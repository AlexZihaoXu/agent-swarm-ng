import type { PlatformStore } from './platform-store';

/**
 * Organizations (docs/organizations.md): folders of agents, computers and group chats, kept apart. Every one of them
 * belongs to exactly one organization, and the links between them never cross one: a computer is assigned only to
 * agents of its organization, DM permissions join agents of one organization, a group's members are all in its
 * organization. Everything an agent can reach follows from those links, so it never sees another organization.
 * Moving something to another organization drops the links that would cross (a preview lists them first).
 */
export const DEFAULT_ORGANIZATION = 'personal';
export type MoveKind = 'agent' | 'computer' | 'group';
export class OrganizationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

const cleanName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60 || /[\u0000-\u001f\u007f]/.test(trimmed))
    throw new OrganizationError('An organization name is 1–60 characters.');
  return trimmed;
};

export class Organizations {
  constructor(
    private database: PlatformStore,
    /** Changes an agent's computer assignments, releasing what it held there (ComputerUseService.assign). */
    private assign?: (agentId: string, computerIds: string[]) => Promise<void>,
  ) {}

  async list() {
    await this.database.initialize();
    const rows = await this.database.client.organization.findMany({
      orderBy: { sequence: 'asc' },
      take: 200,
      include: { _count: { select: { agents: true, computers: true, groups: true } } },
    });
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      agents: row._count.agents,
      computers: row._count.computers,
      groups: row._count.groups,
    }));
  }
  /** The organization to create something in: the one asked for (it must exist), else the first. */
  async resolve(id?: string) {
    await this.database.initialize();
    const found = id
      ? await this.database.client.organization.findUnique({ where: { id } })
      : await this.database.client.organization.findFirst({ orderBy: { sequence: 'asc' } });
    if (!found) throw new OrganizationError('Organization not found.', 404);
    return found.id;
  }
  async name(id: string) {
    await this.database.initialize();
    return (await this.database.client.organization.findUnique({ where: { id }, select: { name: true } }))?.name;
  }
  async create(name: string) {
    await this.database.initialize();
    if ((await this.database.client.organization.count()) >= 200)
      throw new OrganizationError('At most 200 organizations.');
    const row = await this.database.client.organization.create({ data: { name: cleanName(name) } });
    return row.id;
  }
  async rename(id: string, name: string) {
    await this.database.initialize();
    const changed = await this.database.client.organization.updateMany({
      where: { id },
      data: { name: cleanName(name) },
    });
    if (!changed.count) throw new OrganizationError('Organization not found.', 404);
  }
  /** Deletes an empty organization (never the last one): move or delete what is in it first. */
  async remove(id: string) {
    await this.database.initialize();
    await this.database.client.$transaction(async tx => {
      const org = await tx.organization.findUnique({
        where: { id },
        include: { _count: { select: { agents: true, computers: true, groups: true } } },
      });
      if (!org) throw new OrganizationError('Organization not found.', 404);
      const { agents, computers, groups } = org._count;
      if (agents + computers + groups)
        throw new OrganizationError(
          `${org.name} still has ${agents} agent(s), ${computers} computer(s) and ${groups} group(s): move or delete them first.`,
          409,
        );
      if ((await tx.organization.count()) <= 1)
        throw new OrganizationError('The last organization cannot be deleted.', 409);
      await tx.organization.delete({ where: { id } });
    });
  }

  /**
   * Moves an agent, a computer or a group to another organization. Without `apply` it only lists the links the move
   * would drop (for the confirmation); with it, it drops them and moves.
   */
  async move(kind: MoveKind, id: string, to: string, apply: boolean) {
    await this.database.initialize();
    const db = this.database.client;
    const target = await db.organization.findUnique({ where: { id: to }, select: { id: true, name: true } });
    if (!target) throw new OrganizationError('Organization not found.', 404);
    const outside = { organizationId: { not: to } };
    const dropped: string[] = [];
    if (kind === 'agent') {
      const agent = await db.agent.findUnique({ where: { id }, select: { organizationId: true } });
      if (!agent) throw new OrganizationError('Agent not found.', 404);
      if (agent.organizationId === to) return { dropped, moved: false };
      const [assignments, grants, memberships] = await Promise.all([
        db.computerAssignment.findMany({ where: { agentId: id }, include: { computer: true } }),
        db.dmGrant.findMany({ where: { senderId: id, recipient: outside }, include: { recipient: true } }),
        db.groupMember.findMany({ where: { agentId: id, group: outside }, include: { group: true } }),
      ]);
      const crossing = assignments.filter(row => row.computer.organizationId !== to);
      dropped.push(
        ...crossing.map(row => `Computer ${row.computer.name}: no longer assigned`),
        ...grants.map(row => `DM with ${row.recipient.name}: no longer allowed`),
        ...memberships.map(row => `Group ${row.group.name}: no longer a member`),
      );
      if (!apply) return { dropped, moved: false };
      if (crossing.length) {
        const kept = assignments.filter(row => row.computer.organizationId === to).map(row => row.computerId);
        if (this.assign) await this.assign(id, kept);
        else await db.computerAssignment.deleteMany({ where: { agentId: id, computerId: { notIn: kept } } });
      }
      await db.$transaction([
        db.dmGrant.deleteMany({
          where: {
            OR: [
              { senderId: id, recipient: outside },
              { recipientId: id, sender: outside },
            ],
          },
        }),
        db.groupMember.deleteMany({ where: { agentId: id, group: outside } }),
        // Again here, with the move: an assignment made meanwhile cannot survive it (tools recheck assignment).
        db.computerAssignment.deleteMany({ where: { agentId: id, computer: outside } }),
        db.agent.update({ where: { id }, data: { organizationId: to } }),
      ]);
    } else if (kind === 'computer') {
      const computer = await db.computer.findUnique({ where: { id }, select: { organizationId: true } });
      if (!computer) throw new OrganizationError('Computer not found.', 404);
      if (computer.organizationId === to) return { dropped, moved: false };
      const crossing = await db.computerAssignment.findMany({
        where: { computerId: id, agent: outside },
        include: { agent: true },
      });
      dropped.push(...crossing.map(row => `Agent ${row.agent.name}: no longer assigned`));
      if (!apply) return { dropped, moved: false };
      for (const row of crossing) {
        const kept = (await db.computerAssignment.findMany({ where: { agentId: row.agentId } }))
          .map(item => item.computerId)
          .filter(computerId => computerId !== id);
        if (this.assign) await this.assign(row.agentId, kept);
        else
          await db.computerAssignment.delete({
            where: { agentId_computerId: { agentId: row.agentId, computerId: id } },
          });
      }
      await db.$transaction([
        db.computerAssignment.deleteMany({ where: { computerId: id, agent: outside } }),
        db.computer.update({ where: { id }, data: { organizationId: to } }),
      ]);
    } else {
      const group = await db.groupChat.findUnique({ where: { id }, select: { organizationId: true } });
      if (!group) throw new OrganizationError('Group not found.', 404);
      if (group.organizationId === to) return { dropped, moved: false };
      const crossing = await db.groupMember.findMany({
        where: { groupId: id, agent: outside },
        include: { agent: true },
      });
      dropped.push(...crossing.map(row => `Member ${row.agent.name}: removed from the group`));
      if (!apply) return { dropped, moved: false };
      await db.$transaction([
        db.groupMember.deleteMany({ where: { groupId: id, agent: outside } }),
        db.groupChat.update({ where: { id }, data: { organizationId: to } }),
      ]);
    }
    return { dropped, moved: true };
  }
}
