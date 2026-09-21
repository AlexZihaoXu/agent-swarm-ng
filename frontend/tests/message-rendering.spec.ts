import { expect, test, type Page } from './fixtures';

async function send(page: Page, text: string) {
  await page.goto('/');
  await page.getByLabel('Message Avery').fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  const messages = page.getByRole('list', { name: 'Messages' }).locator(':scope > li');
  await expect(messages).toHaveCount(4);
  return messages.last();
}

test('renders Markdown formatting, lists, quotes, tables, and chat line breaks', async ({ page }) => {
  const message = await send(page, '# Heading\n\n**Bold** *italic* ~~removed~~ `inline`\nnext line\n\n> Quoted\n\n- One\n- Two\n\n1. First\n2. Second\n\n- [x] Done\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n[Example](https://example.com)');
  await expect(message.getByRole('heading', { name: 'Heading' })).toBeVisible();
  await expect(message.locator('strong')).toHaveText('Bold');
  await expect(message.locator('em')).toHaveText('italic');
  await expect(message.locator('del')).toHaveText('removed');
  await expect(message.locator('blockquote')).toHaveText('Quoted');
  await expect(message.locator('ul').first().locator('li')).toHaveCount(2);
  await expect(message.locator('ol li')).toHaveCount(2);
  await expect(message.locator('br')).toHaveCount(1);
  await expect(message.getByRole('checkbox')).toBeDisabled();
  await expect(message.getByRole('table')).toContainText('Value');
  await expect(message.getByRole('link', { name: 'Example' })).toHaveAttribute('rel', 'noopener noreferrer');
});

test('agent cards render compact Markdown without exposing spoilers or nesting controls', async ({ page }) => {
  await send(page, '**Bold preview** *italic* ~~removed~~ `inline` [Link](https://example.com) ||CARD SECRET||\n\n```cpp\nint main() {}\n```\n\n- [x] Done');
  const row = page.getByRole('button', { name: 'Open conversation with Avery' });
  const preview = row.locator('[data-slot="swap-text"]').last();
  await expect(preview.locator('strong')).toHaveText('Bold preview');
  await expect(preview.locator('em')).toHaveText('italic');
  await expect(preview.locator('del')).toHaveText('removed');
  await expect(preview.locator('code').first()).toHaveText('inline');
  await expect(preview).toContainText('[Spoiler]');
  await expect(row).not.toContainText('CARD SECRET');
  await expect(preview).not.toContainText('**');
  await expect(row.locator('a, button, input, pre, p, div, table')).toHaveCount(0);
  await expect(preview).toHaveCSS('text-overflow', 'ellipsis');
  await expect(preview).toHaveAttribute('data-prefix', 'You: ');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Message Avery').fill('**Updated** preview');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(preview.locator('strong')).toHaveText('Updated');
  await expect(preview).not.toContainText('Bold preview');
});

test('highlights fenced code, preserves whitespace, and copies code without Markdown', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const code = '#include <iostream>\nint main() {\n  std::cout << "Hello";\n}';
  const message = await send(page, '```cpp\n' + code + '\n```\n\n```unknown-language\n<literal> ||not a spoiler||\n```');
  await expect(message.locator('pre').first()).toHaveText(code);
  await expect(message.locator('pre .hljs-keyword').first()).toBeVisible();
  await expect(message.locator('pre').last()).toHaveText('<literal> ||not a spoiler||');
  await message.getByRole('button', { name: 'Copy code', exact: true }).first().click();
  await expect(message.getByRole('button', { name: 'Copied code' })).toBeVisible();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(code);
});

test('spoilers reveal by keyboard and escaped markers remain literal', async ({ page }) => {
  const message = await send(page, 'Answer: ||**secret**|| and `||literal||` and \\|\\|escaped\\|\\|');
  const spoiler = message.getByRole('button', { name: 'Reveal spoiler', exact: true });
  await expect(spoiler).toHaveAttribute('aria-expanded', 'false');
  await expect(spoiler.getByText('secret', { exact: true })).not.toBeVisible();
  await spoiler.focus(); await page.keyboard.press('Enter');
  await expect(message.getByRole('button', { name: 'Hide spoiler' })).toHaveAttribute('aria-expanded', 'true');
  await expect(message.locator('strong')).toHaveText('secret');
  await expect(message.locator('strong')).toBeVisible();
  await expect(message).toContainText('||escaped||');
  await expect(message.locator('code')).toHaveText('||literal||');
});

test('does not execute HTML, dangerous links, or automatically fetch remote images', async ({ page }) => {
  let fetched = false;
  await page.route('https://example.invalid/**', route => { fetched = true; return route.abort(); });
  const message = await send(page, '<script>window.markdownExecuted = true</script>\n\n<img src="https://example.invalid/raw" onerror="window.markdownExecuted=true">\n\n[bad](javascript:alert%281%29) ![Remote image](https://example.invalid/tracker.png)');
  await expect(message.locator('script, img, iframe')).toHaveCount(0);
  await expect(message.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => 'markdownExecuted' in window)).toBe(false);
  expect(fetched).toBe(false);
});

test('long code and tables scroll inside the message on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open conversation with Avery' }).click();
  const text = '```text\n' + 'long-code-'.repeat(80) + '\n```\n\n| First | Second |\n| --- | --- |\n| ' + 'long-cell-'.repeat(60) + ' | Value |';
  await page.getByLabel('Message Avery').fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  const pre = page.getByRole('list', { name: 'Messages' }).locator('pre');
  await expect(pre).toBeVisible();
  expect(await pre.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
