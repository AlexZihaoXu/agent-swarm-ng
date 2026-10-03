import { beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// The guest (root in the computer) controls Selkies's server and its messages, including its clipboard
// policy. The trusted frame must touch the owner's clipboard only for the owner's own paste/copy keys.
const html = readFileSync(new URL('../../public/desktop-frame.html', import.meta.url), 'utf8');
const gate = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(match =>
  match[1].includes('navigator.clipboard'),
)?.[1];

let now = 0;
let focused = true;
let calls: string[] = [];
let keydown: (event: object) => void;
let window: { swarmDesktopInputEnabled: boolean };
let navigator: { clipboard: Record<string, (...args: unknown[]) => Promise<unknown>> };
let document: { execCommand: (command: string) => boolean; hasFocus: () => boolean };

beforeEach(() => {
  now = 0;
  focused = true;
  calls = [];
  const clipboard = Object.fromEntries(
    ['read', 'readText', 'write', 'writeText'].map(name => [
      name,
      async () => {
        calls.push(name);
        return name.startsWith('read') ? 'owner secret' : undefined;
      },
    ]),
  );
  window = {
    swarmDesktopInputEnabled: false,
    addEventListener: (name: string, handler: (event: object) => void) => {
      if (name === 'keydown') keydown = handler;
    },
  } as never;
  navigator = { clipboard } as never;
  document = {
    execCommand: (command: string) => {
      calls.push(`exec:${command}`);
      return true;
    },
    hasFocus: () => focused,
  };
  class DOMException extends Error {
    constructor(message: string, name: string) {
      super(message);
      this.name = name;
    }
  }
  expect(gate).toBeDefined();
  runInNewContext(gate!, {
    window,
    navigator,
    document,
    DOMException,
    Object,
    Promise,
    performance: { now: () => now },
  });
});

const key = (key: string, extra: object = {}) =>
  keydown({ isTrusted: true, key, code: `Key${key.toUpperCase()}`, ctrlKey: true, ...extra });
const rejected = async (promise: Promise<unknown>) =>
  (await promise.then(
    () => '',
    error => error.name,
  )) || 'resolved';

it('never reads or writes the owner clipboard on its own, such as for a guest push or a focus sync', async () => {
  window.swarmDesktopInputEnabled = true;
  expect(await rejected(navigator.clipboard.readText())).toBe('NotAllowedError');
  expect(await rejected(navigator.clipboard.read())).toBe('NotAllowedError');
  // Not NotAllowedError: Selkies would retry that write on the owner's next key or click.
  expect(await rejected(navigator.clipboard.writeText('rm -rf ~'))).toBe('AbortError');
  expect(await rejected(navigator.clipboard.write([]))).toBe('AbortError');
  expect(document.execCommand('copy')).toBe(false);
  expect(document.execCommand('paste')).toBe(false);
  expect(calls).toEqual([]);
});

it('reads only briefly after the owner presses paste in an unlocked, focused viewer', async () => {
  key('v');
  expect(await rejected(navigator.clipboard.readText())).toBe('NotAllowedError'); // input locked
  window.swarmDesktopInputEnabled = true;
  key('v', { isTrusted: false });
  key('v', { altKey: true });
  key('v', { ctrlKey: false });
  focused = false;
  key('v');
  focused = true;
  expect(await rejected(navigator.clipboard.readText())).toBe('NotAllowedError');
  key('v', { ctrlKey: false, metaKey: true });
  expect(await navigator.clipboard.readText()).toBe('owner secret');
  expect(await rejected(navigator.clipboard.writeText('x'))).toBe('AbortError'); // paste never allows a write
  now += 2000;
  expect(await rejected(navigator.clipboard.readText())).toBe('NotAllowedError');
  expect(calls).toEqual(['readText']);
});

it('writes once, shortly after the owner presses copy or cut', async () => {
  window.swarmDesktopInputEnabled = true;
  key('c');
  expect(await rejected(navigator.clipboard.readText())).toBe('NotAllowedError'); // copy never allows a read
  await navigator.clipboard.writeText('copied in the computer');
  expect(await rejected(navigator.clipboard.writeText('a later guest push'))).toBe('AbortError');
  key('x');
  now += 5000;
  expect(await rejected(navigator.clipboard.write([]))).toBe('AbortError');
  key('x', { key: 'X', code: 'KeyX', ctrlKey: false, metaKey: true });
  expect(document.execCommand('copy')).toBe(true);
  expect(calls).toEqual(['writeText', 'exec:copy']);
});

it('cannot be bypassed by replacing the guarded clipboard', () => {
  expect(() => {
    'use strict';
    (navigator as { clipboard: unknown }).clipboard = {};
  }).toThrow();
});
