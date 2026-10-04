import { test, expect } from './fixtures';

test('a person’s time zone starts as the browser’s and can be changed in Settings → Account', async ({ page }) => {
  await page.goto('/settings');
  const zone = page.getByRole('combobox', { name: 'Time zone' });
  const browser = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await expect(zone).toHaveText(new RegExp(browser.replaceAll('_', ' ')));
  await zone.click();
  await page.getByRole('option', { name: 'Asia/Tokyo', exact: true }).click();
  await expect(page.getByText('Saved. Your agents use it once they finish what they are doing.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Time zone' })).toHaveText(/Asia\/Tokyo/);
  // Put it back for the other tests.
  await page.evaluate(
    zone =>
      fetch('/api/auth/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ timeZone: zone }),
      }),
    browser,
  );
});
