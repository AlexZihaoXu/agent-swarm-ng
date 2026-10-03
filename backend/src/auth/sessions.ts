import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { PlatformStore } from '../platform-store';

export const SESSION_COOKIE = 'swarm_session';
export const SESSION_DAYS = 30;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;
const DAY = 24 * 60 * 60 * 1000;
/** A session's expiry slides forward at most this often, so most requests only read. */
const TOUCH_EVERY = 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// scrypt (RFC 7914) with OWASP's minimum cost: N=2^17, r=8, p=1 (128 MiB, about a quarter second per check).
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const scrypt = (password: string, salt: Buffer, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password.normalize('NFKC'), salt, 32, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

/** `scrypt$N$r$p$salt$key` (base64url), so the cost can rise later without breaking older hashes. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string) {
  const [kind, N, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  }).catch(() => null);
  return actual !== null && actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type SignedIn = { userId: string; name: string; tokenHash: string };

/** Dashboard users and their signed-in browsers. Passwords are scrypt hashes; session tokens are stored hashed. */
export class Accounts {
  // Verifying against this keeps an unknown name as slow as a wrong password.
  private dummy: Promise<string> | undefined;

  constructor(private readonly platform: PlatformStore) {}

  private async client() {
    await this.platform.initialize();
    return this.platform.client;
  }

  /** The account still waiting for its first password (the default "Admin"), if any. */
  async awaitingSetup() {
    const client = await this.client();
    return client.user.findFirst({
      where: { passwordHash: null },
      orderBy: { sequence: 'asc' },
      select: { id: true, name: true },
    });
  }

  /** Sets the first password of a passwordless account; false when it already has one (someone was first). */
  async setFirstPassword(userId: string, password: string) {
    const client = await this.client();
    const passwordHash = await hashPassword(password);
    const done = await client.user.updateMany({
      where: { id: userId, passwordHash: null },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
    return done.count === 1;
  }

  /** The user for these credentials, or null. Takes about as long for an unknown name as for a wrong password. */
  async verify(name: string, password: string) {
    const client = await this.client();
    const user = await client.user.findUnique({ where: { name } });
    if (!user?.passwordHash) {
      this.dummy ??= hashPassword('not a real password');
      await verifyPassword(password, await this.dummy);
      return null;
    }
    return (await verifyPassword(password, user.passwordHash)) ? user : null;
  }

  async verifyUser(userId: string, password: string) {
    const client = await this.client();
    const user = await client.user.findUnique({ where: { id: userId } });
    return user?.passwordHash ? verifyPassword(password, user.passwordHash) : false;
  }

  /** Sets a new password and signs out every other browser of that user. */
  async changePassword(userId: string, password: string, keepTokenHash: string) {
    const client = await this.client();
    const passwordHash = await hashPassword(password);
    await client.$transaction([
      client.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date() } }),
      client.userSession.deleteMany({ where: { userId, tokenHash: { not: keepTokenHash } } }),
    ]);
  }

  /** A new session; returns the cookie's token (only its hash is stored). Expired sessions are cleared on the way. */
  async startSession(userId: string) {
    const client = await this.client();
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await client.userSession.deleteMany({ where: { expiresAt: { lt: now } } });
    await client.userSession.create({
      data: { tokenHash: hashToken(token), userId, expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY) },
    });
    return token;
  }

  async session(token: string | undefined): Promise<SignedIn | null> {
    if (!token || token.length > 100) return null;
    const client = await this.client();
    const tokenHash = hashToken(token);
    const found = await client.userSession.findUnique({
      where: { tokenHash },
      include: { user: { select: { name: true } } },
    });
    const now = Date.now();
    if (!found) return null;
    if (found.expiresAt.getTime() <= now) {
      await client.userSession.deleteMany({ where: { tokenHash } });
      return null;
    }
    if (now - found.lastSeenAt.getTime() > TOUCH_EVERY)
      await client.userSession.updateMany({
        where: { tokenHash },
        data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_DAYS * DAY) },
      });
    return { userId: found.userId, name: found.user.name, tokenHash };
  }

  async endSession(tokenHash: string) {
    const client = await this.client();
    await client.userSession.deleteMany({ where: { tokenHash } });
  }

  /** Host-side reset (scripts/reset-password.ts): forgets the password and signs everyone out; the next visit sets it. */
  async resetPassword(name: string) {
    const client = await this.client();
    const user = await client.user.findUnique({ where: { name } });
    if (!user) return false;
    await client.$transaction([
      client.user.update({ where: { id: user.id }, data: { passwordHash: null, passwordChangedAt: null } }),
      client.userSession.deleteMany({ where: { userId: user.id } }),
    ]);
    return true;
  }
}
