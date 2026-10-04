import { test, expect, type Page } from './fixtures';
import { sampleAgents } from './sample-agents';

test('Agents offers a visible New agent button and a Delete action on the settings page', async ({ page }) => {
  await page.goto('/agents/avery');
  await page.getByRole('button', { name: 'Create new agent' }).click();
  await expect(page).toHaveURL(/\/agents\/new$/);
  await expect(page.getByRole('dialog').getByText('Create new agent', { exact: true }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Delete Avery/ }).click();
  await expect(page).toHaveURL(/\/agents\/avery\/delete$/);
  const dialog = page.getByRole('dialog', { name: 'Delete agent' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Delete agent$/ })).toBeDisabled(); // still requires the exact name
});

test('Agents search asks the server, so agents beyond the loaded page are found', async ({ page }) => {
  const hidden = { ...structuredClone(sampleAgents[0]), id: 'zed', name: 'Zed Farfetched', channelId: 'zed' };
  const searches: string[] = [];
  await page.route(/\/api\/agents(?:\?.*)?$/, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const search = new URL(route.request().url()).searchParams.get('search');
    if (search) searches.push(search);
    return route.fulfill({ json: { agents: search ? [hidden] : sampleAgents, nextCursor: null } });
  });
  await page.route('**/api/channels/zed/messages*', route =>
    route.fulfill({ json: { messages: [], nextCursor: null } }),
  );
  await page.goto('/agents/avery');
  await expect(page.getByRole('button', { name: 'Open settings for Zed Farfetched' })).toHaveCount(0);
  await page.getByLabel('Search agents').fill('Zed');
  await expect(page.getByRole('button', { name: 'Open settings for Zed Farfetched' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open settings for Avery' })).toHaveCount(0);
  expect(searches).toContain('Zed');
});

test('removing an endpoint asks first, and explains when agents still use it', async ({ page }) => {
  let endpoints = [{ id: 'ep-1', name: 'Local server', baseUrl: 'http://127.0.0.1:1/v1', hasApiKey: true }];
  let attempts = 0;
  await page.route('**/api/model-endpoints*', route => route.fulfill({ json: endpoints }));
  await page.route('**/api/model-endpoints/ep-1', route => {
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 409,
        json: { message: '2 agents use this endpoint. Change their endpoint in Agents, or delete them, first.' },
      });
    endpoints = [];
    return route.fulfill({ json: { removed: true } });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Remove endpoint' }).click();
  expect(attempts).toBe(0); // nothing happens until confirmed
  const dialog = page.getByRole('dialog', { name: 'Remove endpoint' });
  await expect(dialog).toContainText('Local server');
  await dialog.getByRole('button', { name: 'Remove endpoint', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('2 agents use this endpoint');
  await expect(page.getByRole('heading', { name: 'Local server', includeHidden: true })).toBeAttached(); // still listed behind the dialog
  await dialog.getByRole('button', { name: 'Remove endpoint', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Local server' })).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('an agent can be renamed and moved to another model without recreating it', async ({ page }) => {
  const agents = sampleAgents.map(agent => ({ ...structuredClone(agent), endpointId: 'ep-1', model: 'm1' }));
  const patches: unknown[] = [];
  await page.route(/\/api\/agents(?:\?.*)?$/, route =>
    route.request().method() === 'GET' ? route.fulfill({ json: { agents, nextCursor: null } }) : route.fallback(),
  );
  await page.route('**/api/model-endpoints*', route =>
    route.fulfill({ json: [{ id: 'ep-1', name: 'Local server', baseUrl: 'http://127.0.0.1:1/v1', hasApiKey: false }] }),
  );
  await page.route('**/api/model-endpoints/test', route => route.fulfill({ json: { models: ['m1', 'm2'] } }));
  await page.route('**/api/agents/model-capabilities*', route =>
    route.fulfill({ json: { thinkingLevels: ['off'], reasoning: false } }),
  );
  await page.route('**/api/agents/avery', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON();
    patches.push(body);
    Object.assign(agents[0], body);
    return route.fulfill({ json: agents[0] });
  });
  await page.goto('/agents/avery');
  const model = page.getByRole('region', { name: 'Model' });
  await expect(model.getByLabel('Name')).toHaveValue('Avery');
  await expect(model.getByRole('combobox', { name: 'Model' })).toContainText('m1'); // current choice is preserved on load
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  await expect(settings.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await model.getByLabel('Name').fill('Avery Prime');
  await model.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'm2' }).click();
  await expect(settings.getByText('Unsaved: Model')).toBeVisible();
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect(model.getByText('Saved. The next turn uses these settings.')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  expect(patches).toEqual([{ name: 'Avery Prime', model: 'm2' }]);
  await expect(page.getByRole('button', { name: 'Open settings for Avery Prime' })).toBeVisible();
});

async function groupPage(page: Page, stops: { agentId: string; body: unknown }[]) {
  const members = sampleAgents
    .slice(0, 2)
    .map(agent => ({ id: agent.id, name: agent.name, avatar: null, channelId: agent.channelId }));
  const message = {
    id: 'gm-1',
    sequence: 1,
    groupId: 'team',
    role: 'user',
    authorId: null,
    authorName: 'You',
    authorAvatar: null,
    text: 'Please research this',
    timestamp: Date.now(),
    replyTo: null,
  };
  const group = { id: 'team', name: 'Research team', createdAt: Date.now(), members, lastMessage: message };
  await page.route(/\/api\/groups(?:\?.*)?$/, route => route.fulfill({ json: { groups: [group], nextCursor: null } }));
  await page.route('**/api/groups/team', route => route.fulfill({ json: group }));
  await page.route('**/api/groups/team/messages*', route =>
    route.fulfill({ json: { messages: [message], nextCursor: null } }),
  );
  await page.route('**/api/agents/*/stop', route => {
    stops.push({ agentId: route.request().url().split('/').at(-2)!, body: route.request().postDataJSON() });
    return route.fulfill({ json: { stopped: true } });
  });
}

test('a group shows who is working on its message and can stop exactly those runs', async ({ page }) => {
  const stops: { agentId: string; body: unknown }[] = [];
  await groupPage(page, stops);
  // Avery is answering the group message; Morgan is busy with something unrelated in a private chat.
  await page.addInitScript(() => {
    Object.assign(window, {
      agentRunSnapshot: [
        {
          agentId: 'avery',
          channelId: 'avery',
          runId: 'run-a',
          clientMessageId: 'gm-1',
          typing: false,
          typingTargets: [],
        },
        {
          agentId: 'morgan',
          channelId: 'morgan',
          runId: 'run-m',
          clientMessageId: 'private-9',
          typing: false,
          typingTargets: [],
        },
      ],
    });
  });
  await page.goto('/chat/groups/team');
  await expect(page.getByText('Avery is working…')).toBeVisible();
  await expect(page.getByText('Morgan is working…')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop response' }).click();
  await expect.poll(() => stops.length).toBe(1);
  expect(stops).toEqual([{ agentId: 'avery', body: { clientMessageId: 'gm-1' } }]); // Morgan's private run is left alone
});

test('a group with nobody working offers no Stop button', async ({ page }) => {
  await groupPage(page, []);
  await page.goto('/chat/groups/team');
  await expect(page.getByLabel('Message Research team')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
});

test('one Save covers every section, and leaving with unsaved changes asks first', async ({ page }) => {
  const puts: unknown[] = [],
    patches: unknown[] = [];
  const agents = sampleAgents.map(agent => ({ ...structuredClone(agent), endpointId: 'ep-1', model: 'm1' }));
  await page.route(/\/api\/agents(?:\?.*)?$/, route =>
    route.request().method() === 'GET' ? route.fulfill({ json: { agents, nextCursor: null } }) : route.fallback(),
  );
  await page.route('**/api/model-endpoints*', route =>
    route.fulfill({ json: [{ id: 'ep-1', name: 'Local server', baseUrl: 'http://127.0.0.1:1/v1', hasApiKey: false }] }),
  );
  await page.route('**/api/model-endpoints/test', route => route.fulfill({ json: { models: ['m1', 'm2'] } }));
  await page.route('**/api/agents/model-capabilities*', route =>
    route.fulfill({ json: { thinkingLevels: ['off'], reasoning: false } }),
  );
  await page.route('**/api/computers', route =>
    route.fulfill({
      json: {
        controllerConnected: true,
        computers: [
          {
            id: 'c1',
            name: 'Desk',
            organizationId: 'personal',
            state: 'running',
            createdAt: 0,
            cpuPercent: 0,
            memoryBytes: 0,
            memoryLimitBytes: null,
            cpuCount: null,
          },
        ],
      },
    }),
  );
  await page.route('**/api/agents/avery/computers', route => {
    if (route.request().method() === 'PUT') {
      puts.push(route.request().postDataJSON());
      return route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({ json: { computers: [] } });
  });
  await page.route('**/api/agents/avery', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    patches.push(route.request().postDataJSON());
    Object.assign(agents[0], route.request().postDataJSON());
    return route.fulfill({ json: agents[0] });
  });
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  await settings.getByRole('checkbox', { name: 'Desk' }).check();
  await settings.getByLabel('Name').fill('Avery Two');
  await expect(settings.getByText('Unsaved: Model, Computers')).toBeVisible();
  // Leaving asks first; keep editing changes nothing.
  await page.getByRole('button', { name: 'Open settings for Morgan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(dialog).toContainText('Model, Computers');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/agents\/avery$/);
  await expect(settings.getByLabel('Name')).toHaveValue('Avery Two');
  // One Save writes both sections.
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => puts.length + patches.length).toBe(2);
  expect(puts).toEqual([{ computerIds: ['c1'] }]);
  expect(patches).toEqual([{ name: 'Avery Two' }]);
  await expect(settings.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  // With nothing unsaved, navigation is immediate; with new edits, Discard and leave goes ahead.
  await settings.getByLabel('Name').fill('Changed again');
  await page.getByRole('button', { name: 'Open settings for Morgan' }).click();
  await page
    .getByRole('dialog', { name: 'Discard unsaved changes?' })
    .getByRole('button', { name: 'Discard and leave' })
    .click();
  await expect(page).toHaveURL(/\/agents\/morgan$/);
});
