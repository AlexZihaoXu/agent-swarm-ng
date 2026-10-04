import type { FastifyReply } from 'fastify';
import type { AgentRuns, RunEvent } from './agent-runs';
import { viewerOf, type Reach, type Viewer } from './users/reach';

/**
 * Whether a person may see an event (docs/users.md#enforcement): its agent (when it names one) and its channel key
 * (a group, computer, file channel, scratchpad, DM or Discord channel) must both be theirs. Admin sees all.
 */
async function visible(reach: Reach, viewer: Viewer, event: RunEvent) {
  if (viewer.admin) return true;
  const channel = String(event.channelId ?? '');
  // A group announcement without a group (an agent left every group) carries nothing to hide.
  if (channel === 'group:') return true;
  // Platform events (agentId 'human') are judged by their channel; an agent's events need the agent too (a Discord
  // channel can be shared with another person's agents).
  const human = !event.agentId || event.agentId === 'human';
  if (!human && !(await reach.agent(viewer, event.agentId))) return false;
  if (/^(group|computer|files|scratch|dm|discord):/.test(channel)) return reach.channel(viewer, channel);
  return human ? reach.channel(viewer, channel) : true;
}

/** Slow/disconnected observers are dropped without affecting agent execution. */
export function createRunStreams(runs: AgentRuns) {
  const connections = new Set<FastifyReply>();
  function attach(reply: FastifyReply, runId?: string, initialEvent?: object) {
    if (reply.raw.destroyed) return;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    });
    const write = (event: object) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      if (reply.raw.writableLength > 1_048_576) {
        reply.raw.destroy();
        return;
      }
      reply.raw.write(`${JSON.stringify(event)}\n`);
    };
    const viewer = viewerOf(reply.request);
    const reach = reply.server.reach;
    // Checked in arrival order (lookups are cached), so a person's events never reorder.
    let order = Promise.resolve();
    const unsubscribe = runs.subscribe((event: RunEvent) => {
      if (runId && event.runId !== runId) return;
      order = order.then(async () => {
        if (viewer.admin || (await visible(reach, viewer, event).catch(() => false))) write(event);
        if (runId && event.type === 'done') reply.raw.end();
      });
    });
    connections.add(reply);
    // Signing out (or a password change) ends the stream: it must not keep showing that session's agents.
    const unwatch = reply.server.watchSession?.(reply.request, () => reply.raw.destroy()) ?? (() => {});
    const heartbeat = setInterval(() => write({ type: 'heartbeat' }), 15000);
    reply.raw.once('close', () => {
      clearInterval(heartbeat);
      unwatch();
      unsubscribe();
      connections.delete(reply);
    });
    if (initialEvent) write(initialEvent);
    if (!runId)
      order = order.then(async () => {
        const mine = async (agentId: string) => viewer.admin || (await reach.agent(viewer, agentId).catch(() => false));
        const active = [];
        for (const run of runs.snapshot()) if (await mine(run.agentId)) active.push(run);
        const compactions = Object.fromEntries(
          (
            await Promise.all(
              Object.entries(runs.compactionSnapshot()).map(async ([agentId, state]) =>
                (await mine(agentId)) ? [[agentId, state]] : [],
              ),
            )
          ).flat(),
        );
        write({ type: 'snapshot', runs: active, compactions });
      });
  }
  return {
    attach,
    close: () => {
      for (const reply of connections) reply.raw.end();
    },
  };
}
