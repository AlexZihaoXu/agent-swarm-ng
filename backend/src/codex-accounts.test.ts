import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthInteraction } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { CodexProvider, codexAccountOf, codexConnectionId, codexFiles, identityOf } from './codex-provider';
import { CodexAccounts } from './codex-accounts';
import { ConnectionError } from './chat-connection';
import { Connections } from './users/connections';
import { registerCodex } from './codex-routes';
import { providerFailure } from './activity-safety';

const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.PRIVATE-SIGNATURE`;
const token = (email: string, user: string) =>
  jwt({
    'https://api.openai.com/profile': { email },
    'https://api.openai.com/auth': { chatgpt_plan_type: 'plus', chatgpt_account_user_id: user },
  });

/** A ChatGPT login whose sign-in completes at once as `who` (set before starting it). */
function login() {
  let access: string | undefined;
  const state = { who: token('a@example.com', 'user-a') };
  const runtime = {
    listCredentials: async () => (access ? [{ providerId: 'openai-codex', type: 'oauth' }] : []),
    getModels: () => [{ id: 'test-codex' }],
    refresh: async () => ({ aborted: false, errors: new Map() }),
    getAuth: async () => (access ? { auth: { apiKey: access } } : undefined),
    login: vi.fn(async (_provider: string, _type: string, value: AuthInteraction) => {
      value.notify({ type: 'device_code', userCode: 'CODE', verificationUri: 'https://auth.openai.com/codex/device' });
      access = state.who;
    }),
    logout: vi.fn(async () => {
      access = undefined;
    }),
  };
  return { state, runtime, codex: new CodexProvider(async () => runtime as unknown as ModelRuntime) };
}

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function setup() {
  directory = await mkdtemp(join(tmpdir(), 'codex-accounts-'));
  const logins = new Map<string, ReturnType<typeof login>>();
  const make = (owner: string, account: string) => {
    const made = login();
    logins.set(`${owner}/${account}`, made);
    return made.codex;
  };
  const first = login();
  logins.set('admin/', first);
  const connections = new Connections(
    { readFor: async () => [] } as never,
    { ownerOfAgent: async () => 'admin' } as never,
    first.codex,
    make,
    new CodexAccounts(join(directory, 'openai-accounts.json')),
  );
  const app = Fastify();
  registerCodex(app, connections);
  return { app, connections, logins };
}

describe('several ChatGPT accounts per person', () => {
  it('names each account by its own connection id and files', () => {
    expect(codexConnectionId()).toBe('provider:openai-codex');
    expect(codexConnectionId('0a1b2c3d')).toBe('provider:openai-codex:0a1b2c3d');
    expect(codexAccountOf('provider:openai-codex')).toBe('');
    expect(codexAccountOf('provider:openai-codex:0a1b2c3d')).toBe('0a1b2c3d');
    expect(codexAccountOf('provider:openai-codex:../x')).toBeUndefined();
    expect(codexAccountOf('endpoint-1')).toBeUndefined();
    expect(codexFiles('admin')).toEqual({ auth: 'openai-auth.json', models: 'openai-models.json' });
    expect(codexFiles('u1', '0a1b2c3d')).toEqual({
      auth: 'openai-auth-u1.0a1b2c3d.json',
      models: 'openai-models-u1.0a1b2c3d.json',
    });
    expect(identityOf(token('a@example.com', 'user-a'))).toEqual({
      email: 'a@example.com',
      plan: 'plus',
      user: 'user-a',
    });
    expect(identityOf('not a token')).toEqual({});
  });

  it('adds, signs in, lists and removes accounts, each its own connection; one account is not signed in twice', async () => {
    const { app, connections, logins } = await setup();
    try {
      await app.inject({ method: 'POST', url: '/api/providers/openai-codex/login', payload: {} });
      await vi.waitFor(async () =>
        expect((await app.inject('/api/providers/openai-codex')).json()).toMatchObject({
          connected: true,
          email: 'a@example.com',
          plan: 'plus',
        }),
      );
      const added = await app.inject({ method: 'POST', url: '/api/providers/openai-codex/accounts', payload: {} });
      expect(added.statusCode).toBe(200);
      const second = added.json().accounts[1];
      expect(second).toMatchObject({ connected: false, endpointId: `provider:openai-codex:${second.account}` });

      // The same ChatGPT account on the second card is refused and signed out again.
      const url = `/api/providers/openai-codex/login?account=${second.account}`;
      await app.inject({ method: 'POST', url, payload: {} });
      await vi.waitFor(async () =>
        expect((await app.inject(`/api/providers/openai-codex?account=${second.account}`)).json()).toMatchObject({
          connected: false,
          login: { state: 'error', message: expect.stringContaining('already') },
        }),
      );
      logins.get(`admin/${second.account}`)!.state.who = token('b@example.com', 'user-b');
      await app.inject({ method: 'POST', url, payload: {} });
      await vi.waitFor(async () =>
        expect((await app.inject('/api/providers/openai-codex/accounts')).json().accounts).toMatchObject([
          { account: '', email: 'a@example.com', connected: true },
          { account: second.account, email: 'b@example.com', connected: true, models: ['test-codex'] },
        ]),
      );
      const listed = (await app.inject('/api/providers/openai-codex/accounts')).body;
      expect(listed).not.toContain('PRIVATE');

      // An agent reaches the second account by its id; once removed, that row is unreachable.
      const connection = await connections.forEndpoint('agent', second.endpointId, new AbortController().signal);
      expect(connection.subscriptionRuntime).toBeDefined();
      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/providers/openai-codex/accounts/${second.account}`,
      });
      expect(removed.json().accounts).toHaveLength(1);
      expect(logins.get(`admin/${second.account}`)!.runtime.logout).toHaveBeenCalled();
      await expect(
        connections.forEndpoint('agent', second.endpointId, new AbortController().signal),
      ).rejects.toBeInstanceOf(ConnectionError);
      expect((await app.inject(`/api/providers/openai-codex?account=${second.account}`)).statusCode).toBe(404);
      expect(
        (await app.inject({ method: 'DELETE', url: `/api/providers/openai-codex/accounts/${second.account}` }))
          .statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('caps the accounts a person may have', async () => {
    const { app } = await setup();
    try {
      for (let index = 1; index < 5; index++)
        expect(
          (await app.inject({ method: 'POST', url: '/api/providers/openai-codex/accounts', payload: {} })).statusCode,
        ).toBe(200);
      const over = await app.inject({ method: 'POST', url: '/api/providers/openai-codex/accounts', payload: {} });
      expect(over.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('calls a ChatGPT usage limit what it is', () => {
    expect(providerFailure('You have hit your ChatGPT usage limit (plus plan). Try again in ~42 min.').category).toBe(
      'usage limit',
    );
  });
});
