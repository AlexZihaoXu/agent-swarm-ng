import { unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CodexProvider, codexFiles } from '../codex-provider';
import { ConnectionError, resolveChatConnection } from '../chat-connection';
import { isPublicUrl } from './public-address';
import { databaseFile } from '../database-location';
import type { EndpointStore } from '../endpoint-store';
import { ADMIN_ID, type Reach } from './reach';
import { choicesOf, ModelChains, type ModelChoice } from '../model-chain';

type ChainAgent = Parameters<typeof choicesOf>[0] & { id: string };

/**
 * Model connections belong to people (docs/users.md#model-connections): their API endpoints and their ChatGPT login.
 * An agent uses its organization owner's, for every turn (heartbeats, timers, watches and Discord included, which
 * run with nobody signed in).
 */
export class Connections {
  private readonly codexes = new Map<string, CodexProvider>();

  constructor(
    readonly endpoints: EndpointStore,
    readonly reach: Reach,
    adminCodex: CodexProvider,
    private readonly makeCodex: (ownerId: string) => CodexProvider = CodexProvider.forOwner,
  ) {
    this.codexes.set(ADMIN_ID, adminCodex);
  }

  /** A person's ChatGPT login. */
  codex(ownerId: string) {
    let codex = this.codexes.get(ownerId);
    if (!codex) this.codexes.set(ownerId, (codex = this.makeCodex(ownerId)));
    return codex;
  }

  /** Whose connections an agent uses: its organization's owner. */
  async ownerOfAgent(agentId: string) {
    return (await this.reach.ownerOfAgent(agentId)) ?? ADMIN_ID;
  }

  /** Each agent's place in its fallback chain (docs/agent-models.md). */
  readonly chains = new ModelChains();

  /** One endpoint of the agent's organization owner, checked like every turn's. */
  async forEndpoint(agentId: string, endpointId: string, signal: AbortSignal) {
    const owner = await this.ownerOfAgent(agentId);
    const connection = await resolveChatConnection(
      endpointId,
      await this.endpoints.readFor(owner),
      this.codex(owner),
      signal,
    );
    // A user's endpoint must still point at the public internet (its name could have been re-pointed since it was
    // saved, docs/users.md#model-connections): checked again on every turn.
    if (owner !== ADMIN_ID && !connection.subscriptionRuntime && !(await isPublicUrl(new URL(connection.baseUrl))))
      throw new ConnectionError(400, 'This endpoint no longer points at a public address. Check it in Settings.');
    return connection;
  }

  /**
   * The model the agent is on now, with its connection: forks and side calls (triage, checks, sleep, watches) use it.
   * Its main turns walk the whole chain (forChain).
   */
  async forAgent(agent: ChainAgent, signal: AbortSignal) {
    const choices = choicesOf(agent);
    const choice = choices[this.chains.active(agent.id, choices)]!;
    return { ...(await this.forEndpoint(agent.id, choice.endpointId, signal)), choice };
  }

  /** Every choice's connection, or why it cannot be reached (a choice that fails here is skipped at once). */
  async forChain(agent: ChainAgent, signal: AbortSignal) {
    const choices = choicesOf(agent);
    const settled = await Promise.allSettled(
      choices.map(choice => this.forEndpoint(agent.id, choice.endpointId, signal)),
    );
    signal.throwIfAborted();
    return choices.map((choice: ModelChoice, index) => {
      const result = settled[index]!;
      return result.status === 'fulfilled'
        ? { choice, connection: result.value }
        : {
            choice,
            unreachable:
              result.reason instanceof ConnectionError ? result.reason.message : 'Its connection could not be reached.',
          };
    });
  }

  /** A deleted person's endpoints and ChatGPT login go with them. */
  async forgetOwner(ownerId: string) {
    const codex = this.codexes.get(ownerId);
    this.codexes.delete(ownerId);
    await codex?.disconnect().catch(() => undefined);
    const directory = dirname(databaseFile());
    const files = codexFiles(ownerId);
    for (const name of [files.auth, files.models]) await unlink(join(directory, name)).catch(() => undefined);
    await this.endpoints.removeOwner(ownerId);
  }

  async close() {
    for (const codex of this.codexes.values()) await codex.cancel().catch(() => undefined);
  }
}
