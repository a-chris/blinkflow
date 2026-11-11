/**
 * The preview card is built by the Go server, but the numbers on it come from
 * the same language the playground counts. testdata/og holds one folder both
 * implementations read, so the Go analyser cannot quietly drift from this
 * parser: the same fixtures and the same expected values are asserted on both
 * sides.
 *
 * The expected JSON is generated from this parser (it is the reference) and
 * then fixed; changing a counting rule here without changing the fixtures is a
 * failing test, which is the point.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stats } from './parser';
import type { LNode, ParseResult } from './parser';

const fixtures = fileURLToPath(new URL('../../../testdata/og/', import.meta.url));

interface Expected {
  steps: number;
  arms: number;
  panels: number;
  notes: number;
  firstNote: string;
  firstStep: string;
  firstGate: string;
}

const STEP_KINDS = new Set<LNode['kind']>(['step', 'failure', 'async', 'return', 'fold']);

/**
 * The card rules, as the server implements them. The counts come from `stats()`
 * rather than a copy of it: two implementations of the same arithmetic in one
 * file is how the nested-note count drifted last time.
 */
function derive(result: ParseResult): Expected {
  const counts = stats(result);
  const gate = result.nodes.find((node) => node.reserved === 'gate');
  const step = result.nodes.find((node) => STEP_KINDS.has(node.kind) && node.text !== '');

  return {
    steps: counts.nodes,
    arms: counts.arms,
    panels: counts.panels,
    notes: counts.notes,
    firstNote: (result.notes[0]?.text ?? '').split('\n')[0].trim(),
    firstStep: step?.text ?? '',
    firstGate: gate?.text ?? '',
  };
}

const documents = readdirSync(fixtures)
  .filter((file) => file.endsWith('.lg'))
  .sort();

describe('preview fixtures', () => {
  it('has fixtures to check', () => {
    expect(documents.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of documents) {
    it(`describes ${file} the way the server does`, () => {
      const doc = readFileSync(`${fixtures}${file}`, 'utf8');
      const expected = JSON.parse(readFileSync(`${fixtures}${file.replace(/\.lg$/, '.json')}`, 'utf8')) as Expected;
      expect(derive(parse(doc))).toEqual(expected);
    });
  }
});
