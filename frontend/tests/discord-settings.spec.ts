import { test, expect } from './fixtures';

const config = (over: object = {}) => ({
  configured: true,
  status: { state: 'online' },
  bot: { id: '1000000000000000001', name: 'aether-bot' },
  inviteUrl: 'https://discord.com/oauth2/authorize?client_id=1000000000000000001&scope=bot&permissions=1',
  admission: 'mention',
  strangerDms: false,
  catchUp: true,
  channels: [
    {
      id: '3000000000000000002',
      guildId: '2',
      guildName: 'Swarm Lab',
      name: 'design',
      place: 'Swarm Lab › #design',
      kind: 'text',
      allowed: false,
      admission: null,
      paused: false,
    },
    {
      id: '3000000000000000004',
      guildId: '2',
      guildName: 'Swarm Lab',
      name: 'ideas',
      place: 'Swarm Lab › #ideas',
      kind: 'forum',
      allowed: true,
      admission: null,
      paused: true,
    },
    {
      id: '3000000000000000007',
      guildId: '7',
      guildName: 'Study',
      name: 'general',
      place: 'Study › #general',
      kind: 'text',
      allowed: false,
      admission: null,
      paused: false,
    },
    {
      id: '5000000000000000001',
      guildId: null,
      guildName: null,
      name: 'alex',
      place: 'DM with alex',
      kind: 'dm',
      allowed: true,
      admission: null,
      paused: false,
    },
  ],
  ...over,
});

test('an agent’s Discord bot: paste a token, choose channels and when they wake it, save with the page', async ({
  page,
}) => {
  let current = config({ configured: false, status: { state: 'off' }, bot: null, inviteUrl: null, channels: [] });
  const calls: { method: string; body: unknown }[] = [];
  await page.route(/\/api\/agents\/avery\/discord(\/token)?$/, async route => {
    const request = route.request();
    if (request.method() !== 'GET')
      calls.push({ method: `${request.method()} ${new URL(request.url()).pathname}`, body: request.postDataJSON() });
    if (request.method() === 'PUT') current = config();
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      current = {
        ...current,
        ...body,
        channels: current.channels.map(channel => ({
          ...channel,
          ...(body.channels?.find((c: { id: string }) => c.id === channel.id) ?? {}),
        })),
      };
    }
    return route.fulfill({ json: current });
  });
  await page.goto('/agents/avery');
  const section = page.getByRole('region', { name: 'Channels' });
  await expect(section.getByText('Not connected')).toBeVisible();
  // Until a bot is connected, the setup guide is open and points at the Developer Portal.
  await expect(section.getByText('How to create a Discord bot for Avery')).toBeVisible();
  await expect(section.getByRole('link', { name: /Discord Developer Portal/ })).toHaveAttribute(
    'href',
    'https://discord.com/developers/applications',
  );
  await expect(section.getByText('Message Content Intent').first()).toBeVisible();
  const token = section.getByLabel('Bot token');
  await expect(token).toHaveAttribute('type', 'password');
  await token.fill('MTAwMDAwMDAwMDAwMDAwMDAx.GxYzAb.abcdefghijklmnopqrstuvwxyz0123');
  await section.getByRole('button', { name: 'Show token' }).click();
  await expect(token).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(section.getByText('Online as aether-bot')).toBeVisible();
  expect(calls[0].method).toBe('PUT /api/agents/avery/discord/token');
  await expect(section.getByRole('link', { name: /Add the bot to a server/ })).toHaveAttribute(
    'href',
    /oauth2\/authorize/,
  );
  await expect(section.getByText('paused: only bots spoke lately')).toBeVisible();
  // Only chosen channels are listed, grouped by server; the rest are found through Add channels.
  const list = section.getByRole('region', { name: 'Chosen channels' });
  await expect(list.getByText('#ideas')).toBeVisible();
  await expect(list.getByText('#design')).toHaveCount(0);
  await expect(section.getByText('Channels it may use · 1 of 3')).toBeVisible();
  await section.getByRole('button', { name: 'Add channels' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Search servers and channels…').fill('des');
  await expect(dialog.getByRole('option', { name: '#general' })).toHaveCount(0);
  await dialog.getByRole('option', { name: '#design' }).click();
  await dialog.getByPlaceholder('Search servers and channels…').fill('study');
  await dialog.getByRole('option', { name: 'All channels in Study' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(list.getByRole('region', { name: 'Study' }).getByText('#general')).toBeVisible();
  // Wake on every message in #design, drop #ideas, and let strangers DM it.
  await list.getByRole('combobox', { name: 'When #design wakes it' }).click();
  await page.getByRole('option', { name: 'Every message' }).click();
  await list.getByRole('button', { name: 'Remove #ideas' }).click();
  await section.getByRole('switch', { name: 'DMs from other people' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].method).toBe('PATCH /api/agents/avery/discord');
  expect(calls[1].body).toEqual({
    strangerDms: true,
    channels: expect.arrayContaining([
      { id: '3000000000000000002', allowed: true, admission: 'all' },
      { id: '3000000000000000004', allowed: false, admission: null },
      { id: '3000000000000000007', allowed: true, admission: null },
    ]),
  });
  await expect(list.getByText('#ideas')).toHaveCount(0);
  await expect(section.getByRole('switch', { name: 'DMs from other people' })).toHaveAttribute('aria-checked', 'true');
});

test('your Discord accounts in Settings: only long numeric IDs, saved together', async ({ page }) => {
  let saved: unknown;
  await page.route('**/api/discord/owner', route => {
    if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
    return route.fulfill({ json: route.request().method() === 'PUT' ? saved : { accounts: [] } });
  });
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Discord' });
  await section.getByRole('button', { name: 'Add account' }).click();
  await section.getByLabel('User ID').fill('alex');
  await expect(section.getByText('A Discord user ID is a long number.')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await section.getByLabel('User ID').fill('400000000000000001');
  await section.getByLabel('Name').fill('Alex');
  await section.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => saved).toEqual({ accounts: [{ id: '400000000000000001', name: 'Alex' }] });
  await expect(section.getByText('Saved.')).toBeVisible();
});

test('Chat shows what an agent’s bot saw on Discord, read-only, with the channel’s files', async ({ page }) => {
  const channel = '3000000000000000004';
  await page.route(/\/api\/agents\/avery\/discord$/, route => route.fulfill({ json: config() }));
  const message = (id: string, extra: object) => ({
    id,
    authorId: '4000000000000000002',
    authorName: 'sam',
    role: 'person',
    text: '',
    timestamp: Date.parse('2026-09-30T10:00:00Z') + Number(id.slice(-2)) * 60_000,
    edited: false,
    deleted: false,
    replyTo: null,
    attachments: [],
    ...extra,
  });
  let pages = 0;
  await page.route(new RegExp(`/api/agents/avery/discord/channels/${channel}/messages`), route => {
    pages++;
    const before = new URL(route.request().url()).searchParams.get('before');
    return route.fulfill({
      json: before
        ? {
            channel: { id: channel, place: 'Swarm Lab › #ideas', kind: 'forum' },
            messages: [message('1300000000000000001', { text: 'the very first idea' })],
            nextCursor: null,
          }
        : {
            channel: { id: channel, place: 'Swarm Lab › #ideas', kind: 'forum' },
            messages: [
              message('1300000000000000010', {
                text: 'what about a darker logo?',
                attachments: [{ name: 'logo.png', size: 2048 }],
              }),
              message('1300000000000000011', {
                authorId: '4000000000000000001',
                authorName: 'alex',
                role: 'owner',
                text: 'Avery, try it',
              }),
              message('1300000000000000012', {
                authorId: '1000000000000000001',
                authorName: 'aether-bot',
                role: 'you',
                text: 'On it, here is a draft.',
                edited: true,
                replyTo: { id: '1300000000000000011', authorName: 'alex', owner: true, text: 'Avery, try it' },
              }),
              message('1300000000000000013', {
                authorId: '1000000000000000002',
                authorName: 'helper',
                role: 'bot',
                text: 'spam',
                deleted: true,
              }),
            ],
            nextCursor: '1300000000000000010',
          },
    });
  });
  await page.goto('/chat/agents/avery');
  await page.getByRole('combobox', { name: 'Chat with' }).click();
  // Allowed channels and DMs are listed; channels the owner did not allow are not.
  await expect(page.getByRole('option', { name: 'Discord #design' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Discord DM alex' })).toBeVisible();
  await page.getByRole('option', { name: 'Discord #ideas' }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/agents/avery/discord/${channel}$`));
  const conversation = page.getByRole('region', { name: 'Conversation with Avery' });
  await expect(conversation.getByText('Swarm Lab › #ideas').first()).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Chat with' })).toHaveText(/#ideas$/);
  const messages = conversation.getByRole('region', { name: 'Discord messages' });
  // Your Discord accounts show as You, also when quoted.
  await expect(messages.getByText('You', { exact: true })).toHaveCount(2);
  await expect(messages.getByText('what about a darker logo?')).toBeVisible();
  await expect(messages.getByText('attached logo.png (2 KB)')).toBeVisible();
  await expect(messages.getByText('On it, here is a draft.')).toBeVisible();
  await expect(messages.getByText('edited', { exact: true })).toBeVisible();
  await expect(messages.getByText('helper · bot')).toBeVisible();
  await expect(messages.getByText('deleted', { exact: true })).toBeVisible();
  // Read-only: no composer; people post on Discord and the agent posts through its bot.
  await expect(conversation.getByRole('textbox')).toHaveCount(0);
  await expect(conversation.getByText('Discord · read-only here; Avery posts through its bot')).toBeVisible();
  await messages.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(messages.getByText('the very first idea')).toBeVisible();
  await expect(messages.getByRole('button', { name: 'Load earlier messages' })).toHaveCount(0);
  // A reload returns to the same channel.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Discord messages' }).getByText('Avery, try it').first()).toBeVisible();
  expect(pages).toBeGreaterThan(1);
});
