import './styles/app.css';
import { parse, stats, type ParseResult } from './lang/parser';
import { closeNoteDialog, hideNotePopup, renderFlow, setAllPanels } from './lang/render';
import { createEditor } from './lang/editor';
import { DEFAULT_EDITOR, displayRef, EDITORS, type EditorId } from './lang/anchors';
import { DEFAULT_SAMPLE_ID, SAMPLES } from './samples';
import { decodeShare, describeLength, encodeShare, readShareInput, shareUrl, ShareError } from './lang/share';

const STORAGE = {
  doc: 'lightgram.doc',
  sample: 'lightgram.sample',
  editor: 'lightgram.editor',
  baseDir: 'lightgram.baseDir',
};

const DEFAULTS = {
  // Empty on purpose: anchors resolve against whatever repo you point this at.
  baseDir: '',
  editor: DEFAULT_EDITOR as EditorId,
};

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const sampleSelect = byId<HTMLSelectElement>('sample');
const editorSelect = byId<HTMLSelectElement>('open-in');
const baseInput = byId<HTMLInputElement>('base');
const shareButton = byId<HTMLButtonElement>('share');
const expandButton = byId<HTMLButtonElement>('expand');
const collapseButton = byId<HTMLButtonElement>('collapse');
const previewHost = byId<HTMLDivElement>('preview');
const statusBar = byId<HTMLDivElement>('status');
const split = byId<HTMLDivElement>('split');
const gutter = byId<HTMLDivElement>('gutter');

for (const sample of SAMPLES) {
  const option = document.createElement('option');
  option.value = sample.id;
  option.textContent = sample.name;
  sampleSelect.appendChild(option);
}

for (const editor of EDITORS) {
  const option = document.createElement('option');
  option.value = editor.id;
  option.textContent = editor.label;
  option.title = editor.hint;
  editorSelect.appendChild(option);
}

const storedSample = localStorage.getItem(STORAGE.sample);
const initialSampleId =
  storedSample && SAMPLES.some((s) => s.id === storedSample) ? storedSample : DEFAULT_SAMPLE_ID;
const initialSample = SAMPLES.find((s) => s.id === initialSampleId) ?? SAMPLES[0];

/** The app path with any share payload stripped, so it can be cleaned off again. */
function withoutPayload(pathname: string): string {
  const stripped = pathname.replace(/\/(?:c1|p1)\.[^/]+\/?$/, '/');
  return stripped === '' ? '/' : stripped;
}

const sharedPayload = readShareInput({ hash: window.location.hash, pathname: window.location.pathname });
let sharedDoc: string | null = null;
let shareError: string | null = null;
let urlTracksDoc = sharedPayload !== null;

if (sharedPayload !== null) {
  try {
    sharedDoc = await decodeShare(sharedPayload);
  } catch (error) {
    shareError = error instanceof ShareError ? error.message : 'this share link could not be read';
    urlTracksDoc = false;
  }
}

let editorId = (localStorage.getItem(STORAGE.editor) as EditorId | null) ?? DEFAULTS.editor;
if (!EDITORS.some((e) => e.id === editorId)) editorId = DEFAULTS.editor;
let baseDir = localStorage.getItem(STORAGE.baseDir) ?? DEFAULTS.baseDir;
let currentDoc = sharedDoc ?? localStorage.getItem(STORAGE.doc) ?? initialSample.doc;

if (sharedDoc !== null) localStorage.setItem(STORAGE.doc, sharedDoc);

if (sharedDoc !== null) {
  const option = document.createElement('option');
  option.value = 'shared';
  option.textContent = 'shared link';
  sampleSelect.prepend(option);
  sampleSelect.value = 'shared';
} else {
  sampleSelect.value = initialSample.id;
}
editorSelect.value = editorId;
baseInput.value = baseDir;
baseInput.placeholder = '/absolute/path/to/your/repo';

let lastResult: ParseResult | null = null;
let renderTimer: number | undefined;

const view = createEditor({
  doc: currentDoc,
  parent: byId<HTMLDivElement>('editor'),
  onChange: (doc) => {
    currentDoc = doc;
    localStorage.setItem(STORAGE.doc, doc);
    // The URL described the document as it was when shared; once it changes,
    // drop the stale payload so a reload cannot resurrect it.
    if (urlTracksDoc) {
      window.history.replaceState(null, '', withoutPayload(window.location.pathname));
      urlTracksDoc = false;
    }
    schedule();
  },
});

// Dev-only handle: makes the playground debuggable from the console.
if (import.meta.env.DEV) {
  (window as unknown as { lightgram?: unknown }).lightgram = { view };
}

function schedule(): void {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 90);
}

function render(): void {
  const result = parse(currentDoc);
  lastResult = result;

  const flow = renderFlow(result, {
    editor: editorId,
    baseDir,
    onAnchorClick: (url, anchor) => {
      if (baseDir.trim() === '') {
        toast(`set base to your repo root to open ${displayRef(anchor)}`);
        baseInput.focus();
        return;
      }
      toast(`opening ${displayRef(anchor)} in ${labelFor(editorId)}`);
      window.location.href = url;
    },
  });

  // A re-render invalidates any note UI that is still on screen.
  hideNotePopup();
  closeNoteDialog();
  previewHost.replaceChildren(flow);
  status(flowSummary(result));
}

function labelFor(id: EditorId): string {
  return EDITORS.find((editor) => editor.id === id)?.label ?? id;
}

function flowSummary(result: ParseResult): string {
  const s = stats(result);
  const parts = [`${s.nodes} nodes`, `${s.arms} arms`, `${s.panels} panels`];
  if (s.notes > 0) parts.push(`${s.notes} note${s.notes === 1 ? '' : 's'}`);
  if (s.errors > 0) parts.push(`${s.errors} error${s.errors === 1 ? '' : 's'}`);
  if (s.hints > 0) parts.push(`${s.hints} hint${s.hints === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * The async clipboard API needs a focused document and can be refused; a hidden
 * textarea plus execCommand still works in those cases.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the legacy path
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.readOnly = true;
    area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

let toastTimer: number | undefined;
function toast(message: string, milliseconds = 2200): void {
  let node = document.querySelector<HTMLDivElement>('.lg-toast');
  if (!node) {
    node = document.createElement('div');
    node.className = 'lg-toast';
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node?.classList.remove('is-visible'), milliseconds);
}

function status(summary: string): void {
  const result = lastResult;
  if (!result) {
    statusBar.textContent = summary;
    return;
  }
  const issues = result.issues;
  statusBar.classList.toggle('has-error', issues.some((i) => i.severity === 'error'));
  if (issues.length === 0) {
    statusBar.textContent = summary;
    return;
  }
  const first = issues[0];
  const extra = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
  statusBar.textContent = `${summary} — line ${first.line}: ${first.message}${extra}`;
}

sampleSelect.addEventListener('change', () => {
  const sample = SAMPLES.find((s) => s.id === sampleSelect.value);
  if (!sample) return;
  localStorage.setItem(STORAGE.sample, sample.id);
  currentDoc = sample.doc;
  localStorage.setItem(STORAGE.doc, sample.doc);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: sample.doc },
  });
  render();
});

editorSelect.addEventListener('change', () => {
  editorId = editorSelect.value as EditorId;
  localStorage.setItem(STORAGE.editor, editorId);
  render();
});

baseInput.addEventListener('input', () => {
  baseDir = baseInput.value;
  localStorage.setItem(STORAGE.baseDir, baseDir);
  render();
});

shareButton.addEventListener('click', async () => {
  shareButton.disabled = true;
  try {
    const payload = await encodeShare(view.state.doc.toString());
    const url = shareUrl(window.location.origin, withoutPayload(window.location.pathname), payload);
    window.history.replaceState(null, '', `#${payload}`);
    urlTracksDoc = true;

    const size = describeLength(url);
    const long = url.length > 6000 ? ' · long link, some chat apps truncate it' : '';
    const copied = await copyToClipboard(url);
    if (copied) toast(`link copied · ${size}${long}`, long ? 5200 : 3000);
    else toast(`copy blocked — the address bar holds the link · ${size}${long}`, 5200);
  } catch {
    toast('could not build a share link');
  } finally {
    shareButton.disabled = false;
  }
});

expandButton.addEventListener('click', () => {
  setAllPanels(previewHost, true);
});

collapseButton.addEventListener('click', () => {
  setAllPanels(previewHost, false);
});

let dragging = false;
gutter.addEventListener('pointerdown', (event) => {
  dragging = true;
  gutter.setPointerCapture(event.pointerId);
  document.body.classList.add('is-dragging');
});
gutter.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const rect = split.getBoundingClientRect();
  const ratio = ((event.clientX - rect.left) / rect.width) * 100;
  const clamped = Math.min(78, Math.max(22, ratio));
  split.style.setProperty('--left', `${clamped}%`);
});
gutter.addEventListener('pointerup', (event) => {
  dragging = false;
  gutter.releasePointerCapture(event.pointerId);
  document.body.classList.remove('is-dragging');
});

render();

if (shareError !== null) toast(shareError, 5200);
else if (sharedDoc !== null) toast('opened a shared diagram · this link is a snapshot', 3000);
