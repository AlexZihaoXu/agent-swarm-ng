import { test, expect, chooseAgent } from './fixtures';

// Route destinations are stable URLs, not serialized chat text or API keys.
test('main tabs and selected agent survive refresh and browser history', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/agents\/avery$/);
  await chooseAgent(page, 'Morgan');
  await expect(page).toHaveURL(/\/agents\/morgan$/);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Settings for Morgan' })).toBeVisible();
  await page.getByRole('tablist', { name: 'Main navigation' }).getByRole('tab', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/agents\/morgan$/);
  await expect(page.getByRole('region', { name: 'Settings for Morgan' })).toBeVisible();
});

test('switching Agents and Chat keeps the selected agent on desktop but shows lists on phones', async ({ page }) => {
  const path = () => new URL(page.url()).pathname;
  await page.goto('/agents/morgan');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect.poll(path).toBe('/chat/agents/morgan');
  // Straight back, before the Chat view has necessarily finished rendering: the click must not be lost.
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect.poll(path).toBe('/agents/morgan');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('button', { name: 'Back to agents' }).click();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('complementary', { name: 'Chats' })).toBeVisible();
});

test('Settings endpoint editor can be bookmarked without placing unsaved keys in the URL', async ({ page }) => {
  await page.goto('/settings/endpoints/new');
  await expect(page.getByRole('heading', { name: 'New endpoint' })).toBeVisible();
  await page.getByLabel('API key').fill('not-for-the-url');
  expect(page.url()).not.toContain('not-for-the-url');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New endpoint' })).toBeVisible();
  await expect(page.getByLabel('API key')).toHaveValue('');
  await page.getByRole('button', { name: 'Remove endpoint' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.route('**/api/model-endpoints*', route =>
    route.fulfill({ json: [{ id: 'saved-1', name: 'Local', baseUrl: 'http://localhost:11434/v1', hasApiKey: false }] }),
  );
  await page.goto('/settings/endpoints/saved-1');
  await expect(page.getByRole('heading', { name: 'Local' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Local' })).toBeVisible();
});

test('phone agent location and agent-to-agent conversation restore from a direct path', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/agents/morgan');
  await expect(page.getByRole('region', { name: 'Settings for Morgan' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Settings for Morgan' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to agents' }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByRole('complementary', { name: 'Agents' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('region', { name: 'Settings for Morgan' })).toBeVisible();
});

test('agent-to-agent DM deep link survives a reload without choosing another peer', async ({ page }) => {
  await page.goto('/agents/avery/dm/morgan');
  await expect(page).toHaveURL(/\/chat\/agents\/avery\/dm\/morgan$/);
  await expect(page.getByRole('region', { name: 'Agent conversation with Morgan' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Agent conversation with Morgan' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Chat with' }).click();
  await page.getByRole('option', { name: 'You', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/agents\/avery$/);
  await page.goBack();
  await expect(page.getByRole('region', { name: 'Agent conversation with Morgan' })).toBeVisible();
});

test('computer viewer path restores after reload and Back returns to the grid', async ({ page }) => {
  const id = '7ad66d47-c09d-478b-96be-8c734ac555eb';
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({
      json: {
        controllerConnected: true,
        computers: [{ id, name: 'Test X11 desk', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0 }],
      },
    }),
  );
  await page.route(`**/computers/${id}/desktop/api/health`, route => route.fulfill({ json: { status: 'ok' } }));
  await page.route(
    url => new URL(url).pathname === `/computers/${id}/desktop/`,
    route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas id="videoCanvas"></canvas>' }),
  );
  await page.goto('/computers');
  await expect(page.getByRole('heading', { name: 'Computers', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Test X11 desk desktop' }).click();
  await expect(page).toHaveURL(new RegExp(`/computers/${id}$`));
  await expect(page.getByTestId('computer-viewer')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('computer-viewer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to computers' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to computers' }).click();
  await expect(page).toHaveURL(/\/computers$/);
  await page.goBack();
  await expect(page.getByTestId('computer-viewer')).toBeVisible();
});

test('legacy section bookmarks and DM preview have refreshable paths without tabs', async ({ page }) => {
  await page.goto('/agents/morgan/edit/avatar');
  const editor = page.getByRole('region', { name: 'Settings for Morgan' });
  await expect(editor).toBeVisible();
  await expect
    .poll(() => editor.getByRole('region', { name: 'Agent editor' }).evaluate(element => element.scrollTop))
    .toBeGreaterThan(100);
  await expect(editor.getByRole('heading', { name: 'Avatar' })).toBeVisible();
  await page.goto('/agents/morgan/edit/settings/channels');
  await expect(editor.getByRole('checkbox', { name: 'Avery' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/agents\/morgan\/edit\/avatar$/);
  await expect
    .poll(() => editor.getByRole('region', { name: 'Agent editor' }).evaluate(element => element.scrollTop))
    .toBeGreaterThan(100);
  await page.goForward();
  await expect(page).toHaveURL(/\/agents\/morgan\/edit\/settings\/channels$/);
  await page.goto('/agents/morgan/edit/settings/channels/swarm');
  await expect(editor.getByRole('checkbox', { name: 'Avery' })).toBeVisible();
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Allowed DMs' })).toBeVisible();
  await page.getByRole('button', { name: 'View DM with Avery' }).click();
  await expect(page).toHaveURL(/\/agents\/morgan\/edit\/settings\/channels\/swarm\/dm\/avery$/);
  await page.reload();
  await expect(editor).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/agents\/morgan\/edit\/settings\/channels\/swarm$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/agents\/morgan\/edit\/settings\/channels\/swarm\/dm\/avery$/);
  await editor.getByRole('button', { name: 'Preview Bean' }).click();
  await editor.getByRole('button', { name: 'Discard changes' }).click();
  await expect(editor).toBeVisible();
});

test('agent create and delete dialogs reopen by path without preserving destructive text', async ({ page }) => {
  await page.goto('/agents/new');
  await expect(page.getByRole('dialog', { name: 'Create new agent' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Create new agent' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Create new agent' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/agents\/avery$/);
  await page.goto('/agents/morgan/delete');
  await expect(page.getByRole('dialog', { name: 'Delete agent' })).toBeVisible();
  await page.getByLabel('Confirm agent name').fill('Morgan');
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Delete agent' })).toBeVisible();
  await expect(page.getByLabel('Confirm agent name')).toHaveValue('');
  await page.getByRole('dialog', { name: 'Delete agent' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/agents\/morgan$/);
});

test('computer create and delete dialogs can reopen by path without restoring confirmation text', async ({ page }) => {
  const id = '7ad66d47-c09d-478b-96be-8c734ac555eb';
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({
      json: {
        controllerConnected: true,
        computers: [{ id, name: 'Test X11 desk', state: 'running', createdAt: 0, cpuPercent: 0, memoryBytes: 0 }],
      },
    }),
  );
  await page.goto('/computers/new');
  await expect(page.getByRole('dialog', { name: 'Create computer' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Create computer' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Create computer' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/computers$/);
  await page.goto(`/computers/${id}/delete`);
  await expect(page.getByRole('dialog', { name: 'Delete computer' })).toBeVisible();
  await page.getByLabel('Confirm computer name').fill('Test X11 desk');
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Delete computer' })).toBeVisible();
  await expect(page.getByLabel('Confirm computer name')).toHaveValue('');
  await page.getByRole('dialog', { name: 'Delete computer' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/computers$/);
});

test('a deep-linked agent outside the first saved page loads before showing settings', async ({ page }) => {
  const agent = {
    id: 'late-agent',
    name: 'Late agent',
    channelId: 'late-channel',
    createdAt: Date.now(),
    lastMessage: null,
  };
  const requests: string[] = [];
  await page.route(/\/api\/agents(?:\?.*)?$/, route => {
    const after = new URL(route.request().url()).searchParams.get('after');
    requests.push(after ?? 'first');
    return route.fulfill({
      json: after
        ? { agents: [agent], nextCursor: null }
        : {
            agents: [{ id: 'avery', name: 'Avery', channelId: 'agent-avery', createdAt: 1, lastMessage: null }],
            nextCursor: 1,
          },
    });
  });
  await page.route('**/api/channels/late-channel/messages*', route =>
    route.fulfill({ json: { messages: [], nextCursor: null } }),
  );
  await page.goto('/agents/late-agent');
  await expect(page.getByRole('region', { name: 'Settings for Avery' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Settings for Late agent' })).toBeVisible();
  expect(requests).toContain('1');
  await expect(page).toHaveURL(/\/agents\/late-agent$/);
});

test('invalid resource URLs never silently open another resource', async ({ page }) => {
  await page.goto('/agents/missing-agent');
  await expect(page.getByText('Page not found.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Avery', exact: true })).toHaveCount(0);
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { controllerConnected: true, computers: [] } }),
  );
  await page.goto('/computers/missing-computer');
  await expect(page.getByRole('alert')).toContainText('Computer not found.');
  await expect(page).toHaveURL(/\/computers\/missing-computer$/);
  await page.route('**/api/groups/missing-group', route =>
    route.fulfill({ status: 404, json: { message: 'Group not found.' } }),
  );
  await page.route('**/api/groups/missing-group/messages*', route =>
    route.fulfill({ status: 404, json: { message: 'Group not found.' } }),
  );
  await page.goto('/chat/groups/missing-group');
  await expect(page).toHaveURL(/\/chat(?:\/agents\/avery)?$/);
  await expect(page.getByRole('region', { name: /Group conversation:/ })).toHaveCount(0);
});

test('group conversation path restores without opening a different chat', async ({ page }) => {
  const group = { id: 'team', name: 'Research', createdAt: Date.now(), lastMessage: null, members: [] };
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: [group], nextCursor: null } }));
  await page.route('**/api/groups/team', route => route.fulfill({ json: group }));
  await page.route('**/api/groups/team/messages*', route =>
    route.fulfill({ json: { messages: [], nextCursor: null } }),
  );
  await page.goto('/chat/groups/team');
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/groups\/team$/);
  await page.getByRole('button', { name: 'Edit group chat' }).click();
  await expect(page).toHaveURL(/\/chat\/groups\/team\/edit$/);
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Edit group chat' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/chat\/groups\/team$/);
  await page.goto('/chat/groups/team/delete');
  await expect(page.getByRole('dialog', { name: 'Delete group chat' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Delete group chat' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/chat\/groups\/team$/);
  await page.goto('/chat/groups/new');
  await expect(page.getByRole('dialog', { name: 'Create group chat' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Create group chat' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/chat(?:\/agents\/avery)?$/);
});
