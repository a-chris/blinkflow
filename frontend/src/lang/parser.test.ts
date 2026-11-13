import { describe, expect, it } from 'vitest';
import { parse, stats } from './parser';
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
    const query = result.nodes[1];

    expect(result.nodes).toHaveLength(3);
    expect(query.kind).toBe('fold');
    expect(query.text).toBe('SELECT * FROM expenses');
    expect(bodyOf(query.fold!)).toEqual(['WHERE user_id = $1', '- this is a bullet, not a step']);
  });

  it('dedents panel bodies to their own margin', () => {
    const doc = ['- step', '  > peek', '      deep line', '        deeper'].join('\n');
    expect(bodyOf(parse(doc).nodes[1].fold!)).toEqual(['deep line', '  deeper']);
  });

  it('extracts an anchor from a panel peek line', () => {
    const doc = [
      '- step',
      '  > build_query — clamps per_page   @app/services/get_expenses.rb:34',
      '    body line',
    ].join('\n');
    const accordion = parse(doc).nodes[1];
    expect(accordion.text).toBe('build_query — clamps per_page');
    expect(accordion.anchor).toEqual({ path: 'app/services/get_expenses.rb', line: 34 });
    expect(bodyOf(accordion.fold!)).toEqual(['body line']);
  });

  it('extracts an anchor from a peek-only panel', () => {
    const accordion = parse(['- step', '  > see @app/models/expense.rb'].join('\n')).nodes[1];
    expect(accordion.text).toBe('see');
    expect(accordion.anchor).toEqual({ path: 'app/models/expense.rb' });
  });

  it('leaves a peek without an anchor untouched', () => {
    const accordion = parse(['- step', '  > just prose'].join('\n')).nodes[1];
    expect(accordion.text).toBe('just prose');
    expect(accordion.anchor).toBeUndefined();
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

  it('lets a lone CR separate lines, the way the card side reads it', () => {
    const result = parse('- a\r- b\r');
    expect(result.nodes.map((n) => n.text)).toEqual(['a', 'b']);
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

describe('notes', () => {
  it('attaches a note to the line above it', () => {
    const doc = ['- Database.where(...)', '  # p50 measured on prod, 6ms at p99', '- next'].join('\n');
    const result = parse(doc);
    expect(result.nodes[0].notes).toEqual([{ text: 'p50 measured on prod, 6ms at p99', line: 2 }]);
    expect(result.nodes[1].notes).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('attaches a note written at the same indent as its line', () => {
    const result = parse(['- step', '# same indent'].join('\n'));
    expect(result.nodes[0].notes[0].text).toBe('same indent');
  });

  it('merges consecutive note lines into one note', () => {
    const doc = [
      '- step',
      '  # 3 writes in one transaction',
      '  # never call this outside a request',
    ].join('\n');
    const notes = parse(doc).nodes[0].notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('3 writes in one transaction\nnever call this outside a request');
    expect(notes[0].line).toBe(2);
  });

  it('keeps an empty `#` as a paragraph break inside one note', () => {
    const doc = ['- step', '  # first para', '  #', '  # second para'].join('\n');
    const notes = parse(doc).nodes[0].notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('first para\n\nsecond para');
  });

  it('does not merge across a line in between, or across indents', () => {
    const apart = parse(['- step', '  # one', '    - child', '  # two'].join('\n'));
    expect(apart.nodes[0].notes.map((n) => n.text)).toEqual(['one', 'two']);

    const indented = parse(['- step', '  # shallow', '    # deeper'].join('\n'));
    expect(indented.nodes[0].notes.map((n) => n.text)).toEqual(['shallow', 'deeper']);
  });

  it('treats notes before any node as document notes', () => {
    const result = parse(['# v3/expenses — API flow', '# a second line', '', '- step'].join('\n'));
    expect(result.notes.map((n) => n.text)).toEqual(['v3/expenses — API flow\na second line']);
    expect(result.nodes[0].notes).toEqual([]);
  });

  it('attaches a note written inside a body to that accordion', () => {
    const doc = ['- step', '  > shell', '    # the script is idempotent', '    $ ls'].join('\n');
    const accordion = parse(doc).nodes[1].fold!;
    expect(accordion.notes.map((n) => n.text)).toEqual(['the script is idempotent']);
    expect(bodyOf(accordion)).toEqual(['$ ls']);
  });

  it('attaches a note written between spine lines to the accordion above', () => {
    const doc = ['- step', '  > peek', '    body line', '  # about this accordion'].join('\n');
    const result = parse(doc);
    expect(result.nodes[1].notes.map((n) => n.text)).toEqual(['about this accordion']);
    expect(result.nodes[0].notes).toEqual([]);
  });

  it('attaches a note inside a body to the nested panel above it', () => {
    const doc = ['- step', '  > outer', '    > inner', '      sql', '    # about the inner one', '    text'].join(
      '\n',
    );
    const outer = parse(doc).nodes[1].fold!;
    const inner = outer.body.find((i) => i.kind === 'panel');
    expect(inner?.kind === 'panel' && inner.panel.notes.map((n) => n.text)).toEqual(['about the inner one']);
    expect(outer.notes).toEqual([]);
  });

  it('keeps an escaped hash as text', () => {
    const doc = ['- step', '  > shell', '    \\# not a note'].join('\n');
    const accordion = parse(doc).nodes[1].fold!;
    expect(accordion.notes).toEqual([]);
    expect(bodyOf(accordion)).toEqual(['# not a note']);
  });

  it('ignores an empty note', () => {
    const result = parse(['- step', '  #', '  #   '].join('\n'));
    expect(result.nodes[0].notes).toEqual([]);
  });

  it('counts notes in the stats, including notes on accordions', () => {
    const doc = ['# doc note', '- step', '  # node note', '  > peek', '    # panel note'].join('\n');
    expect(stats(parse(doc)).notes).toBe(3);
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
    const node = parse(doc).nodes[1];
    const outer = node.fold!;

    expect(node.text).toBe('outer peek');
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
    const one = parse(doc).nodes[1].fold!;
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
    const outer = parse(doc).nodes[1].fold!;
    expect(bodyOf(outer)).toEqual(['<inner>', 'back to outer']);
  });

  it('supports an anchor on a nested peek', () => {
    const doc = ['- step', '  > outer', '    > SQL  @app/models/expense.rb:41', '      SELECT 1'].join('\n');
    const outer = parse(doc).nodes[1].fold!;
    const inner = outer.body.find((i) => i.kind === 'panel');
    expect(inner?.kind === 'panel' && inner.panel.anchor).toEqual({
      path: 'app/models/expense.rb',
      line: 41,
    });
  });

  it('lets a backslash escape a literal leading greater-than', () => {
    const doc = ['- step', '  > peek', '    \\> not a panel'].join('\n');
    expect(bodyOf(parse(doc).nodes[1].fold!)).toEqual(['> not a panel']);
  });

  it('counts a panel only where the accordion has a body', () => {
    // `> three` opens nothing, so it is body text and not a panel — the same
    // count the server's analyzer reaches for the preview card.
    const doc = ['- step', '  > one', '    > two', '      > three'].join('\n');
    expect(stats(parse(doc)).panels).toBe(2);
  });
});

describe('source order', () => {
  it('puts an accordion under the line it is indented in, not on an ancestor', () => {
    const doc = [
      '- root step',
      '  - first child',
      '  - second child',
      '    > detail about the second child',
      '  - third child',
    ].join('\n');
    const result = parse(doc);
    const root = result.nodes[0];
    expect(root.children.map((c) => c.text)).toEqual(['first child', 'second child', 'third child']);
    const detail = root.children[1].children[0];
    expect(detail.kind).toBe('fold');
    expect(detail.text).toBe('detail about the second child');
    expect(root.children[0].children).toEqual([]);
  });

  it('turns a `>` at the step above its own indent into a fold', () => {
    const doc = [
      '- root step',
      '  - first child',
      '  - second child',
      '  > detail about the second child',
      '    - one fact',
      '  - third child',
    ].join('\n');
    const result = parse(doc);
    const root = result.nodes[0];
    expect(root.children.map((c) => c.kind)).toEqual(['step', 'step', 'fold', 'step']);
    const fold = root.children[2];
    expect(fold.text).toBe('detail about the second child');
    expect(fold.fold?.body.map((i) => (i.kind === 'text' ? i.text : '<panel>'))).toEqual(['- one fact']);
    expect(fold.fold?.notes).toEqual([]);
  });

  it('turns a `>` indented at the same level as the line it follows into a fold', () => {
    const result = parse(['- step', '> detail', '  - one fact'].join('\n'));
    expect(result.issues).toEqual([]);
    expect(result.nodes[1].kind).toBe('fold');
    expect(result.nodes[1].fold?.body).toHaveLength(1);
  });

  it('is the element itself as a first child, not an aside on the parent', () => {
    const doc = [
      'gate: checkout',
      '  yes:',
      '    > Charge.create(amount:, source:)   @lib/charge.rb:9',
      '      # the only irreversible step',
      '      - 900ms p99, 30s timeout',
    ].join('\n');
    const result = parse(doc);

    const arm = result.nodes[1];
    expect(arm.kind).toBe('arm');
    expect(arm.children.map((child) => [child.kind, child.text])).toEqual([
      ['fold', 'Charge.create(amount:, source:)'],
    ]);
    const charge = arm.children[0];
    expect(charge.fold?.body).toHaveLength(1);
    expect(charge.fold?.notes.map((note) => note.text)).toEqual(['the only irreversible step']);
    expect(charge.anchor?.path).toBe('lib/charge.rb');
    expect(stats(result).nodes).toBe(3);
    expect(stats(result).panels).toBe(1);
  });

  it('stands as a component of its own when nothing is above it', () => {
    const doc = ['> shell transcript', '  $ ls', '  the only irreversible step'].join('\n');
    const result = parse(doc);

    expect(result.issues).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    const block = result.nodes[0];
    expect(block.kind).toBe('fold');
    expect(block.marker).toBe('>');
    expect(block.text).toBe('shell transcript');
    expect(block.fold?.body.map((i) => (i.kind === 'text' ? i.text : '<panel>'))).toEqual([
      '$ ls',
      'the only irreversible step',
    ]);
    expect(stats(result).nodes).toBe(1);
    expect(stats(result).panels).toBe(1);
  });

  it('stands on its own only when no line above can own it', () => {
    const doc = ['  > shell transcript', '    $ ls', '> second block', '  more'].join('\n');
    const result = parse(doc);

    // The first block has nothing above it; the second one follows a block at a
    // shallower indent, which is no owner either.
    expect(result.nodes.map((n) => [n.kind, n.indent])).toEqual([
      ['fold', 2],
      ['fold', 0],
    ]);
    expect(result.issues).toEqual([]);
    expect(stats(result).panels).toBe(2);
  });

  it('keeps a `+` line as the plain step it used to be, and says so', () => {
    const doc = ['+ Deploy::Run.call', '  - one fact'].join('\n');
    const result = parse(doc);

    expect(result.nodes[0].kind).toBe('step');
    expect(result.nodes[0].text).toBe('+ Deploy::Run.call');
    expect(result.nodes[0].children[0].text).toBe('one fact');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('hint');
  });

  it('is a plain line, with one hint, when a fold hides nothing', () => {
    const doc = ['> Deploy::Run.call', '- tail step'].join('\n');
    const result = parse(doc);

    // The `>` is not doing its job, so the line is just a line — and the hint
    // says so, once, instead of the render inventing a role for it.
    expect(result.issues.map((issue) => issue.severity)).toEqual(['hint']);
    expect(result.issues[0].message).toContain('opens nothing');
    expect(result.nodes.map((n) => n.kind)).toEqual(['fold', 'step']);
    // Nothing to open, so there is no accordion and no panel to count.
    expect(result.nodes[0].fold).toBeUndefined();
    expect(stats(result).panels).toBe(0);
  });

  it('is a plain line when a sibling-indent `>` hides nothing', () => {
    const doc = ['- step one', '> just a note, no body', '- step two'].join('\n');
    const result = parse(doc);

    expect(result.nodes.map((n) => n.kind)).toEqual(['step', 'fold', 'step']);
    expect(result.nodes[1].text).toBe('just a note, no body');
    expect(result.nodes[1].fold).toBeUndefined();
    expect(stats(result).panels).toBe(0);
  });

  it('treats a `>` that hides nothing inside a body as body text', () => {
    const doc = ['> outer', '  - first fact', '  > a stray opener', '  - second fact'].join('\n');
    const result = parse(doc);
    const body = result.nodes[0].fold!.body;

    // Not a panel: nothing to open, so it is the line it says it is.
    // Body text is raw, so the `-` lines keep theirs; the `>` was a marker, and
    // markers live in the marker column, so the text reads without it.
    expect(body.map((item) => (item.kind === 'text' ? item.text : '<panel>'))).toEqual([
      '- first fact',
      'a stray opener',
      '- second fact',
    ]);
    expect(stats(result).panels).toBe(1);
    expect(result.issues.map((issue) => issue.message)).toEqual([
      expect.stringContaining('opens nothing'),
    ]);
  });

  it('keeps the notes of a `>` that hides nothing', () => {
    const doc = ['> outer', '  - first fact', '  > a stray opener', '    # still worth saying'].join('\n');
    const result = parse(doc);
    const fold = result.nodes[0].fold!;

    // The note is not lost: it belongs to the accordion the line sits in.
    expect(fold.body.map((item) => (item.kind === 'text' ? item.text : '<panel>'))).toEqual([
      '- first fact',
      'a stray opener',
    ]);
    expect(fold.notes.map((note) => note.text)).toEqual(['still worth saying']);
    expect(stats(result).notes).toBe(1);
  });

  it('reports the empty-accordion hint once per document', () => {
    const doc = ['> one with no body', '> another with no body'].join('\n');
    const hints = parse(doc).issues.filter((issue) => issue.severity === 'hint');
    expect(hints).toHaveLength(1);
  });

  it('adds a fold at a sibling’s indent to that sibling group', () => {
    const doc = [
      '- parent',
      '  - Child::Call.call()',
      '  > Charge.create(amount:)   @lib/charge.rb:3',
      '    - one fact',
      '    - another fact',
      '  - plain sibling',
    ].join('\n');
    const result = parse(doc);
    expect(result.issues).toEqual([]);
    const fold = result.nodes[2];
    expect(fold.kind).toBe('fold');
    expect(fold.marker).toBe('>');
    expect(fold.anchor?.path).toBe('lib/charge.rb');
    expect(fold.fold?.body).toHaveLength(2);
    expect(result.nodes[3].text).toBe('plain sibling');
    const s = stats(result);
    expect(s.nodes).toBe(4);
    expect(s.panels).toBe(1);
  });

  it('keeps children in the order they were written', () => {
    const doc = ['- step', '  > accordion first', '    body', '  - child one', '  - child two'].join('\n');
    const children = parse(doc).nodes[0].children;
    expect(children.map((c) => `${c.kind}:${c.text}`)).toEqual([
      'fold:accordion first',
      'step:child one',
      'step:child two',
    ]);
  });

  it('keeps a document-level accordion at the top, in source order', () => {
    const doc = ['> first block', '  body', '- step', '> second block', '  body'].join('\n');
    const result = parse(doc);
    expect(result.roots.map((n) => `${n.kind}:${n.text}`)).toEqual(['fold:first block', 'step:step', 'fold:second block']);
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

  it('keeps a four-part suffix in the text, the way the card side reads it', () => {
    const node = parse('- open it @app/x.go:1:2:3').nodes[0];
    expect(node.anchor).toBeUndefined();
    expect(node.text).toBe('open it @app/x.go:1:2:3');
  });

  it('keeps a scientific line in the text', () => {
    const node = parse('- open it @app/x.go:1e5').nodes[0];
    expect(node.anchor).toBeUndefined();
    expect(node.text).toBe('open it @app/x.go:1e5');
  });

  it('keeps a line number beyond the Go side’s int64 in the text', () => {
    const node = parse('- open it @app/x.go:99999999999999999999').nodes[0];
    expect(node.anchor).toBeUndefined();
    expect(node.text).toBe('open it @app/x.go:99999999999999999999');
  });

  it('accepts the largest line number the Go side reads', () => {
    // 2^63-1 rounds to 2^63 in a double; only the accept/reject decision has
    // to match strconv.Atoi, not the stored precision.
    const node = parse('- open it @app/x.go:9223372036854775807').nodes[0];
    expect(node.anchor?.path).toBe('app/x.go');
    expect(node.anchor?.line).toBe(9223372036854775808);
  });
});

describe('errors', () => {
  it('reports a tab, and keeps drawing the line', () => {
    const result = parse(['- step', '\t- tabbed step'].join('\n'));

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].line).toBe(2);
    expect(result.nodes.map((node) => node.text)).toEqual(['step', 'tabbed step']);
  });

  it('reports the source line of a problem', () => {
    const result = parse(['# a note', '', '- step', '\t- tabbed'].join('\n'));
    expect(result.issues[0].line).toBe(4);
  });

  it('has nothing to say about a `>` at the top of a document', () => {
    // A block with no line above it is a component in its own right, not a
    // mistake: a document is allowed to open with one.
    const result = parse(['> shell transcript', '  $ ls', '  still here'].join('\n'));

    expect(result.issues).toEqual([]);
    expect(result.nodes.map((node) => node.text)).toEqual(['shell transcript']);
    expect(result.nodes[0].fold?.body).toHaveLength(2);
  });
});
