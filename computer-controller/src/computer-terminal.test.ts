import { expect, it, vi } from 'vitest';
import { ComputerCoreService, validateCore } from './computer-core-service';
import { terminalResult } from './computer-terminal';
const id = '12345678-1234-1234-1234-123456789abc';
const session = { id, name: 'build', alive: true, exitCode: null, createdAt: 1, columns: 120, rows: 36 };
it.each([
  { operation: 'create', name: 'build', command: 'printf hello', cwd: '~/src' },
  { operation: 'list' },
  ...['view', 'status', 'interrupt', 'delete'].map(operation => ({ operation, session: id })),
  { operation: 'type', session: id, text: 'hello\n世界; kill-server' },
  { operation: 'press', session: id, key: 'C-c' },
  { operation: 'view', session: id, rows: 200, up: 10000 },
  { operation: 'rename', session: id, name: 'server-2' },
  { operation: 'resize', session: id, columns: 80, rows: 24 },
])('accepts bounded terminal request %#', input =>
  expect(validateCore({ kind: 'terminal', ...input })).toMatchObject(input),
);
it.each([
  { operation: 'create', name: 'bad name' },
  { operation: 'create', name: 'ok', cwd: '\0' },
  { operation: 'create', name: 'ok', command: ' ' },
  { operation: 'list', host: 'somewhere' },
  { operation: 'delete', session: '%1' },
  { operation: 'type', session: id, text: '\x1b' },
  { operation: 'type', session: id, text: '😀'.repeat(9000) },
  { operation: 'press', session: id, key: 'run-shell' },
  { operation: 'constructor' },
  { operation: 'list', validationToken: id },
  ...[{ rows: 0 }, { rows: 201 }, { up: -1 }, { up: 10001 }, { rows: 1.5 }, { up: '3' }].map(extra => ({
    operation: 'view',
    session: id,
    ...extra,
  })),
  { operation: 'status', session: id, up: 1 },
  { operation: 'rename', session: id, name: 'bad name' },
  { operation: 'resize', session: id, columns: 241, rows: 24 },
  { operation: 'resize', session: id, columns: 80 },
])('rejects malformed/cross-scope terminal request %#', input =>
  expect(() => validateCore({ kind: 'terminal', ...input })).toThrow(),
);
it('whitelists bounded terminal replies, not guest-controlled extras', () => {
  expect(
    terminalResult(
      {
        type: 'terminal',
        session: { ...session, secret: 'never' },
        text: '<script>untrusted</script>',
        truncated: false,
        note: 'bounded',
        host: 'no',
      },
      'view',
    ),
  ).toEqual({ type: 'terminal', session, text: '<script>untrusted</script>', truncated: false, note: 'bounded' });
  for (const result of [
    { type: 'terminal', sessions: Array(33).fill(session) },
    { type: 'terminal', sessions: [{ ...session, id: '%2' }] },
  ])
    expect(() => terminalResult(result, 'list')).toThrow();
  expect(() =>
    terminalResult({ type: 'terminal', session, text: '😀'.repeat(15000), truncated: true, note: 'bounded' }, 'view'),
  ).toThrow();
  expect(() =>
    terminalResult({ type: 'terminal', session }, 'status', '87654321-1234-1234-1234-123456789abc'),
  ).toThrow();
  expect(
    terminalResult({ type: 'terminal', session: { ...session, alive: false, exitSignal: 'TERM' } }, 'status', id)
      .session,
  ).toMatchObject({ exitSignal: 'TERM' });
});
it('passes only a validated scroll window through a view reply', () => {
  const window = { from: 65, to: 100, total: 136, up: 36 };
  expect(
    terminalResult(
      { type: 'terminal', session, text: 'rows', truncated: true, window: { ...window, x: 1 }, note: 'n' },
      'view',
    ),
  ).toMatchObject({ window });
  expect(() =>
    terminalResult(
      { type: 'terminal', session, text: '', truncated: true, window: { ...window, up: -1 }, note: 'n' },
      'view',
    ),
  ).toThrow();
});
it('terminal requests reuse one-use core authorization and cancellation fencing', async () => {
  const exec = vi.fn(async (_id, mode) =>
    Buffer.from(
      JSON.stringify(
        mode === 'prepare'
          ? { validationToken: id }
          : mode === 'cancel'
            ? { settled: true }
            : { started: true, settled: true, result: { type: 'terminal', session } },
      ),
    ),
  );
  const service = new ComputerCoreService(exec);
  const input = { kind: 'terminal', operation: 'create', name: 'build' };
  const prepared = await service.prepare('computer', input);
  expect((await service.execute('computer', { ...input, ...prepared })).result).toEqual({ type: 'terminal', session });
  await expect(service.execute('computer', { ...input, ...prepared })).rejects.toThrow(/expired/);
  const old = await service.prepare('computer', input);
  await service.cancel('computer');
  await expect(service.execute('computer', { ...input, ...old })).rejects.toThrow(/expired/);
});
