import { expect, it, vi } from 'vitest';
import type { DockerApi } from './docker-api';
import { LxcfsBinder, lxcfsEnabled, lxcfsOutcome } from './lxcfs';

/** A Docker double: one lxcfs service (or none), running desktops with main PIDs, scripted helper exit codes. */
function fixture(options: { enabled?: boolean; daemon?: boolean } = {}) {
  const state = { daemon: options.daemon ?? true, startedAt: '2026-10-05T10:00:00Z', exits: [] as number[] };
  const desktops = new Map<string, number>([
    ['desktop-a', 4100],
    ['desktop-b', 4200],
  ]);
  const execResult = vi.fn(async (_container: string, _command: string[]) => ({
    exitCode: state.exits.shift() ?? 0,
    stdout: Buffer.from('ok /proc/meminfo\n'),
    stderr: Buffer.alloc(0),
  }));
  const json = vi.fn(async (_method: string, path: string) => {
    if (!path.startsWith('/containers/json?filters=')) throw new Error(`unexpected ${path}`);
    const filters = JSON.parse(decodeURIComponent(path.slice('/containers/json?filters='.length)));
    expect(filters.label).toEqual(['com.docker.compose.project=swarm-test', 'com.docker.compose.service=lxcfs']);
    return state.daemon ? [{ Id: 'lxcfs-container' }] : [];
  });
  const optional = vi.fn(async (path: string) => {
    if (path === '/containers/lxcfs-container/json')
      return { Id: 'lxcfs-container', State: { Running: state.daemon, StartedAt: state.startedAt } };
    const name = decodeURIComponent(path.split('/')[2]);
    const pid = desktops.get(name);
    return pid ? { Id: name, State: { Running: true, Pid: pid } } : null;
  });
  const docker = { json, optional, execResult } as unknown as DockerApi;
  const log = vi.fn();
  const binder = new LxcfsBinder(docker, 'swarm-test', options.enabled ?? true, log);
  const commands = () => execResult.mock.calls.map(([container, command]) => [container, ...command].join(' '));
  return { binder, state, execResult, log, commands, desktops };
}

it('reads COMPUTER_LXCFS as on unless turned off, and maps the helper exit statuses', () => {
  expect([undefined, '', 'on', '1', 'true'].map(lxcfsEnabled)).toEqual([true, true, true, true, true]);
  expect(['off', 'OFF', '0', 'false', 'no'].map(lxcfsEnabled)).toEqual([false, false, false, false, false]);
  expect([0, 1, 2, 3, 4, 5, null].map(lxcfsOutcome)).toEqual([
    'bound',
    'failed',
    'failed',
    'not-ready',
    'not-bound',
    'failed',
    'failed',
  ]);
});

it('binds a started computer through the lxcfs container, by its main PID', async () => {
  const { binder, commands } = fixture();
  await binder.attach('desktop-a');
  expect(commands()).toEqual(['lxcfs-container lxcfs-remount 4100']);
  expect(binder.isStale('desktop-a')).toBe(false);
});

it('does nothing when COMPUTER_LXCFS is off', async () => {
  const { binder, execResult, state } = fixture({ enabled: false });
  await binder.attach('desktop-a');
  state.startedAt = 'later';
  await binder.refresh(['desktop-a']);
  expect(execResult).not.toHaveBeenCalled();
});

it('starts without LXCFS when it is not running or not ready, and binds once it is', async () => {
  const { binder, state, commands, log } = fixture({ daemon: false });
  await binder.attach('desktop-a');
  expect(commands()).toEqual([]);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('not ready'));
  await binder.refresh(['desktop-a', 'desktop-b']);
  expect(commands()).toEqual([]);
  state.daemon = true;
  state.exits = [3];
  await binder.refresh(['desktop-a', 'desktop-b']);
  // Not ready yet: nothing else is tried until a later call.
  expect(commands()).toEqual(['lxcfs-container lxcfs-remount 4100']);
  state.exits = [0, 4];
  await binder.refresh(['desktop-a', 'desktop-b']);
  // The computer the controller started is bound; one without binds is only refreshed (left alone).
  expect(commands().slice(1)).toEqual([
    'lxcfs-container lxcfs-remount 4100',
    'lxcfs-container lxcfs-remount 4200 refresh',
  ]);
  expect(binder.isStale('desktop-a') || binder.isStale('desktop-b')).toBe(false);
});

it('replaces binds in place once per lxcfs restart and marks a computer it cannot fix', async () => {
  const { binder, state, commands } = fixture();
  await binder.attach('desktop-a');
  await binder.attach('desktop-b');
  await binder.refresh(['desktop-a', 'desktop-b']);
  expect(commands()).toHaveLength(2);
  state.startedAt = '2026-10-05T11:00:00Z';
  state.exits = [0, 1];
  await binder.refresh(['desktop-a', 'desktop-b']);
  expect(commands().slice(2)).toEqual([
    'lxcfs-container lxcfs-remount 4100 refresh',
    'lxcfs-container lxcfs-remount 4200 refresh',
  ]);
  expect(binder.isStale('desktop-a')).toBe(false);
  expect(binder.isStale('desktop-b')).toBe(true);
  // Not retried for the same lxcfs; a restart of the computer binds it again and clears the mark.
  await binder.refresh(['desktop-a', 'desktop-b']);
  expect(commands()).toHaveLength(4);
  await binder.attach('desktop-b');
  expect(binder.isStale('desktop-b')).toBe(false);
});

it('marks a computer stale when its bind at start fails, and forgets computers that stopped', async () => {
  const { binder, state } = fixture();
  state.exits = [1];
  await binder.attach('desktop-a');
  expect(binder.isStale('desktop-a')).toBe(true);
  await binder.refresh(['desktop-b']);
  expect(binder.isStale('desktop-a')).toBe(false);
});

it('never lets a Docker failure stop a computer from starting', async () => {
  const { binder, execResult, log } = fixture();
  execResult.mockRejectedValueOnce(new Error('Docker operation timed out.'));
  await expect(binder.attach('desktop-a')).resolves.toBeUndefined();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('timed out'));
});
