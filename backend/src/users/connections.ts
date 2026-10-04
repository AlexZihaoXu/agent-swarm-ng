import { unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CodexProvider, codexFiles } from '../codex-provider';
import { resolveChatConnection } from '../chat-connection';
import { databaseFile } from '../database-location';
import type { EndpointStore } from '../endpoint-store';
import { ADMIN_ID, type Reach } from './reach';

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

  async forAgent(agent: { id: string; endpointId: string }, signal: AbortSignal) {
    const owner = await this.ownerOfAgent(agent.id);
    return resolveChatConnection(agent.endpointId, await this.endpoints.readFor(owner), this.codex(owner), signal);
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
