import { test, expect, type Page } from './fixtures';

const HOUR = 3_600_000;
const BUCKET = 30 * 60_000;
const to = Math.ceil(Date.now() / BUCKET) * BUCKET;
const buckets = Array.from({ length: 96 }, (_, i) => to - 48 * HOUR + i * BUCKET);
const wave = (base: number, amp: number) => buckets.map((_, i) => base + amp * Math.sin(i / 6));
const sample = {
  range: '48h',
  from: new Date(to - 48 * HOUR).toISOString(),
  to: new Date(to).toISOString(),
  bucketMs: BUCKET,
  buckets,
  system: { cpuPercent: wave(30, 15), memUsed: wave(20e9, 3e9), memTotal: 64e9 },
  disks: [
    {
      disk: '/dev/nvme0n1p2',
      label: 'nvme0n1p2',
      uses: ['docker', 'platform data'],
      used: wave(390e9, 2e9),
      total: 468e9,
    },
    { disk: 'bulk', label: 'bulk (ZFS)', uses: ['listed'], used: wave(300e9, 1e9), total: 900e9 },
  ],
  computers: [
    { id: 'c1', name: 'Claude Code Lab', cpuPercent: wave(20, 10), memUsed: wave(2e9, 5e8), memLimit: 4 * 2 ** 30 },
    { id: 'c2', name: 'Desk', cpuPercent: wave(8, 4), memUsed: wave(1e9, 2e8), memLimit: 4 * 2 ** 30 },
  ],
  agents: [
    {
      id: 'avery',
      name: 'Avery',
      activeMs: 5.5 * HOUR,
      active: buckets.map(() => 0),
      tokens: {
        input: wave(4000, 3000),
        output: wave(800, 600),
        cacheRead: wave(90000, 40000),
        cacheWrite: buckets.map(() => 0),
        reasoning: wave(200, 150),
      },
      tokenTotals: { input: 384000, output: 76800, cacheRead: 8640000, cacheWrite: 0, reasoning: 19200 },
      cost: 12.5,
    },
    {
      id: 'morgan',
      name: 'Morgan',
      activeMs: 0,
      active: buckets.map(() => 0),
      tokens: { input: [], output: [], cacheRead: [], cacheWrite: [], reasoning: [] },
      tokenTotals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      cost: 0,
    },
  ],
  providers: [
    { provider: 'openai-codex', subscription: true, cost: wave(0.1, 0.08), total: 9.6 },
    { provider: 'openrouter', subscription: false, cost: wave(0.03, 0.02), total: 2.9 },
  ],
};

async function mock(page: Page, ranges: string[]) {
  await page.route('**/api/dashboard**', route => {
    ranges.push(new URL(route.request().url()).searchParams.get('range') ?? '');
    return route.fulfill({ json: sample });
  });
}

test('the Dashboard tab charts system, computers, agents, spend and tokens, and switches the period', async ({
  page,
}) => {
  const ranges: string[] = [];
  await mock(page, ranges);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/agents');
  await page.getByRole('tab', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible();
  for (const title of [
    'Host CPU',
    'Host memory',
    'Disk · nvme0n1p2',
    'Disk · bulk (ZFS)',
    'Computer CPU',
    'Computer memory',
    'Agent active hours',
    'Spend per provider',
    'Avery',
  ])
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText('API-equivalent').first()).toBeVisible();
  // Charts drew (Recharts paths).
  await expect(page.locator('.recharts-area-area').first()).toBeVisible();
  await expect(page.locator('.recharts-line-curve').first()).toBeVisible();
  // Axes and grid draw (React 19 needs react-is 19 for Recharts).
  await expect(page.locator('.recharts-cartesian-axis-tick').first()).toBeVisible();
  expect(ranges.at(-1)).toBe('48h');
  await page.getByRole('radio', { name: 'Week' }).first().click();
  await expect.poll(() => ranges.at(-1)).toBe('7d');
  await page.screenshot({ path: '../.scratch/shots/dashboard-desktop.png', fullPage: false });
});

for (const width of [320, 390]) {
  test(`every tab is one tap away on a ${width}px phone, with the organization and Portal on top`, async ({ page }) => {
    await mock(page, []);
    await page.setViewportSize({ width, height: 780 });
    await page.goto('/dashboard');
    const nav = page.getByRole('tablist', { name: 'Main navigation' });
    const box = (await nav.boundingBox())!;
    // A bottom bar across the whole width.
    expect(box.width).toBeGreaterThanOrEqual(width - 2);
    expect(box.y + box.height).toBeGreaterThan(780 - 80);
    for (const tab of ['Dashboard', 'Agents', 'Chat', 'Computers', 'Settings']) {
      const item = nav.getByRole('tab', { name: tab });
      await expect(item).toBeVisible();
      const size = (await item.boundingBox())!;
      expect(size.height).toBeGreaterThanOrEqual(44);
      expect(size.width).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole('button', { name: /^Organization:/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Portal' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `../.scratch/shots/dashboard-phone-${width}.png` });
    for (const [tab, url] of [
      ['Agents', /\/agents$/],
      ['Chat', /\/chat$/],
      ['Computers', /\/computers$/],
      ['Settings', /\/settings$/],
    ] as const) {
      await nav.getByRole('tab', { name: tab }).click();
      await expect(page).toHaveURL(url);
    }
    await page.screenshot({ path: `../.scratch/shots/settings-phone-${width}.png` });
  });
}
