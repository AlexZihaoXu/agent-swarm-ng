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
  await page.goto('/agents');
  const list = page.getByRole('complementary', { name: 'Agents', exact: true });
  await expect(list.getByText('Riley')).toBeVisible();
  const switcher = page.getByRole('button', { name: 'Organization: All organizations' }).filter({ visible: true });
  await expect(switcher).toContainText('4 agents · 0 computers');
  await switcher.click();
  await page.getByRole('menuitem', { name: /^Lab / }).click();
  await expect(page.getByRole('button', { name: 'Organization: Lab' }).filter({ visible: true })).toBeVisible();
  await expect(list.getByText('Riley')).toBeVisible();
  await expect(list.getByText('Avery')).toHaveCount(0);
  // The choice is per browser and survives a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Organization: Lab' }).filter({ visible: true })).toBeVisible();

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
