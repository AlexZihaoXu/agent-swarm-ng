import { afterEach, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareDatabase } from '../test-database';
import { AgentRuns } from '../agent-runs';
import { ActivityStore } from '../activity-store';
import { backfillRunSpans, closeInterruptedSpans, runSpans } from './run-spans';

afterEach(() => runSpans.configure(undefined));

let count = 0;
async function setup() {
  const folder = await mkdtemp(join(process.env.SQLITE_TEST_ROOT!, 'spans-'));
  const db = await prepareDatabase(join(folder, `spans-${++count}.db`));
  const agent = await db.createAgent({ name: 'A', endpointId: 'fake', model: 'test', thinkingLevel: 'off' });
  runSpans.configure(db, { error: error => console.error(error) });
  return { db, agent, identity: { agentId: agent.id, channelId: agent.channels[0].id } };
}
const finished = async (run: { finished: Promise<void> }) => {
  await run.finished;
  await runSpans.settled();
};

it('records a run from its start to its end, also when stopped or failed', async () => {
  const { db, identity } = await setup();
  try {
    const runs = new AgentRuns();
    const before = Date.now();
    const done = runs.enqueue({ ...identity, clientMessageId: 'm1' }, async () => {});
    await finished(done);
    const failed = runs.enqueue({ ...identity, clientMessageId: 'm2' }, async () => {
      throw new Error('model failed');
    });
    await finished(failed);
    let started!: () => void;
    const running = new Promise<void>(resolve => (started = resolve));
    const stopped = runs.enqueue({ ...identity, clientMessageId: 'm3' }, async ({ signal }) => {
      started();
      await new Promise(resolve => signal.addEventListener('abort', resolve));
    });
    await running;
    await runSpans.settled();
    expect(await db.client.agentRunSpan.findUnique({ where: { runId: stopped.runId } })).toMatchObject({
      endedAt: null,
    });
    await runs.stop(identity.agentId, 'm3');
    await finished(stopped);
    const spans = await db.client.agentRunSpan.findMany({ orderBy: { sequence: 'asc' } });
    expect(spans.map(span => span.runId)).toEqual([done.runId, failed.runId, stopped.runId]);
    for (const span of spans) {
      expect(span.agentId).toBe(identity.agentId);
      expect(span.startedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(span.endedAt!.getTime()).toBeGreaterThanOrEqual(span.startedAt.getTime());
    }
  } finally {
    await db.close();
  }
});

it('counts a provisional run (heartbeat) only once it becomes real work, from its start', async () => {
  const { db, identity } = await setup();
  try {
    const runs = new AgentRuns();
    const dropped = runs.enqueue({ ...identity, clientMessageId: 'h1' }, async () => {}, { provisional: true });
    await finished(dropped);
    let begun = 0;
    const promoted = runs.enqueue(
      { ...identity, clientMessageId: 'h2' },
      async ({ active }) => {
        begun = Date.now();
        await new Promise(resolve => setTimeout(resolve, 20));
        active?.();
        active?.();
      },
      { provisional: true },
    );
    await finished(promoted);
    const spans = await db.client.agentRunSpan.findMany();
    expect(spans.map(span => span.runId)).toEqual([promoted.runId]);
    expect(spans[0].startedAt.getTime()).toBeLessThanOrEqual(begun);
    expect(spans[0].endedAt).not.toBeNull();
  } finally {
    await db.close();
  }
});

it('closes spans a restart left open at their last activity, or at their start without any', async () => {
  const { db, agent } = await setup();
  try {
    const activity = new ActivityStore(db);
    const save = (runId: string, id: string, timestamp: number, label = 'Thinking') =>
      activity.save(agent.id, {
        id: `${runId}:${id}`,
        runId,
        channelId: agent.channels[0].id,
        kind: 'status',
        label,
        text: '',
        timestamp,
        revision: 0,
      });
    await db.client.agentRunSpan.createMany({
      data: [
        { agentId: agent.id, runId: 'with-activity', startedAt: new Date(1_000) },
        { agentId: agent.id, runId: 'silent', startedAt: new Date(2_000) },
        { agentId: agent.id, runId: 'current', startedAt: new Date(9_000) },
      ],
    });
    await save('with-activity', 'a', 1_500);
    await save('with-activity', 'b', 4_000);
    expect(await closeInterruptedSpans(db, new Date(8_000))).toBe(2);
    const spans = Object.fromEntries(
      (await db.client.agentRunSpan.findMany()).map(span => [span.runId, span.endedAt?.getTime() ?? null]),
    );
    expect(spans).toEqual({ 'with-activity': 4_000, silent: 2_000, current: null });
    expect(await closeInterruptedSpans(db, new Date(8_000))).toBe(0);
  } finally {
    await db.close();
  }
});

it('backfills spans once from the activity archive: agent runs only, promoted heartbeats, work not queue time', async () => {
  const { db, agent } = await setup();
  try {
    const activity = new ActivityStore(db);
    const save = (runId: string, id: string, timestamp: number, label = 'Thinking') =>
      activity.save(agent.id, {
        id: `${runId}:${id}`,
        runId,
        channelId: agent.channels[0].id,
        kind: 'status',
        label,
        text: '',
        timestamp,
        revision: 0,
      });
    const run = crypto.randomUUID(),
      dropped = crypto.randomUUID(),
      promoted = crypto.randomUUID(),
      live = crypto.randomUUID(),
      later = crypto.randomUUID();
    await save(run, 'admission', 100, 'Run admission');
    await save(run, 'run-status', 100, 'Run ended');
    await save(run, 'work-timing', 1_000, 'Work timing');
    await save(run, 'turn', 3_000, 'Turn ended');
    await save(dropped, 'run-status', 1_000, 'Heartbeat ended');
    await save(dropped, 'x', 2_000, 'Heartbeat dropped');
    await save(promoted, 'run-status', 1_000, 'Heartbeat ended');
    await save(promoted, 'x', 1_500, 'Thinking');
    await save(promoted, 'y', 2_500, 'Heartbeat promoted');
    await save(`watch-${crypto.randomUUID()}`, 'x', 1_000, 'Watch decision');
    await save(`sleep-${crypto.randomUUID()}`, 'x', 1_000, 'Sleep finished');
    await save(live, 'x', 1_000);
    await save(later, 'x', 50_000);
    await db.client.agentRunSpan.create({
      data: { agentId: agent.id, runId: live, startedAt: new Date(900), endedAt: new Date(5_000) },
    });
    // Small chunks: a run whose rows fall into several chunks is still one span.
    expect(await backfillRunSpans(db, new Date(10_000), 2)).toBe(2);
    expect(await backfillRunSpans(db, new Date(10_000), 2)).toBe(0);
    const spans = Object.fromEntries(
      (await db.client.agentRunSpan.findMany()).map(span => [
        span.runId,
        [span.startedAt.getTime(), span.endedAt?.getTime()],
      ]),
    );
    expect(spans).toEqual({
      [run]: [1_000, 3_000],
      [promoted]: [1_500, 2_500],
      [live]: [900, 5_000],
    });
  } finally {
    await db.close();
  }
});
