import { test, expect, type Page } from './fixtures';
import { sampleAgents } from './sample-agents';
const agent = sampleAgents[0];
const entry = (id: string, sequence: number, text: string, revision = 1) => ({
  id,
  sequence,
  revision,
  runId: 'saved-run',
  channelId: agent.channelId,
  kind: 'assistant',
  label: 'Direct model output',
  text,
  timestamp: 1000 + sequence,
  offset: 0,
  nextOffset: null,
});
const emit = (page: Page, value: object) =>
  page.evaluate(
    event => (window as unknown as { emitAgentEvent: (value: object) => void }).emitAgentEvent(event),
    value,
  );
async function open(page: Page) {
  await page.goto(`/chat/agents/${agent.id}`);
  await page.getByRole('button', { name: 'Agent activity', exact: true }).click();
  return page.getByRole('dialog', { name: 'Agent activity', exact: true });
}

test('restores complete and partial activity after refresh, pages older entries, and restores context usage silently', async ({
  page,
}) => {
  const context = { ...entry('context', 1, '≈ 25 / 100 tokens · 25.0%'), kind: 'status', label: 'Context usage' };
  await page.route(`**/api/agents/${agent.id}/activity*`, route => {
    const older = new URL(route.request().url()).searchParams.has('before');
    return route.fulfill({
      json: {
        entries: older
          ? [entry('old', 2, 'Archived older trace')]
          : [entry('completed', 3, 'Completed trace'), entry('active', 4, 'Partial active trace')],
        nextCursor: older ? null : 3,
        contextUsage: context,
      },
    });
  });
  let panel = await open(page);
  await expect(panel).toContainText('Completed trace');
  await expect(panel).toContainText('Partial active trace');
  await expect(page.getByLabel('Context usage', { exact: true })).toHaveText('≈ 25 / 100 tokens · 25.0%');
  await panel.getByRole('button', { name: 'Load older activity' }).click();
  await expect(panel).toContainText('Archived older trace');
  await expect(panel.locator('details')).toHaveCount(3);
  await page.reload();
  await page.getByRole('button', { name: 'Agent activity', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Agent activity', exact: true });
  await expect(panel).toContainText('Completed trace');
  await expect(panel).toContainText('Partial active trace');
  await expect(page.getByRole('list', { name: 'Messages' })).not.toContainText('trace');
  expect(
    await page.evaluate(
      () => (window as unknown as { notificationAudio: { starts: number } }).notificationAudio.starts,
    ),
  ).toBe(0);
});

test('keeps the newer live revision when a delayed snapshot arrives and ignores duplicate replacements', async ({
  page,
}) => {
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    requested = resolve;
  });
  await page.route(`**/api/agents/${agent.id}/activity*`, async route => {
    requested();
    await gate;
    return route.fulfill({
      json: { entries: [entry('active', 1, 'Old snapshot', 1)], nextCursor: null, contextUsage: null },
    });
  });
  const panel = await open(page);
  await started;
  const live = { type: 'activity', agentId: agent.id, entry: entry('active', 1, 'New live replacement', 2) };
  await emit(page, live);
  await emit(page, live);
  release();
  await expect(panel).toContainText('New live replacement');
  await expect(panel).not.toContainText('Old snapshot');
  await expect(panel.locator('details')).toHaveCount(1);
  await emit(page, { ...live, entry: entry('active', 1, 'Older live event', 1) });
  await expect(panel).not.toContainText('Older live event');
});

test('restored page can expand again after pagehide aborts an in-flight fragment', async ({ page }) => {
  let release!: () => void,
    requests = 0;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(`**/api/agents/${agent.id}/activity*`, route =>
    route.fulfill({
      json: { entries: [{ ...entry('long', 1, 'First'), nextOffset: 5 }], nextCursor: null, contextUsage: null },
    }),
  );
  await page.route(`**/api/agents/${agent.id}/activity/entry*`, async route => {
    if (++requests === 1) await gate;
    await route.fulfill({ json: { ...entry('long', 1, ' tail'), offset: 5 } }).catch(() => {});
  });
  const panel = await open(page);
  await panel.getByRole('button', { name: 'Load more text' }).click();
  await expect(panel.getByRole('button', { name: 'Loading text…' })).toBeDisabled();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(panel.getByRole('button', { name: 'Load more text' })).toBeEnabled();
  release();
  await panel.getByRole('button', { name: 'Load more text' }).click();
  await expect(panel).toContainText('First tail');
});

for (const tool of ['glance', 'read'])
  test(`${tool} image references label evicted copies without losing metadata`, async ({ page }) => {
    const imageId = '8f9bb21a-a7e6-4e52-853d-b188207fc0f0';
    await page.route(`**/api/agents/${agent.id}/activity*`, route =>
      route.fulfill({
        json: {
          entries: [
            {
              ...entry('shot', 1, JSON.stringify({ id: imageId, agentId: agent.id, bounds: [0, 0, 999, 999] })),
              kind: 'tool_result',
              label: `${tool} — result`,
            },
          ],
          nextCursor: null,
          contextUsage: null,
        },
      }),
    );
    await page.route(`**/api/agents/${agent.id}/screenshots/*`, route =>
      route.fulfill({ status: 404, json: { message: 'Expired' } }),
    );
    const panel = await open(page);
    await expect(panel).toContainText('Screenshot expired or unavailable');
    await expect(panel).toContainText(imageId);
  });

for (const width of [280, 320, 390, 760])
  test(`activity stays within the narrow panel at ${width}px with long metadata`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/agents', route =>
      route.fulfill({
        json: {
          agents: sampleAgents.map(value => (value.id === agent.id ? { ...value, name: 'A'.repeat(80) } : value)),
          nextCursor: null,
        },
      }),
    );
    const long = {
      ...entry('long', 1, JSON.stringify({ stdout: 'x'.repeat(2800), command: 'some/very/long/path/'.repeat(40) })),
      label: 'tool_name_'.repeat(20),
      kind: 'tool_result',
      state: 'complete',
      channelId: 'channel-'.repeat(15),
      runId: 'run-'.repeat(30),
      nextOffset: 3500,
      totalLength: 9000,
    };
    const meta = {
      ...entry('meta', 2, 'Detailed metadata value'),
      kind: 'metadata',
      label: 'Model response details',
      state: 'complete',
    };
    await page.route(`**/api/agents/${agent.id}/activity*`, route =>
      route.fulfill({ json: { entries: [long, meta], nextCursor: 1, contextUsage: null } }),
    );
    const panel = await open(page);
    await expect(panel).toContainText('Partial view');
    const metadata = panel.locator('details[data-activity-kind="metadata"]');
    await expect(metadata).not.toHaveAttribute('open', '');
    await metadata.locator('summary').click();
    await expect(metadata).toContainText('Detailed metadata value');
    const geometry = await panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const viewport = element.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
      return {
        left: rect.left,
        right: rect.right,
        window: innerWidth,
        viewportWidth: viewport.clientWidth,
        contentWidth: viewport.scrollWidth,
        escaped: [...element.querySelectorAll('header, details, summary, pre, button')]
          .filter(
            node =>
              node.getBoundingClientRect().right > rect.right + 1 || node.getBoundingClientRect().left < rect.left - 1,
          )
          .map(node => node.tagName),
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.window);
    expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.escaped).toEqual([]);
    if (width === 320) await panel.screenshot({ path: '../.scratch/activity-review-320.png' });
  });

test('retries failed history and text chunks, with replacement on an expansion revision conflict', async ({ page }) => {
  let pages = 0,
    fragments = 0;
  await page.route(`**/api/agents/${agent.id}/activity*`, route =>
    ++pages === 1
      ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
      : route.fulfill({
          json: {
            entries: [{ ...entry('long', 1, 'First section'), nextOffset: 13 }],
            nextCursor: null,
            contextUsage: null,
          },
        }),
  );
  await page.route(`**/api/agents/${agent.id}/activity/entry*`, route => {
    fragments++;
    if (fragments === 1) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
    if (fragments === 2) return route.fulfill({ status: 409, json: { message: 'Changed' } });
    return route.fulfill({ json: entry('long', 1, 'Updated complete text', 2) });
  });
  const panel = await open(page);
  await panel.getByRole('button', { name: 'Retry activity' }).click();
  await expect(panel).toContainText('First section');
  await panel.getByRole('button', { name: 'Load more text' }).click();
  await panel.getByRole('button', { name: 'Retry more text' }).click();
  await expect(panel).toContainText('Updated complete text');
  await expect(panel).not.toContainText('First section');
  await expect(panel.getByRole('button', { name: 'Load more text' })).toHaveCount(0);
});
