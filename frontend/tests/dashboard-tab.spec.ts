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
  system: {
    cpuPercent: wave(30, 15).map((value, i) => (i > 40 && i < 50 ? null : value)),
    memUsed: wave(20e9, 3e9),
    memTotal: 64e9,
    netRx: wave(2e6, 1e6),
    netTx: wave(5e5, 2e5),
  },
  diskIo: [
    { device: 'nvme0n1', label: 'nvme0n1 · HighRel 512GB SSD · 512 GB', read: wave(4e6, 2e6), write: wave(1e6, 5e5) },
    { device: 'sda', label: 'sda · SABRENT · 1.4 TB', read: wave(1e5, 5e4), write: wave(2e5, 1e5) },
  ],
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
    {
      id: 'c1',
      name: 'Claude Code Lab',
      cpuPercent: wave(20, 10),
      memUsed: wave(2e9, 5e8),
      memPercent: wave(47, 12),
      memLimit: 4 * 2 ** 30,
    },
    {
      id: 'c2',
      name: 'Desk',
      cpuPercent: wave(8, 4),
      memUsed: wave(1e9, 2e8),
      memPercent: wave(23, 5),
      memLimit: 4 * 2 ** 30,
    },
  ],
  agents: [
    {
      id: 'avery',
      name: 'Avery',
      activeMs: 5.5 * HOUR,
      active: buckets.map((_, i) => (i % 5 === 0 ? 20 * 60_000 : 0)),
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
    {
      provider: 'openai-codex',
      label: 'openai-codex',
      subscription: true,
      priced: true,
      cost: wave(0.1, 0.08),
      total: 9.6,
    },
    {
      provider: 'openrouter',
      label: 'openrouter',
      subscription: false,
      priced: true,
      cost: wave(0.03, 0.02),
      total: 2.9,
    },
    { provider: 'endpoint:e1', label: 'Home LLM', subscription: false, priced: false, cost: wave(0, 0), total: 0 },
  ],
};

const live = {
  intervalMs: 250,
  cores: 16,
  devices: [
    { device: 'nvme0n1', label: 'nvme0n1 · HighRel 512GB SSD · 512 GB' },
    { device: 'sda', label: 'sda · SABRENT · 1.4 TB' },
  ],
  points: Array.from({ length: 240 }, (_, i) => ({
    t: Date.now() - (240 - i) * 250,
    cpuPercent: 10 + (i % 7),
    memUsed: 8e9,
    memTotal: 32e9,
    netRx: 1e6 + i * 1e4,
    netTx: 2e5,
    disks: { nvme0n1: { read: 3e6, write: 1e6 }, sda: { read: 1e4, write: 5e4 } },
  })),
};

async function mock(page: Page, ranges: string[]) {
  await page.route('**/api/dashboard**', route => {
    ranges.push(new URL(route.request().url()).searchParams.get('range') ?? '');
    return route.fulfill({ json: sample });
  });
  // Registered last: Playwright tries the newest route first, so the stream is not caught by the pattern above. The
  // snapshot, then one more reading (the stream ends there and the page reconnects).
  await page.route('**/api/dashboard/live/stream', route => {
    const t = Date.now();
    const point = { ...live.points.at(-1)!, t };
    const snapshot = { ...live, points: live.points.map((item, i) => ({ ...item, t: t - (240 - i) * 250 })) };
    return route.fulfill({
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify({ type: 'snapshot', ...snapshot })}\n${JSON.stringify({ type: 'point', point })}\n`,
    });
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
  // Now: rings for CPU, memory and each storage area; network now; the last minute per physical disk.
  const now = page.getByRole('region', { name: 'Now' });
  for (const label of ['CPU', 'Memory', 'nvme0n1p2', 'bulk (ZFS)'])
    await expect(now.locator(`[data-usage-label="${label}"]`)).toBeVisible();
  await expect(now.locator('[data-usage-label="CPU"]')).toContainText('16 cores');
  await expect(page.getByRole('heading', { name: 'Disk I/O · sda · SABRENT · 1.4 TB' }).first()).toBeVisible();
  // CPU blue, memory cyan (25%: below the yellow mark).
  const arc = (label: string) => now.locator(`[data-usage-label="${label}"] circle`).nth(1);
  await expect(arc('CPU')).toHaveAttribute('style', /--usage-cpu/);
  await expect(arc('Memory')).toHaveAttribute('style', /--usage-memory/);
  // Storage areas are greens; one 83% full is fairly high: yellow.
  await expect(arc('bulk (ZFS)')).toHaveAttribute('style', /--usage-storage-2/);
  await expect(arc('nvme0n1p2')).toHaveAttribute('style', /--usage-high/);
  // The live charts follow the stream and slide with the clock between readings.
  await expect(page.getByRole('img', { name: /^CPU, last minute: CPU \d/ })).toBeVisible();
  const slide = page.getByRole('img', { name: /^CPU, last minute/ }).locator('g[transform^="matrix"]');
  const before = await slide.getAttribute('transform');
  await expect.poll(() => slide.getAttribute('transform')).not.toBe(before);
  for (const title of [
    'Host CPU',
    'Host memory',
    'Host network',
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
  await expect(page.getByText('not priced (custom endpoint)')).toBeVisible();
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

test('a dropped live stream says it is reconnecting and dims the last readings', async ({ page }) => {
  await mock(page, []);
  let calls = 0;
  await page.route('**/api/dashboard/live/stream', route =>
    // The first two (development StrictMode opens it twice), then the backend is gone.
    ++calls <= 2
      ? route.fulfill({
          contentType: 'application/x-ndjson',
          body: `${JSON.stringify({ type: 'snapshot', ...live })}\n`,
        })
      : route.fulfill({ status: 503, body: '' }),
  );
  await page.goto('/dashboard');
  const now = page.getByRole('region', { name: 'Now' });
  await expect(now.getByRole('status')).toHaveText(/four readings a second/);
  await expect(now.getByRole('status')).toHaveText(/Reconnecting/);
  await expect(now.locator('[data-usage-label="CPU"]')).toContainText('16 cores');
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
