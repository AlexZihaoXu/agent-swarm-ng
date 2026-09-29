import { expect, test, type Page } from './fixtures';

const entries = {
  swarm: {
    id: 'swarm',
    parentId: null,
    title: 'Swarm concepts',
    summary: 'Agent identity and resources.',
    source: 'docs/vision.md',
    hasChildren: true,
    text: 'Agents persist independently of their channels and computers.',
  },
  'swarm/channels': {
    id: 'swarm/channels',
    parentId: 'swarm',
    title: 'Channels',
    summary: 'Ways to communicate.',
    source: 'docs/vision.md',
    hasChildren: false,
    text: 'Channels provide communication, not computer access. More context follows.',
    related: [{ id: 'swarm/computers', title: 'Computers', summary: 'Shared resources.' }],
  },
  'swarm/computers': {
    id: 'swarm/computers',
    parentId: 'swarm',
    title: 'Computers',
    summary: 'Shared resources.',
    source: 'docs/vision.md',
    hasChildren: false,
    text: 'Computers provide capabilities only when explicitly granted. See swarm/channels.',
    related: [{ id: 'swarm/channels', title: 'Channels', summary: 'Ways to communicate.' }],
  },
};
const summary = (entry: (typeof entries)[keyof typeof entries]) => ({
  id: entry.id,
  title: entry.title,
  summary: entry.summary,
  source: entry.source,
  hasChildren: entry.hasChildren,
});

async function mockKnowledge(page: Page) {
  await page.route(/\/api\/knowledge(?:\/(?:entry|search))?(?:\?.*)?$/, route => {
    expect(route.request().method()).toBe('GET');
    const url = new URL(route.request().url()),
      offset = Number(url.searchParams.get('offset') ?? 0);
    if (url.pathname === '/api/knowledge/entry') {
      const id = url.searchParams.get('id') as keyof typeof entries;
      const entry = entries[id];
      if (!entry) return route.fulfill({ status: 404, json: { message: 'Knowledge entry not found.' } });
      const length = Number(url.searchParams.get('length') ?? 4000);
      const text = entry.text.slice(offset, offset + length);
      const breadcrumbs =
        id === 'swarm'
          ? [{ id: 'swarm', title: 'Swarm concepts' }]
          : [
              { id: 'swarm', title: 'Swarm concepts' },
              { id, title: entry.title },
            ];
      return route.fulfill({
        json: {
          ...summary(entry),
          parentId: entry.parentId,
          breadcrumbs,
          related: 'related' in entry ? entry.related : [],
          text,
          offset,
          totalCharacters: entry.text.length,
          nextOffset: offset + text.length < entry.text.length ? offset + text.length : null,
        },
      });
    }
    if (url.pathname === '/api/knowledge/search') {
      const query = url.searchParams.get('query')!.toLowerCase();
      const matches = Object.values(entries)
        .filter(entry => `${entry.title} ${entry.summary} ${entry.text}`.toLowerCase().includes(query))
        .map(entry => ({ ...summary(entry), snippet: entry.summary }));
      return route.fulfill({ json: { query, matches: matches.slice(offset, offset + 20), nextOffset: null } });
    }
    const parentId = url.searchParams.get('parentId');
    const matches = Object.values(entries)
      .filter(entry => entry.parentId === parentId)
      .map(summary);
    return route.fulfill({ json: { parentId, entries: matches.slice(offset, offset + 20), nextOffset: null } });
  });
}

test('Settings opens a read-only Knowledge browser with hierarchy, search, source and refreshable links', async ({
  page,
}) => {
  await mockKnowledge(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Add endpoint' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Unsaved endpoint');
  await page.getByRole('button', { name: 'Browse Swarm Knowledge' }).click();
  await expect(page).toHaveURL(/\/settings\/knowledge$/);
  const browser = page.getByRole('region', { name: 'Swarm Knowledge' });
  await expect(browser.getByRole('button', { name: 'Open knowledge topic Swarm concepts' })).toBeVisible();
  await browser.getByRole('button', { name: 'Open knowledge topic Swarm concepts' }).click();
  await expect(browser.getByText('Agents persist independently of their channels and computers.')).toBeVisible();
  await expect(browser.getByRole('navigation', { name: 'Knowledge path' })).toContainText('Swarm concepts');
  // The root crumb leaves the entry (it once bounced straight back to it).
  await browser.getByRole('navigation', { name: 'Knowledge path' }).getByRole('button', { name: 'Knowledge' }).click();
  await expect(page).toHaveURL(/\/settings\/knowledge$/);
  await expect(browser.getByText('Agents persist independently of their channels and computers.')).toHaveCount(0);
  await browser.getByRole('button', { name: 'Open knowledge topic Swarm concepts' }).click();
  await expect(browser.getByRole('button', { name: 'Open knowledge topic Channels' })).toBeVisible();
  await browser.getByRole('button', { name: 'Open knowledge topic Channels' }).click();
  await expect(page).toHaveURL(/\/settings\/knowledge\/swarm\/channels$/);
  await expect(
    browser.getByText('Channels provide communication, not computer access. More context follows.'),
  ).toBeVisible();
  await expect(browser.getByText('docs/vision.md')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('knowledge-desktop.png'), animations: 'disabled' });
  await browser.getByRole('button', { name: 'Back to settings' }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Unsaved endpoint');
  await page.goto('/settings/knowledge/swarm/channels');
  await page.reload();
  await expect(
    browser.getByText('Channels provide communication, not computer access. More context follows.'),
  ).toBeVisible();
  await browser.getByRole('searchbox', { name: 'Search knowledge' }).fill('computers');
  await expect(browser.getByRole('button', { name: 'Open knowledge topic Computers' })).toBeVisible();
  await browser.getByRole('button', { name: 'Open knowledge topic Computers' }).click();
  await expect(browser.getByText('Computers provide capabilities only when explicitly granted.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save knowledge' })).toHaveCount(0);
});

test('phone Knowledge list/detail navigation stays reachable without horizontal overflow', async ({ page }) => {
  await mockKnowledge(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/settings/knowledge');
  const browser = page.getByRole('region', { name: 'Swarm Knowledge' });
  await browser.getByRole('button', { name: 'Open knowledge topic Swarm concepts' }).click();
  await expect(browser.getByRole('button', { name: 'Back to knowledge topics' })).toBeVisible();
  await expect(browser.getByRole('complementary', { name: 'Knowledge topics' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('knowledge-phone.png'), animations: 'disabled' });
  await browser.getByRole('button', { name: 'Back to knowledge topics' }).click();
  await expect(browser.getByRole('complementary', { name: 'Knowledge topics' })).toBeVisible();
});

test('Knowledge entry loading errors retry and long content expands by explicit chunks', async ({ page }) => {
  await mockKnowledge(page);
  let fail = true;
  await page.route('**/api/knowledge/entry*', route => {
    if (fail) return route.fulfill({ status: 503, json: { message: 'Unavailable.' } });
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
    const text = entries['swarm/channels'].text.slice(offset, offset + 15);
    return route.fulfill({
      json: {
        ...summary(entries['swarm/channels']),
        parentId: 'swarm',
        breadcrumbs: [
          { id: 'swarm', title: 'Swarm concepts' },
          { id: 'swarm/channels', title: 'Channels' },
        ],
        related: [],
        text,
        offset,
        totalCharacters: entries['swarm/channels'].text.length,
        nextOffset: offset + text.length < entries['swarm/channels'].text.length ? offset + text.length : null,
      },
    });
  });
  await page.goto('/settings/knowledge/swarm/channels');
  const browser = page.getByRole('region', { name: 'Swarm Knowledge' });
  await expect(browser.getByRole('alert')).toContainText('Could not load knowledge');
  fail = false;
  await browser.getByRole('button', { name: 'Retry knowledge entry' }).click();
  await expect(browser.getByRole('button', { name: 'Load more knowledge' })).toBeVisible();
  for (let offset = 15; offset < entries['swarm/channels'].text.length; offset += 15) {
    await browser.getByRole('button', { name: 'Load more knowledge' }).click();
    await expect
      .poll(() => browser.getByRole('region', { name: 'Knowledge entry content' }).innerText())
      .toContain(entries['swarm/channels'].text.slice(0, Math.min(offset + 15, entries['swarm/channels'].text.length)));
  }
  await expect(browser.getByText(entries['swarm/channels'].text)).toBeVisible();
});

test('entries link their related entries, including IDs named in the text', async ({ page }) => {
  await mockKnowledge(page);
  await page.goto('/settings/knowledge/swarm/channels');
  const related = page.getByRole('navigation', { name: 'Related knowledge' });
  await expect(related.getByRole('button', { name: /Computers/ })).toBeVisible();
  await related.getByRole('button', { name: /Computers/ }).click();
  await expect(page).toHaveURL(/\/settings\/knowledge\/swarm\/computers$/);
  // An ID in the text is a link to that entry.
  await page.getByRole('button', { name: 'swarm/channels', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/knowledge\/swarm\/channels$/);
});
