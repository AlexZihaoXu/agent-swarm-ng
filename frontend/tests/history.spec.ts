import { expect, test } from './fixtures';
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
const messages = Array.from({ length: 120 }, (_, i) => ({
  id: `saved-${i + 1}`,
  sequence: i + 1,
  channelId: agent.channelId,
  role: i % 2 ? 'assistant' : 'user',
  text: `Saved message ${i + 1}\nA second line for scroll anchoring.`,
  timestamp: 1000 + i,
}));

test('restores paginated history and preserves the reading position when older messages load', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/\/api\/agents(?:\?.*)?$/, route =>
    route.fulfill({
      json: { agents: [...sampleAgents, { ...agent, lastMessage: messages.at(-1) }], nextCursor: null },
    }),
  );
  const cursors: number[] = [];
  await page.route('**/api/channels/saved-channel/messages*', route => {
    const before = Number(new URL(route.request().url()).searchParams.get('before') || 121);
    cursors.push(before);
    const rows = messages.filter(row => row.sequence < before).slice(-50);
    return route.fulfill({ json: { messages: rows, nextCursor: rows[0].sequence > 1 ? rows[0].sequence : null } });
  });
  await page.goto('/chat/agents/avery');
  const row = page.getByRole('button', { name: 'Open conversation with Saved agent' });
  await expect(row).toContainText('Saved message 120');
  await row.click();
  const history = page.getByRole('list', { name: 'Messages' });
  await expect(history.locator(':scope > li')).toHaveCount(50);
  const viewport = page.getByRole('region', { name: 'Chat history', exact: true });
  await viewport.evaluate(element => {
    element.scrollTop = 0;
  });
  const anchor = history.locator('[data-message-id="saved-71"]');
  const before = (await anchor.boundingBox())!.y;
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(history.locator(':scope > li')).toHaveCount(100);
  expect((await anchor.boundingBox())!.y).toBeCloseTo(before, 0);
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(history.locator(':scope > li')).toHaveCount(120);
  await expect(page.getByRole('button', { name: 'Load earlier messages' })).toHaveCount(0);
  expect(cursors).toEqual([121, 71, 21]);
  await expect(row).toContainText('Saved message 120');
  await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
  await row.click();
  await expect(history.locator('[data-message-id="saved-120"]')).toHaveCSS('animation-delay', '0.24s');
});

test('agent pages and history failures can be retried without duplicate cards or browser persistence', async ({
  page,
}) => {
  let failAgents = true;
  let failHistory = true;
  await page.route(/\/api\/agents(?:\?.*)?$/, route => {
    if (failAgents) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
    const more = new URL(route.request().url()).searchParams.has('after');
    return route.fulfill({
      json: {
        agents: [
          {
            ...agent,
            id: more ? 'second-agent' : agent.id,
            channelId: more ? 'second-channel' : agent.channelId,
            name: more ? 'Second saved agent' : agent.name,
            lastMessage: null,
          },
        ],
        nextCursor: more ? null : 1,
      },
    });
  });
  await page.route('**/api/channels/saved-channel/messages*', route =>
    failHistory
      ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
      : route.fulfill({ json: { messages: messages.slice(-1), nextCursor: null } }),
  );
  await page.goto('/agents');
  await expect(page.getByRole('button', { name: 'Retry loading agents' })).toBeVisible();
  failAgents = false;
  await page.getByRole('button', { name: 'Retry loading agents' }).click();
  await page.getByRole('button', { name: 'Load more agents' }).click();
  await expect(page.getByRole('button', { name: 'Open settings for Second saved agent' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Open settings for Saved agent', exact: true }).click();
  await page.getByRole('tablist', { name: 'Main navigation' }).getByRole('tab', { name: 'Chat' }).click();
  await expect(page.getByRole('button', { name: 'Retry loading messages' })).toBeVisible();
  await page.getByLabel('Message Saved agent').fill('Draft');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  failHistory = false;
  await page.getByRole('button', { name: 'Retry loading messages' }).click();
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Saved message 120');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('Saved message');
});
