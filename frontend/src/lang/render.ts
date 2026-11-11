import { buildOpenUrl, displayRef, type EditorId } from './anchors';
import type { Anchor, LNode, Note, Panel, PanelBodyItem, ParseResult } from './parser';

export interface RenderOptions {
  editor: EditorId;
  baseDir: string;
  onAnchorClick?: (url: string, anchor: Anchor, node?: LNode) => void;
}

const GLYPHS: Record<string, string> = {
  step: '–',
  failure: '✕',
  async: '≈',
  return: '↩',
  actor: '@',
  gate: '◆',
  arm: '◦',
  fold: '>',
};

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * Wire a toggle to the body it opens. `owner` is the element that carries the
 * open state — a panel box or a fold row — so both accordions open the same way.
 */
function bindToggle(toggle: HTMLButtonElement, body: HTMLElement, owner: HTMLElement): void {
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
    owner.classList.toggle('is-open', !open);
  });
}

export function renderFlow(result: ParseResult, options: RenderOptions): HTMLElement {
  const flow = el('div', 'bf-flow');

  if (result.notes.length > 0) flow.appendChild(renderDocumentNotes(result.notes));

  if (result.roots.length === 0) {
    const empty = el('div', 'bf-empty');
    empty.textContent = 'Nothing to draw yet — start with a line like `- GET /expenses`.';
    flow.appendChild(empty);
    return flow;
  }

  const list = el('div', 'bf-content bf-roots');
  result.roots.forEach((node, index) => {
    list.appendChild(renderNode(node, options, index === result.roots.length - 1));
  });
  flow.appendChild(list);
  return flow;
}

function renderNode(node: LNode, options: RenderOptions, isLast: boolean): HTMLElement {
  if (node.kind === 'fold' && node.fold && node.fold.body.length > 0) {
    return renderFold(node, options, isLast);
  }

  const wrapper = el('div', 'bf-node');
  wrapper.dataset.kind = node.kind;
  wrapper.dataset.line = String(node.line);
  if (node.reserved) wrapper.dataset.reserved = node.reserved;
  if (isLast) wrapper.classList.add('bf-is-last');

  const marker = el('div', 'bf-marker');
  marker.setAttribute('aria-hidden', 'true');
  const glyph = el('span', 'bf-glyph');
  glyph.textContent = GLYPHS[node.kind] ?? '·';
  marker.appendChild(glyph);

  const main = el('div', 'bf-main');
  const row = el('div', 'bf-row');

  if ((node.kind === 'arm' || node.kind === 'gate') && node.label) {
    const label = el('span', 'bf-arm-label');
    label.textContent = `${node.label}:`;
    row.appendChild(label);
  }

  if (node.text !== '') {
    const text = el('span', 'bf-text');
    text.textContent = node.text;
    row.appendChild(text);
  }

  // Notes sit before the anchor: the note is about this component, the anchor
  // is a pointer out of it.
  for (const note of node.notes) row.appendChild(renderNote(note));
  if (node.anchor) row.appendChild(renderAnchor(node.anchor, options, node));
  main.appendChild(row);

  if (node.children.length > 0) {
    const content = el('div', 'bf-content');
    const lastChild = node.children[node.children.length - 1];
    for (const child of node.children) {
      content.appendChild(renderNode(child, options, child === lastChild));
    }
    main.appendChild(content);
  }

  wrapper.append(marker, main);
  return wrapper;
}

function peekSpan(panel: Panel): HTMLElement {
  const peek = el('span', 'bf-peek');
  peek.textContent = panel.peek || 'details';
  return peek;
}

function renderPanel(panel: Panel, options: RenderOptions, node: LNode): HTMLElement {
  const box = el('div', 'bf-panel');
  const head = el('div', 'bf-panel-head');

  if (panel.body.length === 0) {
    // A peek with no body has nothing to open: render it as an annotation.
    box.classList.add('bf-panel-static');
    head.appendChild(peekSpan(panel));
    box.appendChild(head);
  } else {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'bf-panel-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.dataset.line = String(panel.line);

    // The badge shows the language's own operator: `>` in the source is `>`
    // in the render, rotated a quarter turn once the body is open.
    const glyph = el('span', 'bf-panel-glyph');
    glyph.textContent = '>';
    glyph.setAttribute('aria-hidden', 'true');

    const count = el('span', 'bf-panel-count');
    count.textContent = String(panel.body.length);
    count.title = `${panel.body.length} line${panel.body.length === 1 ? '' : 's'} inside`;

    toggle.append(glyph, peekSpan(panel), count);

    const body = el('div', 'bf-panel-body');
    body.hidden = true;

    appendBodyItems(body, panel.body, options, node);
    bindToggle(toggle, body, box);

    head.appendChild(toggle);
    box.append(head, body);
  }

  // The notes and anchor live beside the toggle, not inside it: nesting a link
  // in a button would make it invalid HTML and swallow the click. Notes come
  // first, anchors last.
  for (const note of panel.notes) head.appendChild(renderNote(note));
  if (panel.anchor) head.appendChild(renderAnchor(panel.anchor, options, node));

  return box;
}

/**
 * Text runs render as one block each; a nested panel splits the run, so the
 * body reads in exactly the order it was written. Shared by panels and folds.
 */
function appendBodyItems(body: HTMLElement, items: PanelBodyItem[], options: RenderOptions, node: LNode): void {
  let run: string[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const pre = document.createElement('pre');
    pre.className = 'bf-pre';
    pre.textContent = run.join('\n');
    body.appendChild(pre);
    run = [];
  };
  for (const item of items) {
    if (item.kind === 'text') {
      run.push(item.text);
      continue;
    }
    flush();
    body.appendChild(renderPanel(item.panel, options, node));
  }
  flush();
}

/**
 * A fold: the line itself is the accordion. It is drawn as a node — the `>`
 * marker in the spine, the line in the text column — so an accordion keeps its
 * place in the tree, and the detail opens underneath it.
 */
function renderFold(node: LNode, options: RenderOptions, isLast: boolean): HTMLElement {
  const wrapper = el('div', 'bf-node bf-fold');
  wrapper.dataset.kind = 'fold';
  wrapper.dataset.line = String(node.line);
  if (isLast) wrapper.classList.add('bf-is-last');

  const marker = el('div', 'bf-marker');
  marker.setAttribute('aria-hidden', 'true');
  const glyph = el('span', 'bf-glyph');
  glyph.textContent = '>';
  marker.appendChild(glyph);

  const main = el('div', 'bf-main');
  const row = el('div', 'bf-panel-head');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'bf-fold-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.dataset.line = String(node.line);

  const text = el('span', 'bf-text');
  text.textContent = node.text;

  const count = el('span', 'bf-panel-count');
  const lines = node.fold!.body.length;
  count.textContent = String(lines);
  count.title = `${lines} line${lines === 1 ? '' : 's'} inside`;

  toggle.append(text, count);
  row.appendChild(toggle);

  // The notes and anchor sit beside the toggle, never inside it: a link nested
  // in a button is invalid HTML and would swallow the click.
  for (const note of [...node.notes, ...(node.fold?.notes ?? [])]) row.appendChild(renderNote(note));
  if (node.anchor) row.appendChild(renderAnchor(node.anchor, options, node));
  main.appendChild(row);

  const body = el('div', 'bf-panel-body');
  body.hidden = true;
  appendBodyItems(body, node.fold!.body, options, node);
  main.appendChild(body);
  bindToggle(toggle, body, wrapper);

  wrapper.append(marker, main);
  return wrapper;
}

function renderAnchor(anchor: Anchor, options: RenderOptions, node?: LNode): HTMLElement {
  const url = buildOpenUrl(options.editor, options.baseDir, anchor);
  const link = document.createElement('a');
  link.className = 'bf-anchor';
  link.href = url;
  link.dataset.path = anchor.path;
  if (anchor.line) link.dataset.line = String(anchor.line);
  link.title = `Open ${anchor.path}${anchor.line ? `:${anchor.line}` : ''}`;
  link.textContent = displayRef(anchor);

  link.addEventListener('click', (event) => {
    event.preventDefault();
    if (options.onAnchorClick) options.onAnchorClick(url, anchor, node);
    else window.location.href = url;
  });

  return link;
}

/**
 * A note page with a folded corner — reads as "note" at 13px far better than a
 * pencil, and as inline SVG it takes `currentColor` and never renders as emoji.
 */
function noteGlyph(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'bf-note-icon');

  const outline = document.createElementNS(ns, 'path');
  outline.setAttribute('d', 'M3.4 2.4h9.2a1 1 0 0 1 1 1v6.5l-3.7 3.7H3.4a1 1 0 0 1-1-1V3.4a1 1 0 0 1 1-1Z');
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', 'currentColor');
  outline.setAttribute('stroke-width', '1.25');
  outline.setAttribute('stroke-linejoin', 'round');

  const fold = document.createElementNS(ns, 'path');
  fold.setAttribute('d', 'M10 13.6v-3.4a.4.4 0 0 1 .4-.4h3.2');
  fold.setAttribute('fill', 'none');
  fold.setAttribute('stroke', 'currentColor');
  fold.setAttribute('stroke-width', '1.25');
  fold.setAttribute('stroke-linejoin', 'round');

  const lineA = document.createElementNS(ns, 'path');
  lineA.setAttribute('d', 'M4.9 5.6h6.2');
  lineA.setAttribute('stroke', 'currentColor');
  lineA.setAttribute('stroke-width', '1.1');
  lineA.setAttribute('stroke-linecap', 'round');

  const lineB = document.createElementNS(ns, 'path');
  lineB.setAttribute('d', 'M4.9 8.1h4.1');
  lineB.setAttribute('stroke', 'currentColor');
  lineB.setAttribute('stroke-width', '1.1');
  lineB.setAttribute('stroke-linecap', 'round');

  svg.append(outline, fold, lineA, lineB);
  return svg;
}

/**
 * A `#` note on a component: hover for the popup, click for the dialog.
 * Works the same on a node and on an accordion.
 */
function renderNote(note: Note): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bf-note';
  button.dataset.line = String(note.line);
  button.appendChild(noteGlyph());
  const firstLine = note.text.split('\n')[0];
  const more = note.text.includes('\n') ? ' …' : '';
  button.setAttribute('aria-label', `note: ${firstLine}${more}`);

  button.addEventListener('mouseenter', () => showNotePopup(button, note.text));
  button.addEventListener('mouseleave', hideNotePopup);
  button.addEventListener('focus', () => showNotePopup(button, note.text));
  button.addEventListener('blur', hideNotePopup);
  button.addEventListener('click', () => {
    hideNotePopup();
    openNoteDialog(note);
  });

  return button;
}

/** `#` lines before any node describe the document itself. */
function renderDocumentNotes(notes: Note[]): HTMLElement {
  const list = el('div', 'bf-doc-notes');

  for (const note of notes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bf-doc-note';
    const label = el('span', 'bf-doc-note-text');
    label.textContent = note.text;
    button.append(noteGlyph(), label);
    button.title = 'open this note';
    button.addEventListener('click', () => openNoteDialog(note));
    list.appendChild(button);
  }

  return list;
}

let notePopup: HTMLElement | null = null;
let noteDialog: HTMLDialogElement | null = null;

function notePopupEl(): HTMLElement {
  if (notePopup) return notePopup;
  const popup = el('div', 'bf-note-pop');
  popup.setAttribute('role', 'tooltip');
  document.body.appendChild(popup);
  notePopup = popup;
  return popup;
}

function showNotePopup(anchor: HTMLElement, text: string): void {
  const popup = notePopupEl();
  popup.textContent = text;
  popup.classList.add('is-visible');

  const gap = 10;
  const anchorBox = anchor.getBoundingClientRect();
  const box = popup.getBoundingClientRect();

  let top = anchorBox.top - box.height - gap;
  if (top < 8) top = anchorBox.bottom + gap;
  let left = anchorBox.left + anchorBox.width / 2 - box.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));

  popup.style.top = `${Math.round(top)}px`;
  popup.style.left = `${Math.round(left)}px`;
}

export function hideNotePopup(): void {
  notePopup?.classList.remove('is-visible');
}

function noteDialogEl(): HTMLDialogElement {
  if (noteDialog) return noteDialog;

  const dialog = document.createElement('dialog');
  dialog.className = 'bf-note-dialog';

  const header = el('header', 'bf-note-head');
  const title = el('span', 'bf-note-title');
  const glyph = el('span', 'bf-note-glyph');
  glyph.appendChild(noteGlyph());
  title.append(glyph, document.createTextNode(' note'));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bf-note-close';
  close.textContent = 'close';
  close.addEventListener('click', closeNoteDialog);
  header.append(title, close);

  const text = el('p', 'bf-note-text');
  const meta = el('p', 'bf-note-line');

  dialog.append(header, text, meta);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeNoteDialog();
  });
  document.body.appendChild(dialog);

  noteDialog = dialog;
  return dialog;
}

export function openNoteDialog(note: Note): void {
  const dialog = noteDialogEl();
  const text = dialog.querySelector('.bf-note-text');
  const meta = dialog.querySelector('.bf-note-line');
  if (text) text.textContent = note.text;
  if (meta) meta.textContent = `line ${note.line}`;

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

export function closeNoteDialog(): void {
  if (!noteDialog) return;
  if (typeof noteDialog.close === 'function') noteDialog.close();
  else noteDialog.removeAttribute('open');
}

/** Open or close every accordion in a rendered flow, nested ones included. */
export function setAllPanels(root: HTMLElement, open: boolean): void {
  const toggles = root.querySelectorAll<HTMLButtonElement>('.bf-fold-toggle, .bf-panel-toggle');
  toggles.forEach((toggle) => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    if (isOpen !== open) toggle.click();
  });
}
