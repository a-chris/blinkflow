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
import { parse } from './parser';
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

const STEP_KINDS = new Set<LNode['kind']>(['step', 'failure', 'async', 'return']);

function countPanels(panels: LNode['panels']): number {
  let total = 0;
  for (const panel of panels) {
    total += 1;
    for (const item of panel.body) {
      if (item.kind === 'panel') total += countPanels([item.panel]);
    }
  }
  return total;
}

function countNotes(result: ParseResult): number {
  let total = result.notes.length;
  for (const node of result.nodes) {
    total += node.notes.length;
    for (const panel of node.panels) {
      total += panel.notes.length;
      for (const item of panel.body) {
        if (item.kind === 'panel') total += item.panel.notes.length;
      }
    }
  }
  return total;
}

/** The card rules, as the server implements them. */
function derive(result: ParseResult): Expected {
  const gate = result.nodes.find((node) => node.reserved === 'gate');
  const step = result.nodes.find((node) => STEP_KINDS.has(node.kind) && node.text !== '');

  return {
    steps: result.nodes.length,
    arms: result.nodes.filter((node) => node.kind === 'arm').length,
    panels: result.nodes.reduce((total, node) => total + countPanels(node.panels), 0),
    notes: countNotes(result),
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
