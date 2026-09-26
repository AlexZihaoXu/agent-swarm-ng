// Isolated WebCodecs smoke for the H.265-default X11 image. localhost is a
// secure context without modifying browser security flags or opening a host
// listener beyond the dev stack's loopback port. Never aim at production.
import { chromium } from '../frontend/node_modules/@playwright/test/index.mjs';

const id = process.env.TEST_COMPUTER_ID;
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id ?? '')) throw Error('Bound disposable computer UUID required');
const base = 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message.slice(0, 160)));
  const roster = await (await page.request.get(`${base}/api/computers`)).json();
  if (roster.computers.length !== 1 || roster.computers[0].id !== id) throw Error('Bound disposable computer changed');
  await page.goto(`${base}/computers/${id}`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe[title$=" desktop"]');
  await frame.locator('#videoCanvas').waitFor({ state: 'attached', timeout: 60000 });
  let state;
  for (let i = 0; i < 45; i++) {
    state = await frame.locator('body').evaluate(() => ({
      secure: isSecureContext, decoder: typeof VideoDecoder,
      attached: !!window.webrtcInput?.inputAttached,
      videoWidth: document.querySelector('#videoStream')?.videoWidth ?? 0,
      videoHeight: document.querySelector('#videoStream')?.videoHeight ?? 0,
    }));
    if (state.attached && state.videoWidth === 1920 && state.videoHeight === 1080) break;
    await page.waitForTimeout(500);
  }
  console.log('SECURE_CODEC', JSON.stringify({ ...state, errors }));
  if (!state.secure || state.decoder === 'undefined') throw Error('localhost did not expose WebCodecs');
  if (!state.attached || state.videoWidth !== 1920 || state.videoHeight !== 1080) throw Error('WebCodecs desktop did not decode the fixed 1920x1080 guest');
  // The server's final Stream settings active log is authoritative for codec;
  // the client stats history is empty unless its inspector is explicitly open.
  if (errors.length) throw Error(`Browser errors: ${JSON.stringify(errors)}`);
} finally { await browser.close(); }
