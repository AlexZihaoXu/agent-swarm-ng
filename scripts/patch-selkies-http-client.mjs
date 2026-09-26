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
// Both origins negotiate their own encoder against one server default. This is
// the WebSocket transport's own server-settings callback, placed after upstream
// applies the published encoder and stores the hardware backend table (`Yi`).
//
//  * Insecure origin (HTTP 19090): browsers have no WebCodecs, so request the
//    JPEG stripes encoder whenever the server defaults to something else.
//  * Secure origin (HTTPS 19091): request the operator's AV1 default whenever
//    the server is on something else, falling back to upstream's own ladder
//    `ea()` (hardware-first, priced against `Yi`) when AV1 is not on the menu.
//    A browser that cannot decode the chosen codec still trips upstream's own
//    decoder-failure downgrade, so an explicit AV1 ask is safe.
//
// The switch sequence mirrors upstream's own decoder-failure path, and `sa()`
// reads the encoder back out of localStorage, so `aa()` transmits it. One ask
// per page load keeps a deliberate later sidebar choice authoritative; a
// missing hardware table defers rather than consuming the one-shot flag.
const oldUpgrade = 'typeof window.encoder==`string`&&ia(window.encoder,e.settings.encoder)';
const secureUpgrade = 'typeof window.encoder==`string`&&ia(window.encoder,e.settings.encoder),(()=>{try{let n=e.settings&&e.settings.encoder;if(!n||typeof n.value!=`string`||n.locked===!0||window.__swarmEncoderAsked)return;let secure=window.isSecureContext&&typeof VideoDecoder!=`u`,have=String(n.value),allowed=Array.isArray(n.allowed)?n.allowed:[],explicit=secure&&allowed.includes(`av1enc`)?`av1enc`:null;if(secure&&!explicit&&!Yi)return;let want=secure?(explicit||ea()||`jpeg`):`jpeg`;if(have===want||!allowed.includes(want))return;window.__swarmEncoderAsked=!0,Wi=want,V=want,Ir(`encoder`,want),si=!1,ri=null,ii=0,ai=0,oi=null,wi(),console.warn(`[Selkies] ${secure?`secure`:`insecure`} origin: switching from ${have} to ${want}.`),aa(`${secure?`secure`:`insecure`} origin prefers ${want}`)}catch(n){console.warn(`[Selkies] encoder preference was not sent:`,n)}})()';
for (const needle of [oldGuard, oldAudio, oldUpgrade]) {
  if (original.split(needle).length !== 2) throw new Error('Pinned Selkies patch anchor changed; review upstream.');
}
const patched = original.replace(oldGuard, jpegGuard).replace(oldAudio, httpAudio).replace(oldUpgrade, secureUpgrade);
if (sha256(patched) !== '5a6d4716d048938637df9e6454fedada071546b02a74d3a74451e36e24ed54c4') {
  throw new Error('Unexpected trusted client derivative; refuse to serve it.');
}
writeFileSync(path, patched);
// Consumers (prepare-selkies-client.sh and the disposable gates) read this one
// pin instead of restating the literal, so a reviewed patch update is a
// single-file change.
console.log(`Pinned Selkies client patched for JPEG-only insecure origins; secure WebCodecs path retained. derivative=${sha256(patched)}`);
