import { expect, it } from 'vitest';
import { isEmoji, loadEmojiCatalog, searchEmoji } from './emoji-catalog';

it('loads local labeled emoji and skin-tone variants, searchable without a network fetch', async () => {
  const catalog = await loadEmojiCatalog();
  expect(catalog.length).toBeGreaterThan(1500);
  expect(catalog.find(item => item.value === '👍')?.label).toContain('thumbs up');
  expect(searchEmoji(catalog, 'coder').some(item => item.value === '👩🏽‍💻')).toBe(true);
  expect(searchEmoji(catalog, 'canada').some(item => item.value === '🇨🇦')).toBe(true);
  expect(searchEmoji(catalog, 'not-a-real-emoji')).toEqual([]);
  expect(catalog.every(item => isEmoji(item.value))).toBe(true);
});
