import { expect, it } from 'vitest';
import { join } from 'node:path';
import { prepareDatabase } from './test-database';
import { ActivityStore } from './activity-store';
import { AgentRuns } from './agent-runs';
it('persists failure before runChat and queued cancellation before work starts', async () => {
  const db = await prepareDatabase(join(process.env.SQLITE_TEST_ROOT!, `${crypto.randomUUID()}.db`));
  const agent = await db.createAgent({ name: 'A', endpointId: 'mock', model: 'test', thinkingLevel: 'off' });
  const store = new ActivityStore(db),
    runs = new AgentRuns();
  runs.setLifecycle(async (run, state) => {
    await store.lifecycle(run, state);
  });
  const identity = () => ({ agentId: agent.id, channelId: agent.channels[0].id, clientMessageId: crypto.randomUUID() });
  let release!: () => void;
  try {
    const failed = runs.enqueue(identity(), async () => {
      throw new Error('Connection preparation failed');
    });
    await failed.finished;
    expect((await store.page(agent.id)).entries.find(e => e.runId === failed.runId)?.label).toBe('Run failed');
    const first = runs.enqueue(
      identity(),
      async () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );
    let secondRan = false;
    const second = runs.enqueue(identity(), async () => {
      secondRan = true;
    });
    await runs.stop(agent.id, second.clientMessageId);
    expect(secondRan).toBe(false);
    expect((await store.page(agent.id)).entries.find(e => e.runId === second.runId)?.label).toBe('Run stopped');
    // First work starts after its queued activity commits.
    for (let tries = 0; !release && tries < 100; tries++) await new Promise(resolve => setTimeout(resolve, 5));
    release();
    await first.finished;
    expect(await db.client.message.count()).toBe(0);
  } finally {
    release?.();
    await runs.shutdown();
    await db.close();
  }
});
