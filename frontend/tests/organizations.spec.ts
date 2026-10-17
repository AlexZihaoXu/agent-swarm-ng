import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

const orgs = (counts: Record<string, number>) => ({
  organizations: [
    {
      id: 'personal',
      name: 'Personal',
      createdAt: '2030-01-01T00:00:00.000Z',
      agents: counts.personal,
      computers: 0,
      groups: 0,
    },
    { id: 'lab', name: 'Lab', createdAt: '2030-01-02T00:00:00.000Z', agents: counts.lab, computers: 0, groups: 0 },
  ],
});

test('the switcher scopes the dashboard to one organization and agents move between them', async ({ page }) => {
  const agents = sampleAgents.map(agent =>
    agent.id === 'riley' || agent.id === 'quinn' ? { ...agent, organizationId: 'lab' } : agent,
  );
  await page.route(/\/api\/agents(?:\?.*)?$/, route => route.fulfill({ json: { agents, nextCursor: null } }));
  await page.route(/\/api\/organizations$/, route => route.fulfill({ json: orgs({ personal: 2, lab: 2 }) }));
  const moves: object[] = [];
  await page.route(/\/api\/organizations\/[^/]+\/move$/, async route => {
    const body = route.request().postDataJSON();
    moves.push({ to: route.request().url().split('/').at(-2), ...body });
    await route.fulfill({
      json: body.apply
        ? { dropped: ['DM with Morgan: no longer allowed'], moved: true }
        : { dropped: ['DM with Morgan: no longer allowed'], moved: false },
    });
  });
  await page.goto('/chat');
  // The chat list shows the organization's agents.
  const option = (name: string) => page.locator('[data-chat-kind="dm"]').filter({ hasText: name });
  await expect(option('Riley')).toBeVisible();
  await expect(option('Avery')).toBeVisible();
  const switcher = page.getByRole('button', { name: 'Organization: All organizations' }).filter({ visible: true });
  await expect(switcher).toContainText('4 agents · 0 computers');
  await switcher.click();
  await page.getByRole('menuitem', { name: /^Lab / }).click();
  await expect(page.getByRole('button', { name: 'Organization: Lab' }).filter({ visible: true })).toBeVisible();
  await expect(option('Riley')).toBeVisible();
  await expect(option('Avery')).toHaveCount(0);
  // The address names the organization shown: it stays across in-app navigation and a reload.
  await expect(page).toHaveURL(/[?&]org=lab(&|$)/);
  await page.getByRole('tab', { name: 'Chat' }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/chat.*[?&]org=lab/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Organization: Lab' }).filter({ visible: true })).toBeVisible();
  await expect(page).toHaveURL(/[?&]org=lab/);
  // An address naming another organization shows that one; Back returns to the one before.
  await page.goto('/agents?org=personal');
  await expect(page.getByRole('button', { name: 'Organization: Personal' }).filter({ visible: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Organization: Lab' }).filter({ visible: true })).toBeVisible();
  // All organizations leave the address plain.
  await page.getByRole('button', { name: 'Organization: Lab' }).filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: /^All organizations/ }).click();
  await expect(page).not.toHaveURL(/org=/);
  await page.getByRole('button', { name: 'Organization: All organizations' }).filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: /^Lab / }).click();

  // Moving an agent: the confirmation lists the links it drops.
  await page.goto('/agents/riley');
  const section = page.getByRole('region', { name: 'Organization' });
  await section.scrollIntoViewIfNeeded();
  await expect(section).toContainText('In Lab.');
  await section.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Personal' }).click();
  await section.getByRole('button', { name: 'Move' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move Riley to Personal?' });
  await expect(dialog).toContainText('DM with Morgan: no longer allowed');
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect
    .poll(() => moves)
    .toEqual([
      { to: 'personal', kind: 'agent', id: 'riley', apply: false },
      { to: 'personal', kind: 'agent', id: 'riley', apply: true },
    ]);
});

test('Settings creates, renames and deletes organizations', async ({ page }) => {
  let state = orgs({ personal: 4, lab: 0 });
  const calls: string[] = [];
  await page.route(/\/api\/organizations(\/[^/]+)?$/, async route => {
    const method = route.request().method();
    const url = new URL(route.request().url()).pathname;
    calls.push(`${method} ${url}`);
    if (method === 'POST')
      state = {
        organizations: [
          ...state.organizations,
          {
            id: 'ops',
            name: route.request().postDataJSON().name,
            createdAt: '2030-01-03T00:00:00.000Z',
            agents: 0,
            computers: 0,
            groups: 0,
          },
        ],
      };
    if (method === 'PATCH')
      state = {
        organizations: state.organizations.map(org =>
          url.endsWith(`/${org.id}`) ? { ...org, name: route.request().postDataJSON().name } : org,
        ),
      };
    if (method === 'DELETE') state = { organizations: state.organizations.filter(org => !url.endsWith(`/${org.id}`)) };
    await route.fulfill({ json: state });
  });
  await page.goto('/settings#organizations');
  const section = page.getByRole('region', { name: 'Organizations' });
  await expect(section.getByLabel('New organization name')).toBeFocused();
  await section.getByLabel('New organization name').fill('Ops');
  await section.getByRole('button', { name: 'Create organization' }).click();
  await expect(section.getByLabel('Rename Ops')).toBeVisible();
  // A non-empty organization cannot be deleted.
  await expect(
    section
      .getByRole('listitem')
      .filter({ has: page.getByLabel('Rename Personal') })
      .getByRole('button', { name: 'Delete' }),
  ).toBeDisabled();
  await section.getByLabel('Rename Lab').fill('Research');
  await section.getByRole('button', { name: 'Rename' }).click();
  await expect(section.getByLabel('Rename Research')).toBeVisible();
  await section
    .getByRole('listitem')
    .filter({ has: page.getByLabel('Rename Ops') })
    .getByRole('button', { name: 'Delete' })
    .click();
  await page.getByRole('dialog', { name: 'Delete Ops?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(section.getByLabel('Rename Ops')).toHaveCount(0);
  expect(calls).toEqual(
    expect.arrayContaining([
      'POST /api/organizations',
      'PATCH /api/organizations/lab',
      'DELETE /api/organizations/ops',
    ]),
  );
});

test('the Organization tab sets up the organization in view, and asks which while all are shown', async ({ page }) => {
  let state = orgs({ personal: 4, lab: 0 });
  const calls: string[] = [];
  await page.route(/\/api\/organizations(\/[^/]+)?$/, async route => {
    const method = route.request().method();
    const url = new URL(route.request().url()).pathname;
    if (method !== 'GET') calls.push(`${method} ${url}`);
    if (method === 'PATCH')
      state = {
        organizations: state.organizations.map(org =>
          url.endsWith(`/${org.id}`) ? { ...org, name: route.request().postDataJSON().name } : org,
        ),
      };
    if (method === 'DELETE') state = { organizations: state.organizations.filter(org => !url.endsWith(`/${org.id}`)) };
    await route.fulfill({ json: state });
  });
  await page.goto('/organization');
  // All organizations in view: pick one, which the switcher then shows too.
  await expect(page.getByRole('heading', { name: 'Choose an organization' })).toBeVisible();
  await page
    .getByRole('list', { name: 'Organizations' })
    .getByRole('button', { name: /Personal/ })
    .click();
  await expect(page).toHaveURL(/\/organization\?org=personal$/);
  await expect(page.getByRole('button', { name: 'Organization: Personal' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Personal', level: 2 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'What it holds' })).toContainText('Agents4');
  // Not empty: deleting waits for its agents.
  await expect(page.getByRole('button', { name: 'Delete Personal' })).toBeDisabled();
  await expect(page.getByText('Delete its agents first.')).toBeVisible();
  // The switcher's other organization: renamed, then deleted (it is empty), which goes back to asking.
  await page.getByRole('button', { name: 'Organization: Personal' }).click();
  await page.getByRole('menuitem', { name: /Lab/ }).click();
  await expect(page.getByRole('heading', { name: 'Lab', level: 2 })).toBeVisible();
  await page.getByLabel('Organization name').fill('Research');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { name: 'Research', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Research' }).click();
  await page.getByRole('dialog', { name: 'Delete Research?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Personal', level: 2 })).toBeVisible();
  expect(calls).toEqual(['PATCH /api/organizations/lab', 'DELETE /api/organizations/lab']);
});
