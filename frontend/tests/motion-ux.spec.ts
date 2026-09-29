import { expect, test } from './fixtures';
import { sampleAgents } from './sample-agents';

const agent = {
  id: 'long-agent',
  channelId: 'long-channel',
  name: 'Long agent',
  endpointId: 'endpoint',
  model: 'test-model',
  thinkingLevel: 'off',
  createdAt: 1000,
};
const messages = Array.from({ length: 40 }, (_, i) => ({
  id: `long-${i + 1}`,
  sequence: i + 1,
  channelId: agent.channelId,
  role: i % 2 ? 'assistant' : 'user',
  text: `Long message ${i + 1}\nWith a second line so the history scrolls.`,
  timestamp: 1000 + i,
}));

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/agents(?:\?.*)?$/, route =>
    route.fulfill({
      json: { agents: [...sampleAgents, { ...agent, lastMessage: messages.at(-1) }], nextCursor: null },
    }),
  );
});

test('a conversation is fetched before it is opened, and shows a placeholder only while it is on its way', async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => (release = resolve));
  let requested = false;
  await page.route('**/api/channels/long-channel/messages*', async route => {
    requested = true;
    await held;
    await route.fulfill({ json: { messages, nextCursor: null } });
  });
  await page.goto('/chat/agents/avery');
  // Idle warm-up or hovering the row starts the request before any click.
  await page.getByRole('button', { name: 'Open conversation with Long agent' }).hover();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: 'Open conversation with Long agent' }).click();
  const placeholder = page.getByRole('status', { name: 'Loading messages…' });
  await expect(placeholder).toBeVisible();
  await expect(page.getByRole('button', { name: 'Loading messages…' })).toHaveCount(0);
  release();
  await expect(page.getByRole('list', { name: 'Messages' }).locator(':scope > li')).toHaveCount(40);
  await expect(placeholder).toHaveCount(0);
});

test('reading older messages offers a way back to the latest, which then disappears', async ({ page }) => {
  await page.route('**/api/channels/long-channel/messages*', route =>
    route.fulfill({ json: { messages, nextCursor: null } }),
  );
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/chat/agents/long-agent');
  await expect(page.getByRole('list', { name: 'Messages' }).locator(':scope > li')).toHaveCount(40);
  const jump = page.getByRole('button', { name: 'Jump to latest' });
  await expect(jump).toHaveCount(0);
  const viewport = page.getByRole('region', { name: 'Chat history', exact: true });
  await viewport.evaluate(element => element.scrollTo({ top: 0 }));
  await expect(jump).toBeVisible();
  await jump.click();
  await expect
    .poll(() => viewport.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight))
    .toBeLessThan(2);
  await expect(jump).toHaveCount(0);
});

test('the sidebar has one selection highlight, and it follows the selected conversation', async ({ page }) => {
  await page.route('**/api/channels/long-channel/messages*', route =>
    route.fulfill({ json: { messages, nextCursor: null } }),
  );
  await page.goto('/chat/agents/avery');
  const highlight = page.locator('[data-slot="row-selection"]');
  await expect(highlight).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Open conversation with Avery' }).locator('[data-slot="row-selection"]'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Open conversation with Long agent' }).click();
  await expect(highlight).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Open conversation with Long agent' }).locator('[data-slot="row-selection"]'),
  ).toHaveCount(1);
});

test('buttons give press feedback, and dialogs open over the shared blurred backdrop', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  const create = page.getByRole('button', { name: 'Create group chat' });
  await expect(create).toHaveCSS('transition-property', /transform/);
  await create.click();
  await expect(page.getByRole('dialog', { name: 'Create group chat' })).toBeVisible();
  await expect(page.locator('[data-state="open"].fixed.inset-0').first()).toHaveCSS('backdrop-filter', 'blur(2px)');
});

test('agent settings offer jump links that follow the reader and land each heading in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('/agents/avery');
  const pane = page.getByRole('region', { name: 'Settings for Avery' });
  const nav = pane.getByRole('navigation', { name: 'Jump to section' });
  await expect(nav.getByRole('link')).toHaveText(['Channels', 'Model', 'Computers', 'Avatar', 'Delete agent']);
  await expect(nav.locator('[aria-current="location"]')).toHaveText('Channels');
  await nav.getByRole('link', { name: 'Avatar' }).click();
  await expect(nav.locator('[aria-current="location"]')).toHaveText('Avatar');
  const heading = pane.getByRole('heading', { name: 'Avatar', exact: true });
  await expect.poll(async () => (await heading.boundingBox())!.y).toBeGreaterThan((await nav.boundingBox())!.y);
  const navBottom = (await nav.boundingBox())!.y + (await nav.boundingBox())!.height;
  // Near the end of the page the scroll bottoms out, so allow the heading anywhere in the upper half.
  await expect.poll(async () => (await heading.boundingBox())!.y - navBottom).toBeLessThan(700 / 2);
  expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(navBottom);
  await expect(pane.getByRole('region', { name: 'Avatar' })).toBeFocused();
  // Scrolling by hand moves the highlight back.
  await pane.getByRole('region', { name: 'Agent editor' }).evaluate(element => element.scrollTo({ top: 0 }));
  await expect(nav.locator('[aria-current="location"]')).toHaveText('Channels');
});

test('empty screens say what is missing and point to the next step', async ({ page }) => {
  await page.route(/\/api\/computers(?:\?.*)?$/, route =>
    route.fulfill({ json: { computers: [], controllerConnected: true } }),
  );
  await page.goto('/computers');
  await expect(page.getByRole('heading', { name: 'No computers yet' })).toBeVisible();
  // The main navigation keeps plain accessible names; its icons are decorative.
  await expect(page.getByRole('tab', { name: 'Computers', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Computers', exact: true }).locator('svg')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Create computer' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Create computer' }).click();
  await expect(page).toHaveURL(/\/computers\/new$/);
  await expect(page.getByRole('dialog', { name: 'Create computer' })).toBeVisible();
});

test('the browser page menu is suppressed on app surfaces but kept for fields and selected text', async ({ page }) => {
  await page.goto('/chat/agents/avery');
  const prevented = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate(element => {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      });
  expect(await prevented('header')).toBe(true);
  expect(await prevented('textarea')).toBe(false);
  await page.getByRole('heading', { name: 'Avery', exact: true }).first().selectText();
  expect(await prevented('header')).toBe(false);
});
