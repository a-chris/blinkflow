// The samples are the first document a visitor reads, and they are the pitch:
// a sample that stops parsing, or that renders as a wall of plain steps, undoes
// the product's own argument. These checks keep the three of them honest.
import { describe, expect, it } from 'vitest';
import { parse, stats } from '../lang/parser';
import { DEFAULT_SAMPLE_ID, SAMPLES } from './index';

describe('playground samples', () => {
  it('ships the three archetypes, the API flow first', () => {
    expect(SAMPLES.map((sample) => sample.id)).toEqual(['articles', 'call-stack', 'user-flow']);
    expect(DEFAULT_SAMPLE_ID).toBe(SAMPLES[0].id);
  });

  it.each(SAMPLES)('$id parses with no errors and no hints', (sample) => {
    expect(parse(sample.doc).issues).toEqual([]);
  });

  it.each(SAMPLES)('$id carries its detail inside accordions', (sample) => {
    // The render has to beat the source: most of a sample belongs in `>`
    // bodies, where it collapses, not on the spine where it does not.
    const counts = stats(parse(sample.doc));
    expect(counts.panels).toBeGreaterThanOrEqual(3);
    expect(counts.notes).toBeGreaterThanOrEqual(2);
  });
});
