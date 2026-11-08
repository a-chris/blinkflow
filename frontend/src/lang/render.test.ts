// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { parse } from './parser';
import { renderFlow, setAllPanels } from './render';

const options = { editor: 'vscode' as const, baseDir: '/root/repo' };

describe('render', () => {
  it('renders a node per line with its kind', () => {
    const root = renderFlow(parse(['- step', '! boom', '~ later', '< back'].join('\n')), options);
    const kinds = Array.from(root.querySelectorAll('.bf-node')).map((n) => (n as HTMLElement).dataset.kind);
    expect(kinds).toEqual(['step', 'failure', 'async', 'return']);
  });

  it('shows arms as labelled pills', () => {
    const root = renderFlow(parse(['gate: ok', '  draft:', '  else:'].join('\n')), options);
    const labels = Array.from(root.querySelectorAll('.bf-arm-label')).map((n) => n.textContent);
    expect(labels).toEqual(['gate:', 'draft:', 'else:']);
    expect(root.querySelector<HTMLElement>('[data-reserved="else"]')).not.toBeNull();
  });

  it('renders a panel collapsed, showing only the peek line', () => {
    const root = renderFlow(parse(['- step', '  > SELECT * FROM expenses', '    WHERE user_id = $1'].join('\n')), options);

    const toggle = root.querySelector<HTMLButtonElement>('.bf-panel-toggle');
    const body = root.querySelector<HTMLElement>('.bf-panel-body');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.querySelector('.bf-peek')?.textContent).toBe('SELECT * FROM expenses');
    expect(body?.hidden).toBe(true);
    expect(body?.textContent).toContain('WHERE user_id = $1');
  });

  it('opens and closes a panel on click', () => {
    const root = renderFlow(parse(['- step', '  > peek', '    body line'].join('\n')), options);
    const toggle = root.querySelector<HTMLButtonElement>('.bf-panel-toggle')!;
    const body = root.querySelector<HTMLElement>('.bf-panel-body')!;
    const panel = root.querySelector<HTMLElement>('.bf-panel')!;
    const glyph = toggle.querySelector('.bf-panel-glyph')!;

    expect(glyph.textContent).toBe('>');

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    expect(panel.classList.contains('is-open')).toBe(true);

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    expect(panel.classList.contains('is-open')).toBe(false);
  });

  it('shows how many lines are inside a collapsed panel', () => {
    const root = renderFlow(parse(['- step', '  > peek', '    one', '    two', '    three'].join('\n')), options);
    expect(root.querySelector('.bf-panel-count')?.textContent).toBe('3');
  });

  it('renders a peek-only panel as a static line, not a button', () => {
    const root = renderFlow(parse(['- step', '  > just a note'].join('\n')), options);
    expect(root.querySelector('.bf-panel-toggle')).toBeNull();
    expect(root.querySelector('.bf-panel-static')?.textContent).toBe('just a note');
  });

  it('opens and closes every panel at once', () => {
    const root = renderFlow(parse(['- a', '  > p1', '    b1', '- b', '  > p2', '    b2'].join('\n')), options);
    const bodies = () => Array.from(root.querySelectorAll<HTMLElement>('.bf-panel-body'));

    setAllPanels(root, true);
    expect(bodies().every((b) => !b.hidden)).toBe(true);

    setAllPanels(root, false);
    expect(bodies().every((b) => b.hidden)).toBe(true);
  });

  it('links an anchor to the configured editor and reports the click', () => {
    const onAnchorClick = vi.fn();
    const root = renderFlow(parse('- charge @app/services/charge.rb:9'), { ...options, onAnchorClick });

    const link = root.querySelector<HTMLAnchorElement>('.bf-anchor')!;
    expect(link.href).toBe('vscode://file/root/repo/app/services/charge.rb:9:1');
    expect(link.textContent).toBe('charge.rb:9');

    link.click();
    expect(onAnchorClick).toHaveBeenCalledTimes(1);
    expect(onAnchorClick.mock.calls[0][0]).toBe('vscode://file/root/repo/app/services/charge.rb:9:1');
  });

  it('re-renders anchors when the editor changes', () => {
    const root = renderFlow(parse('- charge @app/charge.rb:9'), { editor: 'sublime', baseDir: '/root' });
    expect(root.querySelector<HTMLAnchorElement>('.bf-anchor')!.href).toBe(
      'subl://open?url=file:///root/app/charge.rb&line=9',
    );
  });

  it('links an anchor written on a peek line, without toggling the panel', () => {
    const onAnchorClick = vi.fn();
    const doc = ['- step', '  > build query  @app/services/get_expenses.rb:12', '    body line'].join('\n');
    const root = renderFlow(parse(doc), { ...options, onAnchorClick });

    const link = root.querySelector<HTMLAnchorElement>('.bf-panel-head .bf-anchor')!;
    expect(link).not.toBeNull();
    expect(link.href).toBe('vscode://file/root/repo/app/services/get_expenses.rb:12:1');
    expect(link.textContent).toBe('get_expenses.rb:12');
    expect(root.querySelector('.bf-peek')?.textContent).toBe('build query');

    link.click();
    expect(onAnchorClick).toHaveBeenCalledTimes(1);
    expect(onAnchorClick.mock.calls[0][1]).toEqual({
      path: 'app/services/get_expenses.rb',
      line: 12,
    });

    const toggle = root.querySelector<HTMLButtonElement>('.bf-panel-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector<HTMLElement>('.bf-panel-body')!.hidden).toBe(true);
  });

  it('links an anchor on a peek-only panel', () => {
    const root = renderFlow(parse(['- step', '  > see @app/models/expense.rb:41'].join('\n')), options);
    expect(root.querySelector('.bf-panel-toggle')).toBeNull();
    expect(root.querySelector<HTMLAnchorElement>('.bf-panel-static .bf-anchor')!.href).toBe(
      'vscode://file/root/repo/app/models/expense.rb:41:1',
    );
  });

  it('renders panels and children in the order they were written', () => {
    const doc = ['- step', '  > first note', '    note body', '  - child', '> second note', '  note body'].join(
      '\n',
    );
    const root = renderFlow(parse(doc), options);
    const own = root.querySelector('.bf-node > .bf-main > .bf-content')!;
    const order = Array.from(own.children).map((n) =>
      n.classList.contains('bf-panel') ? n.querySelector('.bf-peek')?.textContent : n.querySelector('.bf-text')?.textContent,
    );
    expect(order).toEqual(['first note', 'child', 'second note']);
  });

  it('renders a nested accordion inside the outer body', () => {
    const doc = ['- step', '  > outer peek', '    intro', '    > inner peek', '      SELECT 1', '    outro'].join('\n');
    const root = renderFlow(parse(doc), options);

    const outerBody = root.querySelector<HTMLElement>('.bf-panel-body')!;
    const inner = outerBody.querySelector<HTMLElement>('.bf-panel')!;
    expect(inner).not.toBeNull();
    expect(inner.querySelector('.bf-peek')?.textContent).toBe('inner peek');

    const innerBody = inner.querySelector<HTMLElement>('.bf-panel-body')!;
    expect(innerBody.hidden).toBe(true);
    expect(innerBody.textContent).toContain('SELECT 1');
  });

  it('keeps text runs around a nested panel in order', () => {
    const doc = ['- step', '  > outer', '    intro', '    > inner', '      body', '    outro'].join('\n');
    const root = renderFlow(parse(doc), options);
    const outerBody = root.querySelector<HTMLElement>('.bf-panel-body')!;
    const shape = Array.from(outerBody.children).map((n) =>
      n.tagName === 'PRE' ? `pre:${n.textContent}` : `panel:${n.querySelector('.bf-peek')?.textContent}`,
    );
    expect(shape).toEqual(['pre:intro', 'panel:inner', 'pre:outro']);
  });

  it('toggles a nested panel without collapsing the outer one', () => {
    const doc = ['- step', '  > outer', '    intro', '    > inner', '      body'].join('\n');
    const root = renderFlow(parse(doc), options);
    const outerToggle = root.querySelector<HTMLButtonElement>('.bf-panel-toggle')!;
    outerToggle.click();
    expect(outerToggle.getAttribute('aria-expanded')).toBe('true');

    const innerToggle = root.querySelectorAll<HTMLButtonElement>('.bf-panel-toggle')[1]!;
    innerToggle.click();
    expect(innerToggle.getAttribute('aria-expanded')).toBe('true');
    expect(outerToggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelectorAll<HTMLElement>('.bf-panel-body')[1].hidden).toBe(false);
  });

  it('opens nested panels with expand all', () => {
    const doc = ['- step', '  > outer', '    > inner', '      body'].join('\n');
    const root = renderFlow(parse(doc), options);
    setAllPanels(root, true);
    const bodies = Array.from(root.querySelectorAll<HTMLElement>('.bf-panel-body'));
    expect(bodies).toHaveLength(2);
    expect(bodies.every((b) => !b.hidden)).toBe(true);
  });

  it('renders a note chip on the node it belongs to', () => {
    const root = renderFlow(parse(['- step', '  # the reason'].join('\n')), options);
    const chip = root.querySelector<HTMLButtonElement>('.bf-note')!;
    expect(chip).not.toBeNull();
    expect(chip.querySelector('svg.bf-note-icon')).not.toBeNull();
    expect(chip.getAttribute('aria-label')).toContain('the reason');
  });

  it('shows a note chip on an accordion, not only on nodes', () => {
    const doc = ['- step', '  > SELECT * FROM expenses', '    WHERE user_id = $1', '    # slow at p99'].join('\n');
    const root = renderFlow(parse(doc), options);
    const panelHead = root.querySelector<HTMLElement>('.bf-panel-head')!;
    const chip = panelHead.querySelector<HTMLButtonElement>('.bf-note')!;
    expect(chip).not.toBeNull();
    expect(chip.getAttribute('aria-label')).toContain('slow at p99');
  });

  it('puts the note chip before the source anchor', () => {
    const doc = ['- charge @app/services/charge.rb:9', '  # timeout is deliberate'].join('\n');
    const row = renderFlow(parse(doc), options).querySelector('.bf-row')!;
    const order = Array.from(row.children).map((n) => n.className.split(' ')[0].replace('bf-', ''));
    expect(order).toEqual(['text', 'note', 'anchor']);
  });

  it('puts the note chip before the anchor on an accordion too', () => {
    const doc = ['- step', '  > summarize  @app/services/x.rb:2', '    # about the query', '    SELECT 1'].join('\n');
    const head = renderFlow(parse(doc), options).querySelector('.bf-panel-head')!;
    const order = Array.from(head.children).map((n) => n.className.split(' ')[0].replace('bf-', ''));
    expect(order).toEqual(['panel-toggle', 'note', 'anchor']);
  });

  it('renders one chip for a multi-line note and shows every line', () => {
    const doc = ['- step', '  # 3 writes in one transaction', '  # never call this outside a request'].join('\n');
    const root = renderFlow(parse(doc), options);

    expect(root.querySelectorAll('.bf-note')).toHaveLength(1);

    const chip = root.querySelector<HTMLButtonElement>('.bf-note')!;
    chip.dispatchEvent(new MouseEvent('mouseenter'));
    const popup = document.querySelector<HTMLElement>('.bf-note-pop')!;
    expect(popup.textContent).toBe('3 writes in one transaction\nnever call this outside a request');

    chip.click();
    const dialog = document.querySelector<HTMLDialogElement>('.bf-note-dialog')!;
    expect(dialog.querySelector('.bf-note-text')?.textContent).toBe(
      '3 writes in one transaction\nnever call this outside a request',
    );
    expect(dialog.querySelector('.bf-note-line')?.textContent).toBe('line 2');
  });

  it('shows the note in a popup on hover', () => {
    const root = renderFlow(parse(['- step', '  # measured on prod'].join('\n')), options);
    const chip = root.querySelector<HTMLButtonElement>('.bf-note')!;
    chip.dispatchEvent(new MouseEvent('mouseenter'));

    const popup = document.querySelector<HTMLElement>('.bf-note-pop')!;
    expect(popup.classList.contains('is-visible')).toBe(true);
    expect(popup.textContent).toBe('measured on prod');

    chip.dispatchEvent(new MouseEvent('mouseleave'));
    expect(popup.classList.contains('is-visible')).toBe(false);
  });

  it('opens a dialog when a note is clicked', () => {
    const root = renderFlow(parse(['- step', '  # the long version'].join('\n')), options);
    root.querySelector<HTMLButtonElement>('.bf-note')!.click();

    const dialog = document.querySelector<HTMLDialogElement>('.bf-note-dialog')!;
    expect(dialog).not.toBeNull();
    expect(dialog.open || dialog.hasAttribute('open')).toBe(true);
    expect(dialog.querySelector('.bf-note-text')?.textContent).toBe('the long version');
    expect(dialog.querySelector('.bf-note-line')?.textContent).toBe('line 2');
  });

  it('renders document notes above the flow', () => {
    const root = renderFlow(parse(['# v3/expenses — API flow', '- step'].join('\n')), options);
    const notes = root.querySelectorAll('.bf-doc-note');
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toBe('v3/expenses — API flow');
  });

  it('shows an empty state', () => {
    expect(renderFlow(parse('# only a comment'), options).querySelector('.bf-empty')).not.toBeNull();
  });
});
