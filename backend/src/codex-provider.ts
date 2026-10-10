import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CredentialSynchronizationError, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { databaseFile } from './database-location';

export const CODEX_PROVIDER = 'openai-codex';
export const CODEX_CONNECTION = 'provider:openai-codex';
/** At most this many ChatGPT accounts per person (the first one included). */
export const MAX_CODEX_ACCOUNTS = 5;
export const CODEX_ACCOUNT_PATTERN = /^[0-9a-f]{8}$/;
/**
 * A person's ChatGPT accounts are separate connections (docs/users.md#model-connections): the first is
 * `provider:openai-codex` (account ''), each one added after it `provider:openai-codex:<account>`.
 */
export const codexConnectionId = (account = '') => (account ? `${CODEX_CONNECTION}:${account}` : CODEX_CONNECTION);
/** The ChatGPT account a connection id names ('' for the first), or undefined when it is not a ChatGPT one. */
export function codexAccountOf(endpointId: string) {
  if (endpointId === CODEX_CONNECTION) return '';
  const account = endpointId.startsWith(`${CODEX_CONNECTION}:`) ? endpointId.slice(CODEX_CONNECTION.length + 1) : '';
  return CODEX_ACCOUNT_PATTERN.test(account) ? account : undefined;
}
export type CodexLogin = {
  state: 'idle' | 'starting' | 'waiting' | 'connected' | 'error';
  userCode?: string;
  verificationUri?: string;
  message?: string;
};
/** Who a login is, from its access token's claims (shown on its card; never the token). */
export type CodexIdentity = { email?: string; plan?: string; user?: string };

/**
 * A person's ChatGPT login files beside the database: admin keeps the original names (docs/users.md); an account added
 * after the first adds `.<account>`.
 */
export const codexFiles = (ownerId: string, account = '') => {
  const name = (kind: string) =>
    `openai-${kind}${ownerId === 'admin' ? '' : `-${ownerId}`}${account ? `.${account}` : ''}.json`;
  return { auth: name('auth'), models: name('models') };
};

/** The profile claims of a ChatGPT access token (a JWT); nothing when it cannot be read. */
export function identityOf(accessToken: string | undefined): CodexIdentity {
  try {
    const claims = JSON.parse(Buffer.from(accessToken!.split('.')[1]!, 'base64url').toString()) as Record<
      string,
      Record<string, unknown> | undefined
    >;
    const profile = claims['https://api.openai.com/profile'];
    const auth = claims['https://api.openai.com/auth'];
    const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
    const user = text(auth?.chatgpt_account_user_id) ?? text(auth?.chatgpt_user_id);
    return {
      ...(text(profile?.email) ? { email: text(profile?.email) } : {}),
      ...(text(auth?.chatgpt_plan_type) ? { plan: text(auth?.chatgpt_plan_type) } : {}),
      ...(user ? { user } : {}),
    };
  } catch {
    return {};
  }
}

export class CodexProvider {
  private runtimePromise?: Promise<ModelRuntime>;
  private login: CodexLogin = { state: 'idle' };
  private disconnecting = false;
  private refreshing?: Promise<void>;
  private refreshAfter = 0;
  private pending?: { controller: AbortController; work: Promise<void> };
  /** Refuses a sign-in (its message) after it completes, e.g. an account already signed in on another card. */
  refuse?: (identity: CodexIdentity) => Promise<string | undefined>;
  constructor(
    private factory = async (files = codexFiles('admin')) => {
      const directory = dirname(databaseFile());
      await mkdir(directory, { recursive: true, mode: 0o700 });
      return ModelRuntime.create({
        authPath: join(directory, files.auth),
        modelsPath: null,
        modelsStorePath: join(directory, files.models),
        allowModelNetwork: false,
      });
    },
  ) {}

  /** The login of another person, or another of their accounts (its own files). */
  static forOwner(ownerId: string, account = '') {
    return new CodexProvider(() => new CodexProvider().factory(codexFiles(ownerId, account)));
  }

  /** Who is signed in (empty when nobody is, or the token cannot be read). */
  async identity(): Promise<CodexIdentity> {
    try {
      const runtime = await this.runtime();
      const signedIn = (await runtime.listCredentials()).some(
        item => item.providerId === CODEX_PROVIDER && item.type === 'oauth',
      );
      if (!signedIn) return {};
      return identityOf((await runtime.getAuth(CODEX_PROVIDER, { signal: AbortSignal.timeout(15000) }))?.auth.apiKey);
    } catch {
      return {};
    }
  }

  runtime() {
    return (this.runtimePromise ??= this.factory());
  }

  async refreshModels(force = false) {
    const runtime = await this.runtime();
    if (this.refreshing) return this.refreshing;
    if (this.disconnecting || (!force && Date.now() < this.refreshAfter)) return;
    this.refreshAfter = Date.now() + 5 * 60_000;
    this.refreshing = (async () => {
      try {
        const result = await runtime.refresh({
          providers: [CODEX_PROVIDER],
          allowNetwork: true,
          force: true,
          signal: AbortSignal.timeout(5000),
        });
        if (result.aborted || result.errors.size) this.refreshAfter = Date.now() + 60_000;
      } catch {
        this.refreshAfter = Date.now() + 60_000;
      } // Keep the SDK's last known catalog; never expose provider errors/tokens.
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  async status() {
    const runtime = await this.runtime();
    const signedIn = () =>
      runtime
        .listCredentials()
        .then(items => items.some(item => item.providerId === CODEX_PROVIDER && item.type === 'oauth'));
    if (await signedIn()) await this.refreshModels();
    const connected = !this.disconnecting && (await signedIn());
    const { email, plan } = connected ? await this.identity() : {};
    return {
      connected,
      ...(email ? { email } : {}),
      ...(plan ? { plan } : {}),
      models: connected ? runtime.getModels(CODEX_PROVIDER).map(model => model.id) : [],
      login: this.login,
    };
  }

  async capabilities(id: string) {
    if (!(await this.status()).connected) return { thinkingLevels: [], reasoning: false };
    const model = (await this.runtime()).getModel(CODEX_PROVIDER, id);
    return model
      ? { thinkingLevels: getSupportedThinkingLevels(model), reasoning: Boolean(model.reasoning) }
      : { thinkingLevels: [], reasoning: false };
  }

  start() {
    if (this.pending || this.disconnecting) return;
    const controller = new AbortController();
    this.login = { state: 'starting' };
    const timer = setTimeout(() => controller.abort(), 15 * 60_000);
    const work = this.runtime()
      .then(runtime =>
        runtime.login(CODEX_PROVIDER, 'oauth', {
          signal: controller.signal,
          prompt: async prompt => {
            if (prompt.type === 'select' && prompt.options.some(option => option.id === 'device_code'))
              return 'device_code';
            throw new Error('Unsupported login prompt');
          },
          notify: event => {
            if (controller.signal.aborted) return;
            if (event.type === 'device_code') {
              // Do not turn provider-supplied URLs into an arbitrary login link.
              if (event.verificationUri !== 'https://auth.openai.com/codex/device')
                throw new Error('Unexpected verification URL');
              this.login = { state: 'waiting', userCode: event.userCode, verificationUri: event.verificationUri };
            }
          },
        }),
      )
      .then(async () => {
        const refused = this.refuse && (await this.refuse(await this.identity()));
        if (refused) {
          await (await this.runtime()).logout(CODEX_PROVIDER);
          this.login = { state: 'error', message: refused };
          return;
        }
        this.refreshAfter = 0;
        this.login = { state: 'connected' };
      })
      .catch(error => {
        this.login = {
          state: 'error',
          message:
            error instanceof CredentialSynchronizationError
              ? 'Sign-in was saved, but provider initialization failed. Restart the backend before retrying.'
              : controller.signal.aborted
                ? 'Sign-in cancelled or expired.'
                : 'Could not connect. Enable device code login in ChatGPT security settings, then try again.',
        };
      })
      .finally(() => {
        clearTimeout(timer);
        this.pending = undefined;
      });
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
    try {
      await this.cancel();
      await (await this.runtime()).logout(CODEX_PROVIDER);
    } finally {
      this.refreshAfter = 0;
      this.disconnecting = false;
    }
  }
}
