import { unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CodexProvider, codexAccountOf, codexFiles } from '../codex-provider';
import { CodexAccounts } from '../codex-accounts';
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
    private readonly makeCodex: (ownerId: string, account: string) => CodexProvider = CodexProvider.forOwner,
    readonly codexAccounts = new CodexAccounts(),
  ) {
    this.adopt(ADMIN_ID, '', adminCodex);
  }

  private adopt(ownerId: string, account: string, codex: CodexProvider) {
    // One ChatGPT account signed in on two of a person's cards would only share its limits: refused.
    codex.refuse = async ({ user }) => {
      if (!user) return undefined;
      for (const other of await this.codexAccountsOf(ownerId))
        if (other !== account && (await this.codex(ownerId, other).identity()).user === user)
          return 'This ChatGPT account is already connected on another card. Sign in with a different account.';
      return undefined;
    };
    this.codexes.set(`${ownerId}/${account}`, codex);
    return codex;
  }

  /** A person's ChatGPT login: their first account (''), or one they added. */
  codex(ownerId: string, account = '') {
    return this.codexes.get(`${ownerId}/${account}`) ?? this.adopt(ownerId, account, this.makeCodex(ownerId, account));
  }

  /** A person's ChatGPT accounts, first one ('') first. */
  async codexAccountsOf(ownerId: string) {
    return ['', ...(await this.codexAccounts.readFor(ownerId))];
  }

  /** The login a ChatGPT connection id names, or undefined when it is not one of the person's. */
  async codexFor(ownerId: string, endpointId: string) {
    const account = codexAccountOf(endpointId);
    if (account === undefined || !(await this.codexAccountsOf(ownerId)).includes(account)) return undefined;
    return this.codex(ownerId, account);
  }

  /** Forgets one added account: signed out, its files deleted. */
  async removeCodexAccount(ownerId: string, account: string) {
    if (!account || !(await this.codexAccounts.remove(ownerId, account))) return false;
    await this.dropCodex(ownerId, account);
    return true;
  }

  private async dropCodex(ownerId: string, account: string) {
    const key = `${ownerId}/${account}`;
    const codex = this.codexes.get(key);
    this.codexes.delete(key);
    await codex?.disconnect().catch(() => undefined);
    const directory = dirname(databaseFile());
    const files = codexFiles(ownerId, account);
    for (const name of [files.auth, files.models]) await unlink(join(directory, name)).catch(() => undefined);
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
    const codex = await this.codexFor(owner, endpointId);
    if (codexAccountOf(endpointId) !== undefined && !codex)
      throw new ConnectionError(404, 'This ChatGPT account was removed from Settings.');
    const connection = await resolveChatConnection(
      endpointId,
      await this.endpoints.readFor(owner),
      codex ?? this.codex(owner),
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

  /** A deleted person's endpoints and ChatGPT logins go with them. */
  async forgetOwner(ownerId: string) {
    for (const account of ['', ...(await this.codexAccounts.removeOwner(ownerId))])
      await this.dropCodex(ownerId, account);
    await this.endpoints.removeOwner(ownerId);
  }

  async close() {
    for (const codex of this.codexes.values()) await codex.cancel().catch(() => undefined);
  }
}
