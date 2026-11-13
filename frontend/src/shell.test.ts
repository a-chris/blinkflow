// @vitest-environment jsdom
/**
 * The shell is static HTML, and it is the one file `main.ts` cannot guard: it
 * wires controls by id and would happily start without a link in the corner.
 * The GitHub link is a whole navigation target in that file, so it is pinned
 * here rather than left to whoever next edits the header.
 */
import shellHtml from '../index.html?raw';
import { describe, expect, it } from 'vitest';

const shell = new DOMParser().parseFromString(shellHtml, 'text/html');
const links = Array.from(shell.querySelectorAll<HTMLAnchorElement>('.topbar .controls a'));

describe('shell', () => {
  it('puts one links-away control in the controls, last', () => {
    expect(links).toHaveLength(1);
    expect(shell.querySelector('.topbar .controls')?.lastElementChild).toBe(links[0]);
  });

  it('points it at the project, in a new tab, without handing over the opener', () => {
    const link = links[0];
    expect(link.getAttribute('href')).toBe('https://github.com/a-chris/blinkflow');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')?.split(/\s+/).sort()).toEqual(['noopener', 'noreferrer']);
  });

  it('names the link for a screen reader, and hides the mark from it', () => {
    const link = links[0];
    expect(link.getAttribute('aria-label')).toBe('Blinkflow on GitHub');
    expect(link.textContent?.trim()).toBe('');
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
