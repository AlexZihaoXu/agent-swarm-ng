import { describe, expect, it, vi } from 'vitest';
import { AgentRuns } from './agent-runs';

const identity = { agentId: 'agent', channelId: 'channel', clientMessageId: 'message' };
describe('backend-owned agent runs', () => {
  it('broadcasts group deletion to connected observers', () => {
    const runs = new AgentRuns();
    const events: object[] = [];
    runs.subscribe(event => events.push(event));
    runs.groupDeleted('group-id');
    expect(events).toEqual([expect.objectContaining({ type: 'group_deleted', groupId: 'group-id', channelId: 'group:group-id' })]);
  });
  it('keeps working without listeners and exposes its current state to reconnecting clients', async () => {
    const runs = new AgentRuns();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const events: object[] = [];
    const detach = runs.subscribe(event => events.push(event));
    const run = runs.start(identity, async ({ emit, signal }) => {
      emit({ type: 'typing', active: true, targets: ['dm:agent:peer'] });
      await gate;
      expect(signal.aborted).toBe(false);
      emit({ type: 'channel_message', text: 'Finished offline' });
    });
    await Promise.resolve();
    detach();
    expect(runs.snapshot()).toEqual([{ ...identity, runId: run.runId, typing: true, typingTargets: ['dm:agent:peer'] }]);
    expect(() => runs.start(identity, async () => {})).toThrow();
    const resumed: object[] = [];
    runs.subscribe(event => resumed.push(event));
    finish(); await run.finished;
    expect(resumed).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'channel_message', text: 'Finished offline' }), expect.objectContaining({ type: 'done', runId: run.runId })]));
    expect(runs.snapshot()).toEqual([]);
  });
  it('accepts messages into the same run and changes the admission epoch on explicit Stop', async () => {
    const runs = new AgentRuns(); const inference = vi.fn();
    const run = runs.start(identity, async ({ inbox, signal }) => {
      inbox.add({ role: 'user', text: 'hi' });
      await inbox.take(signal);
      inference();
    });
    await Promise.resolve();
    const revision = runs.stopVersion(identity.agentId);
    const joined = runs.offer(identity.agentId, { role: 'user', text: 'task' }, { type: 'user_message', text: 'task', channelId: identity.channelId });
    expect(joined?.runId).toBe(run.runId);
    expect(joined?.clientMessageId).toBe(identity.clientMessageId);
    expect(await runs.stop(identity.agentId, 'stale')).toBe(false);
    expect(runs.stopVersion(identity.agentId)).toBe(revision);
    expect(await runs.stop(identity.agentId, identity.clientMessageId)).toBe(true);
    expect(runs.stopVersion(identity.agentId)).toBe(revision + 1);
    expect(inference).not.toHaveBeenCalled();
    expect(runs.offer(identity.agentId, { role: 'user', text: 'late' }, {})).toBeUndefined();
    expect(run.inbox.add({ role: 'user', text: 'late' })).toBe(false);
  });

  it('queues distinct conversations without leaking messages between their inboxes', async () => {
    const runs = new AgentRuns(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const human = runs.start(identity, async () => gate);
    let received: string[] = [];
    const dm = runs.enqueue({ ...identity, channelId: 'dm:a:b', clientMessageId: 'dm-message' }, async ({ inbox, signal }) => {
      inbox.prepend({ role: 'user', text: 'original DM' });
      received = (await inbox.take(signal)).messages.map(message => message.text);
    });
    await Promise.resolve();
    expect(runs.snapshot().find(run => run.runId === dm.runId)?.queued).toBe(true);
    expect(runs.offer(identity.agentId, { role: 'user', text: 'wrong channel' }, { channelId: 'other' })).toBeUndefined();
    expect(runs.offer(identity.agentId, { role: 'user', text: 'follow-up DM' }, { channelId: 'dm:a:b' })?.runId).toBe(dm.runId);
    release(); await human.finished; await dm.finished;
    expect(received).toEqual(['original DM', 'follow-up DM']);
    expect(runs.snapshot()).toEqual([]);
  });

  it('stops queued conversation work without waiting for another active conversation', async () => {
    const runs = new AgentRuns(); let release!: () => void;
    const active = runs.start(identity, async () => new Promise<void>(resolve => { release = resolve; }));
    await Promise.resolve(); const work = vi.fn(async () => {});
    const queued = runs.enqueue({ ...identity, channelId: 'dm:a:b', clientMessageId: 'queued' }, work);
    expect(await runs.stop(identity.agentId, 'queued')).toBe(true);
    await queued.finished; expect(work).not.toHaveBeenCalled(); expect(runs.has(identity.agentId)).toBe(true);
    expect(runs.stopVersion(identity.agentId)).toBe(0);
    release(); await active.finished; await runs.shutdown();
  });

  it('honors an explicitly configured deadline without requiring a dashboard', async () => {
    vi.useFakeTimers();
    try {
      const runs = new AgentRuns(100);
      let stopped = false;
      const run = runs.start(identity, async ({ signal }) => {
        await new Promise<void>(resolve => signal.addEventListener('abort', () => { stopped = true; resolve(); }, { once: true }));
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(100);
      await run.finished;
      expect(stopped).toBe(true);
      expect(runs.snapshot()).toEqual([]);
      expect(() => new AgentRuns(-1)).toThrow('AGENT_RUN_TIMEOUT_MS');
    } finally { vi.useRealTimers(); }
  });

  it('stops only the identified request, and shutdown waits for cleanup', async () => {
    const runs = new AgentRuns();
    let cleaned = false;
    const run = runs.start(identity, async ({ signal }) => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      cleaned = true;
    });
    await Promise.resolve();
    expect(await runs.stop('agent', 'different-message')).toBe(false);
    expect(runs.has('agent')).toBe(true);
    await runs.shutdown();
    await run.finished;
    expect(cleaned).toBe(true);
    expect(runs.has('agent')).toBe(false);
    expect(() => runs.start(identity, async () => {})).toThrow();
  });
});
