import { UNTRUSTED, type MemoryHit, type MemoryStore } from './store';
import { sourceOf } from './tools';
import { knowledgeOf } from '../help-tool';
import type { KnowledgeCatalog } from '../swarm-knowledge/catalog';

export type KnowledgePointer = { id: string; title: string; summary: string };
/**
 * Tool families whose first use brings their Knowledge entry to mind. Communication, Knowledge and help are left out:
 * they are used in nearly every turn and their guidance is in the system prompt.
 */
const POINTED_FAMILY =
  /^(terminal_|watch_|monitor$|harness_listener_|start_recording|scratch_|upload_file|present_scratch|copy_file|save_screenshot|use_computer$|run_actions$|set_timer|set_reminder|discord_)/;

/** Cue-driven recall limits: per input, per tool call, and per turn (one batch of inputs and all its tool calls). */
export const CUE_LIMITS = { input: 3, tool: 2, turn: 10, scanChars: 4096 };

/**
 * Cue-driven recall (docs/agent-memory.md): every input (a message, a non-chat event) and every tool call (its
 * arguments and result) is a cue; the memories it brings to mind are attached as a small reminder, like a human being
 * reminded of something. Literal matching, no model call. A memory shown (or recalled, memorized or revised by the agent) is not attached
 * again until a third of the context window has passed since; a compaction clears that, as the mention left view.
 */
export class CueRecall {
  private agents = new Map<string, { position: number; shown: Map<string, number> }>();
  constructor(
    private memory: MemoryStore,
    /** Swarm Knowledge: its entries' cue phrases and the tool → entry map bring entries to mind too. */
    private knowledge?: KnowledgeCatalog,
  ) {}

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

  private recent(agentId: string, windowTokens: number) {
    const state = this.of(agentId);
    return new Set([...state.shown].filter(([, at]) => state.position - at < windowTokens / 3).map(([id]) => id));
  }
  /**
   * The Knowledge entry a text (or a tool's first use) brings to mind now, if any: at most one, not shown or read
   * within the last third of the context. Marked as shown.
   */
  knowledgeCue(agentId: string, text: string, windowTokens: number, tool?: string): KnowledgePointer | null {
    if (!this.knowledge) return null;
    const recent = this.recent(agentId, windowTokens);
    // Specific cue phrases first, then the generic entry of a tool family.
    const candidates = [
      ...(text.trim() ? this.knowledge.cued(text.slice(0, CUE_LIMITS.scanChars)) : []),
      ...(tool && POINTED_FAMILY.test(tool)
        ? knowledgeOf(tool)
            .slice(0, 1)
            .flatMap(id => this.knowledge!.pointer(id) ?? [])
        : []),
    ];
    const pick = candidates.find(entry => !recent.has(`knowledge:${entry.id}`));
    if (!pick) return null;
    this.shown(agentId, [`knowledge:${pick.id}`]);
    return { id: pick.id, title: pick.title, summary: pick.summary };
  }
  /** The agent read this entry (read_knowledge): no pointer to it for a while. */
  readKnowledge(agentId: string, id: string) {
    const entry = this.knowledge?.pointer(id);
    if (entry) this.shown(agentId, [`knowledge:${entry.id}`]);
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
  return `[Memory reminder: ${hits.map(hit => `${hit.name}${UNTRUSTED[hit.trust] ?? ''}: ${hit.title} — ${hit.excerpt.slice(0, 100)}`).join(' | ')}]`;
}

/** The one-line pointer to a Knowledge entry. */
export function knowledgeReminder(entry: KnowledgePointer) {
  return `[Knowledge: ${entry.id} (${entry.title}): ${entry.summary} read_knowledge({id:"${entry.id}"}) for details, if you have not read it lately.]`;
}
