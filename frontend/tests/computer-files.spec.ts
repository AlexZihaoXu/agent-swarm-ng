import { test, expect, type Page } from './fixtures';
const id = 'c4a5f16d-0042-4b70-a232-dd65591a2c4c';
const home = '/home/agent';
const file = (name: string, type = 'file', parent = home) => ({ name, path: `${parent}/${name}`, type, size: type === 'directory' ? null : 12, modifiedAt: 1700000000000, isSymlink: false });
async function setup(page: Page, state = 'running') {
  const requests: URL[] = [];
  await page.route('**/api/computers', route => route.fulfill({ json: { controllerConnected: true, computers: [{ id, name: 'File desk', state, createdAt: 0, cpuPercent: 0, memoryBytes: 0 }] } }));
  await page.route('**/api/computers/**', route => {
    const url = new URL(route.request().url()); requests.push(url);
    if (url.pathname.endsWith('settings-limits')) return route.fulfill({ json: { cpuCores: { min: 1, max: 8, default: 4 }, memoryGiB: { min: 1, max: 16, default: 4 }, timezoneDefault: 'UTC' } });
    if (url.pathname.endsWith('/control')) return route.fulfill({ json: { holders: [] } });
    if (url.pathname.endsWith('/preview')) return route.fulfill({ status: 503, json: { message: 'Warming up' } });
    if (url.pathname.endsWith('/files')) {
      const path = url.searchParams.get('path') || home, filter = url.searchParams.get('filter') || '', offset = Number(url.searchParams.get('offset') || 0);
      if (path === '/denied') return route.fulfill({ status: 403, json: { message: 'Permission denied.' } });
      const entries = path === home ? [file('src', 'directory'), file('README.md'), file('image.png'), file('x'.repeat(180) + '.txt')] : path === `${home}/src` ? [file('main.ts', 'file', path)] : path === '/home' ? [file('agent', 'directory', path)] : [];
      return route.fulfill({ json: { path, parent: path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/', entries: offset ? [file('later.txt')] : entries.filter(row => row.name.includes(filter)), nextOffset: path === home && !offset && !filter ? 200 : null, truncated: false } });
    }
    if (url.pathname.endsWith('/file-preview')) {
      const path = url.searchParams.get('path')!, binary = path.endsWith('.png');
      return route.fulfill({ json: { path, name: path.split('/').at(-1), size: 12, text: binary ? null : '<script>not executable</script>\nhello', truncated: !binary, binary } });
    }
    if (url.pathname.endsWith('/download')) return route.fulfill({ contentType: 'application/octet-stream', headers: { 'content-disposition': 'attachment; filename="README.md"' }, body: 'hello world\n' });
    return route.fulfill({ status: 404, json: { message: 'Not found' } });
  });
  await page.goto('/computers');
  await page.getByRole('button', { name: 'Actions for File desk' }).click();
  return requests;
}
async function open(page: Page) {
  const requests = await setup(page);
  await page.getByRole('menuitem', { name: 'File browser', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'File browser · File desk' });
  await expect(panel.getByRole('button', { name: 'README.md', exact: false }).first()).toBeVisible();
  return { panel, requests };
}
test('file browser navigates, edits paths, filters and pages without upload or mutations', async ({ page }) => {
  const { panel, requests } = await open(page);
  await expect(panel.getByRole('button', { name: /Upload|New folder|Delete|Rename/ })).toHaveCount(0);
  await panel.getByRole('button', { name: /^src\// }).click();
  await expect(panel.getByRole('button', { name: /^main.ts/ })).toBeVisible();
  await panel.getByRole('navigation', { name: 'Folder breadcrumbs' }).getByRole('button', { name: 'agent', exact: true }).click();
  await panel.getByRole('button', { name: 'Next page' }).click(); await expect(panel.getByRole('button', { name: /^later.txt/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Previous page' }).click();
  await panel.getByLabel('Filter this folder').fill('README');
  await expect(panel.getByRole('list', { name: 'Folder entries' }).getByRole('listitem')).toHaveCount(1);
  expect(requests.some(url => url.searchParams.get('filter') === 'README')).toBe(true);
  await panel.getByRole('button', { name: 'Edit path' }).click();
  await panel.getByLabel('Folder path').fill('/denied'); await panel.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Permission denied');
  await panel.getByRole('button', { name: 'Edit path' }).click();
  await panel.getByLabel('Folder path').fill(home); await panel.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(panel.getByRole('list', { name: 'Folder entries' })).toContainText('README.md');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Actions for File desk' })).toBeFocused();
});
test('starts at home and navigates through breadcrumbs only, including leaving previews', async ({ page }) => {
  const { panel, requests } = await open(page);
  expect(requests.find(url => url.pathname.endsWith('/files'))?.searchParams.get('path')).toBe(home);
  await expect(panel.getByRole('button', { name: /^(Back|Forward|Up one folder|Refresh)$/ })).toHaveCount(0);
  const crumbs = panel.getByRole('navigation', { name: 'Folder breadcrumbs' });
  await panel.getByRole('button', { name: /^src\// }).click();
  await expect(crumbs.getByRole('button', { name: 'src', exact: true })).toBeVisible();
  await crumbs.getByRole('button', { name: 'agent', exact: true }).click();
  await expect(panel.getByRole('list', { name: 'Folder entries' })).toContainText('README.md');
  await crumbs.getByRole('button', { name: 'home', exact: true }).click();
  await panel.getByRole('button', { name: /^agent\// }).click();
  await panel.getByRole('button', { name: /^README.md/ }).click();
  await expect(panel.getByLabel('File preview')).toBeVisible();
  await crumbs.getByRole('button', { name: 'agent', exact: true }).click();
  await expect(panel.getByLabel('File preview')).toHaveCount(0);
  await expect(panel.getByRole('list', { name: 'Folder entries' })).toContainText('README.md');
});
test('text preview remains inert and readonly; download is an actual named file', async ({ page }) => {
  const { panel } = await open(page);
  await panel.getByRole('button', { name: /^README.md/ }).click();
  await expect(panel.getByLabel('File preview')).toHaveText('<script>not executable</script>\nhello');
  await expect(panel).toContainText('Preview truncated to 64 KiB');
  await expect(panel.locator('script')).toHaveCount(0);
  const saved = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download README.md', exact: true }).click();
  const download = await saved; expect(download.suggestedFilename()).toBe('README.md');
  const stream = await download.createReadStream(); let text = ''; for await (const chunk of stream!) text += chunk.toString();
  expect(text).toBe('hello world\n');
  await panel.getByRole('navigation', { name: 'Folder breadcrumbs' }).getByRole('button', { name: 'agent', exact: true }).click();
  await panel.getByRole('button', { name: /^image.png/ }).click();
  await expect(panel).toContainText('No text preview for this file');
});
for (const width of [280, 320, 760, 1280]) test(`file modal is contained at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const { panel } = await open(page);
  const box = await panel.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  const overflow = await panel.evaluate(element => [...element.querySelectorAll('[data-radix-scroll-area-viewport]')].some(node => node.scrollWidth > node.clientWidth + 1));
  expect(overflow).toBe(false); await expect(panel).toHaveCSS('animation-name', 'none');
  await expect(panel.getByLabel('Locations', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('complementary', { name: 'File locations' })).toHaveCount(0);
  if (width === 320 || width === 1280) await panel.screenshot({ path: `../.scratch/file-browser-${width}.png` });
});
test('stopped computers cannot open file browser', async ({ page }) => {
  await setup(page, 'exited'); await expect(page.getByRole('menuitem', { name: 'File browser', exact: true })).toBeDisabled();
});
