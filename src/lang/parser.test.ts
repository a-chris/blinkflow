import { describe, expect, it } from 'vitest';
import { parse } from './parser';

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

  it('keeps a panel body raw, including lines that look like nodes', () => {
    const doc = [
      '- Database.where(...)',
      '  > SELECT * FROM expenses',
      '    WHERE user_id = $1',
      '    - this is a bullet, not a step',
      '    > and this is not a nested panel',
      '- next step',
    ].join('\n');

    const result = parse(doc);
    const where = result.nodes[0];

    expect(result.nodes).toHaveLength(2);
    expect(where.panels).toHaveLength(1);
    expect(where.panels[0].peek).toBe('SELECT * FROM expenses');
    expect(where.panels[0].body).toEqual([
      'WHERE user_id = $1',
      '- this is a bullet, not a step',
      '> and this is not a nested panel',
    ]);
  });

  it('dedents panel bodies to their own margin', () => {
    const doc = ['- step', '  > peek', '      deep line', '        deeper'].join('\n');
    expect(parse(doc).nodes[0].panels[0].body).toEqual(['deep line', '  deeper']);
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
    const result = parse(['- fine', '> orphan'].join('\n'));
    expect(result.issues[0].line).toBe(2);
  });
});
