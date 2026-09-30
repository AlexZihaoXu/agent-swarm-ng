import type { FastifyReply } from 'fastify';
import type { AgentRuns, RunEvent } from './agent-runs';

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
    const unsubscribe = runs.subscribe((event: RunEvent) => {
      if (runId && event.runId !== runId) return;
      write(event);
      if (runId && event.type === 'done') reply.raw.end();
    });
    connections.add(reply);
    const heartbeat = setInterval(() => write({ type: 'heartbeat' }), 15000);
    reply.raw.once('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      connections.delete(reply);
    });
    if (initialEvent) write(initialEvent);
    if (!runId) write({ type: 'snapshot', runs: runs.snapshot(), compactions: runs.compactionSnapshot() });
  }
  return {
    attach,
    close: () => {
      for (const reply of connections) reply.raw.end();
    },
  };
}
