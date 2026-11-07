import { describe, expect, it } from 'vitest';
import { contentOf, parse, stats } from './parser';
import type { Panel } from './parser';

/** Flatten a panel body to readable labels: text as-is, nested panels in <>. */
const bodyOf = (panel: Panel): string[] =>
  panel.body.map((item) => (item.kind === 'text' ? item.text : `<${item.panel.peek}>`));

describe('structure', () => {
  it('builds the tree from indentation', () => {
    const doc = [
      '@user',
      'GET v3/expenses',
      '  gate: permission expenses.read',
      '    yes:',
      '      - Services::GetExpenses.call(user_id)',
      '        - Database.where(user_id:)',
      '    no:',
      '      - 403 { error: "forbidden" }',
    ].join('\n');

    const result = parse(doc);

    expect(result.roots.map((n) => n.kind)).toEqual(['actor', 'step']);
    expect(result.roots[0].text).toBe('@user');

    const get = result.roots[1];
    expect(get.text).toBe('GET v3/expenses');
    expect(get.children).toHaveLength(1);

    const gate = get.children[0];
    expect(gate.kind).toBe('gate');
    expect(gate.text).toBe('permission expenses.read');
    expect(gate.children.map((c) => c.label)).toEqual(['yes', 'no']);

    const yes = gate.children[0];
    expect(yes.kind).toBe('arm');
    expect(yes.reserved).toBe('yes');
    expect(yes.children).toHaveLength(1);
    expect(yes.children[0].children[0].text).toBe('Database.where(user_id:)');
    expect(result.issues).toEqual([]);
  });

  it('tracks depth for rendering', () => {
    const result = parse('- a\n  - b\n    - c');
    expect(result.nodes.map((n) => n.depth)).toEqual([0, 1, 2]);
  });

  it('keeps text lines raw, including lines that look like bullets', () => {
    const doc = [
      '- Database.where(...)',
      '  > SELECT * FROM expenses',
      '    WHERE user_id = $1',
      '    - this is a bullet, not a step',
      '- next step',
    ].join('\n');

    const result = parse(doc);
    const where = result.nodes[0];

    expect(result.nodes).toHaveLength(2);
    expect(where.panels).toHaveLength(1);
    expect(where.panels[0].peek).toBe('SELECT * FROM expenses');
    expect(bodyOf(where.panels[0])).toEqual([
      'WHERE user_id = $1',
      '- this is a bullet, not a step',
    ]);
  });

  it('dedents panel bodies to their own margin', () => {
    const doc = ['- step', '  > peek', '      deep line', '        deeper'].join('\n');
    expect(bodyOf(parse(doc).nodes[0].panels[0])).toEqual(['deep line', '  deeper']);
  });

  it('extracts an anchor from a panel peek line', () => {
    const doc = [
      '- step',
      '  > build_query — clamps per_page   @app/services/get_expenses.rb:34',
      '    body line',
    ].join('\n');
    const panel = parse(doc).nodes[0].panels[0];
    expect(panel.peek).toBe('build_query — clamps per_page');
    expect(panel.anchor).toEqual({ path: 'app/services/get_expenses.rb', line: 34 });
    expect(bodyOf(panel)).toEqual(['body line']);
  });

  it('extracts an anchor from a peek-only panel', () => {
    const panel = parse(['- step', '  > see @app/models/expense.rb'].join('\n')).nodes[0].panels[0];
    expect(panel.peek).toBe('see');
    expect(panel.anchor).toEqual({ path: 'app/models/expense.rb' });
  });

  it('leaves a peek without an anchor untouched', () => {
    const panel = parse(['- step', '  > just prose'].join('\n')).nodes[0].panels[0];
    expect(panel.peek).toBe('just prose');
    expect(panel.anchor).toBeUndefined();
  });

  it('ignores blank lines and comments', () => {
    const result = parse(['# a comment', '', '- one', '', '  # another', '- two'].join('\n'));
    expect(result.nodes.map((n) => n.text)).toEqual(['one', 'two']);
  });
});

describe('markers', () => {
  it('recognises every flow marker', () => {
    const result = parse(['- step', '! failure', '~ async', '< return'].join('\n'));
    expect(result.nodes.map((n) => n.kind)).toEqual(['step', 'failure', 'async', 'return']);
  });

  it('treats an unmarked line as a step, so an entry point needs no dash', () => {
    const result = parse(['GET v3/expenses', '  - list them'].join('\n'));
    expect(result.roots[0].kind).toBe('step');
    expect(result.roots[0].text).toBe('GET v3/expenses');
    expect(result.issues).toEqual([]);
  });

  it('strips the legacy arrow and warns once', () => {
    const result = parse(['-> first', '  -> second'].join('\n'));
    expect(result.nodes[0].kind).toBe('step');
    expect(result.nodes[0].text).toBe('first');
    expect(result.issues.filter((i) => i.severity === 'hint')).toHaveLength(1);
    expect(result.issues[0].message).toContain('`-`');
  });

  it('hints when a marker is not followed by a space', () => {
    const result = parse('-oops');
    expect(result.nodes[0].kind).toBe('step');
    expect(result.issues[0].severity).toBe('hint');
    expect(result.issues[0].message).toContain('space');
  });

  it('flags tabs', () => {
    const result = parse('\t- step');
    expect(result.issues.some((i) => i.severity === 'error' && /tab/.test(i.message))).toBe(true);
  });
});

describe('arms', () => {
  it('separates reserved words from free-form labels', () => {
    const result = parse(
      ['gate: x', '  yes:', '  no:', '  else:', '  err: Timeout', '  draft:', '  submitted:'].join('\n'),
    );
    const arms = result.nodes.filter((n) => n.kind === 'arm');
    expect(arms.map((a) => a.label)).toEqual(['yes', 'no', 'else', 'err', 'draft', 'submitted']);
    expect(arms.map((a) => a.reserved)).toEqual(['yes', 'no', 'else', 'err', undefined, undefined]);
    expect(arms[3].text).toBe('Timeout');
  });

  it('accepts multi-word labels for path splits', () => {
    const result = parse(['PATCH /x', '  existing customer:', '    - password login'].join('\n'));
    expect(result.roots[0].children[0].label).toBe('existing customer');
    expect(result.issues).toEqual([]);
  });

  it('does not turn a colon inside a token into an arm', () => {
    const result = parse(['- key:value pair', '12:30'].join('\n'));
    expect(result.nodes.map((n) => n.kind)).toEqual(['step', 'step']);
  });

  it('hints when an arm label is a sentence', () => {
    const result = parse('gate: x\n  when the user is a draft:');
    expect(result.issues[0].severity).toBe('hint');
    expect(result.issues[0].message).toContain('sentence');
  });

  it('requires a gate for value matching but not for path splits', () => {
    const result = parse(['PATCH /x', '  new user:', '    - signup', '  returning:', '    - login'].join('\n'));
    const arms = result.roots[0].children;
    expect(arms.map((a) => a.label)).toEqual(['new user', 'returning']);
    expect(arms[0].children[0].text).toBe('signup');
  });
});

describe('nested panels', () => {
  it('parses a panel inside a panel body', () => {
    const doc = [
      '- step',
      '  > outer peek',
      '    intro line',
      '    > inner peek',
      '      SELECT 1',
      '    outro line',
    ].join('\n');
    const outer = parse(doc).nodes[0].panels[0];

    expect(outer.peek).toBe('outer peek');
    expect(bodyOf(outer)).toEqual(['intro line', '<inner peek>', 'outro line']);

    const inner = outer.body.find((i) => i.kind === 'panel');
    expect(inner?.kind).toBe('panel');
    if (inner?.kind === 'panel') expect(bodyOf(inner.panel)).toEqual(['SELECT 1']);
  });

  it('nests three levels deep', () => {
    const doc = [
      '- step',
      '  > one',
      '    > two',
      '      > three',
      '        leaf',
    ].join('\n');
    const one = parse(doc).nodes[0].panels[0];
    const two = one.body[0];
    expect(two.kind).toBe('panel');
    if (two.kind !== 'panel') return;
    const three = two.panel.body[0];
    expect(three.kind).toBe('panel');
    if (three.kind !== 'panel') return;
    expect(bodyOf(three.panel)).toEqual(['leaf']);
  });

  it('ends a nested panel where its indentation ends', () => {
    const doc = ['- step', '  > outer', '    > inner', '      inner body', '    back to outer', '  after outer'].join(
      '\n',
    );
    const outer = parse(doc).nodes[0].panels[0];
    expect(bodyOf(outer)).toEqual(['<inner>', 'back to outer']);
  });

  it('supports an anchor on a nested peek', () => {
    const doc = ['- step', '  > outer', '    > SQL  @app/models/expense.rb:41', '      SELECT 1'].join('\n');
    const outer = parse(doc).nodes[0].panels[0];
    const inner = outer.body.find((i) => i.kind === 'panel');
    expect(inner?.kind === 'panel' && inner.panel.anchor).toEqual({
      path: 'app/models/expense.rb',
      line: 41,
    });
  });

  it('lets a backslash escape a literal leading greater-than', () => {
    const doc = ['- step', '  > peek', '    \\> not a panel'].join('\n');
    expect(bodyOf(parse(doc).nodes[0].panels[0])).toEqual(['> not a panel']);
  });

  it('counts nested panels in the stats', () => {
    const doc = ['- step', '  > one', '    > two', '      > three'].join('\n');
    expect(stats(parse(doc)).panels).toBe(3);
  });
});

describe('source order', () => {
  it('attaches a panel to the sibling above it, not to the ancestor', () => {
    const doc = [
      '- root step',
      '  - first child',
      '  - second child',
      '  > detail about the second child',
      '  - third child',
    ].join('\n');
    const result = parse(doc);
    const root = result.nodes[0];
    expect(root.panels).toHaveLength(0);
    expect(root.children.map((c) => c.text)).toEqual(['first child', 'second child', 'third child']);
    expect(root.children[1].panels.map((p) => p.peek)).toEqual(['detail about the second child']);
  });

  it('accepts a panel indented at the same level as the line it follows', () => {
    const result = parse(['- step', '> detail'].join('\n'));
    expect(result.issues).toEqual([]);
    expect(result.nodes[0].panels).toHaveLength(1);
  });

  it('keeps panels and children in the order they were written', () => {
    const doc = [
      '- step',
      '  > note written first',
      '  - child one',
      '  - child two',
      '> note written last',
    ].join('\n');
    const items = contentOf(parse(doc).nodes[0]);
    expect(items.map((i) => (i.kind === 'panel' ? `panel:${i.panel.peek}` : `node:${i.node.text}`))).toEqual([
      'panel:note written first',
      'node:child one',
      'node:child two',
      'panel:note written last',
    ]);
  });

  it('renders a panel written after the children below them', () => {
    const doc = ['- call', '  - a', '  - b', '> query for the call', '  SELECT 1'].join('\n');
    const items = contentOf(parse(doc).nodes[0]);
    expect(items.map((i) => i.kind)).toEqual(['node', 'node', 'panel']);
  });
});

describe('anchors', () => {
  it('extracts path, line and column from the end of a line', () => {
    const result = parse('- Services::GetExpenses.call   @app/services/get_expenses.rb:12:4');
    const node = result.nodes[0];
    expect(node.text).toBe('Services::GetExpenses.call');
    expect(node.anchor).toEqual({ path: 'app/services/get_expenses.rb', line: 12, column: 4 });
  });

  it('works without a line number', () => {
    expect(parse('- charge @app/services/charge.rb').nodes[0].anchor).toEqual({
      path: 'app/services/charge.rb',
    });
  });

  it('does not treat an actor as an anchor', () => {
    const node = parse('@user').nodes[0];
    expect(node.kind).toBe('actor');
    expect(node.anchor).toBeUndefined();
  });

  it('leaves non-numeric line suffixes alone', () => {
    const node = parse('- deploy @bin/release:abc').nodes[0];
    expect(node.anchor).toBeUndefined();
    expect(node.text).toBe('deploy @bin/release:abc');
  });
});

describe('errors', () => {
  it('reports a panel with no parent', () => {
    const result = parse('> orphan');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('error');
    expect(result.nodes).toHaveLength(0);
  });

  it('reports the source line of a problem', () => {
    const result = parse(['# nothing to attach to', '> orphan'].join('\n'));
    expect(result.issues[0].line).toBe(2);
  });
});
