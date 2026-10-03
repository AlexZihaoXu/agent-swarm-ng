import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import { hostname } from '../host-policy';
import type { AuditLog } from '../audit/store';
import type { SignInGuard } from '../security/guard';
import {
  Accounts,
  PASSWORD_MAX,
  PASSWORD_MIN,
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_DAYS,
  type SignedIn,
} from './sessions';

/** Reachable without signing in. Everything else (any path, WebSocket upgrades included) needs a session. */
// Sign-out too: it must clear every cookie even when the one that answers first has expired.
const PUBLIC = new Set(['/api/health', '/api/auth/session', '/api/auth/login', '/api/auth/setup', '/api/auth/logout']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const WINDOW = 15 * 60 * 1000;
/** Wrong passwords per account from one address, per address, and per account from everywhere (a slow, distributed
 * guess). The first two cannot lock the owner out from another address; the third only after many attempts. */
const MAX_PER_PAIR = 10;
const MAX_PER_ADDRESS = 30;
const MAX_PER_ACCOUNT = 100;
/** Password hashing is deliberately slow: at most this many run at once, so a burst cannot exhaust the CPU. */
const MAX_HASHING = 4;
const MAX_TRACKED = 10_000;

declare module 'fastify' {
  interface FastifyRequest {
    signedIn?: SignedIn;
    /** Sign-in events for the audit log: the kind, the name given, and why it was refused. */
    authEvent?: { kind: string; actor: string; reason?: string };
  }
  interface FastifyInstance {
    /** Closes a long-lived stream when its session ends; returns the unwatch. */
    watchSession: (request: FastifyRequest, close: () => void) => () => void;
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
  Type.Object({
    signedIn: Type.Literal(false),
    setupRequired: Type.Boolean(),
    name: Type.Optional(Type.String()),
    /** Locked down, and this address is not trusted: signing in will be refused. */
    lockedDown: Type.Optional(Type.Boolean()),
  }),
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

  /** Counted before the password is checked, so concurrent guesses cannot all slip under the limit. */
  record(keys: string[], now = Date.now()) {
    for (const key of keys) {
      const kept = this.recent(key, now);
      // Re-inserted, so an address being limited is the newest entry and the last to be forgotten.
      this.attempts.delete(key);
      this.attempts.set(key, [...kept, now]);
    }
    // Bounded memory: forget the oldest entries (Map keeps insertion order).
    for (const key of this.attempts.keys()) {
      if (this.attempts.size <= MAX_TRACKED) break;
      this.attempts.delete(key);
    }
    return now;
  }

  /** A correct password: that attempt does not count, and this address may try this account afresh. */
  forgive(keys: string[], at: number, clear: string) {
    for (const key of keys) {
      const kept = this.attempts.get(key)?.filter(time => time !== at);
      if (kept?.length) this.attempts.set(key, kept);
      else this.attempts.delete(key);
    }
    this.attempts.delete(clear);
  }
}

/** Ends a session's open streams (run events, terminals) when it is signed out, its password changes or a host reset
 * removes it. Logout and password changes end them at once; a periodic check catches host resets. */
class SessionStreams {
  private readonly open = new Map<string, Set<() => void>>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly accounts: Accounts) {}

  watch(signedIn: SignedIn | undefined, close: () => void) {
    if (!signedIn) return () => {};
    const closers = this.open.get(signedIn.tokenHash) ?? new Set();
    closers.add(close);
    this.open.set(signedIn.tokenHash, closers);
    this.timer ??= setInterval(() => void this.recheck(), 60_000);
    this.timer.unref?.();
    return () => {
      closers.delete(close);
      if (!closers.size) this.open.delete(signedIn.tokenHash);
      if (!this.open.size) this.stop();
    };
  }

  end(tokenHashes: string[]) {
    for (const hash of tokenHashes) {
      const closers = this.open.get(hash);
      this.open.delete(hash);
      for (const close of closers ?? []) close();
    }
    if (!this.open.size) this.stop();
  }

  private async recheck() {
    const ended: string[] = [];
    for (const hash of this.open.keys()) if (!(await this.accounts.isValid(hash).catch(() => true))) ended.push(hash);
    this.end(ended);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

function cookieValue(header: string | undefined, name: string) {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** The browser's address: Caddy, the only way in, sets X-Real-IP (resolved through trusted proxies such as a public
 * reverse proxy) and otherwise puts it last in X-Forwarded-For. */
export function clientAddress(request: FastifyRequest) {
  const real = request.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  const forwarded = request.headers['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',').pop()?.trim();
  return last || request.ip;
}

const secure = (request: FastifyRequest) => request.headers['x-forwarded-proto'] === 'https';

// The HTTPS origin uses its own __Secure- cookie, so it never collides with the plain one the HTTP origin sets.
const cookieName = (request: FastifyRequest) => (secure(request) ? SECURE_SESSION_COOKIE : SESSION_COOKIE);

function sessionToken(request: FastifyRequest) {
  const header = request.headers.cookie;
  return (
    (secure(request) ? cookieValue(header, SECURE_SESSION_COOKIE) : undefined) ?? cookieValue(header, SESSION_COOKIE)
  );
}

function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string) {
  reply.header(
    'set-cookie',
    `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure(request) ? '; Secure' : ''}`,
  );
}

/** Every session cookie this browser sends here: on HTTPS also the plain one the HTTP origin set (same host). */
function sessionTokens(request: FastifyRequest) {
  const header = request.headers.cookie;
  const names = secure(request) ? [SECURE_SESSION_COOKIE, SESSION_COOKIE] : [SESSION_COOKIE];
  return names.map(name => cookieValue(header, name)).filter((token): token is string => Boolean(token));
}

function clearSessionCookie(request: FastifyRequest, reply: FastifyReply) {
  // On HTTPS both names go (a Secure clear also removes an older Secure cookie of the plain name).
  const names = secure(request) ? [SECURE_SESSION_COOKIE, SESSION_COOKIE] : [SESSION_COOKIE];
  reply.header(
    'set-cookie',
    names.map(name => `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure(request) ? '; Secure' : ''}`),
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
 * GET /api/auth/check is what Caddy asks before letting a browser reach a computer's desktop stream. Returns the
 * stream watch: long-lived streams call it so they close when their session ends.
 */
export function registerAuth(
  app: FastifyInstance,
  accounts: Accounts,
  { requireLogin, audit, guard }: { requireLogin: boolean; audit?: AuditLog; guard?: SignInGuard },
) {
  const failures = new Failures();
  const streams = new SessionStreams(accounts);
  app.addHook('onClose', async () => streams.stop());
  let hashing = 0;
  /** Runs a password check unless too many already are; null when busy. */
  const hash = async <T>(work: () => Promise<T>): Promise<T | null> => {
    if (hashing >= MAX_HASHING) return null;
    hashing++;
    try {
      return await work();
    } finally {
      hashing--;
    }
  };
  // Every sign-in, setup, sign-out and password change goes to the audit log: who (the name given), from where, when
  // (to the millisecond), and whether it worked (ok), was refused (failed) or held back by the limits (denied).
  // Attempts refused before their handler ran (malformed body, another site, an unknown host name) count too.
  const ATTEMPTS: Record<string, string> = { '/api/auth/login': 'auth.login', '/api/auth/setup': 'auth.setup' };
  // A flood of refused attempts from one address must not push real history out of the log: at most 30 such events per
  // address in 15 minutes, then one note that further ones go unlogged until the window moves on.
  const refusedLogged = new Failures();
  app.addHook('onResponse', async (request, reply) => {
    const early = ATTEMPTS[request.routeOptions.url ?? ''];
    const given = (request.body as { name?: unknown } | undefined)?.name;
    const event =
      request.authEvent ??
      (early && request.method === 'POST'
        ? {
            kind: early,
            actor: typeof given === 'string' ? given.trim() : '(not given)',
            reason:
              reply.statusCode === 403
                ? 'refused: another site or host name'
                : `refused: invalid request (${reply.statusCode})`,
          }
        : undefined);
    if (!event || !audit) return;
    const ip = clientAddress(request);
    if (reply.statusCode >= 300) {
      const key = `logged:${ip}`;
      if (refusedLogged.wait([[key, 31]])) return;
      refusedLogged.record([key]);
      if (refusedLogged.wait([[key, 31]])) {
        event.reason = `${event.reason ?? 'refused'}; further refused attempts from this address go unlogged for up to 15 minutes`;
      }
    }
    await audit.record(
      {
        kind: event.kind,
        outcome:
          reply.statusCode < 300 ? 'ok' : reply.statusCode === 429 || reply.statusCode === 423 ? 'denied' : 'failed',
        actor: event.actor.slice(0, 64),
        ip,
        detail: event.reason ? { reason: event.reason } : undefined,
      },
      new Date(Date.now() - reply.elapsedTime),
    );
  });
  const note = (request: FastifyRequest, reason: string) => {
    if (request.authEvent) request.authEvent.reason = reason;
  };
  const busy = (reply: FastifyReply) =>
    reply.header('retry-after', '2').code(429).send({ message: 'The dashboard is busy. Try again in a moment.' });

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    const upgrade = (request.headers.upgrade ?? '').toLowerCase() === 'websocket';
    if ((!SAFE_METHODS.has(request.method) || upgrade) && crossOrigin(request))
      return reply.code(403).send({ message: 'Requests from another site are not allowed.' });
    const signedIn = await accounts.session(sessionToken(request));
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
      if (waiting) return { signedIn: false, setupRequired: true, name: waiting.name };
      const lockedDown = guard ? await guard.refuses(clientAddress(request)) : false;
      return { signedIn: false, setupRequired: false, ...(lockedDown ? { lockedDown } : {}) };
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
      request.authEvent = { kind: 'auth.setup', actor: name.trim() };
      const waiting = await accounts.awaitingSetup();
      if (!waiting) {
        note(request, 'password already set');
        return reply.code(409).send({ message: 'The password is already set. Sign in instead.' });
      }
      if (name.trim() !== waiting.name) {
        note(request, 'not the account awaiting setup');
        return reply.code(400).send({ message: `Set the password of ${waiting.name}.` });
      }
      const set = await hash(() => accounts.setFirstPassword(waiting.id, password));
      if (set === null) {
        note(request, 'busy');
        return busy(reply);
      }
      if (!set) {
        note(request, 'password already set');
        return reply.code(409).send({ message: 'The password is already set. Sign in instead.' });
      }
      return signIn(request, reply, waiting.id, waiting.name);
    },
  );

  app.post(
    '/api/auth/login',
    {
      schema: {
        operationId: 'signIn',
        body: SignInCredentials,
        response: { 200: SignedInResponse, 401: Message, 423: Message, 429: Message },
      },
    },
    async (request, reply) => {
      const { name, password } = request.body as Static<typeof SignInCredentials>;
      const ip = clientAddress(request);
      request.authEvent = { kind: 'auth.login', actor: name.trim() };
      const account = `account:${name.trim().toLowerCase()}`;
      const address = `address:${clientAddress(request)}`;
      const pair = `${account}|${address}`;
      const wait = failures.wait([
        [pair, MAX_PER_PAIR],
        [address, MAX_PER_ADDRESS],
        [account, MAX_PER_ACCOUNT],
      ]);
      if (wait) {
        note(request, 'too many wrong passwords');
        reply.header('retry-after', String(wait));
        return reply.code(429).send({ message: `Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} min.` });
      }
      if (guard && (await guard.refuses(ip))) {
        note(request, 'locked down: not a trusted address');
        return reply.code(423).send({
          message:
            'Sign-in is locked down after many failed attempts. Sign in from a trusted address, or have the host unlock it.',
        });
      }
      if (hashing >= MAX_HASHING) {
        note(request, 'busy');
        return busy(reply);
      }
      const at = failures.record([pair, address, account]);
      const user = await hash(() => accounts.verify(name.trim(), password));
      if (user === null) {
        note(request, 'wrong name or password');
        await guard?.failed(ip, name.trim()).catch(() => undefined);
        return reply.code(401).send({ message: 'Wrong name or password.' });
      }
      failures.forgive([address, account], at, pair);
      await guard?.succeeded(ip, user.name).catch(() => undefined);
      return signIn(request, reply, user.id, user.name);
    },
  );

  app.post(
    '/api/auth/logout',
    { schema: { operationId: 'signOut', response: { 200: Type.Object({ signedIn: Type.Literal(false) }) } } },
    async (request, reply) => {
      if (request.signedIn) request.authEvent = { kind: 'auth.logout', actor: request.signedIn.name };
      // Signing out ends every session this browser holds here, not only the one that answered.
      const ended = await accounts.endTokens(sessionTokens(request));
      streams.end(ended);
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
      request.authEvent = { kind: 'auth.password', actor: signedIn.name };
      const key = `password:${signedIn.tokenHash}`;
      const wait = failures.wait([[key, MAX_PER_PAIR]]);
      if (wait) {
        note(request, 'too many wrong passwords');
        reply.header('retry-after', String(wait));
        return reply.code(429).send({ message: `Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} min.` });
      }
      if (hashing >= MAX_HASHING) {
        note(request, 'busy');
        return busy(reply);
      }
      const at = failures.record([key]);
      const correct = await hash(() => accounts.verifyUser(signedIn.userId, current));
      if (!correct) {
        note(request, 'current password wrong');
        return reply.code(403).send({ message: 'The current password is wrong.' });
      }
      failures.forgive([], at, key);
      const ended = await hash(() => accounts.changePassword(signedIn.userId, password, signedIn.tokenHash));
      if (ended === null) return busy(reply);
      streams.end(ended);
      return { signedIn: true as const, name: signedIn.name };
    },
  );

  app.get('/api/auth/check', { schema: { hide: true } }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    // Browsers always send Origin on a WebSocket handshake: another site's page must not open a desktop.
    if (crossOrigin(request)) return reply.code(403).send({ message: 'Requests from another site are not allowed.' });
    return request.signedIn ? reply.code(204).send() : reply.code(401).send({ message: 'Sign in first.' });
  });

  return (request: FastifyRequest, close: () => void) => streams.watch(request.signedIn, close);
}
