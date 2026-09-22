import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthInteraction } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, InMemoryModelsStore, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { createChatSession } from './chat-runtime';
import { CodexProvider } from './codex-provider';
import { registerCodex } from './codex-routes';

function fixture() {
  let connected = false;
  let interaction!: AuthInteraction;
  let complete!: () => void;
  const runtime = {
    listCredentials: async () => connected ? [{ providerId: 'openai-codex', type: 'oauth' }] : [],
    getModels: () => [{ id: 'test-codex' }],
    refresh: vi.fn(async () => ({ aborted: false, errors: new Map() })),
    login: vi.fn(async (_provider, _type, value: AuthInteraction) => {
      interaction = value;
      expect(await value.prompt({ type: 'select', message: 'Method', options: [{ id: 'device_code', label: 'Device' }] })).toBe('device_code');
      value.notify({ type: 'device_code', userCode: 'TEST-CODE', verificationUri: 'https://auth.openai.com/codex/device' });
      await new Promise<void>((resolve, reject) => { complete = resolve; value.signal?.addEventListener('abort', () => reject(new Error('PRIVATE TOKEN')), { once: true }); });
      connected = true;
      return { access: 'PRIVATE TOKEN', refresh: 'PRIVATE REFRESH' };
    }),
    logout: vi.fn(async () => { connected = false; }),
  };
  const codex = new CodexProvider(async () => runtime as unknown as ModelRuntime);
  return { codex, runtime, complete: () => complete(), interaction: () => interaction };
}

describe('ChatGPT subscription connection', () => {
  it('refreshes and deduplicates the catalog, validates new model capabilities, and retains models on refresh failure', async () => {
    let models = [{ id: 'bundled-model', reasoning: false, thinkingLevelMap: {} }];
    let fail = false;
    const runtime = {
      listCredentials: async () => [{ providerId: 'openai-codex', type: 'oauth' }],
      getModels: () => models,
      getModel: (_provider: string, id: string) => models.find(model => model.id === id),
      refresh: vi.fn(async () => {
        if (fail) throw new Error('PRIVATE TOKEN provider failure');
        models = [{ id: 'new-codex-model', reasoning: true, thinkingLevelMap: { off: null, max: 'max' } }];
        return { aborted: false, errors: new Map() };
      }),
    };
    const codex = new CodexProvider(async () => runtime as unknown as ModelRuntime);
    const statuses = await Promise.all([codex.status(), codex.status()]);
    expect(statuses[0].models).toEqual(['new-codex-model']);
    expect(runtime.refresh).toHaveBeenCalledTimes(1);
    expect(runtime.refresh.mock.calls[0]).toEqual([expect.objectContaining({ providers: ['openai-codex'], allowNetwork: true, force: true, signal: expect.any(AbortSignal) })]);
    const capabilities = await codex.capabilities('new-codex-model');
    expect(capabilities.thinkingLevels).toContain('max');
    expect(capabilities.thinkingLevels).not.toContain('off');
    expect(await codex.capabilities('unknown')).toEqual({ thinkingLevels: [], reasoning: false });
    fail = true;
    await codex.refreshModels(true);
    expect((await codex.status()).models).toEqual(['new-codex-model']);
    expect(JSON.stringify(await codex.status())).not.toContain('PRIVATE');
  });
  it('uses the native Codex Responses transport while retaining channel-only publication', async () => {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const model = runtime.getModels('openai-codex')[0];
    const session = await createChatSession({ name: 'Codex', model: model.id, thinkingLevel: getSupportedThinkingLevels(model)[0], baseUrl: 'not-used-for-subscriptions', channel: { id: 'channel', agentId: 'agent', kind: 'platform-chat' } }, [], () => {}, [], runtime);
    try {
      expect(session.model?.api).toBe('openai-codex-responses');
      expect(session.model?.provider).toBe('openai-codex');
      expect(session.agent.state.tools.map(tool => tool.name)).toEqual(['send_message']);
      expect(session.sessionFile).toBeUndefined();
    } finally { session.dispose(); }
  });
  it('restores stored subscription metadata without refreshing or exposing tokens', async () => {
    const directory = await mkdtemp(join(process.env.SQLITE_TEST_ROOT ?? '.cache', 'codex-auth-'));
    const authPath = join(directory, 'auth.json');
    await writeFile(authPath, JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'PRIVATE ACCESS', refresh: 'PRIVATE REFRESH', expires: 0 } }));
    try {
      const runtime = await ModelRuntime.create({ authPath, modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
      vi.spyOn(runtime, 'refresh').mockResolvedValue({ aborted: false, errors: new Map() });
      const codex = new CodexProvider(async () => runtime);
      const status = await codex.status();
      expect(status.connected).toBe(true);
      expect(status.models.length).toBeGreaterThan(0);
      expect(JSON.stringify(status)).not.toContain('PRIVATE');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('uses device sign-in, deduplicates starts, exposes no tokens, and disconnects', async () => {
    const { codex, runtime, complete } = fixture();
    expect(await codex.status()).toMatchObject({ connected: false, models: [] });
    codex.start(); codex.start();
    await vi.waitFor(async () => expect((await codex.status()).login.state).toBe('waiting'));
    expect(runtime.login).toHaveBeenCalledTimes(1);
    expect(await codex.status()).toMatchObject({ login: { userCode: 'TEST-CODE' } });
    complete();
    await vi.waitFor(async () => expect((await codex.status()).connected).toBe(true));
    expect(JSON.stringify(await codex.status())).not.toContain('PRIVATE');
    expect((await codex.status()).models).toEqual(['test-codex']);
    await codex.disconnect();
    expect((await codex.status()).connected).toBe(false);
  });

  it('cancels pending authentication without persisting a late login', async () => {
    const { codex, interaction } = fixture();
    codex.start();
    await vi.waitFor(async () => expect((await codex.status()).login.state).toBe('waiting'));
    await codex.disconnect();
    expect(interaction().signal?.aborted).toBe(true);
    expect(await codex.status()).toMatchObject({ connected: false, login: { state: 'idle' } });
  });

  it('rejects cross-site login and serves uncached safe status', async () => {
    const { codex, runtime } = fixture();
    const app = Fastify();
    registerCodex(app, codex);
    try {
      expect((await app.inject({ method: 'POST', url: '/api/providers/openai-codex/login', headers: { origin: 'https://evil.example' }, payload: {} })).statusCode).toBe(403);
      expect(runtime.login).not.toHaveBeenCalled();
      const status = await app.inject('/api/providers/openai-codex');
      expect(status.json()).toMatchObject({ connected: false });
      expect(status.headers['cache-control']).toBe('no-store');
    } finally { await app.close(); }
  });
});
