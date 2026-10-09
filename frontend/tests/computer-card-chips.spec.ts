import { test, expect } from './fixtures';

const desk = (id: string, name: string, state: string) => ({
  id,
  name,
  state,
  createdAt: 0,
  cpuPercent: 0,
  memoryBytes: 0,
  memoryLimitBytes: 4294967296,
});
const session = (id: string, alive: boolean) => ({
  id,
  name: id,
  alive,
  exitCode: alive ? null : 0,
  createdAt: 1,
  columns: 100,
  rows: 30,
});

test('a running card shows a green dot and how many terminals are open', async ({ page }) => {
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({
      json: {
        controllerConnected: true,
        computers: [
          desk('a1b2c3d4-0000-4000-8000-000000000001', 'Lab', 'running'),
          desk('a1b2c3d4-0000-4000-8000-000000000002', 'Old', 'exited'),
        ],
      },
    }),
  );
  await page.route('**/api/computers/*/preview*', route =>
    route.fulfill({ status: 503, json: { message: 'Warming up' } }),
  );
  await page.route('**/api/computers/*/terminals', route =>
    route.fulfill({
      json: { type: 'terminal', sessions: [session('build', true), session('tests', true), session('done', false)] },
    }),
  );
  const lab = 'a1b2c3d4-0000-4000-8000-000000000001';
  await page.route('**/api/computers/control', route =>
    route.fulfill({
      json: {
        holders: [{ computerId: lab, agent: { id: 'avery', name: 'Avery' } }],
        readers: [
          { computerId: lab, agent: { id: 'morgan', name: 'Morgan' } },
          { computerId: lab, agent: { id: 'quinn', name: 'Quinn' } },
        ],
        recordings: [],
      },
    }),
  );
  await page.goto('/computers');
  const card = page.getByRole('article', { name: 'Lab' });
  // Exited terminals are not counted.
  await expect(card.getByLabel('2 terminals open')).toBeVisible();
  await expect(card.getByText('Running')).toBeVisible();
  // The holder on its own, the agents only viewing grouped; avatars only (names in the tooltip and label).
  await expect(card.getByRole('img', { name: /^Avery is using it/ })).toBeVisible();
  await expect(card.getByRole('img', { name: 'Viewing: Morgan, Quinn' })).toBeVisible();
  await expect(card.getByText('Avery')).toHaveCount(0);
  const old = page.getByRole('article', { name: 'Old' });
  await expect(old.getByText('Stopped')).toBeVisible();
  await expect(old.getByLabel(/terminals? open/)).toHaveCount(0);
  await expect(old.getByRole('img', { name: /using it|Viewing/ })).toHaveCount(0);
  await card.screenshot({ path: '../.scratch/card-chips.png' });
});
