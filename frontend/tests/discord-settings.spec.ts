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
      kind: 'forum',
      allowed: true,
      admission: null,
      paused: true,
    },
    {
      id: '5000000000000000001',
      guildId: null,
      guildName: null,
      name: 'alex',
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
  // Allow #design, wake on every message there, and let strangers DM it.
  await section.getByLabel('#design').check();
  await section.getByRole('combobox', { name: 'When #design wakes it' }).click();
  await page.getByRole('option', { name: 'Every message' }).click();
  await section.getByRole('switch', { name: 'DMs from other people' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toEqual({
    method: 'PATCH /api/agents/avery/discord',
    body: { strangerDms: true, channels: [{ id: '3000000000000000002', allowed: true, admission: 'all' }] },
  });
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
