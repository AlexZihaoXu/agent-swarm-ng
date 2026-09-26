#!/usr/bin/env node
// A narrowly reviewed Selkies 2.0.0 client derivative. The guest cannot edit
// these frontend-served bytes. A remote HTTP origin cannot use WebCodecs, but
// JPEG can decode through createImageBitmap without disabling browser security.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('Trusted Selkies client asset directory is required.');
const path = join(directory, 'assets/selkies-core-BbKps5RD.js');
const original = readFileSync(path, 'utf8');
const sha256 = text => createHash('sha256').update(text).digest('hex');
if (sha256(original) !== '3a2199dfa2535eb0ad077e6413df11ef57b944e802209788d140c2194e2e1519') {
  throw new Error('Pinned Selkies client changed; review upstream before updating the HTTP patch.');
}
const oldGuard = 'function Io(){return ga(),window.isSecureContext?(window.VideoDecoder===void 0?(console.warn(`VideoDecoder API unavailable: the stream is pinned to the jpeg encoder.`),Lo()):console.log(`Pre-flight checks passed: Secure context and VideoDecoder API are available.`),!0):(console.error(`FATAL: Not in a secure context. WebCodecs require HTTPS.`),q&&(q.textContent=`Error: This application requires a secure connection (HTTPS). Please check the URL.`,q.classList.remove(`hidden`)),kr&&kr.classList.add(`hidden`),!1)}';
const jpegGuard = 'function Io(){ga();if(!window.isSecureContext){if(typeof createImageBitmap!==`function`){console.error(`JPEG decode unavailable on HTTP.`);return !1}console.warn(`HTTP origin: using JPEG fallback without WebCodecs.`);Lo();return !0}return window.VideoDecoder===void 0?(console.warn(`VideoDecoder API unavailable: the stream is pinned to the jpeg encoder.`),Lo()):console.log(`Pre-flight checks passed: Secure context and VideoDecoder API are available.`),!0}';
const oldAudio = 'async function De(){if(N!==`primary`)';
const httpAudio = 'async function De(){if(!window.isSecureContext)return;if(N!==`primary`)';
// A secure origin may also upgrade *off* a JPEG-default server. This is the
// WebSocket transport's own server-settings callback, placed after upstream
// applies the published encoder and stores the hardware backend table. The
// ladder `ea()` prices every codec against that table, so with no table yet
// (a viewer connecting before the startup GPU probe reported) it declines to
// switch; skipping without consuming the one-shot flag lets a later settings
// payload try again. `sa()` reads the encoder back out of localStorage, so the
// switch sequence mirrors upstream's own decoder-failure path and `aa()` then
// transmits it.
// A secure origin may also upgrade *off* a JPEG-default server. This is the
// WebSocket transport's own server-settings callback, placed after upstream
// applies the published encoder and stores the hardware backend table (`Yi`):
// the ladder `ea()` prices every codec against that table, so without it there
// it declines to switch. `ea()` returns the best encoder this host encodes in
// hardware that this browser decodes, jpeg only as a last resort. The switch
// sequence mirrors upstream's own decoder-failure path, and `sa()` reads the
// encoder back out of localStorage, so `aa()` transmits it. One ask per page
// load keeps a deliberate later choice in the viewer sidebar authoritative.
const oldUpgrade = 'typeof window.encoder==`string`&&ia(window.encoder,e.settings.encoder)';
const secureUpgrade = 'typeof window.encoder==`string`&&ia(window.encoder,e.settings.encoder),(()=>{try{let n=e.settings&&e.settings.encoder;if(!n||typeof n.value!=`string`||n.locked===!0)return;if(!window.isSecureContext||typeof VideoDecoder==`u`)return;if(String(n.value)!==`jpeg`||window.__swarmEncoderUpgradeAsked||!Yi)return;let r=ea();if(!r||r===`jpeg`){window.__swarmEncoderUpgradeAsked=!0;return}window.__swarmEncoderUpgradeAsked=!0,Wi=r,V=r,Ir(`encoder`,r),si=!1,ri=null,ii=0,ai=0,oi=null,wi(),console.warn(`[Selkies] secure origin: switching from jpeg to ${r}.`),aa(`secure origin prefers ${r}`)}catch(n){console.warn(`[Selkies] secure encoder upgrade failed:`,n)}})()';
for (const needle of [oldGuard, oldAudio, oldUpgrade]) {
  if (original.split(needle).length !== 2) throw new Error('Pinned Selkies patch anchor changed; review upstream.');
}
const patched = original.replace(oldGuard, jpegGuard).replace(oldAudio, httpAudio).replace(oldUpgrade, secureUpgrade);
if (sha256(patched) !== 'ef414260687a434d609955e6ef18d9fccdd9500ca6169e827ee3f7b74f25c6d8') {
  throw new Error('Unexpected trusted client derivative; refuse to serve it.');
}
writeFileSync(path, patched);
// Consumers (prepare-selkies-client.sh and the disposable gates) read this one
// pin instead of restating the literal, so a reviewed patch update is a
// single-file change.
console.log(`Pinned Selkies client patched for JPEG-only insecure origins; secure WebCodecs path retained. derivative=${sha256(patched)}`);
