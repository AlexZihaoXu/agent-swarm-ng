import { describe, expect, it, vi } from 'vitest';
import { AgentRuns } from './agent-runs';

const identity = { agentId: 'agent', channelId: 'channel', clientMessageId: 'message' };
describe('backend-owned agent runs', () => {
  it('keeps working without listeners and exposes its current state to reconnecting clients', async () => {
    const runs = new AgentRuns();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const events: object[] = [];
    const detach = runs.subscribe(event => events.push(event));
    const run = runs.start(identity, async ({ emit, signal }) => {
      emit({ type: 'typing', active: true });
      await gate;
      expect(signal.aborted).toBe(false);
      emit({ type: 'channel_message', text: 'Finished offline' });
    });
    await Promise.resolve();
    detach();
    expect(runs.snapshot()).toEqual([{ ...identity, runId: run.runId, typing: true }]);
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
    const joined = runs.offer(identity.agentId, { role: 'user', text: 'task' }, { type: 'user_message', text: 'task' });
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
