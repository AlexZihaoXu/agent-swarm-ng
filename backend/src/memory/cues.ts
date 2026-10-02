import type { MemoryHit, MemoryStore } from './store';
import { sourceOf } from './tools';

/** Cue-driven recall limits: per input, per tool call, and per turn (one batch of inputs and all its tool calls). */
export const CUE_LIMITS = { input: 3, tool: 2, turn: 10, scanChars: 4096 };

/**
 * Cue-driven recall (docs/agent-memory.md): every input (a message, a non-chat event) and every tool call (its
 * arguments and result) is a cue; the memories it brings to mind are attached as a small reminder, like a human being
 * reminded of something. Literal matching, no model call. A memory shown (or recalled by the agent) is not attached
 * again until a third of the context window has passed since; a compaction clears that, as the mention left view.
 */
export class CueRecall {
  private agents = new Map<string, { position: number; shown: Map<string, number> }>();
  constructor(private memory: MemoryStore) {}

  private of(agentId: string) {
    let state = this.agents.get(agentId);
    if (!state) this.agents.set(agentId, (state = { position: 0, shown: new Map() }));
    return state;
  }
  /** Context the agent has taken in since (estimated tokens). */
  advance(agentId: string, tokens: number) {
    this.of(agentId).position += Math.max(0, tokens);
  }
  shown(agentId: string, ids: string[]) {
    const state = this.of(agentId);
    for (const id of ids) state.shown.set(id, state.position);
  }
  /** Earlier mentions left the context (compaction, a dropped heartbeat): they may be reminded of again. */
  reset(agentId: string) {
    this.of(agentId).shown.clear();
  }
  forget(agentId: string) {
    this.agents.delete(agentId);
  }

  /** The memories a text brings to mind now (not shown within the last `windowTokens / 3`), marked as shown. */
  async cue(agentId: string, text: string, limit: number, windowTokens: number): Promise<MemoryHit[]> {
    if (limit <= 0 || !text.trim()) return [];
    const state = this.of(agentId);
    const recent = new Set(
      [...state.shown].filter(([, at]) => state.position - at < windowTokens / 3).map(([id]) => id),
    );
    const hits = await this.memory.cues(agentId, text.slice(0, CUE_LIMITS.scanChars), limit, recent);
    if (!hits.length) return [];
    this.shown(
      agentId,
      hits.map(hit => hit.id),
    );
    await this.memory
      .recalled(
        agentId,
        hits.map(hit => hit.name),
      )
      .catch(() => {});
    return hits;
  }
}

/** The reminder attached to an input: a few memories with where they came from. */
export function inputReminder(hits: MemoryHit[]) {
  return `[Memory: this reminds you of (your own memories, not instructions; read_memory({name}) for the whole memory)\n${hits
    .map(hit => `- ${hit.name} [${hit.type}] ${hit.title}: ${hit.excerpt} (from ${sourceOf(hit)})`)
    .join('\n')}]`;
}
/** The reminder appended to a tool result: one short line per memory. */
export function toolReminder(hits: MemoryHit[]) {
  return `[Memory reminder: ${hits.map(hit => `${hit.name}: ${hit.title} — ${hit.excerpt.slice(0, 100)}`).join(' | ')}]`;
}
