import { beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { ReactionStore } from './reaction-store';
import { ActivityStore } from './activity-store';
import { ReactionCoordinator } from './reaction-coordinator';
import type { ActivityTrace } from './activity-events';
const mocks = vi.hoisted(() => ({ evaluate: vi.fn(), connection: vi.fn() }));
vi.mock('./reaction-triage', () => ({ evaluateReaction: mocks.evaluate }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.mockResolvedValue({ baseUrl: 'http://mock.invalid/v1', apiKey: 'mock-secret' });
});
async function fixture() {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await db.createAgent({ name: 'A', endpointId: 'mock', model: 'test', thinkingLevel: 'off' });
  const channel = agent.channels[0].id,
    message = await db.appendMessage(channel, 'assistant', 'Result');
  const reactions = new ReactionStore(db),
    archive = new ActivityStore(db),
    emitted: any[] = [];
  await reactions.set(channel, message.id, '👍', true);
  const enqueue = vi.fn().mockReturnValue({ runId: 'scheduled-run' });
  const coordinator = new ReactionCoordinator(db, { forAgent: mocks.connection } as any, { enqueue } as any, vi.fn(), {
    store: archive,
    emit: (_agent, entry) => emitted.push(entry),
  });
  return {
    db,
    agent,
    channel,
    message,
    reactions,
    archive,
    emitted,
    enqueue,
    coordinator,
    text: async () =>
      JSON.stringify(await db.client.activity.findMany({ where: { agentId: agent.id }, orderBy: { sequence: 'asc' } })),
    close: async () => {
      coordinator.close();
      await coordinator.settled();
      await db.close();
    },
  };
}
function decision(action: 'engage' | 'ignore') {
  return async (
    _config: unknown,
    _history: unknown,
    _notice: unknown,
    _signal: unknown,
    _runtime: unknown,
    trace: ActivityTrace,
  ) => {
    trace.record('thinking', 'Thinking', 'Fork detail mock-secret', 'thought', false, 'complete');
    return { action, reason: 'Mock decision' };
  };
}
it.each(['engage', 'ignore'] as const)(
  'archives standalone %s triage without publishing its internal output',
  async action => {
    const f = await fixture();
    mocks.evaluate.mockImplementation(decision(action));
    try {
      await f.coordinator.offer(f.channel, f.message.id, '👍');
      await f.coordinator.settled();
      const saved = await f.text();
      expect(saved).toContain('Reaction triage ended');
      expect(saved).toContain('Fork detail [redacted]');
      expect(saved).not.toContain('mock-secret');
      expect(saved).toContain('Reaction source');
      expect(f.enqueue).toHaveBeenCalledTimes(action === 'engage' ? 1 : 0);
      if (action === 'engage') expect(saved).toContain('scheduled-run');
      expect(await f.db.client.message.count()).toBe(1);
      expect(f.emitted.length).toBeGreaterThan(0);
      for (const entry of f.emitted)
        expect(await f.db.client.activity.findUnique({ where: { id: entry.id } })).not.toBeNull();
    } finally {
      await f.close();
    }
  },
);
it('records the failure phase without leaking preparation errors or pretending triage succeeded', async () => {
  const f = await fixture();
  mocks.connection.mockRejectedValueOnce(new Error('RAW AUTH ERROR mock-secret'));
  try {
    await f.coordinator.offer(f.channel, f.message.id, '👍');
    await f.coordinator.settled();
    const saved = await f.text();
    expect(saved).toContain('preparation');
    expect(saved).toContain('Reaction triage failed');
    expect(saved).not.toContain('RAW AUTH ERROR');
    expect(mocks.evaluate).not.toHaveBeenCalled();
    expect(f.enqueue).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
it('records advice discarded after reaction removal without scheduling ordinary inference', async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  mocks.evaluate.mockImplementation(async (...args) => {
    await gate;
    return decision('engage')(...(args as Parameters<ReturnType<typeof decision>>));
  });
  try {
    await f.coordinator.offer(f.channel, f.message.id, '👍');
    await vi.waitFor(() => expect(mocks.evaluate).toHaveBeenCalledOnce());
    await f.reactions.set(f.channel, f.message.id, '👍', false);
    release();
    await f.coordinator.settled();
    const rows = await f.db.client.activity.findMany({
      where: { agentId: f.agent.id, label: 'Reaction triage decision' },
    });
    expect(JSON.parse(rows[0].text)).toMatchObject({ action: 'engage', applied: false, eligible: false });
    expect(f.enqueue).not.toHaveBeenCalled();
  } finally {
    release();
    await f.close();
  }
});
it('records pending-limit skips and cancellation of queued branches', async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  mocks.evaluate.mockImplementation(async (...args) => {
    await gate;
    return decision('engage')(...(args as Parameters<ReturnType<typeof decision>>));
  });
  try {
    for (let i = 0; i < 5; i++) await f.coordinator.offer(f.channel, f.message.id, '👍');
    const cancelled = f.coordinator.cancelAgent(f.agent.id);
    release();
    await cancelled;
    const saved = await f.text();
    expect(saved).toContain('Reaction triage skipped');
    expect(saved).toContain('Reaction triage stopped');
    expect(f.enqueue).not.toHaveBeenCalled();
  } finally {
    release();
    await f.close();
  }
});
