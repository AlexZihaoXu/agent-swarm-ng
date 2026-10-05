import { expect, test, type Page } from './fixtures';
import { sampleAgents } from './sample-agents';

const agent = {
  id: 'saved-agent',
  channelId: 'saved-channel',
  name: 'Saved agent',
  endpointId: 'endpoint',
  model: 'test-model',
  thinkingLevel: 'off',
  createdAt: 1000,
};
const start = new Date(2026, 8, 1, 9).getTime();
const messages = Array.from({ length: 300 }, (_, i) => ({
  id: `saved-${i + 1}`,
  sequence: i + 1,
  channelId: agent.channelId,
  role: i % 2 ? 'assistant' : 'user',
  text: `Saved message ${i + 1} about the deploy plan`,
  timestamp: start + i * 60_000,
  replyTo: null,
}));
const group = {
  id: 'crew',
  name: 'Crew',
  organizationId: 'personal',
  createdAt: start,
  members: [{ id: 'avery', name: 'Avery', channelId: 'avery', avatar: null }],
  lastMessage: null,
};
const posts = Array.from({ length: 120 }, (_, i) => ({
  id: `post-${i + 1}`,
  sequence: i + 1,
  groupId: 'crew',
  role: 'assistant',
  authorId: 'avery',
  authorName: 'Avery',
  authorAvatar: null,
  text: `Group post ${i + 1}`,
  timestamp: start + i * 60_000,
  replyTo: null,
}));

/** History pages as the server cuts them: `before` and the search Jump's `around` (10 earlier, ≤200 a page). */
function cut<T extends { id: string; sequence: number }>(rows: T[], url: URL, size: number) {
  const before = Number(url.searchParams.get('before') || rows.length + 1);
  const around = url.searchParams.get('around');
  const target = rows.find(row => row.id === around);
  const held = rows.filter(row => row.sequence < before);
  const chosen = target ? held.filter(row => row.sequence >= target.sequence - 10).slice(-200) : held.slice(-size);
  return { messages: chosen, nextCursor: chosen[0] && chosen[0].sequence > 1 ? chosen[0].sequence : null };
}

const result = (
  id: string,
  options: { kind?: 'chat' | 'group'; text?: string; name?: string } = {},
): Record<string, unknown> => {
  const kind = options.kind ?? 'chat';
  const text = options.text ?? `Saved message ${id.split('-')[1]} about the deploy plan`;
  const at = text.indexOf('deploy');
  return {
    id,
    kind,
    sequence: Number(id.split('-')[1]),
    timestamp: start,
    conversation:
      kind === 'group'
        ? { key: 'group:crew', name: 'Crew', groupId: 'crew' }
        : { key: `chat:${agent.channelId}`, name: agent.name, agentId: agent.id },
    author:
      kind === 'group'
        ? { kind: 'agent', id: 'avery', name: 'Avery', avatar: null }
        : { kind: 'human', id: null, name: null, avatar: null },
    snippet: { text, ranges: at >= 0 ? [{ start: at, end: at + 6 }] : [], clippedStart: false, clippedEnd: false },
    files: [],
  };
};

async function mockApi(page: Page) {
  await page.route(/\/api\/agents(?:\?.*)?$/, route =>
    route.fulfill({
      json: { agents: [...sampleAgents, { ...agent, lastMessage: messages.at(-1) }], nextCursor: null },
    }),
  );
  await page.route('**/api/channels/saved-channel/messages*', route =>
    route.fulfill({ json: cut(messages, new URL(route.request().url()), 50) }),
  );
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: [group], nextCursor: null } }));
  await page.route('**/api/groups/crew', route => route.fulfill({ json: group }));
  await page.route('**/api/groups/crew/messages*', route =>
    route.fulfill({ json: cut(posts, new URL(route.request().url()), 40) }),
  );
  await page.route('**/api/chats/*/reactions*', route =>
    route.fulfill({
      json: {
        messages: new URL(route.request().url()).searchParams.getAll('ids').map(id => ({ id, reactions: [] })),
      },
    }),
  );
  const searches: URLSearchParams[] = [];
  await page.route('**/api/search/messages*', route => {
    const params = new URL(route.request().url()).searchParams;
    searches.push(params);
    if (params.get('conversation') === null)
      return route.fulfill({
        json: {
          total: 1,
          more: false,
          page: 1,
          pageSize: 25,
          results: [result('post-3', { kind: 'group', text: 'Group post 3 with the deploy notes' })],
        },
      });
    const pageNumber = Number(params.get('page') ?? 1);
    const ids = Array.from({ length: 60 }, (_, i) => `saved-${params.get('sort') === 'oldest' ? i + 1 : 60 - i}`);
    return route.fulfill({
      json: {
        total: 60,
        more: false,
        page: pageNumber,
        pageSize: 25,
        results: ids.slice((pageNumber - 1) * 25, pageNumber * 25).map(id => result(id)),
      },
    });
  });
  return searches;
}

test('searches a chat with filters, sorts, pages, remembers searches and jumps to a message', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const searches = await mockApi(page);
  await page.goto('/chat/agents/saved-agent');
  const history = page.getByRole('list', { name: 'Messages' });
  await expect(history.locator('[data-message-id="saved-300"]')).toBeVisible();

  await page.getByRole('button', { name: 'Search messages' }).click();
  const panel = page.getByRole('dialog', { name: 'Search messages' });
  await expect(panel).toBeVisible();
  const field = panel.getByRole('combobox', { name: 'Search messages' });
  await expect(field).toBeFocused();
  // Filters are offered while the field is empty; choosing one asks for its value.
  await expect(panel.getByRole('option', { name: /from: you or an agent/ })).toBeVisible();
  await panel.getByRole('option', { name: /has: link, file or image/ }).click();
  await expect(field).toHaveValue('has:');
  await panel.getByRole('option', { name: 'link', exact: true }).click();
  await expect(panel.getByText('has:', { exact: true })).toBeVisible();
  await field.fill('deploy');
  await expect(panel.getByRole('heading', { name: '60 Results' })).toBeVisible();
  expect(Object.fromEntries(searches.at(-1)!)).toEqual({
    q: 'deploy',
    conversation: 'chat:saved-channel',
    has: 'link',
  });
  const results = panel.getByRole('list', { name: 'Search results' });
  await expect(results.locator(':scope > li')).toHaveCount(25);
  await expect(results.locator('mark').first()).toHaveText('deploy');

  // Sort and pages.
  await panel.getByRole('combobox', { name: 'Sort' }).click();
  await page.getByRole('option', { name: 'Oldest' }).click();
  await expect.poll(() => searches.at(-1)!.get('sort')).toBe('oldest');
  await expect(results.locator(':scope > li').first()).toContainText('Saved message 1 about');
  await panel.getByRole('button', { name: 'Page 3' }).click();
  await expect(panel.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');
  await expect(results.locator(':scope > li')).toHaveCount(10);
  await panel.getByRole('button', { name: /Previous/ }).click();
  await expect(panel.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
  await panel.getByRole('button', { name: /Previous/ }).click();

  // Jump: older history loads back to the message, which is shown and highlighted.
  await results.locator(':scope > li').nth(4).hover();
  await results.getByRole('button', { name: "Jump to You's message" }).nth(4).click();
  const target = history.locator('li[data-window-id="saved-5"]');
  await expect(target).toBeInViewport();
  await expect(target).toHaveClass(/message-jump-flash/);
  await expect(target).not.toHaveClass(/message-jump-flash/, { timeout: 5000 });

  // Recent searches: the jump remembered this one; the chip can go, and History can be cleared.
  await panel.getByRole('button', { name: 'Remove filter has: link' }).click();
  await field.fill('');
  await field.click();
  const remembered = panel.getByRole('option', { name: 'deploy has: link' });
  await expect(remembered).toBeVisible();
  expect(
    await page.evaluate(
      () => Object.entries(localStorage).find(([key]) => key.startsWith('swarm.search-history:'))?.[1] ?? null,
    ),
  ).toContain('deploy');
  await remembered.click();
  await expect(field).toHaveValue('deploy');
  await expect(panel.getByRole('button', { name: 'Remove filter has: link' })).toBeVisible();
  await field.fill('');
  await panel.getByRole('option', { name: 'Clear history' }).click();
  await expect(panel.getByRole('option', { name: 'deploy has: link' })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => Object.entries(localStorage).find(([key]) => key.startsWith('swarm.search-history:'))?.[1] ?? null,
    ),
  ).toBeNull();

  // Escape closes the suggestions first, then the panel, and focus returns to the button.
  await field.press('Escape');
  await expect(panel.getByRole('option')).toHaveCount(0);
  await field.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: 'Search messages' })).toBeFocused();
  // Ctrl+F opens it again from the chat.
  await history.locator('li').first().click();
  await page.keyboard.press('Control+f');
  await expect(panel).toBeVisible();
});

test('on a phone, searches all chats in a full-screen sheet and jumps into a group', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const searches = await mockApi(page);
  await page.goto('/chat/agents/saved-agent');
  // Phones reach search through the header's More menu.
  await expect(page.getByRole('button', { name: 'Search messages' })).toHaveCount(0);
  const more = page.getByRole('button', { name: /^More for / });
  await more.click();
  await page.getByRole('menuitem', { name: 'Search messages' }).click();
  const panel = page.getByRole('dialog', { name: 'Search messages' });
  await expect(panel.getByRole('combobox', { name: 'Search messages' })).toBeFocused();
  await panel.getByRole('button', { name: 'Close search' }).click();
  await expect(panel).toBeHidden();
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole('menuitem', { name: 'Search messages' }).click();
  const box = (await panel.boundingBox())!;
  expect(box.width).toBe(390);
  expect(box.y).toBe(0);
  const field = panel.getByRole('combobox', { name: 'Search messages' });
  // A typed scope token becomes the scope.
  await field.fill('deploy in:all ');
  await expect(field).toHaveValue('deploy ');
  await expect(panel.getByRole('heading', { name: '1 Result' })).toBeVisible();
  expect(searches.at(-1)!.get('conversation')).toBeNull();
  const card = panel.getByRole('list', { name: 'Search results' }).locator(':scope > li');
  await expect(card).toContainText('Crew');
  await card.getByRole('button', { name: "Jump to Avery's message" }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/chat\/groups\/crew/);
  const target = page.locator('li[data-window-id="post-3"]');
  await expect(target).toBeInViewport();
  await expect(target).toHaveClass(/message-jump-flash/);
});
