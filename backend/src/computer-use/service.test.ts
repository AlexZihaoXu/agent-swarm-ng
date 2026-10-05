import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { ComputerUseService, type ComputerRuntime } from './service';
const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
async function fixture() {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  closes.push(() => db.close());
  const a = await db.createAgent({ name: 'A', endpointId: 'local', model: 'model', thinkingLevel: 'off' });
  const b = await db.createAgent({ name: 'B', endpointId: 'local', model: 'model', thinkingLevel: 'off' });
  const computer = await db.client.computer.create({
    data: { name: 'Desk', requestKey: crypto.randomUUID(), state: 'running' },
  });
  let now = 0,
    executes = 0,
    cancels = 0,
    invalid = false;
  const runtime: ComputerRuntime = {
    capture: async () => ({
      mimeType: 'image/jpeg',
      data: Buffer.from([255, 216, 255, 217]),
      width: 640,
      height: 360,
      bounds: [0, 0, 999, 999],
    }),
    execute: async () => {
      executes++;
      return { started: !invalid, completed: invalid ? 0 : 1, error: invalid ? 'Invalid combo' : null };
    },
    cancel: async () => {
      cancels++;
    },
  };
  const service = new ComputerUseService(db, runtime, () => now);
  await service.ready();
  await service.assign(a.id, [computer.id]);
  await service.assign(b.id, [computer.id]);
  return {
    db,
    a,
    b,
    computer,
    service,
    runtime,
    time: (n: number) => {
      now = n;
    },
    invalid: (v: boolean) => {
      invalid = v;
    },
    counts: () => ({ executes, cancels }),
  };
}
it('requires a current claim for every core tool, never assignment alone, and uses the claim target', async () => {
  const f = await fixture();
  const calls: string[] = [];
  f.runtime.prepareCore = async (id, request) => {
    calls.push(id);
    return request;
  };
  f.runtime.core = async () => ({ started: true, settled: true, result: { type: 'text', text: 'guest' } });
  for (const kind of ['read', 'edit', 'write', 'bash'])
    await expect(f.service.core(f.a.id, { kind })).rejects.toThrow(/use_computer/);
  expect(calls).toEqual([]);
  await f.service.use(f.a.id, 'Desk', true);
  for (const kind of ['read', 'edit', 'write', 'bash']) await f.service.core(f.a.id, { kind });
  expect(calls).toEqual(Array(4).fill(f.computer.id));
  await expect(f.service.core(f.b.id, { kind: 'read' })).rejects.toThrow(/use_computer/);
  await f.service.assign(f.a.id, []);
  await expect(f.service.core(f.a.id, { kind: 'read' })).rejects.toThrow(/use_computer/);
});
it('core tools never grant GUI allowance; mutating core work invalidates it', async () => {
  const f = await fixture();
  await f.service.use(f.a.id, 'Desk', true);
  f.runtime.prepareCore = async (_id, request) => request;
  f.runtime.core = async () => ({ started: true, settled: true, result: { type: 'text', text: 'ok' } });
  await f.service.core(f.a.id, { kind: 'read' });
  await expect(f.service.run(f.a.id, {})).rejects.toThrow(/look/i);
  await f.service.capture(f.a.id, {});
  await f.service.core(f.a.id, { kind: 'bash' });
  await expect(f.service.run(f.a.id, {})).rejects.toThrow(/look/i);
});
it('joins active core work before transfer, and unknown cancellation retains the claim', async () => {
  const f = await fixture();
  await f.service.use(f.a.id, 'Desk', true);
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => {
    enter = resolve;
  });
  f.runtime.prepareCore = async (_id, request) => request;
  f.runtime.core = async (_id, _request, signal) => {
    enter();
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    expect(signal?.aborted).toBe(true);
    return { started: true, settled: true, error: 'Cancelled' };
  };
  const running = f.service.core(f.a.id, { kind: 'bash' });
  await entered;
  const release = f.service.forceRelease(f.computer.id);
  expect((await f.db.client.computerClaim.findUnique({ where: { computerId: f.computer.id } }))?.agentId).toBe(f.a.id);
  finish();
  await running;
  await release;
  await f.service.use(f.b.id, 'Desk', true);
  f.runtime.cancel = async () => {
    throw new Error('Unsettled');
  };
  await expect(f.service.forceRelease(f.computer.id)).rejects.toThrow('Unsettled');
  expect((await f.db.client.computerClaim.findUnique({ where: { computerId: f.computer.id } }))?.agentId).toBe(f.b.id);
});

it('separates assignments from one active holder, preserves an old claim when a switch is busy', async () => {
  const f = await fixture();
  await f.service.use(f.a.id, 'Desk', true);
  await expect(f.service.use(f.b.id, f.computer.id, true)).rejects.toThrow(/A.*release/);
  const other = await f.db.client.computer.create({
    data: { name: 'Second', requestKey: crypto.randomUUID(), state: 'running' },
  });
  await f.service.assign(f.b.id, [f.computer.id, other.id]);
  await f.service.use(f.b.id, other.id, true);
  await expect(f.service.use(f.b.id, 'Desk', true)).rejects.toThrow(/release/);
  expect((await f.service.list(f.b.id)).find(c => c.id === other.id)?.current).toBe(true);
  await f.service.use(f.a.id, null);
  await f.service.use(f.b.id, 'Desk', true);
  expect((await f.service.list(f.a.id))[0].holder?.id).toBe(f.b.id);
});
it("tells the agent each computer's saved caps, with swap equal to memory, and nothing when unknown", async () => {
  const f = await fixture();
  const sized = await f.db.client.computer.create({
    data: { name: 'Sized', requestKey: crypto.randomUUID(), state: 'running', cpuCores: 2, memoryGiB: 4 },
  });
  await f.service.assign(f.a.id, [f.computer.id, sized.id]);
  const listed = await f.service.list(f.a.id);
  expect(listed.find(c => c.id === sized.id)?.caps).toEqual({ cpus: 2, memoryGiB: 4, swapGiB: 4 });
  expect(listed.find(c => c.id === f.computer.id)).not.toHaveProperty('caps');
  expect(await f.service.use(f.a.id, 'Sized')).toMatchObject({ caps: { cpus: 2, memoryGiB: 4, swapGiB: 4 } });
});
it('saves a screenshot of the held computer without granting input allowance', async () => {
  const f = await fixture();
  await expect(f.service.snapshot(f.a.id, { kind: 'glance', quality: 'full' })).rejects.toThrow(/use_computer/);
  await f.service.use(f.a.id, 'Desk', true);
  const saved = await f.service.snapshot(f.a.id, { kind: 'glance', quality: 'full' });
  expect(saved.computer.name).toBe('Desk');
  expect(saved.frame.width).toBeGreaterThan(0);
  // The agent has not seen it: input still needs a look.
  await expect(f.service.run(f.a.id, {})).rejects.toThrow(/look/i);
});
it('grants two combos for thirty real seconds, refunds preflight rejection, invalidates release', async () => {
  const f = await fixture();
  await f.service.use(f.a.id, 'Desk', true);
  await expect(f.service.run(f.a.id, {}, new AbortController().signal)).rejects.toThrow(/look/i);
  await f.service.capture(f.a.id, { mode: 'glance' });
  f.invalid(true);
  expect((await f.service.run(f.a.id, {})).started).toBe(false);
  f.invalid(false);
  await f.service.run(f.a.id, {});
  await f.service.run(f.a.id, {});
  await expect(f.service.run(f.a.id, {})).rejects.toThrow(/look/i);
  await f.service.capture(f.a.id, { mode: 'glance' });
  f.time(30001);
  await expect(f.service.run(f.a.id, {})).rejects.toThrow(/look/i);
  await f.service.capture(f.a.id, { mode: 'glance' });
  await f.service.use(f.a.id, null);
  await f.service.use(f.a.id, 'Desk', true);
  await expect(f.service.run(f.a.id, {})).rejects.toThrow(/look/i);
  expect(f.counts().executes).toBe(3);
});
it('revokes access at execution and force release retains assignment and leaves a notice', async () => {
  const f = await fixture();
  await f.service.use(f.a.id, 'Desk', true);
  await f.service.forceRelease(f.computer.id);
  expect(await f.service.list(f.a.id)).toHaveLength(1);
  expect((await f.service.notices(f.a.id))[0].text).toMatch(/released/);
  // A force release takes only the claim: the agent still reads, but cannot act.
  await f.service.capture(f.a.id, { mode: 'glance' });
  await expect(f.service.run(f.a.id, { actions: [] })).rejects.toThrow(/write: true/);
  await f.service.use(f.a.id, 'Desk', true);
  await f.service.assign(f.a.id, []);
  await expect(f.service.capture(f.a.id, { mode: 'glance' })).rejects.toThrow(/use_computer/);
  await expect(f.service.use(f.a.id, 'Desk', true)).rejects.toThrow(/assigned/);
});
it('restart releases claims, preserves assignments and persists next-turn notices without inference', async () => {
  const f = await fixture();
  await f.service.use(f.a.id, 'Desk', true);
  const next = new ComputerUseService(f.db, f.runtime);
  await next.ready();
  expect((await next.list(f.a.id))[0].holder).toBeNull();
  const notes = await next.notices(f.a.id);
  expect(notes[0].text).toMatch(/restart/);
  await next.acknowledgeNotices(
    f.a.id,
    notes.map(n => n.id),
  );
  expect(await next.notices(f.a.id)).toEqual([]);
});
it('force release waits for cancellation settlement before transferring a computer', async () => {
  const f = await fixture();
  let finish!: () => void;
  let entered!: () => void;
  const begun = new Promise<void>(resolve => {
    entered = resolve;
  });
  f.runtime.execute = async (_id, _request, signal) => {
    entered();
    await new Promise<void>(resolve => {
      finish = resolve;
      signal!.addEventListener('abort', () => {}, { once: true });
    });
    return { started: true, completed: 0, error: 'Stopped' };
  };
  await f.service.use(f.a.id, 'Desk', true);
  await f.service.capture(f.a.id, { mode: 'glance' });
  const running = f.service.run(f.a.id, {});
  await begun;
  let released = false;
  const release = f.service.forceRelease(f.computer.id).then(() => {
    released = true;
  });
  await Promise.resolve();
  expect(released).toBe(false);
  finish();
  await running;
  await release;
  await f.service.use(f.b.id, 'Desk', true);
});
it('does not let a slow screenshot on one computer delay Force release or another computer, and release aborts it', async () => {
  const f = await fixture();
  const other = await f.db.client.computer.create({
    data: { name: 'Other', requestKey: crypto.randomUUID(), state: 'running' },
  });
  await f.service.assign(f.b.id, [other.id]);
  await f.service.use(f.a.id, 'Desk', true);
  await f.service.use(f.b.id, 'Other', true);
  let started!: () => void;
  const capturing = new Promise<void>(resolve => {
    started = resolve;
  });
  const slow = f.runtime.capture;
  f.runtime.capture = (id, request, signal) => {
    if (id !== f.computer.id) return slow(id, request, signal);
    started();
    return new Promise((_resolve, reject) =>
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
    ); // never finishes on its own
  };
  const shot = f.service.capture(f.a.id, {}).catch(error => error as Error);
  await capturing;
  await expect(f.service.capture(f.b.id, {})).resolves.toMatchObject({ width: 640 }); // another computer proceeds meanwhile
  const released = Date.now();
  await f.service.forceRelease(f.computer.id); // would hang behind the stuck screenshot before
  expect(Date.now() - released).toBeLessThan(2000);
  expect(((await shot) as Error).message).toBe('aborted');
  expect(await f.db.client.computerClaim.count({ where: { computerId: f.computer.id } })).toBe(0);
  await expect(f.service.run(f.a.id, {})).rejects.toThrow(/use_computer/);
}, 15000);

it('lets any assigned agent read a held computer without disturbing the holder; only the holder acts', async () => {
  const f = await fixture();
  f.runtime.prepareCore = async (_id, request) => request;
  f.runtime.core = async () => ({ started: true, settled: true, result: { type: 'text', text: 'guest' } });
  await f.service.use(f.a.id, 'Desk', true);
  // B reads by default, even while A holds it.
  expect(await f.service.use(f.b.id, 'Desk')).toMatchObject({ write: false, heldForWritingBy: 'A' });
  await f.service.capture(f.b.id, { mode: 'glance' });
  expect((await f.service.core(f.b.id, { kind: 'read', path: '/home/agent/x' })).result).toBeTruthy();
  await f.service.core(f.b.id, { kind: 'terminal', operation: 'list' });
  // Reading gives B nothing to act with, and writing needs the claim A holds.
  await expect(f.service.run(f.b.id, { actions: [] })).rejects.toThrow(/reading this computer.*write: true/);
  await expect(f.service.core(f.b.id, { kind: 'bash', command: 'ls' })).rejects.toThrow(/write: true/);
  await expect(f.service.use(f.b.id, 'Desk', true)).rejects.toThrow(/held for writing by A.*still read/);
  // A is undisturbed: its look still lets it act.
  await f.service.capture(f.a.id, { mode: 'glance' });
  expect((await f.service.run(f.a.id, { actions: [] })).completed).toBe(1);
  expect((await f.service.list(f.b.id))[0]).toMatchObject({ holder: { name: 'A' }, current: false, reading: true });
  // Omitting write keeps A's claim; write:false gives it up and keeps reading; B may then claim it.
  expect(await f.service.use(f.a.id, 'Desk')).toMatchObject({ write: true });
  expect(await f.service.use(f.a.id, 'Desk', false)).toMatchObject({ write: false });
  await f.service.capture(f.a.id, { mode: 'glance' });
  await expect(f.service.run(f.a.id, { actions: [] })).rejects.toThrow(/write: true/);
  expect(await f.service.use(f.b.id, 'Desk', true)).toMatchObject({ write: true });
  // Selecting another computer to read gives up the claim on this one.
  const other = await f.db.client.computer.create({
    data: { name: 'Other', requestKey: crypto.randomUUID(), state: 'running' },
  });
  await f.service.assign(f.b.id, [f.computer.id, other.id]);
  expect(await f.service.use(f.b.id, 'Other')).toMatchObject({ write: false });
  expect((await f.service.holders()).length).toBe(0);
  await f.service.use(f.b.id, null);
  await expect(f.service.capture(f.b.id, { mode: 'glance' })).rejects.toThrow(/use_computer/);
});

it('puts back what an agent held and read when its heartbeat is dropped', async () => {
  const f = await fixture();
  const other = await f.db.client.computer.create({
    data: { name: 'Other', requestKey: crypto.randomUUID(), state: 'running' },
  });
  await f.service.assign(f.a.id, [f.computer.id, other.id]);
  await f.service.use(f.a.id, 'Other');
  const before = await f.service.heldState(f.a.id);
  expect(before).toEqual({ claim: null, reading: other.id });
  // The heartbeat claimed Desk, then was dropped: the claim goes, the reading selection comes back.
  await f.service.use(f.a.id, 'Desk', true);
  await f.service.restoreHeld(f.a.id, before);
  expect(await f.service.heldState(f.a.id)).toEqual(before);
  expect(await f.service.holders()).toEqual([]);
  // A claim held before the heartbeat stays.
  await f.service.use(f.a.id, 'Desk', true);
  const holding = await f.service.heldState(f.a.id);
  await f.service.restoreHeld(f.a.id, holding);
  expect((await f.service.holders()).map(claim => claim.agent.name)).toEqual(['A']);
});

it('lists readers apart from the holder, only while they are still assigned', async () => {
  const f = await fixture();
  await f.service.use(f.a.id, 'Desk', true);
  await f.service.use(f.b.id, 'Desk');
  expect(await f.service.readers()).toEqual([{ computerId: f.computer.id, agent: { id: f.b.id, name: 'B' } }]);
  expect((await f.service.holders()).map(claim => claim.agent.name)).toEqual(['A']);
  await f.service.assign(f.b.id, []);
  expect(await f.service.readers()).toEqual([]);
});
