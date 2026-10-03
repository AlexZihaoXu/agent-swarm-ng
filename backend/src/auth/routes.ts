import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { hostname } from '../host-policy';
import { Accounts, PASSWORD_MAX, PASSWORD_MIN, SESSION_COOKIE, SESSION_DAYS, type SignedIn } from './sessions';

/** Reachable without signing in. Everything else (any path, WebSocket upgrades included) needs a session. */
const PUBLIC = new Set(['/api/health', '/api/auth/session', '/api/auth/login', '/api/auth/setup']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const WINDOW = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 10;
const MAX_PER_ADDRESS = 30;

declare module 'fastify' {
  interface FastifyRequest {
    signedIn?: SignedIn;
  }
}

const Password = Type.String({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX });
const Credentials = Type.Object({ name: Type.String({ minLength: 1, maxLength: 64 }), password: Password });
const SignInCredentials = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 64 }),
  password: Type.String({ minLength: 1, maxLength: PASSWORD_MAX }),
});
const PasswordChange = Type.Object({
  current: Type.String({ minLength: 1, maxLength: PASSWORD_MAX }),
  password: Password,
});
const SessionState = Type.Union([
  Type.Object({ signedIn: Type.Literal(true), name: Type.String() }),
  Type.Object({ signedIn: Type.Literal(false), setupRequired: Type.Boolean(), name: Type.Optional(Type.String()) }),
]);
const Message = Type.Object({ message: Type.String() });
const SignedInResponse = Type.Object({ signedIn: Type.Literal(true), name: Type.String() });

/** Failed sign-ins in a sliding window, per account and per client address. In memory: a restart forgets them. */
class Failures {
  private readonly attempts = new Map<string, number[]>();

  private recent(key: string, now: number) {
    const kept = (this.attempts.get(key) ?? []).filter(time => now - time < WINDOW);
    if (kept.length) this.attempts.set(key, kept);
    else this.attempts.delete(key);
    return kept;
  }

  /** Seconds until another attempt is allowed, or 0. */
  wait(keys: [string, number][], now = Date.now()) {
    let seconds = 0;
    for (const [key, max] of keys) {
      const kept = this.recent(key, now);
      if (kept.length >= max) seconds = Math.max(seconds, Math.ceil((kept[0]! + WINDOW - now) / 1000));
    }
    return seconds;
  }

  record(keys: string[], now = Date.now()) {
    for (const key of keys) this.attempts.set(key, [...this.recent(key, now), now]);
  }

  clear(key: string) {
    this.attempts.delete(key);
  }
}

function cookieValue(header: string | undefined, name: string) {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** The browser's address: Caddy, the only way in, puts it last in X-Forwarded-For. */
function clientAddress(request: FastifyRequest) {
  const forwarded = request.headers['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',').pop()?.trim();
  return last || request.ip;
}

const secure = (request: FastifyRequest) => request.headers['x-forwarded-proto'] === 'https';

function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string) {
  reply.header(
    'set-cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure(request) ? '; Secure' : ''}`,
  );
}

function clearSessionCookie(request: FastifyRequest, reply: FastifyReply) {
  reply.header(
    'set-cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure(request) ? '; Secure' : ''}`,
  );
}

/** A cross-site page must not change anything, even with SameSite cookies: its Origin must be this dashboard. */
function crossOrigin(request: FastifyRequest) {
  const origin = request.headers.origin;
  if (origin === undefined) return false;
  try {
    return (
      hostname(new URL(origin).host) === null ||
      new URL(origin).host.toLowerCase() !== (request.headers.host ?? '').toLowerCase()
    );
  } catch {
    return true;
  }
}

/**
 * Dashboard sign-in. With requireLogin every request needs a session cookie except health and the sign-in endpoints;
 * GET /api/auth/check is what Caddy asks before letting a browser reach a computer's desktop stream.
 */
export function registerAuth(app: FastifyInstance, accounts: Accounts, { requireLogin }: { requireLogin: boolean }) {
  const failures = new Failures();

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    const upgrade = (request.headers.upgrade ?? '').toLowerCase() === 'websocket';
    if ((!SAFE_METHODS.has(request.method) || upgrade) && crossOrigin(request))
      return reply.code(403).send({ message: 'Requests from another site are not allowed.' });
    const signedIn = await accounts.session(cookieValue(request.headers.cookie, SESSION_COOKIE));
    if (signedIn) request.signedIn = signedIn;
    if (requireLogin && !signedIn && !PUBLIC.has(path)) {
      reply.header('cache-control', 'no-store');
      return reply.code(401).send({ message: 'Sign in first.' });
    }
  });

  const signIn = async (request: FastifyRequest, reply: FastifyReply, userId: string, name: string) => {
    setSessionCookie(request, reply, await accounts.startSession(userId));
    reply.header('cache-control', 'no-store');
    return { signedIn: true as const, name };
  };

  app.get(
    '/api/auth/session',
    { schema: { operationId: 'getAuthSession', response: { 200: SessionState } } },
    async (request, reply): Promise<Static<typeof SessionState>> => {
      reply.header('cache-control', 'no-store');
      if (request.signedIn) return { signedIn: true, name: request.signedIn.name };
      const waiting = await accounts.awaitingSetup();
      return waiting
        ? { signedIn: false, setupRequired: true, name: waiting.name }
        : { signedIn: false, setupRequired: false };
    },
  );

  app.post(
    '/api/auth/setup',
    {
      schema: {
        operationId: 'setUpAuth',
        body: Credentials,
        response: { 200: SignedInResponse, 400: Message, 409: Message },
      },
    },
    async (request, reply) => {
      const { name, password } = request.body as Static<typeof Credentials>;
      const waiting = await accounts.awaitingSetup();
      if (!waiting) return reply.code(409).send({ message: 'The password is already set. Sign in instead.' });
      if (name.trim() !== waiting.name)
        return reply.code(400).send({ message: `Set the password of ${waiting.name}.` });
      if (!(await accounts.setFirstPassword(waiting.id, password)))
        return reply.code(409).send({ message: 'The password is already set. Sign in instead.' });
      return signIn(request, reply, waiting.id, waiting.name);
    },
  );

  app.post(
    '/api/auth/login',
    {
      schema: {
        operationId: 'signIn',
        body: SignInCredentials,
        response: { 200: SignedInResponse, 401: Message, 429: Message },
      },
    },
    async (request, reply) => {
      const { name, password } = request.body as Static<typeof SignInCredentials>;
      const account = `account:${name.trim().toLowerCase()}`;
      const address = `address:${clientAddress(request)}`;
      const wait = failures.wait([
        [account, MAX_PER_ACCOUNT],
        [address, MAX_PER_ADDRESS],
      ]);
      if (wait) {
        reply.header('retry-after', String(wait));
        return reply.code(429).send({ message: `Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} min.` });
      }
      const user = await accounts.verify(name.trim(), password);
      if (!user) {
        failures.record([account, address]);
        return reply.code(401).send({ message: 'Wrong name or password.' });
      }
      failures.clear(account);
      return signIn(request, reply, user.id, user.name);
    },
  );

  app.post(
    '/api/auth/logout',
    { schema: { operationId: 'signOut', response: { 200: Type.Object({ signedIn: Type.Literal(false) }) } } },
    async (request, reply) => {
      if (request.signedIn) await accounts.endSession(request.signedIn.tokenHash);
      clearSessionCookie(request, reply);
      return { signedIn: false as const };
    },
  );

  app.post(
    '/api/auth/password',
    {
      schema: {
        operationId: 'changePassword',
        body: PasswordChange,
        response: { 200: SignedInResponse, 401: Message, 403: Message, 429: Message },
      },
    },
    async (request, reply) => {
      const signedIn = request.signedIn;
      if (!signedIn) return reply.code(401).send({ message: 'Sign in first.' });
      const { current, password } = request.body as Static<typeof PasswordChange>;
      const account = `account:${signedIn.name.toLowerCase()}`;
      const wait = failures.wait([[account, MAX_PER_ACCOUNT]]);
      if (wait) {
        reply.header('retry-after', String(wait));
        return reply.code(429).send({ message: `Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} min.` });
      }
      if (!(await accounts.verifyUser(signedIn.userId, current))) {
        failures.record([account]);
        return reply.code(403).send({ message: 'The current password is wrong.' });
      }
      await accounts.changePassword(signedIn.userId, password, signedIn.tokenHash);
      return { signedIn: true as const, name: signedIn.name };
    },
  );

  app.get('/api/auth/check', { schema: { hide: true } }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return request.signedIn ? reply.code(204).send() : reply.code(401).send({ message: 'Sign in first.' });
  });
}
