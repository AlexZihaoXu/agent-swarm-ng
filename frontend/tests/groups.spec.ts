import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

test('reaction loading failures are visible and retry without losing conversation text', async ({ page }) => {
  let failing = true;
  await page.route('**/api/chats/*/reactions*', route =>
    failing
      ? route.fulfill({ status: 503, json: { message: 'Temporary failure' } })
      : route.fulfill({
          json: {
            messages: new URL(route.request().url()).searchParams.getAll('ids').map(id => ({ id, reactions: [] })),
          },
        }),
  );
  await page.goto('/chat/agents/avery');
  await expect(page.getByText('Could not load reactions.', { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('list', { name: 'Messages', exact: true })).toBeVisible();
  failing = false;
  await page.getByRole('button', { name: 'Retry reactions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry reactions', exact: true })).toHaveCount(0);
});

for (const mobile of [false, true])
  test(`Chat groups preserve Agents, group timestamps and persist reactions${mobile ? ' on mobile' : ''}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const stamp = new Date(2026, 8, 24, 13).getTime();
    let group: any = null;
    const messages: any[] = [];
    const reactions = new Map<string, { emoji: string; count: number; mine: boolean }[]>();
    let grants = 0;
    page.on('request', request => {
      if (request.method() === 'PATCH' && request.url().includes('/settings')) grants++;
    });
    await page.route(/\/api\/groups(?:\?.*)?$/, async route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        group = {
          id: 'team',
          name: body.name,
          createdAt: stamp,
          members: sampleAgents
            .filter(agent => body.agentIds.includes(agent.id))
            .map(agent => ({ id: agent.id, name: agent.name, channelId: agent.channelId, avatar: null })),
          lastMessage: null,
        };
        messages.push(
          ...[0, 4, 10].map((minute, index) => ({
            id: `group-${index}`,
            sequence: index + 1,
            groupId: 'team',
            role: 'assistant',
            authorId: sampleAgents[0].id,
            authorName: sampleAgents[0].name,
            authorAvatar: null,
            text: ['First finding', 'Related detail', 'Later finding'][index],
            timestamp: stamp + minute * 60000,
          })),
        );
        return route.fulfill({ json: group });
      }
      return route.fulfill({ json: { groups: group ? [group] : [], nextCursor: null } });
    });
    await page.route('**/api/groups/team', route => route.fulfill({ json: group }));
    await page.route('**/api/groups/team/messages*', route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        const message = {
          id: body.clientMessageId,
          sequence: messages.length + 1,
          groupId: 'team',
          role: 'user',
          authorId: null,
          authorName: 'You',
          authorAvatar: null,
          text: body.message,
          timestamp: stamp + 12 * 60000,
        };
        messages.push(message);
        group.lastMessage = message;
        return route.fulfill({ status: 202, json: { message, duplicate: false } });
      }
      return route.fulfill({ json: { messages, nextCursor: null } });
    });
    await page.route('**/api/chats/*/reactions*', route =>
      route.fulfill({
        json: {
          messages: new URL(route.request().url()).searchParams
            .getAll('ids')
            .map(id => ({ id, reactions: reactions.get(id) ?? [] })),
        },
      }),
    );
    await page.route('**/api/chats/*/messages/*/reaction', route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
      const { emoji, active } = route.request().postDataJSON();
      reactions.set(id, active ? [{ emoji, count: 1, mine: true }] : []);
      return route.fulfill({ json: { reactions: reactions.get(id) } });
    });
    await page.goto('/');
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await expect(page.getByLabel('Search chats', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open conversation with Avery', exact: true }).click();
    await expect(page.getByLabel('Message Avery')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Chat with' })).toBeVisible();
    if (mobile) await page.getByRole('button', { name: 'Back to chats' }).click();
    await page.getByRole('button', { name: 'Create group chat', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create group chat' });
    await dialog.getByLabel('Group name').fill('Research');
    // Members: a short chosen list; the rest are found through Add agents.
    await expect(dialog.getByText('No agents yet. Add up to 16.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Add agents' }).click();
    const picker = page.getByRole('dialog', { name: 'Add agents' });
    await picker.getByRole('option', { name: 'Avery', exact: true }).click();
    await picker.getByPlaceholder('Search agents…').fill('Mor');
    await picker.getByRole('option', { name: 'Morgan', exact: true }).click();
    await picker.getByRole('button', { name: 'Done' }).click();
    const chosen = dialog.getByRole('list', { name: 'Chosen agents' });
    await expect(chosen.getByText('Avery')).toBeVisible();
    await expect(chosen.getByText('Morgan')).toBeVisible();
    await expect(dialog.getByText('Agents (2/16)')).toBeVisible();
    await dialog.getByRole('button', { name: 'Create group', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Chat with' })).toHaveCount(0);
    await expect(page.locator('[data-message-id="group-1"]')).toHaveAttribute('data-grouped', 'true');
    await expect(page.locator('[data-message-id="group-2"]')).not.toHaveAttribute('data-grouped', 'true');
    const detail = page.locator('[data-message-id="group-1"]');
    const content = detail.locator('[tabindex="0"]');
    await content.focus();
    if (mobile) {
      await expect(detail.locator('time').first()).toBeHidden();
      await expect(content.locator('time')).toBeVisible();
    } else await expect(detail.locator('time').first()).toHaveCSS('opacity', '1');
    const idleShadow = await content.evaluate(element => getComputedStyle(element).boxShadow);
    await content.click({ button: 'right' });
    await expect(content).toHaveAttribute('data-state', 'open');
    await expect.poll(() => content.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe(idleShadow);
    if (mobile) await page.getByRole('menuitem', { name: 'Add reaction' }).click();
    else await page.getByRole('menuitem', { name: 'Add reaction' }).hover();
    await page.getByRole('searchbox', { name: 'Search emojis' }).fill('thumbs up');
    await page
      .getByRole('group', { name: 'Emoji choices' })
      .getByRole('button', { name: 'thumbs up', exact: true })
      .click();
    await expect(content).toHaveCSS('box-shadow', idleShadow);
    await expect(detail.getByRole('button', { name: 'Thumbs up: 1 reaction', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(detail.getByRole('button', { name: 'Add reaction' })).toBeVisible();
    await page.getByLabel('Message Research').fill('Human message');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const history = page.getByRole('region', { name: 'Group chat history' });
    const human = history.getByText('Human message', { exact: true });
    await expect(human).toBeVisible();
    await expect
      .poll(
        async () =>
          (await human.boundingBox())!.x > (await history.getByText('First finding', { exact: true }).boundingBox())!.x,
      )
      .toBe(true);
    if (mobile) await page.getByRole('button', { name: 'Back to chats' }).click();
    await expect(page.getByRole('button', { name: 'Open group chat Research', exact: true })).toContainText(
      'Human message',
    );
    if (mobile) await page.getByRole('button', { name: 'Open group chat Research', exact: true }).click();
    expect(grants).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`chat-group-${mobile ? 'mobile' : 'desktop'}.png`),
      fullPage: true,
    });
    if (mobile) await page.getByRole('button', { name: 'Back to chats' }).click();
    await page.getByRole('tab', { name: 'Agents', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Settings for Avery' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Chat with' })).toHaveCount(0);
  });
