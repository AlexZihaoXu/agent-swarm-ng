import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CredentialSynchronizationError, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryModelsStore } from '@earendil-works/pi-ai';
import { databaseFile } from './database-location';

export const CODEX_PROVIDER = 'openai-codex';
export const CODEX_CONNECTION = 'provider:openai-codex';
export type CodexLogin = { state: 'idle' | 'starting' | 'waiting' | 'connected' | 'error'; userCode?: string; verificationUri?: string; message?: string };

export class CodexProvider {
  private runtimePromise?: Promise<ModelRuntime>;
  private login: CodexLogin = { state: 'idle' };
  private disconnecting = false;
  private pending?: { controller: AbortController; work: Promise<void> };
  constructor(private factory = async () => {
    const directory = dirname(databaseFile());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return ModelRuntime.create({ authPath: join(directory, 'openai-auth.json'), modelsPath: null,
      modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
  }) {}

  runtime() { return this.runtimePromise ??= this.factory(); }

  async status() {
    const runtime = await this.runtime();
    const connected = (await runtime.listCredentials()).some(item => item.providerId === CODEX_PROVIDER && item.type === 'oauth');
    return { connected, models: connected ? runtime.getModels(CODEX_PROVIDER).map(model => model.id) : [], login: this.login };
  }

  start() {
    if (this.pending || this.disconnecting) return;
    const controller = new AbortController();
    this.login = { state: 'starting' };
    const timer = setTimeout(() => controller.abort(), 15 * 60_000);
    const work = this.runtime().then(runtime => runtime.login(CODEX_PROVIDER, 'oauth', {
      signal: controller.signal,
      prompt: async prompt => {
        if (prompt.type === 'select' && prompt.options.some(option => option.id === 'device_code')) return 'device_code';
        throw new Error('Unsupported login prompt');
      },
      notify: event => {
        if (controller.signal.aborted) return;
        if (event.type === 'device_code') {
          // Do not turn provider-supplied URLs into an arbitrary login link.
          if (event.verificationUri !== 'https://auth.openai.com/codex/device') throw new Error('Unexpected verification URL');
          this.login = { state: 'waiting', userCode: event.userCode, verificationUri: event.verificationUri };
        }
      },
    })).then(() => { this.login = { state: 'connected' }; }).catch(error => {
      this.login = { state: 'error', message: error instanceof CredentialSynchronizationError
        ? 'Sign-in was saved, but provider initialization failed. Restart the backend before retrying.'
        : controller.signal.aborted ? 'Sign-in cancelled or expired.' : 'Could not connect. Enable device code login in ChatGPT security settings, then try again.' };
    }).finally(() => { clearTimeout(timer); this.pending = undefined; });
    this.pending = { controller, work };
  }

  async cancel() {
    const pending = this.pending;
    pending?.controller.abort();
    await pending?.work;
    this.login = { state: 'idle' };
  }

  async disconnect() {
    if (this.disconnecting) return;
    this.disconnecting = true;
    try { await this.cancel(); await (await this.runtime()).logout(CODEX_PROVIDER); }
    finally { this.disconnecting = false; }
  }
}
