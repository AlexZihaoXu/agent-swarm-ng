import { test, expect, type Page } from './fixtures';
const id = 'c4a5f16d-0042-4b70-a232-dd65591a2c4c';
const home = '/home/agent';
const file = (name: string, type = 'file', parent = home) => ({
  name,
  path: `${parent}/${name}`,
  type,
  size: type === 'directory' ? null : 12,
  modifiedAt: 1700000000000,
  isSymlink: false,
});
type Upload = { url: URL; body: string };
async function setup(page: Page, state = 'running') {
  const requests: URL[] = [];
  const uploads: Upload[] = [];
  const parts: { offset: number; length: number }[] = [];
  const folders: { path: string; name: string }[] = [];
  const ranges: (string | undefined)[] = [];
  const cancels: URL[] = [];
  await page.route('**/api/computers', route =>
    route.fulfill({
      json: {
        controllerConnected: true,
        computers: [{ id, name: 'File desk', state, createdAt: 0, cpuPercent: 0, memoryBytes: 0 }],
      },
    }),
  );
  await page.route('**/api/computers/**', route => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.pathname.endsWith('settings-limits'))
      return route.fulfill({
        json: {
          cpuCores: { min: 1, max: 8, default: 4 },
          memoryGiB: { min: 1, max: 16, default: 4 },
          timezoneDefault: 'UTC',
        },
      });
    if (url.pathname.endsWith('/control')) return route.fulfill({ json: { holders: [] } });
    if (url.pathname.endsWith('/preview')) return route.fulfill({ status: 503, json: { message: 'Warming up' } });
    if (url.pathname.endsWith('/files')) {
      const path = url.searchParams.get('path') || home,
        filter = url.searchParams.get('filter') || '',
        offset = Number(url.searchParams.get('offset') || 0);
      if (path === '/denied') return route.fulfill({ status: 403, json: { message: 'Permission denied.' } });
      const entries =
        path === home
          ? [
              file('src', 'directory'),
              file('README.md'),
              file('image.png'),
              file('locked.bin'),
              file('x'.repeat(180) + '.txt'),
            ]
          : path === `${home}/src`
            ? [file('main.ts', 'file', path)]
            : path === '/home'
              ? [file('agent', 'directory', path)]
              : [];
      return route.fulfill({
        json: {
          path,
          parent: path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/',
          entries: offset ? [file('later.txt')] : entries.filter(row => row.name.includes(filter)),
          nextOffset: path === home && !offset && !filter ? 200 : null,
          truncated: false,
        },
      });
    }
    if (url.pathname.endsWith('/file-preview')) {
      const path = url.searchParams.get('path')!,
        binary = path.endsWith('.png');
      return route.fulfill({
        json: {
          path,
          name: path.split('/').at(-1),
          size: 12,
          text: binary ? null : '<script>not executable</script>\nhello',
          truncated: !binary,
          binary,
        },
      });
    }
    if (url.pathname.endsWith('/download')) {
      const range = route.request().headers().range;
      ranges.push(range);
      if (url.searchParams.get('path')?.endsWith('locked.bin'))
        return route.fulfill({ status: 403, json: { message: 'Path access denied.' } });
      if (range === 'bytes=0-0')
        return route.fulfill({
          status: 206,
          contentType: 'application/octet-stream',
          headers: { 'content-range': 'bytes 0-0/12', 'accept-ranges': 'bytes' },
          body: 'h',
        });
      return route.fulfill({
        contentType: 'application/octet-stream',
        headers: { 'content-disposition': 'attachment; filename="README.md"', 'accept-ranges': 'bytes' },
        body: 'hello world\n',
      });
    }
    if (url.pathname.endsWith('/upload')) {
      if (route.request().method() === 'DELETE') {
        cancels.push(url);
        return route.fulfill({ json: { cancelled: true } });
      }
      // Parts: an empty opening part (the name and space check), then the data; the last part places the file.
      const body = route.request().postDataBuffer()?.toString() ?? '';
      parts.push({ offset: Number(url.searchParams.get('offset')), length: body.length });
      const name = url.searchParams.get('name')!,
        mode = url.searchParams.get('mode'),
        size = Number(url.searchParams.get('size')),
        offset = Number(url.searchParams.get('offset'));
      if (name === 'fails.txt' && body.length)
        return route.fulfill({ status: 507, json: { message: 'There is not enough free space on this computer.' } });
      if (offset === 0 && !body.length && mode === 'refuse' && ['README.md', 'image.png'].includes(name))
        return route.fulfill({
          status: 409,
          json: { message: 'A file with that name already exists.', conflict: true },
        });
      if (offset + body.length < size) return route.fulfill({ status: 202, json: { received: offset + body.length } });
      uploads.push({ url, body });
      const saved = mode === 'rename' ? name.replace(/(\.[^.]*)?$/, ' (1)$1') : name;
      return route.fulfill({
        status: 201,
        json: { name: saved, path: `${url.searchParams.get('path')}/${saved}`, size },
      });
    }
    if (url.pathname.endsWith('/folders')) {
      const body = route.request().postDataJSON();
      folders.push(body);
      return route.fulfill({ json: { path: `${body.path}/${body.name}`, created: true } });
    }
    return route.fulfill({ status: 404, json: { message: 'Not found' } });
  });
  await page.goto('/computers');
  await page.getByRole('button', { name: 'Actions for File desk' }).click();
  return Object.assign(requests, { uploads, folders, ranges, cancels, parts });
}
async function open(page: Page) {
  const requests = await setup(page);
  await page.getByRole('menuitem', { name: 'File browser', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'File browser · File desk' });
  await expect(panel.getByRole('button', { name: 'README.md', exact: false }).first()).toBeVisible();
  return { panel, requests };
}
test('file browser navigates, edits paths, filters and pages without edit or delete controls', async ({ page }) => {
  const { panel, requests } = await open(page);
  await expect(panel.getByRole('button', { name: /New folder|Delete|Rename/ })).toHaveCount(0);
  const editPath = panel.getByRole('button', { name: 'Edit path', exact: true });
  await expect(editPath).toHaveText('');
  await expect(editPath).toHaveAttribute('title', 'Edit path');
  await expect(editPath.locator('svg')).toBeVisible();
  await panel.getByRole('button', { name: /^src\// }).click();
  await expect(panel.getByRole('button', { name: /^main.ts/ })).toBeVisible();
  await panel
    .getByRole('navigation', { name: 'Folder breadcrumbs' })
    .getByRole('button', { name: 'agent', exact: true })
    .click();
  await panel.getByRole('button', { name: 'Next page' }).click();
  await expect(panel.getByRole('button', { name: /^later.txt/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Previous page' }).click();
  await panel.getByLabel('Filter this folder').fill('README');
  await expect(panel.getByRole('list', { name: 'Folder entries' }).getByRole('listitem')).toHaveCount(1);
  expect(requests.some(url => url.searchParams.get('filter') === 'README')).toBe(true);
  await panel.getByRole('button', { name: 'Edit path' }).click();
  await panel.getByLabel('Folder path').fill('/denied');
  await panel.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Permission denied');
  await panel.getByRole('button', { name: 'Edit path' }).click();
  await panel.getByLabel('Folder path').fill(home);
  await panel.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(panel.getByRole('list', { name: 'Folder entries' })).toContainText('README.md');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Actions for File desk' })).toBeFocused();
});
test('starts in the home folder and navigates through breadcrumbs only, including leaving previews', async ({
  page,
}) => {
  const { panel, requests } = await open(page);
  expect(requests.find(url => url.pathname.endsWith('/files'))?.searchParams.get('path')).toBe(home);
  await expect(panel.getByRole('button', { name: /^(Back|Forward|Up one folder|Refresh)$/ })).toHaveCount(0);
  const crumbs = panel.getByRole('navigation', { name: 'Folder breadcrumbs' });
  await panel.getByRole('button', { name: /^src\// }).click();
  await expect(crumbs.getByRole('button', { name: 'src', exact: true })).toBeVisible();
  await crumbs.getByRole('button', { name: 'agent', exact: true }).click();
  await expect(panel.getByRole('list', { name: 'Folder entries' })).toContainText('README.md');
  await panel.getByRole('button', { name: /^README.md/ }).click();
  await expect(panel.getByLabel('File preview')).toBeVisible();
  await crumbs.getByRole('button', { name: 'agent', exact: true }).click();
  await expect(panel.getByLabel('File preview')).toHaveCount(0);
  await expect(panel.getByRole('list', { name: 'Folder entries' })).toContainText('README.md');
});
test('text preview remains inert and readonly; download is an actual named file', async ({ page }) => {
  const { panel, requests } = await open(page);
  await panel.getByRole('button', { name: /^README.md/ }).click();
  await expect(panel.getByLabel('File preview')).toHaveText('<script>not executable</script>\nhello');
  await expect(panel).toContainText('Preview truncated to 64 KiB');
  await expect(panel.locator('script')).toHaveCount(0);
  const saved = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download README.md', exact: true }).click();
  const download = await saved;
  // A one-byte range checks the file first; the browser's own download then streams the whole of it.
  expect(requests.ranges).toEqual(['bytes=0-0', undefined]);
  expect(download.suggestedFilename()).toBe('README.md');
  expect(download.url()).toBe(
    `http://127.0.0.1:5173/api/computers/${id}/download?path=${encodeURIComponent(`${home}/README.md`)}`,
  );
  // Chromium cancels a native download whose response a route mocked, so its bytes are not read here (the real
  // streaming path is covered by the controller/backend tests and the disposable-computer check).
  await panel
    .getByRole('navigation', { name: 'Folder breadcrumbs' })
    .getByRole('button', { name: 'agent', exact: true })
    .click();
  await panel.getByRole('button', { name: /^image.png/ }).click();
  await expect(panel).toContainText('No text preview for this file');
});
test('a download the computer refuses says why instead of saving an error page', async ({ page }) => {
  const { panel, requests } = await open(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await panel.getByRole('button', { name: 'Download locked.bin', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('Path access denied.');
  expect(requests.ranges).toEqual(['bytes=0-0']);
  expect(downloads).toBe(0);
});
for (const width of [280, 320, 760, 1280])
  test(`file modal is contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { panel } = await open(page);
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    const overflow = await panel.evaluate(element =>
      [...element.querySelectorAll('[data-radix-scroll-area-viewport]')].some(
        node => node.scrollWidth > node.clientWidth + 1,
      ),
    );
    expect(overflow).toBe(false);
    await expect(panel).toHaveCSS('animation-name', 'none');
    await expect(panel.getByLabel('Locations', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('complementary', { name: 'File locations' })).toHaveCount(0);
    if (width === 320 || width === 1280) await panel.screenshot({ path: `../.scratch/file-browser-${width}.png` });
  });
test('stopped computers cannot open file browser', async ({ page }) => {
  await setup(page, 'exited');
  await expect(page.getByRole('menuitem', { name: 'File browser', exact: true })).toBeDisabled();
});

test('the desktop viewer opens the file browser', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('Escape');
  await page.route(`**/computers/${id}/desktop/**`, route =>
    route.fulfill({ contentType: 'text/html', body: '<html><body style="background:#123">Desktop</body></html>' }),
  );
  await page.goto(`/computers/${id}`);
  await page.getByRole('button', { name: 'File browser', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'File browser · File desk' });
  await expect(panel.getByRole('button', { name: 'README.md', exact: false }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  // Portal (Ctrl+K anywhere) also had a command per running computer; it is hidden at the owner's request
  // (2026-10-17), so that half waits until it returns:
  // await page.goto('/computers');
  // await page.getByRole('article', { name: 'File desk' }).waitFor();
  // await page.keyboard.press('Control+k');
  // await page.keyboard.type('files');
  // await page.getByRole('option', { name: /Files on File desk/ }).click();
  // await expect(panel.getByRole('button', { name: 'README.md', exact: false }).first()).toBeVisible();
});

/**
 * Uploads report progress through XHR events, which a mocked route answers all at once. This shim sends each
 * upload's progress in steps (a slow link) before the request itself goes out to the mocked route.
 */
async function slowUploads(page: Page, steps = 8, delay = 250) {
  await page.addInitScript(
    ({ steps, delay }) => {
      const open = XMLHttpRequest.prototype.open;
      const send = XMLHttpRequest.prototype.send;
      const abort = XMLHttpRequest.prototype.abort;
      type Shim = XMLHttpRequest & { shimUrl?: string; shimTimer?: number; shimPending?: boolean };
      XMLHttpRequest.prototype.open = function (this: Shim, method: string, url: string | URL) {
        this.shimUrl = String(url);
        // eslint-disable-next-line prefer-rest-params
        return open.apply(this, arguments as unknown as Parameters<typeof open>);
      } as typeof open;
      XMLHttpRequest.prototype.send = function (this: Shim, body?: Document | XMLHttpRequestBodyInit | null) {
        if (!this.shimUrl?.includes('/upload?') || !(body instanceof Blob) || !body.size) return send.call(this, body);
        const total = body.size;
        let step = 0;
        this.shimPending = true;
        const tick = () => {
          step++;
          this.upload.dispatchEvent(
            new ProgressEvent('progress', {
              lengthComputable: true,
              loaded: Math.round((total * step) / steps),
              total,
            }),
          );
          if (step < steps) this.shimTimer = window.setTimeout(tick, delay);
          else {
            this.shimPending = false;
            send.call(this, body);
          }
        };
        this.shimTimer = window.setTimeout(tick, delay);
      };
      XMLHttpRequest.prototype.abort = function (this: Shim) {
        if (this.shimPending) {
          clearTimeout(this.shimTimer);
          this.shimPending = false;
          this.dispatchEvent(new ProgressEvent('abort'));
          return;
        }
        return abort.call(this);
      };
    },
    { steps, delay },
  );
}
const bytes = (size: number, fill = 'x') => Buffer.from(fill.repeat(size));

test('uploads picked files into the viewed folder with progress, speed and time left, then refreshes', async ({
  page,
}) => {
  await slowUploads(page);
  const { panel, requests } = await open(page);
  await panel.getByRole('button', { name: /^src\// }).click();
  await expect(panel.getByRole('button', { name: /^main.ts/ })).toBeVisible();
  const listings = () => requests.filter(url => url.pathname.endsWith('/files') && !url.searchParams.get('filter'));
  const before = listings().length;
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Upload', exact: true }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: bytes(4_000_000) },
    { name: 'fails.txt', mimeType: 'text/plain', buffer: bytes(10) },
  ]);
  const uploads = panel.getByRole('region', { name: 'Uploads' });
  const bar = uploads.getByRole('progressbar', { name: 'Uploading notes.txt' });
  await expect(bar).toBeVisible();
  // Bytes sent of the total, a smoothed speed and the time left, beside the percentage.
  await expect(uploads).toContainText(/MB of 3\.8 MB · [\d.]+ (B|KB|MB)\/s · \d+ (s|min) left/);
  await expect(uploads).toContainText(/\d+%/);
  expect(Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await expect(uploads).toContainText('3.8 MB · Uploaded');
  await expect(uploads.getByRole('alert')).toHaveText('There is not enough free space on this computer.');
  const notes = requests.uploads.find(upload => upload.url.searchParams.get('name') === 'notes.txt')!;
  expect(Object.fromEntries(notes.url.searchParams)).toMatchObject({
    path: `${home}/src`,
    name: 'notes.txt',
    size: '4000000',
    offset: '0',
    mode: 'refuse',
  });
  expect(notes.url.searchParams.get('upload')).toMatch(/^[0-9a-f]{32}$/);
  expect(notes.body.length).toBe(4_000_000);
  await expect.poll(() => listings().length).toBeGreaterThan(before);
  await uploads.getByRole('button', { name: 'Clear finished' }).click();
  await expect(uploads).toHaveCount(0);
});

test('sends a large file in 32 MiB parts, one after another, after an empty opening part', async ({ page }) => {
  const { panel, requests } = await open(page);
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Upload', exact: true }).click();
  const size = 40 * 1024 * 1024;
  await (await chooser).setFiles([{ name: 'disk.img', mimeType: 'application/octet-stream', buffer: bytes(size) }]);
  await expect(panel.getByRole('region', { name: 'Uploads' })).toContainText('40.0 MB · Uploaded', { timeout: 30_000 });
  const part = 32 * 1024 * 1024;
  expect(requests.parts).toEqual([
    { offset: 0, length: 0 },
    { offset: 0, length: part },
    { offset: part, length: size - part },
  ]);
});

test('asks before replacing a file of the same name: keep both, replace or skip', async ({ page }) => {
  const { panel, requests } = await open(page);
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Upload', exact: true }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'README.md', mimeType: 'text/plain', buffer: bytes(5, 'a') },
    { name: 'image.png', mimeType: 'image/png', buffer: bytes(5, 'b') },
    { name: 'new.txt', mimeType: 'text/plain', buffer: bytes(5, 'c') },
  ]);
  const uploads = panel.getByRole('region', { name: 'Uploads' });
  // The new name goes straight through; both taken names wait for a choice.
  await expect(uploads).toContainText('new.txt5 B · Uploaded');
  const items = uploads.getByRole('listitem');
  await expect(items.filter({ hasText: 'A file with this name is already here.' })).toHaveCount(2);
  expect(requests.uploads.map(upload => upload.url.searchParams.get('name'))).toEqual(['new.txt']);
  await items.filter({ hasText: 'README.md' }).getByRole('button', { name: 'Keep both' }).click();
  await expect(uploads).toContainText('Uploaded as README (1).md');
  await items.filter({ hasText: 'image.png' }).getByRole('button', { name: 'Replace' }).click();
  await expect(items.filter({ hasText: 'image.png' })).toContainText('5 B · Uploaded');
  const modes = Object.fromEntries(
    requests.uploads.map(upload => [upload.url.searchParams.get('name'), upload.url.searchParams.get('mode')]),
  );
  expect(modes).toEqual({ 'new.txt': 'refuse', 'README.md': 'rename', 'image.png': 'overwrite' });
  // Skip sends nothing.
  const again = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Upload', exact: true }).click();
  await (await again).setFiles([{ name: 'README.md', mimeType: 'text/plain', buffer: bytes(5) }]);
  await items.last().getByRole('button', { name: 'Skip' }).click();
  await expect(items.last()).toContainText('Skipped');
  expect(requests.uploads).toHaveLength(3);
});

test('cancels one upload without sending it, while the next keeps going', async ({ page }) => {
  await slowUploads(page, 20, 300);
  const { panel, requests } = await open(page);
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Upload', exact: true }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'one.bin', mimeType: 'application/octet-stream', buffer: bytes(2_000_000) },
    { name: 'two.bin', mimeType: 'application/octet-stream', buffer: bytes(1_000) },
  ]);
  const uploads = panel.getByRole('region', { name: 'Uploads' });
  await expect(uploads.getByRole('progressbar', { name: 'Uploading one.bin' })).toBeVisible();
  await uploads.getByRole('button', { name: 'Cancel upload of one.bin' }).click();
  await expect(uploads.getByRole('listitem').filter({ hasText: 'one.bin' })).toContainText('Cancelled');
  await expect(uploads.getByRole('listitem').filter({ hasText: 'two.bin' })).toContainText('Uploaded', {
    timeout: 15_000,
  });
  expect(requests.uploads.map(upload => upload.url.searchParams.get('name'))).toEqual(['two.bin']);
  // The computer is told to drop what it has of the cancelled one.
  expect(requests.cancels.map(url => url.searchParams.get('name'))).toEqual(['one.bin']);
});

test('closing with uploads running asks first', async ({ page }) => {
  await slowUploads(page, 40, 300);
  const { panel } = await open(page);
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Upload', exact: true }).click();
  await (await chooser).setFiles([{ name: 'big.bin', mimeType: 'application/octet-stream', buffer: bytes(1000) }]);
  await expect(panel.getByRole('progressbar', { name: 'Uploading big.bin' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toContainText('Uploads are still running. Closing cancels them.');
  await panel.getByRole('button', { name: 'Keep uploading' }).click();
  await expect(panel.getByRole('progressbar', { name: 'Uploading big.bin' })).toBeVisible();
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: 'Cancel uploads and close' }).click();
  await expect(panel).toHaveCount(0);
});

test('drag and drop shows a drop frame and uploads files and whole folders', async ({ page }) => {
  const { panel, requests } = await open(page);
  // A synthetic drop has no file-system entries: give the dropped item a folder "proj" holding a.txt and an empty
  // "empty" folder, as a real folder drop does.
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['hello'], 'top.txt', { type: 'text/plain' }));
    data.items.add(new File(['x'], 'proj', { type: '' }));
    const file = (name: string, content: string) => ({
      isFile: true,
      isDirectory: false,
      name,
      file: (done: (file: File) => void) => done(new File([content], name)),
    });
    const folder = (name: string, children: unknown[]) => ({
      isFile: false,
      isDirectory: true,
      name,
      createReader: () => {
        let read = false;
        return {
          readEntries: (done: (entries: unknown[]) => void) => {
            done(read ? [] : children);
            read = true;
          },
        };
      },
    });
    const entries = [file('top.txt', 'hello'), folder('proj', [file('a.txt', 'abc'), folder('empty', [])])];
    const byName = new Map(entries.map(entry => [entry.name, entry]));
    DataTransferItem.prototype.webkitGetAsEntry = function (this: DataTransferItem) {
      return (byName.get(this.getAsFile()?.name ?? '') ?? null) as unknown as FileSystemEntry;
    };
    return data;
  });
  const content = page.getByRole('dialog', { name: 'File browser · File desk' });
  await content.dispatchEvent('dragenter', { dataTransfer: transfer });
  await expect(page.getByText('Drop 2 items to upload')).toBeVisible();
  await expect(page.getByText(`Into ${home}. Folders are uploaded with everything in them.`)).toBeVisible();
  await content.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.getByText('Drop 2 items to upload')).toHaveCount(0);
  const uploads = panel.getByRole('region', { name: 'Uploads' });
  await expect(uploads.getByRole('listitem').filter({ hasText: 'proj/a.txt' })).toContainText('Uploaded');
  await expect(uploads.getByRole('listitem').filter({ hasText: 'top.txt' })).toContainText('Uploaded');
  expect(requests.folders).toEqual(
    expect.arrayContaining([
      { path: home, name: 'proj' },
      { path: `${home}/proj`, name: 'empty' },
    ]),
  );
  const placed = requests.uploads.map(upload => [
    upload.url.searchParams.get('path'),
    upload.url.searchParams.get('name'),
    upload.body,
  ]);
  expect(placed).toEqual(
    expect.arrayContaining([
      [home, 'top.txt', 'hello'],
      [`${home}/proj`, 'a.txt', 'abc'],
    ]),
  );
});

test('uploading works on a phone: the picker, and readable progress inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await slowUploads(page, 30, 300);
  const { panel } = await open(page);
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Upload', exact: true }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'a-rather-long-file-name-from-a-phone-camera-roll.jpg', mimeType: 'image/jpeg', buffer: bytes(3_000_000) },
  ]);
  const uploads = panel.getByRole('region', { name: 'Uploads' });
  await expect(uploads).toContainText(/[\d.]+ (B|KB|MB)\/s/);
  const box = await uploads.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(await uploads.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.screenshot({ path: '../.scratch/file-browser-upload-320.png' });
});
