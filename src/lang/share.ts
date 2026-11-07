/**
 * Share links.
 *
 * The document travels inside the URL, so a link needs no server, no storage
 * and no account. Two payload shapes:
 *
 *   c1.<base64url>   deflate-raw compressed  (the normal case)
 *   p1.<base64url>   plain UTF-8             (browser without CompressionStream)
 *
 * base64url, not base64: `+`, `/` and `=` have meaning in a URL path, and `+`
 * turns into a space in a query string.
 */

const COMPRESSED = 'c1.';
const PLAIN = 'p1.';

export class ShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareError';
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new ShareError('this share link is not valid base64');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Push bytes through a compression stream and collect the result. Spelled out
 * with a ReadableStream reader rather than Blob.stream()/Response so it behaves
 * the same in the browser and under jsdom.
 */
async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  // CompressionStream's writable is typed as BufferSource; Uint8Array is one, but
  // the stream generics do not line up, so name the shape explicitly.
  const pair = stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
  const reader = source.pipeThrough(pair).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const canCompress = (): boolean =>
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** Encode a document into a URL-safe payload (no leading `#`). */
export async function encodeShare(doc: string): Promise<string> {
  const bytes = new TextEncoder().encode(doc);

  if (!canCompress()) return PLAIN + toBase64Url(bytes);

  const packed = await through(bytes, new CompressionStream('deflate-raw'));
  return COMPRESSED + toBase64Url(packed);
}

/** Decode a payload produced by {@link encodeShare}. Throws {@link ShareError}. */
export async function decodeShare(payload: string): Promise<string> {
  const value = payload.trim();

  if (value.startsWith(PLAIN)) {
    return new TextDecoder().decode(fromBase64Url(value.slice(PLAIN.length)));
  }

  if (value.startsWith(COMPRESSED)) {
    if (!canCompress()) throw new ShareError('this browser cannot decompress the link');
    const packed = fromBase64Url(value.slice(COMPRESSED.length));
    try {
      return new TextDecoder().decode(await through(packed, new DecompressionStream('deflate-raw')));
    } catch {
      throw new ShareError('this share link is damaged or from another version');
    }
  }

  throw new ShareError('this does not look like a lightgram share link');
}

/**
 * Where a share payload can hide: the fragment by default (`#c1.…`), or the
 * path for links people hand-write (`/c1.…`). The fragment is preferred — it
 * never reaches the server and needs no rewrite rules to serve.
 */
export function readShareInput(location: { hash: string; pathname: string }): string | null {
  const fragment = location.hash.replace(/^#/, '').trim();
  if (fragment !== '') return fragment;

  const segment = location.pathname.replace(/^\/+/, '');
  if (segment.startsWith(COMPRESSED) || segment.startsWith(PLAIN)) return segment;

  return null;
}

/** Build the canonical share URL for a payload. */
export function shareUrl(origin: string, pathname: string, payload: string): string {
  const path = pathname === '' ? '/' : pathname;
  return `${origin}${path}#${payload}`;
}

/** Human-readable size, used to warn when a link is awkward to paste around. */
export function describeLength(url: string): string {
  if (url.length < 1024) return `${url.length} chars`;
  return `${(url.length / 1024).toFixed(1)} KB`;
}
