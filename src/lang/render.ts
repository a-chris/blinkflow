import { buildOpenUrl, displayRef, type EditorId } from './anchors';
import { contentOf } from './parser';
import type { Anchor, LNode, Panel, ParseResult } from './parser';

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

  const list = el('div', 'lg-content lg-roots');
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

  if (node.anchor) row.appendChild(renderAnchor(node.anchor, options, node));
  main.appendChild(row);

  const items = contentOf(node);
  if (items.length > 0) {
    const content = el('div', 'lg-content');
    const lastChild = node.children[node.children.length - 1];
    for (const item of items) {
      content.appendChild(
        item.kind === 'panel'
          ? renderPanel(item.panel, options, node)
          : renderNode(item.node, options, item.node === lastChild),
      );
    }
    main.appendChild(content);
  }

  wrapper.append(marker, main);
  return wrapper;
}

function peekSpan(panel: Panel): HTMLElement {
  const peek = el('span', 'lg-peek');
  peek.textContent = panel.peek || 'details';
  return peek;
}

function renderPanel(panel: Panel, options: RenderOptions, node: LNode): HTMLElement {
  const box = el('div', 'lg-panel');
  const head = el('div', 'lg-panel-head');

  if (panel.body.length === 0) {
    // A peek with no body has nothing to open: render it as an annotation.
    box.classList.add('lg-panel-static');
    head.appendChild(peekSpan(panel));
    box.appendChild(head);
  } else {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'lg-panel-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.dataset.line = String(panel.line);

    // The badge shows the language's own operator: `>` in the source is `>`
    // in the render, rotated a quarter turn once the body is open.
    const glyph = el('span', 'lg-panel-glyph');
    glyph.textContent = '>';
    glyph.setAttribute('aria-hidden', 'true');

    const count = el('span', 'lg-panel-count');
    count.textContent = String(panel.body.length);
    count.title = `${panel.body.length} line${panel.body.length === 1 ? '' : 's'} inside`;

    toggle.append(glyph, peekSpan(panel), count);

    const body = el('div', 'lg-panel-body');
    body.hidden = true;

    // Text runs render as one block each; a nested panel splits the run, so the
    // body reads in exactly the order it was written.
    let run: string[] = [];
    const flush = (): void => {
      if (run.length === 0) return;
      const pre = document.createElement('pre');
      pre.className = 'lg-pre';
      pre.textContent = run.join('\n');
      body.appendChild(pre);
      run = [];
    };
    for (const item of panel.body) {
      if (item.kind === 'text') {
        run.push(item.text);
        continue;
      }
      flush();
      body.appendChild(renderPanel(item.panel, options, node));
    }
    flush();

    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
      box.classList.toggle('is-open', !open);
    });

    head.appendChild(toggle);
    box.append(head, body);
  }

  // The anchor lives beside the toggle, not inside it: nesting a link in a
  // button would make it invalid HTML and swallow the click.
  if (panel.anchor) head.appendChild(renderAnchor(panel.anchor, options, node));

  return box;
}

function renderAnchor(anchor: Anchor, options: RenderOptions, node?: LNode): HTMLElement {
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
    if (options.onAnchorClick) options.onAnchorClick(url, anchor, node);
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
