import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Opt-in destructive E2E: run only against a uniquely named isolated dev Compose
// project. The default browser suite does not include *.live.ts.
test.skip(process.env.COMPUTER_E2E_ALLOW !== '1', 'Requires an isolated computer-enabled dev stack.');
test.setTimeout(240_000);

test('creates, previews, persists and permanently deletes a real computer through the dashboard', async ({
  page,
  request,
}) => {
  const name = `E2E desktop ${Date.now()}`;
  let id: string | undefined;
  let completed = false;
  try {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Computers' }).click();
    await expect(page.getByRole('heading', { name: 'Computers' })).toBeVisible();
    await page.getByRole('button', { name: 'Create computer' }).click();
    const create = page.getByRole('dialog', { name: 'Create computer' });
    await create.getByLabel('Computer name').fill(name);
    await create.getByRole('button', { name: 'Create computer' }).click();
    const card = page.getByRole('article', { name });
    await expect(card).toBeVisible({ timeout: 110_000 });
    await expect
      .poll(async () => {
        const response = await request.get('/api/computers');
        const data = await response.json();
        id = data.computers.find((item: { name: string }) => item.name === name)?.id;
        return Boolean(id);
      })
      .toBe(true);
    // The card crossfades between at most two preview layers; any of them must
    // eventually carry a decoded desktop frame.
    await expect
      .poll(
        () =>
          card
            .getByTestId('computer-preview-layer')
            .last()
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        { timeout: 35_000 },
      )
      .toBeGreaterThan(0);
    await expect(card).toContainText('CPU');
    await expect(card).toContainText('Memory');
    await page.screenshot({ path: '../.scratch/computers-live-desktop.png', animations: 'disabled' });
    page.on('response', response => {
      if (
        response.url().includes(`/computers/${id}/desktop/`) ||
        response.url().includes(`/api/computers/${id}/preview?full=1`)
      ) {
        console.log('Computer viewer response:', response.status(), new URL(response.url()).pathname);
      }
    });
    page.on('websocket', socket => {
      if (!socket.url().includes(`/computers/${id}/desktop/`)) return;
      console.log('Computer iframe WebSocket path:', new URL(socket.url()).pathname);
      socket.on('socketerror', error => console.log('Computer iframe WebSocket error:', error.slice(0, 240)));
      socket.on('close', () => console.log('Computer iframe WebSocket closed'));
    });
    page.on('pageerror', error => console.log('Computer iframe JS error:', error.message.slice(0, 300)));
    page.on('console', message => {
      if (message.type() === 'error') console.log('Computer iframe console error:', message.text().slice(0, 300));
    });
    await card.getByRole('button', { name: `Open ${name} desktop` }).click();
    const viewer = page.getByTestId('computer-viewer');
    await expect(viewer).toBeVisible();
    const frame = page.frameLocator(`iframe[title="${name} desktop"]`);
    await expect
      .poll(() => frame.locator('body').evaluate(body => body.innerHTML.length), { timeout: 20_000 })
      .toBeGreaterThan(20);
    console.log(
      'Computer iframe body:',
      (await frame.locator('body').evaluate(body => (body as HTMLElement).innerText)).slice(0, 220),
    );
    const fullCheck = await request.get(`/api/computers/${id}/preview?full=1&at=${Date.now()}`);
    console.log('Full preview response:', fullCheck.status(), fullCheck.headers()['content-type']);
    // The sudo computer cannot change this root document or executable JS;
    // the API harness above changes its own JS file and checks Caddy still
    // serves the immutable build-time asset before this iframe is trusted.
    expect(
      await page.evaluate(() => {
        const childDocument = document.querySelector('iframe')?.contentDocument;
        return Boolean(childDocument?.querySelector('script[src^="./assets/index-CPWh3fQ6.js?swarm-revision="]'));
      }),
    ).toBe(true);
    await viewer.getByRole('button', { name: /human desktop input/ }).click();
    const preview = page.getByTestId('computer-consent-preview');
    await expect
      .poll(() => preview.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 35_000 })
      .toBe(1920);
    const beforeGrant = await request.get(`/api/computers/${id}/preview?full=1&at=${Date.now()}`);
    if (beforeGrant.ok()) await writeFile('../.scratch/computers-portal-before-click.jpg', await beforeGrant.body());
    // The portal first displays a separate, white Remote Desktop dialog.
    // Do not click fixed coordinates on an unrelated desktop notification.
    await expect
      .poll(
        () =>
          preview.locator('img').evaluate((image: HTMLImageElement) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            if (!context || image.naturalWidth !== 1920) return false;
            context.drawImage(image, -700, -350);
            const pixel = context.getImageData(0, 0, 1, 1).data;
            return pixel[0] > 190 && pixel[1] > 190 && pixel[2] > 190;
          }),
        { timeout: 35_000 },
      )
      .toBe(true);
    const box = await preview.boundingBox();
    expect(box).toBeTruthy();
    await preview.click({ position: { x: box!.width * (1244 / 1920), y: box!.height * (464 / 1080) } });
    await preview.click({ position: { x: box!.width * (1280 / 1920), y: box!.height * (329 / 1080) } });
    const afterGrant = await request.get(`/api/computers/${id}/preview?full=1&at=${Date.now()}`);
    if (afterGrant.ok()) await writeFile('../.scratch/computers-portal-after-click.jpg', await afterGrant.body());
    await viewer.getByRole('button', { name: 'Show live desktop' }).click();
    const video = frame.locator('video');
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth), { timeout: 40_000 })
      .toBe(1920);
    await page.screenshot({ path: '../.scratch/computers-live-viewer-desktop.png', animations: 'disabled' });
    // Selkies pointer input must act on GNOME, not merely accept WebSocket 101.
    // The Files icon is at 35×68 on the 1920×1080 fixed virtual monitor.
    const videoBox = await video.boundingBox();
    expect(videoBox).toBeTruthy();
    // Selkies deliberately overlays the video with a hidden input for keys;
    // send a real pointer event at the rendered position, not locator.click.
    await page.mouse.click(videoBox!.x + videoBox!.width * (35 / 1920), videoBox!.y + videoBox!.height * (68 / 1080));
    await expect
      .poll(
        () =>
          video.evaluate((element: HTMLVideoElement) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            if (!context) return false;
            context.drawImage(element, -320, -420);
            const pixel = context.getImageData(0, 0, 1, 1).data;
            return pixel[0] > 180 && pixel[1] > 180 && pixel[2] > 180;
          }),
        { timeout: 12_000 },
      )
      .toBe(true);
    await page.screenshot({ path: '../.scratch/computers-live-after-files-click.png', animations: 'disabled' });
    await page.keyboard.press('Meta');
    await expect
      .poll(
        () =>
          video.evaluate((element: HTMLVideoElement) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            if (!context) return false;
            context.drawImage(element, -960, -75);
            const pixel = context.getImageData(0, 0, 1, 1).data;
            return pixel[0] < 130 && pixel[1] > 45 && pixel[2] > 45;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    await page.screenshot({ path: '../.scratch/computers-live-after-meta-key.png', animations: 'disabled' });
    if (process.env.COMPUTER_E2E_PERF === '1') {
      const timings: number[] = [];
      const cpu: number[] = [];
      for (let sample = 0; sample < 20; sample++) {
        const overview = sample % 2 === 1; // First Meta closes Overview.
        await video.evaluate((element: HTMLVideoElement, visible: boolean) => {
          const perfWindow = window as Window & { __computerPerf?: { elapsed?: number } };
          const state: { elapsed?: number } = {};
          perfWindow.__computerPerf = state;
          const started = performance.now();
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d');
          const tick = () => {
            if (state.elapsed !== undefined || !context) return;
            context.drawImage(element, -960, -75);
            const pixel = context.getImageData(0, 0, 1, 1).data;
            const observed = pixel[0] < 130 && pixel[1] > 45 && pixel[2] > 45;
            if (observed === visible) {
              state.elapsed = performance.now() - started;
              return;
            }
            element.requestVideoFrameCallback(tick);
          };
          element.requestVideoFrameCallback(tick);
        }, overview);
        await page.keyboard.press('Meta');
        await expect
          .poll(
            () =>
              frame
                .locator('video')
                .evaluate(
                  () => (window as Window & { __computerPerf?: { elapsed?: number } }).__computerPerf?.elapsed ?? -1,
                ),
            { timeout: 7000, intervals: [50, 100, 200] },
          )
          .toBeGreaterThanOrEqual(0);
        // Read the renderer's monotonic timestamp, not the polling interval.
        const duration = await video.evaluate(
          () => (window as Window & { __computerPerf?: { elapsed?: number } }).__computerPerf?.elapsed ?? -1,
        );
        timings.push(duration);
        await page.waitForTimeout(160); // Let GNOME's Overview transition settle before reversing it.
        const response = await request.get('/api/computers');
        if (response.ok()) {
          const observed = (await response.json()).computers.find((item: { id: string }) => item.id === id)?.cpuPercent;
          if (typeof observed === 'number') cpu.push(observed);
        }
      }
      const percentile = (values: number[], fraction: number) =>
        [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
      const encoder = process.env.COMPUTER_E2E_ENCODER === 'vaapi' ? 'vaapi' : 'software';
      const result = {
        encoder,
        source:
          'Chromium input command to first matching decoded WebCodecs frame; includes Playwright/CDP overhead; no optical glass-to-glass',
        samples: timings.length,
        inputMs: { p50: percentile(timings, 0.5), p95: percentile(timings, 0.95), values: timings },
        cpuPercent: cpu.length ? { p50: percentile(cpu, 0.5), p95: percentile(cpu, 0.95), values: cpu } : null,
      };
      console.log('Computer input-to-video latency:', JSON.stringify(result));
      await writeFile(`../.scratch/computers-perf-${encoder}.json`, JSON.stringify(result, null, 2));
    }
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(page.getByRole('button', { name: 'Back to computers' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '../.scratch/computers-live-viewer-phone.png', animations: 'disabled' });
    await expect(page.getByRole('button', { name: 'Pan desktop left' })).toBeDisabled();
    await page.getByRole('button', { name: 'Pan desktop right' }).click();
    await expect(page.getByRole('button', { name: 'Pan desktop left' })).toBeEnabled();
    await page.screenshot({ path: '../.scratch/computers-live-viewer-phone-panned.png', animations: 'disabled' });
    await page.getByRole('button', { name: 'Back to computers' }).click();
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '../.scratch/computers-live-phone.png', animations: 'disabled' });
    await card.getByRole('button', { name: `Open ${name} desktop` }).click();
    await expect(viewer.getByRole('button', { name: 'Grant screen access' })).toBeVisible();
    await expect
      .poll(() => frame.locator('video').evaluate((element: HTMLVideoElement) => element.videoWidth), {
        timeout: 40_000,
      })
      .toBe(1920);
    await page.getByRole('button', { name: 'Back to computers' }).click();
    await expect(card).toBeVisible();
    // Delete now lives in the shared context menu behind the card's trigger.
    await card.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Remove' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete computer' });
    const confirm = dialog.getByLabel('Confirm computer name');
    await confirm.fill(name.toLowerCase());
    await expect(dialog.getByRole('button', { name: 'Delete computer' })).toBeDisabled();
    await confirm.fill(name);
    await dialog.getByRole('button', { name: 'Delete computer' }).click();
    await expect(card).toHaveCount(0, { timeout: 60_000 });
    // The browser cache and API poll can cross the in-flight Docker teardown;
    // wait for the database's committed deletion rather than one immediate read.
    await expect
      .poll(
        async () => {
          const after = await (await request.get('/api/computers')).json();
          return after.computers.some((item: { id: string }) => item.id === id);
        },
        { timeout: 60_000 },
      )
      .toBe(false);
    completed = true;
  } finally {
    // A failed, uniquely labelled test computer is left briefly for the
    // harness to collect bounded diagnostics before its scoped cleanup.
    if (completed) {
      const response = await request.get('/api/computers').catch(() => null);
      if (response?.ok()) {
        const data = await response.json();
        for (const row of data.computers as { id: string; name: string }[]) {
          if (row.name === name)
            await request
              .delete(`/api/computers/${encodeURIComponent(row.id)}`, { data: { confirmation: name } })
              .catch(() => {});
        }
      }
    }
  }
});
