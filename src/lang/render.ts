import { buildOpenUrl, displayRef, type EditorId } from './anchors';
import type { Anchor, LNode, Panel, ParseResult } from './parser';

export interface RenderOptions {
  editor: EditorId;
  baseDir: string;
  onAnchorClick?: (url: string, node: LNode, anchor: Anchor) => void;
}

const GLYPHS: Record<string, string> = {
  step: '–',
  failure: '✕',
  async: '≈',
  return: '↩',
  actor: '@',
  gate: '◆',
  arm: '◦',
};

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function renderFlow(result: ParseResult, options: RenderOptions): HTMLElement {
  const flow = el('div', 'lg-flow');

  if (result.roots.length === 0) {
    const empty = el('div', 'lg-empty');
    empty.textContent = 'Nothing to draw yet — start with a line like `- GET /expenses`.';
    flow.appendChild(empty);
    return flow;
  }

  const list = el('div', 'lg-children lg-roots');
  result.roots.forEach((node, index) => {
    list.appendChild(renderNode(node, options, index === result.roots.length - 1));
  });
  flow.appendChild(list);
  return flow;
}

function renderNode(node: LNode, options: RenderOptions, isLast: boolean): HTMLElement {
  const wrapper = el('div', 'lg-node');
  wrapper.dataset.kind = node.kind;
  wrapper.dataset.line = String(node.line);
  if (node.reserved) wrapper.dataset.reserved = node.reserved;
  if (isLast) wrapper.classList.add('lg-is-last');

  const marker = el('div', 'lg-marker');
  marker.setAttribute('aria-hidden', 'true');
  const glyph = el('span', 'lg-glyph');
  glyph.textContent = GLYPHS[node.kind] ?? '·';
  marker.appendChild(glyph);

  const main = el('div', 'lg-main');
  const row = el('div', 'lg-row');

  if ((node.kind === 'arm' || node.kind === 'gate') && node.label) {
    const label = el('span', 'lg-arm-label');
    label.textContent = `${node.label}:`;
    row.appendChild(label);
  }

  if (node.text !== '') {
    const text = el('span', 'lg-text');
    text.textContent = node.text;
    row.appendChild(text);
  }

  if (node.anchor) row.appendChild(renderAnchor(node, node.anchor, options));
  main.appendChild(row);

  for (const panel of node.panels) main.appendChild(renderPanel(panel));

  if (node.children.length > 0) {
    const children = el('div', 'lg-children');
    node.children.forEach((child, index) => {
      children.appendChild(renderNode(child, options, index === node.children.length - 1));
    });
    main.appendChild(children);
  }

  wrapper.append(marker, main);
  return wrapper;
}

function renderPanel(panel: Panel): HTMLElement {
  const box = el('div', 'lg-panel');

  if (panel.body.length === 0) {
    // A peek with no body has nothing to open: render it as a static detail line.
    box.classList.add('lg-panel-static');
    const staticBody = el('div', 'lg-peek');
    staticBody.textContent = panel.peek || 'details';
    box.appendChild(staticBody);
    return box;
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'lg-panel-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.dataset.line = String(panel.line);

  const chevron = el('span', 'lg-chevron');
  chevron.textContent = '▸';
  const peek = el('span', 'lg-peek');
  peek.textContent = panel.peek || 'details';

  toggle.append(chevron, peek);

  const body = el('div', 'lg-panel-body');
  body.hidden = true;
  const pre = document.createElement('pre');
  pre.className = 'lg-pre';
  pre.textContent = panel.body.join('\n');
  body.appendChild(pre);

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
    chevron.textContent = open ? '▸' : '▾';
    box.classList.toggle('is-open', !open);
  });

  box.append(toggle, body);
  return box;
}

function renderAnchor(node: LNode, anchor: Anchor, options: RenderOptions): HTMLElement {
  const url = buildOpenUrl(options.editor, options.baseDir, anchor);
  const link = document.createElement('a');
  link.className = 'lg-anchor';
  link.href = url;
  link.dataset.path = anchor.path;
  if (anchor.line) link.dataset.line = String(anchor.line);
  link.title = `Open ${anchor.path}${anchor.line ? `:${anchor.line}` : ''}`;
  link.textContent = displayRef(anchor);

  link.addEventListener('click', (event) => {
    event.preventDefault();
    if (options.onAnchorClick) options.onAnchorClick(url, node, anchor);
    else window.location.href = url;
  });

  return link;
}

/** Open or close every panel in a rendered flow. */
export function setAllPanels(root: HTMLElement, open: boolean): void {
  const toggles = root.querySelectorAll<HTMLButtonElement>('.lg-panel-toggle');
  toggles.forEach((toggle) => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    if (isOpen !== open) toggle.click();
  });
}
