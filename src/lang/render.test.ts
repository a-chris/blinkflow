// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { parse } from './parser';
import { renderFlow, setAllPanels } from './render';

const options = { editor: 'vscode' as const, baseDir: '/root/repo' };

describe('render', () => {
  it('renders a node per line with its kind', () => {
    const root = renderFlow(parse(['- step', '! boom', '~ later', '< back'].join('\n')), options);
    const kinds = Array.from(root.querySelectorAll('.lg-node')).map((n) => (n as HTMLElement).dataset.kind);
    expect(kinds).toEqual(['step', 'failure', 'async', 'return']);
  });

  it('shows arms as labelled pills', () => {
    const root = renderFlow(parse(['gate: ok', '  draft:', '  else:'].join('\n')), options);
    const labels = Array.from(root.querySelectorAll('.lg-arm-label')).map((n) => n.textContent);
    expect(labels).toEqual(['gate:', 'draft:', 'else:']);
    expect(root.querySelector<HTMLElement>('[data-reserved="else"]')).not.toBeNull();
  });

  it('renders a panel collapsed, showing only the peek line', () => {
    const root = renderFlow(parse(['- step', '  > SELECT * FROM expenses', '    WHERE user_id = $1'].join('\n')), options);

    const toggle = root.querySelector<HTMLButtonElement>('.lg-panel-toggle');
    const body = root.querySelector<HTMLElement>('.lg-panel-body');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.querySelector('.lg-peek')?.textContent).toBe('SELECT * FROM expenses');
    expect(body?.hidden).toBe(true);
    expect(body?.textContent).toContain('WHERE user_id = $1');
  });

  it('opens and closes a panel on click', () => {
    const root = renderFlow(parse(['- step', '  > peek', '    body line'].join('\n')), options);
    const toggle = root.querySelector<HTMLButtonElement>('.lg-panel-toggle')!;
    const body = root.querySelector<HTMLElement>('.lg-panel-body')!;
    const panel = root.querySelector<HTMLElement>('.lg-panel')!;
    const chevron = toggle.querySelector('.lg-chevron')!;

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    expect(panel.classList.contains('is-open')).toBe(true);
    expect(chevron.textContent).toBe('▾');

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    expect(chevron.textContent).toBe('▸');
  });

  it('renders a peek-only panel as a static line, not a button', () => {
    const root = renderFlow(parse(['- step', '  > just a note'].join('\n')), options);
    expect(root.querySelector('.lg-panel-toggle')).toBeNull();
    expect(root.querySelector('.lg-panel-static')?.textContent).toBe('just a note');
  });

  it('opens and closes every panel at once', () => {
    const root = renderFlow(parse(['- a', '  > p1', '    b1', '- b', '  > p2', '    b2'].join('\n')), options);
    const bodies = () => Array.from(root.querySelectorAll<HTMLElement>('.lg-panel-body'));

    setAllPanels(root, true);
    expect(bodies().every((b) => !b.hidden)).toBe(true);

    setAllPanels(root, false);
    expect(bodies().every((b) => b.hidden)).toBe(true);
  });

  it('links an anchor to the configured editor and reports the click', () => {
    const onAnchorClick = vi.fn();
    const root = renderFlow(parse('- charge @app/services/charge.rb:9'), { ...options, onAnchorClick });

    const link = root.querySelector<HTMLAnchorElement>('.lg-anchor')!;
    expect(link.href).toBe('vscode://file/root/repo/app/services/charge.rb:9:1');
    expect(link.textContent).toBe('charge.rb:9');

    link.click();
    expect(onAnchorClick).toHaveBeenCalledTimes(1);
    expect(onAnchorClick.mock.calls[0][0]).toBe('vscode://file/root/repo/app/services/charge.rb:9:1');
  });

  it('re-renders anchors when the editor changes', () => {
    const root = renderFlow(parse('- charge @app/charge.rb:9'), { editor: 'sublime', baseDir: '/root' });
    expect(root.querySelector<HTMLAnchorElement>('.lg-anchor')!.href).toBe(
      'subl://open?url=file:///root/app/charge.rb&line=9',
    );
  });

  it('shows an empty state', () => {
    expect(renderFlow(parse('# only a comment'), options).querySelector('.lg-empty')).not.toBeNull();
  });
});
