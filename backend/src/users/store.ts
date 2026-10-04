import type { PlatformStore } from '../platform-store';
import { hashPassword } from '../auth/sessions';
import { ADMIN_ID } from './reach';

export class UserError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

const cleanName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 64 || /[\u0000-\u001f\u007f]/.test(trimmed))
    throw new UserError('A name is 1–64 characters.');
  return trimmed;
};

/** RAM in use toward a cap: the computers of the organizations a person owns (unknown sizes count as nothing). */
export async function memoryInUse(platform: PlatformStore, ownerId: string, except?: string) {
  await platform.initialize();
  const sum = await platform.client.computer.aggregate({
    where: { organization: { ownerId }, ...(except ? { id: { not: except } } : {}) },
    _sum: { memoryGiB: true },
  });
  return sum._sum.memoryGiB ?? 0;
}

/**
 * Refuses a computer RAM size that would take its organization's owner over their cap (docs/users.md#accounts).
 * `computerId`: the computer being resized or moved in (its current size is replaced, not added).
 */
export async function checkMemoryCap(
  platform: PlatformStore,
  organizationId: string,
  memoryGiB: number,
  computerId?: string,
) {
  await platform.initialize();
  const owner = await platform.client.organization.findUnique({
    where: { id: organizationId },
    select: { owner: { select: { id: true, name: true, memoryLimitGiB: true } } },
  });
  const limit = owner?.owner.memoryLimitGiB;
  if (limit == null) return null;
  const used = await memoryInUse(platform, owner!.owner.id, computerId);
  return used + memoryGiB > limit
    ? `${owner!.owner.name}'s computers may have ${limit} GiB of RAM in total; ${used} GiB is already allocated.`
    : null;
}

/** Dashboard people (docs/users.md): admin creates users, sets their passwords, caps their RAM, disables, deletes. */
export class Users {
  constructor(
    private readonly platform: PlatformStore,
    /** A deleted person's endpoints, ChatGPT login and Discord accounts go with them (users/connections.ts). */
    private readonly forgetConnections: (userId: string) => Promise<void> = async () => {},
  ) {}

  private async client() {
    await this.platform.initialize();
    return this.platform.client;
  }

  async list() {
    const client = await this.client();
    const rows = await client.user.findMany({
      orderBy: { sequence: 'asc' },
      include: { organizations: { select: { id: true, name: true }, orderBy: { sequence: 'asc' } } },
    });
    return Promise.all(
      rows.map(async row => ({
        id: row.id,
        name: row.name,
        admin: row.role === 'admin',
        disabled: Boolean(row.disabledAt),
        memoryLimitGiB: row.memoryLimitGiB,
        memoryUsedGiB: await memoryInUse(this.platform, row.id),
        organizations: row.organizations,
        createdAt: row.createdAt.toISOString(),
      })),
    );
  }

  /** A new user with the password admin chose, and their organization "<name>'s Organization". */
  async create(input: { name: string; password: string; memoryLimitGiB?: number | null }) {
    const client = await this.client();
    const name = cleanName(input.name);
    if (await client.user.findUnique({ where: { name } })) throw new UserError('That name is taken.', 409);
    const passwordHash = await hashPassword(input.password);
    const user = await client.$transaction(async tx => {
      const created = await tx.user.create({
        data: {
          name,
          role: 'user',
          passwordHash,
          passwordChangedAt: new Date(),
          memoryLimitGiB: input.memoryLimitGiB ?? null,
        },
      });
      await tx.organization.create({ data: { name: `${name}'s Organization`.slice(0, 60), ownerId: created.id } });
      return created;
    });
    return user.id;
  }

  /** Password, disabling and the RAM cap; a new password or disabling signs them out everywhere. */
  async update(id: string, change: { password?: string; disabled?: boolean; memoryLimitGiB?: number | null }) {
    const client = await this.client();
    const user = await client.user.findUnique({ where: { id } });
    if (!user) throw new UserError('User not found.', 404);
    if (user.role === 'admin' && (change.disabled !== undefined || change.memoryLimitGiB !== undefined))
      throw new UserError('The admin account cannot be disabled or capped.', 403);
    const data: {
      passwordHash?: string;
      passwordChangedAt?: Date;
      disabledAt?: Date | null;
      memoryLimitGiB?: number | null;
    } = {};
    if (change.password !== undefined) {
      data.passwordHash = await hashPassword(change.password);
      data.passwordChangedAt = new Date();
    }
    if (change.disabled !== undefined) data.disabledAt = change.disabled ? (user.disabledAt ?? new Date()) : null;
    if (change.memoryLimitGiB !== undefined) data.memoryLimitGiB = change.memoryLimitGiB;
    const signOut = change.password !== undefined || change.disabled === true;
    const [ended] = await client.$transaction([
      client.userSession.findMany({
        where: signOut ? { userId: id } : { userId: '\u0000' },
        select: { tokenHash: true },
      }),
      client.user.update({ where: { id }, data }),
      client.userSession.deleteMany({ where: signOut ? { userId: id } : { userId: '\u0000' } }),
    ]);
    return { name: user.name, ended: ended.map(session => session.tokenHash) };
  }

  /** Deletes a user: their organizations (and everything in them) become admin's; their connections go. */
  async remove(id: string) {
    const client = await this.client();
    const user = await client.user.findUnique({ where: { id } });
    if (!user) throw new UserError('User not found.', 404);
    if (user.role === 'admin') throw new UserError('The admin account cannot be deleted.', 403);
    const ended = await client.userSession.findMany({ where: { userId: id }, select: { tokenHash: true } });
    await client.$transaction([
      // Their agents' endpoints were theirs: cleared, so none runs on admin's endpoint of the same name unasked.
      client.agent.updateMany({
        where: { organization: { ownerId: id }, endpointId: { not: 'provider:openai-codex' } },
        data: { endpointId: '' },
      }),
      client.organization.updateMany({ where: { ownerId: id }, data: { ownerId: ADMIN_ID } }),
      client.discordAccount.deleteMany({ where: { userId: id } }),
      client.user.delete({ where: { id } }),
    ]);
    await this.forgetConnections(id);
    return { name: user.name, ended: ended.map(session => session.tokenHash) };
  }
}
