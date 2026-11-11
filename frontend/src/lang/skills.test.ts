// The examples shipped to agents are documentation, and documentation rots.
// These read the real files from `skills/` and parse them, so an example that
// no longer compiles fails CI instead of being published to an agent that will
// then produce a broken link.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parse, stats } from './parser';

const examplesDir = fileURLToPath(new URL('../../../skills/explain-code-flow/examples/', import.meta.url));
const skillFiles = [
  'SKILL.md',
  'reference/writing.md',
  'reference/syntax.md',
].map((name) => ({
  name,
  path: fileURLToPath(new URL(`../../../skills/explain-code-flow/${name}`, import.meta.url)),
}));

const examples = readdirSync(examplesDir)
  .filter((name) => name.endsWith('.lg'))
  .sort();

describe('shipped examples', () => {
  it('includes one example per level of abstraction', () => {
    expect(examples).toEqual(['code-native.lg', 'concept.lg', 'pseudocode.lg']);
  });

  it.each(examples)('%s parses without errors', (name) => {
    const result = parse(readFileSync(examplesDir + name, 'utf8'));

    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it.each(examples)('%s is a diagram, not a flat list', (name) => {
    const counts = stats(parse(readFileSync(examplesDir + name, 'utf8')));

    // A single-root tree is the shape an explanation has: a title that branches.
    expect(counts.nodes).toBeGreaterThan(3);
    expect(counts.arms).toBeGreaterThan(0);
    expect(counts.panels).toBeGreaterThan(0);
  });

  it.each(examples)('%s would publish a card with a readable title', (name) => {
    const source = readFileSync(examplesDir + name, 'utf8');
    const firstLine = source.split('\n')[0];

    // The card takes the document's first note as its title, so that line is
    // the whole first impression in a chat client.
    expect(firstLine.startsWith('# ')).toBe(true);
    expect(firstLine.length).toBeLessThan(80);
  });
});

// Documentation that quotes counts can lie, and a skill that lies about the
// response teaches the model to misread it. These re-derive the numbers from
// the documents themselves: nodes are steps in the server's counting.
function countsOf(document: string) {
  const { nodes, arms, panels, notes } = stats(parse(document));
  return { steps: nodes, arms, panels, notes };
}

function fencedAfter(text: string, heading: string): string {
  const at = text.indexOf(heading);
  if (at < 0) throw new Error(`no heading ${heading}`);
  const fence = text.indexOf('```', at);
  const start = text.indexOf('\n', fence) + 1;
  return text.slice(start, text.indexOf('```', start));
}

describe('documented counts are the real counts', () => {
  it('syntax.md quotes the counts its complete document produces', () => {
    const text = readFileSync(skillFile('reference/syntax.md'), 'utf8');
    const counts = countsOf(fencedAfter(text, '## Complete document'));

    expect(text).toContain(
      `${counts.steps} steps · ${counts.arms} arms · ${counts.panels} panels · ${counts.notes} notes`,
    );
  });

  it('SKILL.md quotes the counts of the document in its worked example', () => {
    const text = readFileSync(skillFile('SKILL.md'), 'utf8');
    const counts = countsOf(fencedAfter(text, 'Document —'));

    for (const [field, value] of Object.entries(counts)) {
      expect(text).toContain(`"${field}":${value}`);
    }
  });

  it('SKILL.md quotes the title its worked example produces', () => {
    const text = readFileSync(skillFile('SKILL.md'), 'utf8');
    const document = fencedAfter(text, 'Document —');
    const title = document.split('\n')[0].replace(/^#\s*/, '').trim();

    expect(text).toContain(`"title":"${title}"`);
  });
});

function skillFile(name: string): string {
  return fileURLToPath(new URL(`../../../skills/explain-code-flow/${name}`, import.meta.url));
}

describe('skill files', () => {
  it.each(skillFiles)('$name exists and carries the workflow', ({ path }) => {
    const text = readFileSync(path, 'utf8');

    expect(text.length).toBeGreaterThan(200);
    // Every file an agent fetches has to say where the endpoint is, or it will
    // reach for the repository instead of the API.
    if (path.endsWith('SKILL.md')) {
      expect(text).toContain('https://blinkflow.live/share');
      expect(text).toContain('--data-binary');
    }
  });
});
