import { expect, it } from 'vitest';
import { renderTerminal, terminalSvg } from './terminal-render';
import { viewResult } from './terminal-tools';

it('lays out coloured rows on a monospace grid as inert SVG text', () => {
  const svg = terminalSvg('\x1b[1;31mFAIL\x1b[0m <b>&\n\x1b[42m ok \x1b[0m\x1b[38;5;208mx\x1b[7my', 80);
  expect(svg).toContain('fill="#cd3131" font-weight="bold">FAIL</text>');
  expect(svg).toContain('&lt;b&gt;&amp;');
  expect(svg).not.toContain('<b>');
  expect(svg).toMatch(/<rect x="8" y="28" width="[\d.]+" height="20" fill="#0dbc79"\/>/); // green background, row 2
  expect(svg).toContain('fill="rgb(255,135,0)"'); // 256-colour orange
  expect(svg).toMatch(/<rect [^>]*fill="rgb\(255,135,0\)"\/>/); // inverse swaps into the background
});

it('renders a PNG as wide as the terminal', () => {
  const image = renderTerminal('hello \x1b[32mworld\x1b[0m\n', 120);
  expect([...image.data.slice(1, 4)].map(byte => String.fromCharCode(byte)).join('')).toBe('PNG');
  expect(image.width).toBe(Math.ceil(120 * 16 * 0.602 + 16));
  expect(image.height).toBe(20 + 16);
});

it('a coloured view returns its text without escapes plus an image, kept by reference', async () => {
  const receipt = {
    started: true,
    settled: true as const,
    result: { type: 'terminal', session: { columns: 80 }, text: 'ok', ansi: '\x1b[32mok' },
  };
  const kept: object[] = [];
  const result = await viewResult(receipt, true, async frame => {
    kept.push(frame);
    return { id: 'image-1' };
  });
  expect(result.content).toHaveLength(2);
  expect(result.content[0].type === 'text' && result.content[0].text).not.toContain('\x1b');
  expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  expect(result.details).toEqual({ computerImage: { id: 'image-1' } });
  expect(kept).toHaveLength(1);
  const blind = await viewResult(receipt, false);
  expect(blind.content).toHaveLength(1);
  expect(JSON.stringify(blind.content)).toContain('does not accept images');
  const plain = await viewResult({ ...receipt, result: { type: 'terminal', text: 'ok' } }, true);
  expect(plain.content).toHaveLength(1);
});
