import { expect, it } from 'vitest';
import { validateRecording } from './recording';

const id = '12345678-1234-1234-1234-123456789abc';
const desktop = {
  id,
  folder: 'Videos/agent-recordings/x',
  source: 'desktop',
  label: 'desktop',
  mode: 'events',
  fps: 30,
};

it('accepts bounded recording requests and refuses anything else before the guest sees it', () => {
  expect(
    validateRecording('start', { ...desktop, rules: { 'mouse.move_to': { before: 2.5, after: 2.5 }, mark: {} } }),
  ).toBeTruthy();
  expect(
    validateRecording('start', { ...desktop, source: 'terminal', session: id, label: 'terminal-build', fps: 15 }),
  ).toBeTruthy();
  for (const bad of [
    { ...desktop, fps: 61 },
    { ...desktop, source: 'terminal', session: id, fps: 31 },
    { ...desktop, folder: '../etc' },
    { ...desktop, folder: '/etc/cron.d' },
    { ...desktop, label: 'a b' },
    { ...desktop, rules: { 'bash.run': {} } },
    { ...desktop, rules: { mark: { before: 31 } } },
    { ...desktop, session: id },
    { ...desktop, extra: 1 },
  ])
    expect(() => validateRecording('start', bad)).toThrow();
  expect(validateRecording('start', { ...desktop, keepStart: true, keepEnd: false })).toBeTruthy();
  expect(() => validateRecording('start', { ...desktop, keepEnd: 'yes' })).toThrow('keepEnd is true or false.');
  expect(validateRecording('mark', { ids: [id], label: 'build failed', before: 10, after: 5 })).toBeTruthy();
  expect(() => validateRecording('mark', { ids: [id], before: 31 })).toThrow('before must be within 0..30');
  expect(validateRecording('update', { id, keepEnd: true })).toBeTruthy();
  expect(validateRecording('mark', { ids: [id], label: 'build failed' })).toBeTruthy();
  expect(() => validateRecording('mark', { ids: ['x'] })).toThrow();
  expect(validateRecording('stop', { id, reason: 'lease ended', notes: [{ at: 1, text: 'renewed' }] })).toBeTruthy();
  expect(() => validateRecording('stop', { id, notes: [{ at: 1, text: 'x', more: 1 }] })).toThrow();
  expect(() => validateRecording('delete', {})).toThrow('Unknown recording operation.');
});
