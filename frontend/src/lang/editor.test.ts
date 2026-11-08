// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { createEditor } from './editor';

function setup(doc: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = createEditor({ doc, parent: host, onChange: () => {} });

  const press = (key: string, shift = false) => {
    const event = new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
  };

  return { view, press };
}

describe('indent keys', () => {
  it('indents the current line with Tab, in spaces', () => {
    const { view, press } = setup('- step');

    view.dispatch({ selection: EditorSelection.cursor(0) });
    press('Tab');

    expect(view.state.doc.line(1).text).toBe('  - step');
    expect(view.state.doc.toString()).not.toContain('\t');
  });

  it('outdents with Shift-Tab', () => {
    const { view, press } = setup('    - nested');

    view.dispatch({ selection: EditorSelection.cursor(6) });
    press('Tab', true);
    expect(view.state.doc.line(1).text).toBe('  - nested');

    press('Tab', true);
    expect(view.state.doc.line(1).text).toBe('- nested');

    // already at column 0: nothing to remove, and no crash
    press('Tab', true);
    expect(view.state.doc.line(1).text).toBe('- nested');
  });

  it('stops at the start of the line instead of eating into text', () => {
    const { view, press } = setup('- step');

    view.dispatch({ selection: EditorSelection.cursor(0) });
    press('Tab', true);
    expect(view.state.doc.line(1).text).toBe('- step');
  });

  it('indents every line of a multi-line selection', () => {
    const { view, press } = setup('one\ntwo\nthree');

    view.dispatch({ selection: EditorSelection.range(1, 9) });
    press('Tab');

    expect(view.state.doc.toString()).toBe('  one\n  two\n  three');
  });

  it('outdents every line of a multi-line selection', () => {
    const { view, press } = setup('  one\n  two');

    view.dispatch({ selection: EditorSelection.range(2, 9) });
    press('Tab', true);

    expect(view.state.doc.toString()).toBe('one\ntwo');
  });

  it('never inserts a literal tab, which the parser rejects', () => {
    const { view, press } = setup('- step');
    view.dispatch({ selection: EditorSelection.cursor(6) });

    press('Tab');
    press('Tab');

    expect(view.state.doc.line(1).text).not.toMatch(/\t/);
    expect(view.state.doc.line(1).text.startsWith('    ')).toBe(true);
  });
});
