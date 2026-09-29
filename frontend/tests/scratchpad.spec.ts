import { test, expect } from './fixtures';

const usage = { files: 2, bytes: 2048, maxFiles: 500, maxBytes: 52_428_800, maxFileBytes: 1_048_576 };

test('agent settings browse the agent’s scratchpad read-only: folders, files and a text preview', async ({ page }) => {
  await page.route(/\/api\/agents\/avery\/scratch(\?.*)?$/, async route => {
    const folder = new URL(route.request().url()).searchParams.get('folder') ?? '';
    expect(route.request().method()).toBe('GET');
    await route.fulfill({
      json:
        folder === 'drafts'
          ? {
              folder,
              folders: [],
              files: [{ name: 'plan.md', path: 'drafts/plan.md', size: 1024, updatedAt: '2026-09-29T12:00:00.000Z' }],
              usage,
            }
          : {
              folder,
              folders: [{ name: 'drafts', path: 'drafts', files: 1, size: 1024 }],
              files: [{ name: 'notes.txt', path: 'notes.txt', size: 1024, updatedAt: '2026-09-29T12:00:00.000Z' }],
              usage,
            },
    });
  });
  await page.route(/\/api\/agents\/avery\/scratch\/file\?.*$/, route =>
    route.fulfill({
      json: {
        path: 'drafts/plan.md',
        size: 1024,
        updatedAt: '2026-09-29T12:00:00.000Z',
        text: '# Plan\n1. Ship it\n',
        offset: 1,
        lines: 2,
        totalLines: 2,
        truncated: false,
        partialLine: false,
        nextOffset: null,
        prevOffset: null,
      },
    }),
  );
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  const scratch = settings.getByRole('region', { name: 'Scratchpad' });
  await scratch.scrollIntoViewIfNeeded();
  await expect(scratch.getByText('2 of 500 files · 2.0 KB of 50.0 MB')).toBeVisible();
  await expect(scratch.getByText('ask Avery to change them')).toBeVisible();
  await scratch.getByRole('button', { name: /drafts\// }).click();
  await scratch.getByRole('button', { name: /plan\.md/ }).click();
  await expect(scratch.getByLabel('Scratch file preview')).toHaveText('# Plan\n1. Ship it\n');
  const crumbs = scratch.getByRole('navigation', { name: 'Scratchpad location' });
  await expect(crumbs).toContainText('drafts');
  await crumbs.getByRole('button', { name: 'Scratchpad' }).click();
  await expect(scratch.getByRole('button', { name: /notes\.txt/ })).toBeVisible();
  // Nothing on the page can change the files.
  await expect(scratch.getByRole('button', { name: /delete|save|edit/i })).toHaveCount(0);
  // The jump links include the section.
  await expect(page.getByRole('link', { name: 'Scratchpad' }).first()).toBeVisible();
});

test('an empty scratchpad says so', async ({ page }) => {
  await page.route(/\/api\/agents\/avery\/scratch(\?.*)?$/, route =>
    route.fulfill({ json: { folder: '', folders: [], files: [], usage: { ...usage, files: 0, bytes: 0 } } }),
  );
  await page.goto('/agents/avery');
  const scratch = page.getByRole('region', { name: 'Settings for Avery' }).getByRole('region', { name: 'Scratchpad' });
  await scratch.scrollIntoViewIfNeeded();
  await expect(scratch.getByText('No scratch files yet')).toBeVisible();
});
