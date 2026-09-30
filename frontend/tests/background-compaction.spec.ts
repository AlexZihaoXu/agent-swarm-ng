import { test, expect } from './fixtures';
import { sampleAgents } from './sample-agents';

const compaction = (state: 'running' | 'sleeping' | null) => ({
  type: 'compaction',
  state,
  agentId: 'avery',
  eventId: crypto.randomUUID(),
  runId: 'platform',
  channelId: 'platform',
});

test('an agent compacting in the background shows an orbiting arc; asleep, closed eyes and zzz', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  const conversation = page.getByRole('region', { name: 'Conversation with Avery' });
  const chats = page.getByRole('complementary', { name: 'Chats' });
  await expect(conversation.getByLabel('Message Avery')).toBeVisible();
  const emit = (event: object) =>
    page.evaluate(
      value => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(value),
      event,
    );
  await emit(compaction('running'));
  await expect(conversation.locator('[data-slot="compaction-ring"]').first()).toBeVisible();
  await expect(chats.locator('[data-slot="compaction-ring"]').first()).toBeVisible();
  await expect(conversation.getByText('is compacting its memory in the background')).toBeVisible();
  await page.screenshot({ path: '../.scratch/shots/compaction-running.png' });
  // Context full before the summary: the agent sleeps.
  await emit(compaction('sleeping'));
  await expect(conversation.locator('[data-slot="sleeping"]').first()).toBeVisible();
  await expect(conversation.locator('[data-slot="compaction-ring"]')).toHaveCount(0);
  await expect(conversation.getByText('is asleep until its memory is compacted')).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: '../.scratch/shots/compaction-sleeping.png' });
  await emit(compaction(null));
  await expect(conversation.locator('[data-slot="sleeping"]')).toHaveCount(0);
  await expect(chats.locator('[data-slot="compaction-ring"]')).toHaveCount(0);
});

test('reduced motion keeps the compaction and sleeping cues still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/chat/agents/avery');
  const conversation = page.getByRole('region', { name: 'Conversation with Avery' });
  await expect(conversation.getByLabel('Message Avery')).toBeVisible();
  await page.evaluate(
    value => (window as unknown as { emitAgentEvent: (event: object) => void }).emitAgentEvent(value),
    compaction('sleeping'),
  );
  const z = conversation.locator('[data-slot="sleeping"] > span').first();
  await expect(z).toBeVisible();
  await expect(z).toHaveCSS('animation-name', 'none');
});

test('each agent’s memory settings save with the page', async ({ page }) => {
  let body: unknown;
  await page.route('**/api/agents/avery', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    body = route.request().postDataJSON();
    return route.fulfill({
      json: { ...sampleAgents[0], compaction: { atPercent: 55, idleMinutes: 0, idlePercent: 50 } },
    });
  });
  await page.goto('/agents/avery');
  const settings = page.getByRole('region', { name: 'Settings for Avery' });
  const at = settings.getByLabel('Compact while working at (%)', { exact: true });
  await expect(at).toHaveValue('65');
  await at.fill('95');
  await expect(settings.getByRole('alert').first()).toContainText('from 20 to 90');
  await at.fill('55');
  await settings.getByLabel('Compact when idle for (minutes)', { exact: true }).fill('0');
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect(settings.getByRole('status').first()).toContainText('Saved');
  expect(body).toEqual({ compaction: { atPercent: 55, idleMinutes: 0 } });
});
