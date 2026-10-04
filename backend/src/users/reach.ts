import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    /** Who may reach what (users/reach.ts). */
    reach: Reach;
  }
}
import type { PlatformStore } from '../platform-store';
import { parseChannelKey } from '../files/access';

/**
 * Who is acting (docs/users.md): admin reaches every organization, a user only those they own. Without sign-in
 * (requireLogin off: tests and isolated development) the dashboard acts as admin.
 */
export type Viewer = { userId: string; name: string; admin: boolean };
export const ADMIN_ID = 'admin';
const OPEN: Viewer = { userId: ADMIN_ID, name: 'Admin', admin: true };
export const viewerOf = (request: FastifyRequest): Viewer =>
  request.signedIn
    ? { userId: request.signedIn.userId, name: request.signedIn.name, admin: request.signedIn.admin }
    : OPEN;

/**
 * Which organization each thing belongs to, and whether a person may reach it. Lookups are cached (events check
 * every delta); moves, deletions and owner changes call `forget()`.
 */
export class Reach {
  private readonly owners = new Map<string, string>();
  private readonly orgOf = {
    agent: new Map<string, string>(),
    computer: new Map<string, string>(),
    group: new Map<string, string>(),
  };

  constructor(private readonly platform: PlatformStore) {}

  forget() {
    this.owners.clear();
    for (const map of Object.values(this.orgOf)) map.clear();
  }

  private async client() {
    await this.platform.initialize();
    return this.platform.client;
  }

  async ownerOf(organizationId: string | null | undefined) {
    if (!organizationId) return null;
    let owner = this.owners.get(organizationId);
    if (owner === undefined) {
      const found = await (
        await this.client()
      ).organization.findUnique({
        where: { id: organizationId },
        select: { ownerId: true },
      });
      if (!found) return null;
      this.owners.set(organizationId, (owner = found.ownerId));
    }
    return owner;
  }

  private async lookup(kind: keyof Reach['orgOf'], id: string | null | undefined) {
    if (!id) return null;
    const cache = this.orgOf[kind];
    let organizationId = cache.get(id);
    if (organizationId === undefined) {
      const client = await this.client();
      const where = { where: { id }, select: { organizationId: true } } as const;
      const found =
        kind === 'agent'
          ? await client.agent.findUnique(where)
          : kind === 'computer'
            ? await client.computer.findUnique(where)
            : await client.groupChat.findUnique(where);
      if (!found) return null;
      cache.set(id, (organizationId = found.organizationId));
    }
    return organizationId;
  }
  organizationOfAgent = (id: string | null | undefined) => this.lookup('agent', id);
  organizationOfComputer = (id: string | null | undefined) => this.lookup('computer', id);
  organizationOfGroup = (id: string | null | undefined) => this.lookup('group', id);

  /** The person whose model connections an agent uses: its organization's owner. */
  async ownerOfAgent(agentId: string) {
    return this.ownerOf(await this.organizationOfAgent(agentId));
  }

  async organization(viewer: Viewer, organizationId: string | null | undefined) {
    if (!organizationId) return false;
    const owner = await this.ownerOf(organizationId);
    return owner !== null && (viewer.admin || owner === viewer.userId);
  }
  agent = async (viewer: Viewer, id: string | null | undefined) =>
    this.organization(viewer, await this.organizationOfAgent(id));
  computer = async (viewer: Viewer, id: string | null | undefined) =>
    this.organization(viewer, await this.organizationOfComputer(id));
  group = async (viewer: Viewer, id: string | null | undefined) =>
    this.organization(viewer, await this.organizationOfGroup(id));

  /**
   * A channel or event key: a private chat's channel id, `chat:<channelId>`, `group:<id>`, `dm:<a>:<b>`,
   * `discord:<id>` (reachable when one of the person's agents uses it), `computer:<id>`, `scratch:<agentId>`,
   * `files:<channel key>`.
   */
  async channel(viewer: Viewer, key: string | null | undefined): Promise<boolean> {
    if (!key) return false;
    if (viewer.admin) return true;
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    if (kind === 'files') return this.channel(viewer, id);
    if (kind === 'computer') return this.computer(viewer, id);
    if (kind === 'scratch') return this.agent(viewer, id);
    if (rest.length && ['chat', 'group', 'dm', 'discord'].includes(kind!)) {
      const parsed = parseChannelKey(key);
      if (!parsed) return false;
      if (parsed.kind === 'group') return this.group(viewer, parsed.groupId);
      if (parsed.kind === 'dm') return (await this.agent(viewer, parsed.a)) && (await this.agent(viewer, parsed.b));
      if (parsed.kind === 'discord') {
        const rows = await (
          await this.client()
        ).discordChannel.findMany({
          where: { channelId: parsed.channelId },
          select: { agentId: true },
        });
        for (const row of rows) if (await this.agent(viewer, row.agentId)) return true;
        return false;
      }
      key = parsed.channelId;
    }
    // A private chat: the channel's agent.
    const channel = await (await this.client()).channel.findUnique({ where: { id: key }, select: { agentId: true } });
    return Boolean(channel && (await this.agent(viewer, channel.agentId)));
  }

  async file(viewer: Viewer, fileId: string) {
    if (viewer.admin) return true;
    const file = await (
      await this.client()
    ).channelFile.findUnique({
      where: { id: fileId },
      select: { channelKey: true },
    });
    return Boolean(file && (await this.channel(viewer, file.channelKey)));
  }

  /** The organizations a person reaches: null for admin (all of them). */
  async organizations(viewer: Viewer): Promise<string[] | null> {
    if (viewer.admin) return null;
    const owned = await (
      await this.client()
    ).organization.findMany({
      where: { ownerId: viewer.userId },
      select: { id: true },
      orderBy: { sequence: 'asc' },
    });
    return owned.map(item => item.id);
  }
}

/**
 * Whose model connections a request is about: the named organization's owner when the person reaches it (admin
 * choosing a model for an agent in Sam's organization sees Sam's), otherwise the person's own.
 */
export async function connectionOwner(reach: Reach, viewer: Viewer, organizationId?: string) {
  if (organizationId && (await reach.organization(viewer, organizationId)))
    return (await reach.ownerOf(organizationId)) ?? viewer.userId;
  return viewer.userId;
}
