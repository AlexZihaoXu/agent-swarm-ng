import { test, expect, chooseAgent, agentOption as option, type Page } from './fixtures';
import { sampleAgents } from './sample-agents';

// Wide screens: the Agents panel chooses an agent from a picker and lists that agent's settings sections.
const picker = (page: Page) => page.getByRole('combobox', { name: 'Agent' });

test('the picker shows each agent with avatar, name and organization', async ({ page }) => {
  await page.goto('/agents/avery');
  const panel = page.getByRole('complementary', { name: 'Agents', exact: true });
  await expect(panel.getByRole('searchbox', { name: 'Search agents' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /^Open settings for / })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Create new agent' })).toBeVisible();
  await expect(picker(page).locator('[data-option-label]')).toHaveText('Avery');
  await expect(picker(page)).toContainText('Personal');
  await expect(picker(page).locator('[data-avatar-seed]')).toHaveCount(1);
  await picker(page).click();
  await expect(page.getByRole('option')).toHaveCount(sampleAgents.length);
  await expect(page.getByRole('option').locator('[data-option-label]')).toHaveText(
    sampleAgents.map(agent => agent.name),
  );
  const morgan = option(page, 'Morgan');
  await expect(morgan).toContainText('Personal');
  await expect(morgan.locator('[data-avatar-seed]')).toHaveCount(1);
  // One organization: no group headings.
  await expect(page.locator('[cmdk-group-heading]')).toHaveCount(0);
});

test('searching filters the agents', async ({ page }) => {
  await page.goto('/agents/avery');
  await picker(page).click();
  const search = page.getByPlaceholder('Search agents…');
  await expect(search).toBeFocused();
  await search.fill('ri');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(option(page, 'Riley')).toBeVisible();
  await search.fill('nobody');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(page.getByText('No matches')).toBeVisible();
  await search.fill('');
  await expect(page.getByRole('option')).toHaveCount(sampleAgents.length);
  // A search lasts for one opening: choosing a match and reopening starts afresh.
  await search.fill('ri');
  await option(page, 'Riley').click();
  await expect(page).toHaveURL(/\/agents\/riley$/);
  await picker(page).click();
  await expect(page.getByPlaceholder('Search agents…')).toHaveValue('');
  await expect(page.getByRole('option')).toHaveCount(sampleAgents.length);
});

test('with every organization shown, agents are grouped under organization headings', async ({ page }) => {
  const agents = structuredClone(sampleAgents).map(agent =>
    agent.id === 'morgan' || agent.id === 'quinn' ? { ...agent, organizationId: 'work' } : agent,
  );
  await page.route(/\/api\/agents(?:\?.*)?$/, route => route.fulfill({ json: { agents, nextCursor: null } }));
  await page.route(/\/api\/organizations$/, route =>
    route.fulfill({
      json: {
        organizations: [
          {
            id: 'personal',
            name: 'Personal',
            createdAt: '2030-01-01T00:00:00.000Z',
            agents: 2,
            computers: 0,
            groups: 0,
          },
          { id: 'work', name: 'Work', createdAt: '2030-01-02T00:00:00.000Z', agents: 2, computers: 0, groups: 0 },
        ],
      },
    }),
  );
  await page.goto('/agents/avery');
  await expect(picker(page)).toContainText('Personal'); // the trigger still names the organization
  await picker(page).click();
  await expect(page.locator('[cmdk-group-heading]')).toHaveText(['Personal', 'Work']);
  await expect(page.getByRole('option').locator('[data-option-label]')).toHaveText([
    'Avery',
    'Riley',
    'Morgan',
    'Quinn',
  ]);
  const work = page.getByRole('group', { name: 'Work' });
  await expect(work.getByRole('option')).toHaveCount(2);
  await expect(work.getByRole('option').filter({ hasText: 'Morgan' })).toBeVisible();
  await expect(work.getByRole('option').filter({ hasText: 'Quinn' })).toBeVisible();
  // Grouped, the options leave the organization to their heading.
  await expect(option(page, 'Morgan')).not.toContainText('Work');
});

test('choosing an agent opens its settings', async ({ page }) => {
  await page.goto('/agents/avery');
  await chooseAgent(page, 'Morgan');
  await expect(page).toHaveURL(/\/agents\/morgan$/);
  await expect(page.getByRole('region', { name: 'Settings for Morgan' })).toBeVisible();
  await expect(picker(page).locator('[data-option-label]')).toHaveText('Morgan');
  await expect(page.getByRole('option')).toHaveCount(0); // the list closed
});

test('the panel lists the settings sections and marks the one jumped to', async ({ page }) => {
  await page.goto('/agents/avery');
  const nav = page
    .getByRole('complementary', { name: 'Agents', exact: true })
    .getByRole('navigation', { name: 'Jump to section' });
  await expect(nav.getByRole('link').first()).toHaveText('Channels');
  for (const name of ['Model', 'Instructions', 'Memory', 'Avatar'])
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Channels' })).toHaveAttribute('aria-current', 'location');
  await nav.getByRole('link', { name: 'Model' }).click();
  await expect(nav.getByRole('link', { name: 'Model' })).toHaveAttribute('aria-current', 'location');
  await expect(nav.getByRole('link', { name: 'Channels' })).not.toHaveAttribute('aria-current', 'location');
  await expect(nav.locator('[aria-current="location"]')).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Model' })).toHaveCSS('cursor', 'pointer');
});
