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
for (const needle of [oldGuard, oldAudio]) {
  if (original.split(needle).length !== 2) throw new Error('Pinned Selkies patch anchor changed; review upstream.');
}
const patched = original.replace(oldGuard, jpegGuard).replace(oldAudio, httpAudio);
if (sha256(patched) !== '633f8909c4ef14c2a3c178292f4b6d47dbacbf71ccd55060ace4db623b000c52') {
  throw new Error('Unexpected trusted client derivative; refuse to serve it.');
}
writeFileSync(path, patched);
console.log('Pinned Selkies client patched for JPEG-only insecure origins; secure WebCodecs path retained.');
