// Renders the app's PNG icons from their SVG sources with headless Chromium (docs/development.md#progressive-web-app).
// Run from frontend/ where @playwright/test is installed: node scripts/render-icons.mjs [outputs…] (default: all)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

// [source, output, size, opaque]
const jobs = [
  ['public/icon.svg', 'public/icon-192.png', 192, false],
  ['public/icon.svg', 'public/icon-512.png', 512, false],
  ['public/icon-maskable.svg', 'public/icon-maskable-192.png', 192, true],
  ['public/icon-maskable.svg', 'public/icon-maskable-512.png', 512, true],
  ['icons/apple-touch-icon.svg', 'public/apple-touch-icon.png', 180, true],
  ['public/favicon.svg', 'public/favicon-32.png', 32, false],
  // Android's status-bar badge for notifications: only its alpha counts (a white pebble with its eyes cut out).
  ['icons/badge.svg', 'public/badge-96.png', 96, false],
];
const only = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [source, output, size, opaque] of jobs.filter(job => !only.length || only.includes(job[1]))) {
  const svg = readFileSync(source, 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:${opaque ? '#151515' : 'transparent'}">${svg}</body></html>`,
  );
  await page.screenshot({ path: output, omitBackground: !opaque, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', output);
}
await browser.close();
