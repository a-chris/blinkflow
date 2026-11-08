// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  decodeShare,
  describeLength,
  embeddedOrigin,
  embeddedUrl,
  encodeShare,
  readShareInput,
  shareUrl,
  ShareError,
} from './share';

const hasCompression = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

const doc = `# v3/expenses — API flow

@user
GET v3/expenses
  gate: permission expenses.read
    yes:
      - Services::GetExpenses.call(user_id)   @app/services/get_expenses.rb:12
        > AR query builder — clamps per_page, opaque cursor
          - per_page clamped to 1..100, default 25
    no:
      - 403 { error: "forbidden" }
`;

describe('round trip', () => {
  it('encodes and decodes a document', async () => {
    const payload = await encodeShare(doc);
    expect(await decodeShare(payload)).toBe(doc);
  });

  it('keeps the payload URL-safe', async () => {
    for (const sample of [doc, 'x'.repeat(5000), 'üñîçø∂é 🎉']) {
      const payload = await encodeShare(sample);
      expect(payload).toMatch(/^[A-Za-z0-9\-_.]+$/);
      expect(payload).not.toContain('+');
      expect(payload).not.toContain('/');
      expect(payload).not.toContain('=');
    }
  });

  it('survives unicode and awkward whitespace', async () => {
    const tricky = 'a\tb\r\nc — em dash\n🎉🎉\n\n  trailing  ';
    expect(await decodeShare(await encodeShare(tricky))).toBe(tricky);
  });

  it('handles an empty document', async () => {
    expect(await decodeShare(await encodeShare(''))).toBe('');
  });

  it('round-trips a large document', async () => {
    const large = doc.repeat(200);
    const payload = await encodeShare(large);
    expect(await decodeShare(payload)).toBe(large);
  });
});

describe.skipIf(!hasCompression)('compression', () => {
  it('compresses rather than storing the text', async () => {
    const payload = await encodeShare(doc);
    expect(payload.startsWith('c1.')).toBe(true);
    expect(payload.length).toBeLessThan(doc.length);
  });

  it('beats plain base64 by a wide margin on repetitive text', async () => {
    const repetitive = doc.repeat(50);
    const compressed = await encodeShare(repetitive);
    const plain = 'p1.' + btoa(unescape(encodeURIComponent(repetitive))).replace(/=+$/, '');
    expect(compressed.length).toBeLessThan(plain.length * 0.5);
  });
});

describe('decoding failures', () => {
  it('rejects a payload that is not a share link', async () => {
    await expect(decodeShare('hello')).rejects.toBeInstanceOf(ShareError);
  });

  it('says a newer build made the link, instead of showing an empty document', async () => {
    await expect(decodeShare('c2.HVTRx8wQ')).rejects.toThrow('needs a newer blinkflow');
  });

  it('rejects damaged base64', async () => {
    await expect(decodeShare('p1.!!!!')).rejects.toBeInstanceOf(ShareError);
  });

  it('rejects truncated compressed data', async () => {
    const payload = await encodeShare(doc);
    await expect(decodeShare(payload.slice(0, payload.length - 20))).rejects.toBeInstanceOf(ShareError);
  });
});

describe('plain payloads', () => {
  it('decodes a p1 payload without compression support', async () => {
    const payload = 'p1.' + btoa(unescape(encodeURIComponent('GET /x\n  - y'))).replace(/=+$/, '');
    expect(await decodeShare(payload)).toBe('GET /x\n  - y');
  });
});

describe('readShareInput', () => {
  it('reads the fragment', () => {
    expect(readShareInput({ hash: '#c1.abc', pathname: '/' })).toBe('c1.abc');
  });

  it('falls back to the path, so hand-written links work', () => {
    expect(readShareInput({ hash: '', pathname: '/c1.abc' })).toBe('c1.abc');
    expect(readShareInput({ hash: '', pathname: '/p1.abc' })).toBe('p1.abc');
  });

  it('ignores an ordinary path', () => {
    expect(readShareInput({ hash: '', pathname: '/' })).toBeNull();
    expect(readShareInput({ hash: '', pathname: '/blinkflow/' })).toBeNull();
    expect(readShareInput({ hash: '', pathname: '/assets/index-Cikaj9Ln.js' })).toBeNull();
    expect(readShareInput({ hash: '', pathname: '/a1.png' })).toBeNull();
  });

  it('reads the payload from a mounted subpath, matching the server', () => {
    expect(readShareInput({ hash: '', pathname: '/blinkflow/c1.abc' })).toBe('c1.abc');
    expect(readShareInput({ hash: '', pathname: '/a/b/p1.abc/' })).toBe('p1.abc');
  });

  it('still ignores a subpath that carries no payload', () => {
    expect(readShareInput({ hash: '', pathname: '/blinkflow/' })).toBeNull();
    expect(readShareInput({ hash: '', pathname: '/blinkflow/index.html' })).toBeNull();
  });

  it('still reads a version it cannot decode, so the user gets an explanation', () => {
    expect(readShareInput({ hash: '', pathname: '/c2.abc' })).toBe('c2.abc');
    expect(readShareInput({ hash: '#c2.abc', pathname: '/' })).toBe('c2.abc');
  });
});

describe('embeddedOrigin', () => {
  it('uses the declared server origin, so a dev editor cannot emit its own port', () => {
    expect(embeddedOrigin('http://localhost:5174', 'http://localhost:8080')).toBe('http://localhost:8080');
  });

  it('falls back to the page origin when nothing is declared', () => {
    expect(embeddedOrigin('https://blinkflow.example', null)).toBe('https://blinkflow.example');
    expect(embeddedOrigin('https://blinkflow.example', '')).toBe('https://blinkflow.example');
    expect(embeddedOrigin('https://blinkflow.example', '   ')).toBe('https://blinkflow.example');
  });

  it('tolerates a trailing slash in the declaration', () => {
    expect(embeddedOrigin('http://localhost:5174', 'http://localhost:8080/')).toBe('http://localhost:8080');
  });
});

describe('embeddedUrl', () => {
  it('puts the payload in the path, where a server can answer for it', () => {
    expect(embeddedUrl('http://localhost:8080', '/', 'c1.abc')).toBe('http://localhost:8080/c1.abc');
    expect(embeddedUrl('https://example.com', '/blinkflow/', 'c1.abc')).toBe(
      'https://example.com/blinkflow/c1.abc',
    );
  });

  it('round-trips under a subpath, where both sides agree on the last segment', () => {
    const url = embeddedUrl('https://example.com', '/blinkflow/', 'c1.abc');
    expect(url).toBe('https://example.com/blinkflow/c1.abc');
    const parsed = new URL(url);
    expect(readShareInput({ hash: parsed.hash, pathname: parsed.pathname })).toBe('c1.abc');
  });

  it('normalises a path without a trailing slash', () => {
    expect(embeddedUrl('http://x.dev', '/blinkflow', 'c1.abc')).toBe('http://x.dev/blinkflow/c1.abc');
  });

  it('round-trips through readShareInput, so an embedded link opens the same document', () => {
    const url = embeddedUrl('http://localhost:8080', '/', 'c1.abc');
    const parsed = new URL(url);
    expect(readShareInput({ hash: parsed.hash, pathname: parsed.pathname })).toBe('c1.abc');
  });

  it('differs from the simple link only in where the payload sits', () => {
    const privateUrl = shareUrl('http://localhost:8080', '/', 'c1.abc');
    const embedded = embeddedUrl('http://localhost:8080', '/', 'c1.abc');

    expect(privateUrl).toBe('http://localhost:8080/#c1.abc');
    expect(embedded).toBe('http://localhost:8080/c1.abc');
    // Same origin and app path: only the carrier differs.
    expect(privateUrl.replace('#c1.abc', '')).toBe(embedded.replace('c1.abc', ''));
  });
});

describe('shareUrl', () => {
  it('puts the payload in the fragment and keeps the path', () => {
    expect(shareUrl('http://localhost:5174', '/', 'c1.abc')).toBe('http://localhost:5174/#c1.abc');
    expect(shareUrl('https://example.com', '/blinkflow/', 'c1.abc')).toBe(
      'https://example.com/blinkflow/#c1.abc',
    );
  });

  it('treats an empty path as the root', () => {
    expect(shareUrl('http://x.dev', '', 'c1.abc')).toBe('http://x.dev/#c1.abc');
  });
});

describe('describeLength', () => {
  it('reports characters or kilobytes', () => {
    expect(describeLength('x'.repeat(200))).toBe('200 chars');
    expect(describeLength('x'.repeat(3072))).toBe('3.0 KB');
  });
});
