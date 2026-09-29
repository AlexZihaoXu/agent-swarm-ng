import { describe, expect, it } from 'vitest';
import { color256, parseAnsi } from './ansi';

describe('parseAnsi', () => {
  it('turns SGR escapes into styled runs that carry across lines', () => {
    const [first, second] = parseAnsi('a\x1b[1;32mgo\n on\x1b[0m done');
    expect(first).toEqual([
      { text: 'a', style: {} },
      { text: 'go', style: { bold: true, fg: '#0dbc79' } },
    ]);
    expect(second).toEqual([
      { text: ' on', style: { bold: true, fg: '#0dbc79' } },
      { text: ' done', style: {} },
    ]);
  });

  it('understands bright, 256-colour and true-colour codes', () => {
    const [line] = parseAnsi('\x1b[94ma\x1b[38;5;196;48;2;1;2;3mb\x1b[39;49mc');
    expect(line.map(run => run.style)).toEqual([{ fg: '#3b8eea' }, { fg: 'rgb(255, 0, 0)', bg: 'rgb(1, 2, 3)' }, {}]);
    expect(color256(244)).toBe('rgb(128, 128, 128)');
  });
});
