import { test, expect } from './fixtures';

const memory = (name: string, type: string, title: string, extra: object = {}) => ({
  name,
  type,
  title,
  text: `${title}: details.`,
  by: 'your owner',
  trust: 'owner',
  channelId: null,
  recalls: 2,
  lastRecalledAt: null,
  faded: false,
  conflict: false,
  forgottenAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  ...extra,
});

test('agent settings show its memory by type, edit and forget a memory, and save the sleep window', async ({
  page,
}) => {
  let overview = {
    index: '- sam [person] Sam runs releases',
    memories: [
      memory('sam', 'person', 'Sam runs releases'),
      memory('tables', 'preference', 'Owner likes tables', { by: 'Kim on Discord', trust: 'other', conflict: true }),
    ],
    forgotten: [] as object[],
    maxCount: 1000,
    sleep: {
      from: '03:00',
      to: '05:00',
      activeFrom: '',
      activeTo: '',
      sleeping: false,
      sleptAt: '2026-10-02T03:10:00.000Z',
      lastNight: '- memorized sam: Sam runs releases',
    },
  };
  const calls: string[] = [];
  await page.route(/\/api\/agents\/avery\/memory(\/.*)?$/, async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    calls.push(`${method} ${url.pathname.replace('/api/agents/avery/memory', '') || '/'}`);
    if (url.pathname.endsWith('/versions'))
      return route.fulfill({
        json: [
          {
            title: 'Sam',
            text: 'Old text.',
            type: 'person',
            changedBy: 'sleep',
            createdAt: '2026-10-01T11:00:00.000Z',
          },
        ],
      });
    if (method === 'PATCH') {
      const body = route.request().postDataJSON();
      overview = {
        ...overview,
        memories: overview.memories.map(item => (item.name === 'sam' ? { ...item, ...body } : item)),
      };
      return route.fulfill({ json: overview.memories[0] });
    }
    if (method === 'DELETE') {
      overview = {
        ...overview,
        memories: overview.memories.filter(item => item.name !== 'sam'),
        forgotten: [memory('sam', 'person', 'Sam runs releases', { forgottenAt: '2026-10-02T10:00:00.000Z' })],
      };
      return route.fulfill({ status: 204 });
    }
    if (method === 'PUT') {
      overview = { ...overview, sleep: { ...overview.sleep, ...route.request().postDataJSON() } };
      return route.fulfill({ json: overview });
    }
    return route.fulfill({ json: overview });
  });
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  const section = settings.getByRole('region', { name: 'Memory' });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByText('- memorized sam: Sam runs releases')).toBeVisible();
  const types = section.getByRole('radiogroup', { name: 'Memory type' });
  await expect(types.getByRole('radio', { name: 'All 2' })).toBeChecked();
  await types.getByRole('radio', { name: 'Preference 1' }).click();
  const list = section.getByRole('list', { name: 'Memories' });
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list).toContainText('conflict');
  await expect(list).toContainText('preference · untrusted');
  await types.getByRole('radio', { name: 'All 2' }).click();
  await list.getByRole('button', { name: /Sam runs releases/ }).click();
  await expect(section.getByText('person · from your owner (you)')).toBeVisible();
  await section.getByText('Earlier versions (1)').click();
  await expect(section.getByText('Old text.')).toBeVisible();
  await section.getByRole('button', { name: 'Edit' }).click();
  await section.getByLabel('Memory text').fill('Sam runs releases on Fridays.');
  await section.getByRole('button', { name: 'Save memory' }).click();
  await expect(section.getByText('Sam runs releases on Fridays.')).toBeVisible();
  await section.getByRole('button', { name: 'Forget' }).click();
  await expect(types.getByRole('radio', { name: 'Forgotten 1' })).toBeVisible();
  // The sleep window saves with the other settings.
  await section.getByLabel('Sleeps from').fill('01:30');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => calls).toContain('PUT /sleep-window');
  expect(calls).toContain('PATCH /sam');
  expect(calls).toContain('DELETE /sam');
});
