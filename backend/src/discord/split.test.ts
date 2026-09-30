import { expect, it } from 'vitest';
import { splitDiscord } from './split';

it('keeps short text whole and splits long text at paragraph and line boundaries', () => {
  expect(splitDiscord('  hi  ')).toEqual(['hi']);
  expect(splitDiscord('')).toEqual([]);
  const paragraphs = Array.from({ length: 30 }, (_, index) => `Paragraph ${index} ${'word '.repeat(20)}`).join('\n\n');
  const parts = splitDiscord(paragraphs, 500);
  expect(parts.length).toBeGreaterThan(1);
  for (const part of parts) expect(part.length).toBeLessThanOrEqual(500);
  const words = (value: string) => value.replace(/\s+/g, ' ').trim();
  expect(words(parts.join('\n'))).toBe(words(paragraphs));
});

it('closes and reopens a code block cut across messages', () => {
  const code = [
    'Here:',
    '```ts',
    ...Array.from({ length: 60 }, (_, index) => `const value${index} = ${index};`),
    '```',
    'Done.',
  ].join('\n');
  const parts = splitDiscord(code, 400);
  expect(parts.length).toBeGreaterThan(2);
  for (const part of parts) {
    expect(part.length).toBeLessThanOrEqual(400);
    expect((part.match(/```/g) ?? []).length % 2).toBe(0); // every part's fences are balanced
  }
  expect(parts[1].startsWith('```ts\n')).toBe(true);
});

it('hard-splits a single line longer than a message', () => {
  const parts = splitDiscord('x'.repeat(4500));
  expect(parts.map(part => part.length)).toEqual([2000, 2000, 500]);
});
