import { DiscordOwnerSettings } from '@/components/discord-owner-settings';
import { noAutofill, secretField } from '@/lib/no-autofill';
import { AccountSettings } from '@/components/account-settings';
import { SecuritySettings } from '@/components/security-settings';
import { SwarmSettings } from '@/components/swarm-settings';
import { OrganizationSettings } from '@/components/organization-settings';
import { ComputerStorageSettings } from '@/components/computer-storage-settings';
import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { surface } from '@/lib/motion';
import { CodexConnection } from '@/components/codex-connection';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { randomUuid } from '@/lib/random-uuid';
import { PageHeader } from '@/components/page-header';
import { UserSettings } from '@/components/user-settings';
import { useSignedIn } from '@/lib/auth';
import { settingsCard, settingsInput } from '@/lib/styles';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { endpointPath, type DashboardRoute } from '@/lib/dashboard-location';

type TestResult =
  | { state: 'idle' | 'testing' | 'saved' }
  | { state: 'success'; models: string[]; details?: { id: string; contextWindow: number }[] }
  | { state: 'error'; message: string };

const inputClass = settingsInput;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

type Endpoint = {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  saved: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  images?: boolean;
  reasoning?: boolean;
  /** What its models reported when last listed, when they agree. */
  detectedContextWindow?: number;
};

/** Model limits (docs/development.md#model-limits): the backend's ranges and defaults. */
const CONTEXT_RANGE = { min: 1024, max: 10_000_000 };
const REPLY_RANGE = { min: 256, max: 1_000_000 };
const DEFAULT_CONTEXT = 32768;
const tokens = (value: number) => value.toLocaleString('en-US');
const defaultReply = (context: number) => Math.max(4096, Math.min(32768, Math.floor(context / 4)));
/** A typed token count ("131,072" works too): undefined when empty, NaN when it is not a whole number in range. */
function parseTokens(value: string, range: { min: number; max: number }) {
  const digits = value.replace(/[\s,_]/g, '');
  if (!digits) return undefined;
  const parsed = /^\d+$/.test(digits) ? Number(digits) : NaN;
  return parsed >= range.min && parsed <= range.max ? parsed : NaN;
}
const limitText = (value?: number) => (value === undefined ? '' : String(value));

function EndpointCard({
  endpoint,
  onSaved,
  onRemove,
  focused = false,
}: {
  endpoint: Endpoint;
  onSaved: (value: Endpoint) => void;
  onRemove: () => Promise<void>;
  /** Opened by a link to this endpoint: start expanded. */
  focused?: boolean;
}) {
  const id = useId();
  // Saved endpoints rest as a one-line summary; Edit expands the form, Done/Cancel or a save folds it away.
  const [editing, setEditing] = useState(() => !endpoint.saved || focused);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [name, setName] = useState(endpoint.name);
  const [baseUrl, setBaseUrl] = useState(endpoint.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [keyChanged, setKeyChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TestResult>({ state: 'idle' });
  const [contextWindow, setContextWindow] = useState(limitText(endpoint.contextWindow));
  const [maxOutputTokens, setMaxOutputTokens] = useState(limitText(endpoint.maxOutputTokens));
  // Unset switches leave the choice to the model's defaults; touching one saves it.
  const [images, setImages] = useState(endpoint.images);
  const [reasoning, setReasoning] = useState(endpoint.reasoning);
  const request = useRef<AbortController | null>(null);
  const testing = result.state === 'testing';
  const openrouter = baseUrl.trim().replace(/\/+$/, '') === OPENROUTER_URL;
  const parsedContext = parseTokens(contextWindow, CONTEXT_RANGE);
  const parsedReply = parseTokens(maxOutputTokens, REPLY_RANGE);
  const limitsInvalid = !openrouter && (Number.isNaN(parsedContext) || Number.isNaN(parsedReply));
  const limitsDirty =
    contextWindow !== limitText(endpoint.contextWindow) ||
    maxOutputTokens !== limitText(endpoint.maxOutputTokens) ||
    images !== endpoint.images ||
    reasoning !== endpoint.reasoning;
  const dirty = name !== endpoint.name || baseUrl !== endpoint.baseUrl || keyChanged || limitsDirty;
  // A fresh model list says what the server reports now; otherwise what it reported when last listed.
  const listed =
    result.state === 'success' && result.details ? [...new Set(result.details.map(row => row.contextWindow))] : null;
  const detected = listed ? (listed.length === 1 ? listed[0] : undefined) : endpoint.detectedContextWindow;
  const effectiveContext =
    (parsedContext !== undefined && !Number.isNaN(parsedContext) ? parsedContext : undefined) ??
    detected ??
    DEFAULT_CONTEXT;

  useEffect(() => () => request.current?.abort(), []);

  async function testConnection() {
    if (testing || !baseUrl.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setResult({ state: 'testing' });
    try {
      const { data, error } = await api.POST('/api/model-endpoints/test', {
        body: {
          baseUrl: baseUrl.trim(),
          ...(keyChanged || !endpoint.saved ? { apiKey: apiKey.trim() } : { endpointId: endpoint.id }),
        },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
      });
      if (controller.signal.aborted) return;
      if (error || !data) setResult({ state: 'error', message: error?.message ?? 'The connection test failed.' });
      else setResult({ state: 'success', models: data.models, details: data.details });
    } catch {
      if (!controller.signal.aborted)
        setResult({
          state: 'error',
          message: 'Could not complete the request. Check the backend connection and try again.',
        });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  async function saveEndpoint() {
    setSaving(true);
    try {
      const { data, error } = await api.POST('/api/model-endpoints', {
        body: {
          id: endpoint.id,
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          ...(keyChanged || !endpoint.saved ? { apiKey: apiKey.trim() } : {}),
          // Empty clears a limit (null); OpenRouter's catalog sets its own, so its card leaves them as saved.
          ...(openrouter
            ? {}
            : {
                contextWindow: parsedContext ?? null,
                maxOutputTokens: parsedReply ?? null,
                images: images ?? null,
                reasoning: reasoning ?? null,
              }),
        },
      });
      if (error || !data) {
        setResult({ state: 'error', message: error?.message ?? 'Could not save endpoint.' });
        return;
      }
      onSaved({ ...data, saved: true });
      setBaseUrl(data.baseUrl);
      setContextWindow(limitText(data.contextWindow));
      setMaxOutputTokens(limitText(data.maxOutputTokens));
      setImages(data.images);
      setReasoning(data.reasoning);
      setApiKey('');
      setKeyChanged(false);
      setResult({ state: 'saved' });
      setEditing(false);
    } catch {
      setResult({ state: 'error', message: 'Could not save endpoint. Check the backend connection.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className={settingsCard}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-title`} className="truncate text-sm font-semibold">
            {name.trim() || 'New endpoint'}
          </h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {openrouter ? 'OpenRouter · API credits' : 'OpenAI-compatible API'}
            {!editing && (
              <>
                {' · '}
                <span className="font-mono">{endpoint.baseUrl}</span>
                {' · '}
                {endpoint.hasApiKey ? 'key saved' : 'no key'}
              </>
            )}
          </p>
        </div>
        {endpoint.saved && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 shrink-0 sm:min-h-0"
            aria-expanded={editing}
            aria-controls={`${id}-form`}
            disabled={testing || saving}
            onClick={() => {
              if (editing && dirty) {
                setName(endpoint.name);
                setBaseUrl(endpoint.baseUrl);
                setApiKey('');
                setKeyChanged(false);
                setContextWindow(limitText(endpoint.contextWindow));
                setMaxOutputTokens(limitText(endpoint.maxOutputTokens));
                setImages(endpoint.images);
                setReasoning(endpoint.reasoning);
                setResult({ state: 'idle' });
              }
              setEditing(value => !value);
            }}
          >
            {!editing ? 'Edit' : dirty ? 'Cancel' : 'Done'}
          </Button>
        )}
        <button
          type="button"
          onClick={() => {
            if (endpoint.saved) setConfirmingRemoval(true);
            else void onRemove();
          }}
          aria-label="Remove endpoint"
          className="flex size-11 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:size-auto sm:p-2"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="size-4"
          >
            <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <ConfirmDialog
        open={confirmingRemoval}
        onOpenChange={setConfirmingRemoval}
        title="Remove endpoint"
        confirmLabel="Remove endpoint"
        busyLabel="Removing…"
        onConfirm={onRemove}
        description={
          <>
            Removes <strong className="text-foreground">{endpoint.name.trim() || 'this endpoint'}</strong> and its saved
            API key from this backend. Agents that use it must be moved to another endpoint or deleted first; you will
            be told if any still do.
          </>
        }
      />
      <AnimatePresence initial={false}>
        {editing && (
          <m.div
            key="form"
            id={`${id}-form`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={surface}
            className="overflow-hidden"
          >
            <div className="pt-5">
              {/* Labeled field-group composition: Kibo field/basic-inputs/field-basic-inputs-4. */}
              <form
                onSubmit={event => {
                  event.preventDefault();
                  void testConnection();
                }}
              >
                <fieldset disabled={testing || saving} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor={`${id}-name`} className="block text-sm font-medium">
                      Name
                    </label>
                    <input
                      id={`${id}-name`}
                      value={name}
                      onChange={event => setName(event.target.value)}
                      placeholder="e.g. Local server"
                      {...noAutofill}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`${id}-url`} className="block text-sm font-medium">
                      Base URL
                    </label>
                    <input
                      id={`${id}-url`}
                      type="url"
                      required
                      value={baseUrl}
                      onChange={event => {
                        setBaseUrl(event.target.value);
                        setResult({ state: 'idle' });
                      }}
                      placeholder="https://api.openai.com/v1"
                      {...noAutofill}
                      spellCheck={false}
                      aria-describedby={`${id}-url-help`}
                      className={inputClass}
                    />
                    <p id={`${id}-url-help`} className="text-xs leading-relaxed text-muted-foreground">
                      Include the API prefix, such as /v1. Local URLs are resolved from the backend.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`${id}-key`} className="block text-sm font-medium">
                      API key
                    </label>
                    <input
                      id={`${id}-key`}
                      {...secretField(true)}
                      value={apiKey}
                      onChange={event => {
                        setApiKey(event.target.value);
                        setKeyChanged(true);
                        setResult({ state: 'idle' });
                      }}
                      placeholder={
                        endpoint.hasApiKey && !keyChanged
                          ? 'Saved key — enter to replace'
                          : openrouter
                            ? 'OpenRouter API key'
                            : 'Optional for local servers'
                      }
                      className={inputClass}
                    />
                  </div>
                  {openrouter && (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      An OpenRouter API key is required for inference, billed by OpenRouter. Lists tool-capable
                      text/vision models; reasoning support depends on the model.
                    </p>
                  )}
                  {endpoint.hasApiKey && !keyChanged && (
                    <button
                      type="button"
                      className="min-h-11 rounded text-xs text-muted-foreground underline underline-offset-4 sm:min-h-0"
                      onClick={() => {
                        setKeyChanged(true);
                        setApiKey('');
                        setResult({ state: 'idle' });
                      }}
                    >
                      Clear saved key
                    </button>
                  )}
                  {!openrouter && (
                    <fieldset className="min-w-0 space-y-4 border-t border-border pt-4">
                      <legend className="float-left mb-1 w-full text-sm font-medium">Model limits</legend>
                      <p className="clear-left text-xs leading-relaxed text-muted-foreground">
                        Leave a field empty to use what the server reports, or the default. They apply to every model on
                        this endpoint.
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <TokenField
                          id={`${id}-context`}
                          label="Context window (tokens)"
                          value={contextWindow}
                          onChange={setContextWindow}
                          invalid={Number.isNaN(parsedContext)}
                          range={CONTEXT_RANGE}
                          placeholder={
                            detected
                              ? `Detected: ${tokens(detected)}`
                              : listed && listed.length > 1
                                ? 'Detected per model'
                                : `Default: ${tokens(DEFAULT_CONTEXT)}`
                          }
                          help="How much the model can read at once: its instructions, the conversation and tool results."
                        />
                        <TokenField
                          id={`${id}-reply`}
                          label="Max reply length (tokens)"
                          value={maxOutputTokens}
                          onChange={setMaxOutputTokens}
                          invalid={Number.isNaN(parsedReply)}
                          range={REPLY_RANGE}
                          placeholder={`Default: ${tokens(defaultReply(effectiveContext))}`}
                          help="The longest single reply, thinking included. Defaults to a quarter of the context window."
                        />
                      </div>
                      <SwitchRow
                        id={`${id}-images`}
                        label="Image input"
                        help="The model can look at images, such as screenshots of a computer or attached photos."
                        checked={images ?? false}
                        onCheckedChange={setImages}
                      />
                      <SwitchRow
                        id={`${id}-reasoning`}
                        label="Reasoning"
                        help="The model thinks before it answers. Agents on this endpoint can then choose a thinking level."
                        checked={reasoning ?? false}
                        onCheckedChange={setReasoning}
                      />
                    </fieldset>
                  )}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-11 sm:min-h-0"
                      disabled={testing || saving || !name.trim() || !baseUrl.trim() || limitsInvalid}
                      onClick={() => void saveEndpoint()}
                    >
                      {saving ? 'Saving…' : 'Save endpoint'}
                    </Button>
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      className="min-h-11 sm:min-h-0"
                      disabled={testing || !baseUrl.trim()}
                    >
                      {testing ? 'Testing…' : 'Test connection'}
                    </Button>
                    <span className="text-xs text-muted-foreground">Lists models only. No inference request.</span>
                  </div>
                </fieldset>
              </form>
              {result.state === 'testing' && (
                <p role="status" className="mt-4 text-sm text-muted-foreground">
                  Requesting model list…
                </p>
              )}
              {result.state === 'error' && (
                <p role="alert" className="mt-4 text-sm leading-relaxed">
                  <span className="font-medium">Connection failed. </span>
                  {result.message}
                </p>
              )}
              {result.state === 'success' && (
                <div className="mt-4 rounded-lg bg-muted/50 p-3">
                  <p role="status" className="text-sm">
                    Connected · {result.models.length} {result.models.length === 1 ? 'model' : 'models'} available
                  </p>
                  {result.models.length > 0 && (
                    <details className="mt-2">
                      <summary className="flex min-h-11 items-center rounded text-xs text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring sm:min-h-0">
                        View models
                      </summary>
                      <ScrollArea
                        label="Available models"
                        className="mt-3"
                        style={{ height: Math.min(result.models.length * 28, 144) }}
                      >
                        <ul className="space-y-1 pr-4 font-mono text-xs text-muted-foreground">
                          {result.models.map(model => (
                            <li key={model} className="break-all py-1">
                              {model}
                            </li>
                          ))}
                        </ul>
                      </ScrollArea>
                    </details>
                  )}
                </div>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
      {result.state === 'saved' && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Saved locally.
        </p>
      )}
    </section>
  );
}

function TokenField({
  id,
  label,
  value,
  onChange,
  invalid,
  range,
  placeholder,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  range: { min: number; max: number };
  placeholder: string;
  help: string;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-help`}
        {...noAutofill}
        className={inputClass}
      />
      <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">
        {invalid ? `Enter a whole number from ${tokens(range.min)} to ${tokens(range.max)}.` : help}
      </p>
    </div>
  );
}

/** A labelled on/off setting with its explanation (the heartbeat switch's row composition). */
function SwitchRow({
  id,
  label,
  help,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium">
          {label}
        </label>
        <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">
          {help}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        describedBy={`${id}-help`}
        className="mt-0.5"
      />
    </div>
  );
}

export function Settings({ route, onNavigate }: { route: DashboardRoute; onNavigate: (path: string) => void }) {
  const { admin } = useSignedIn();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const newEndpointId = useRef(randomUuid());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void api
      .GET('/api/model-endpoints', { signal: controller.signal })
      .then(({ data, error: failure }) => {
        if (controller.signal.aborted) return;
        if (failure || !data) setError('Could not load saved endpoints.');
        else setEndpoints(data.map(endpoint => ({ ...endpoint, saved: true })));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load saved endpoints.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (loading || route.kind !== 'endpoint-new') return;
    setEndpoints(current =>
      current.some(item => item.id === newEndpointId.current)
        ? current
        : [...current, { id: newEndpointId.current, name: '', baseUrl: '', hasApiKey: false, saved: false }],
    );
  }, [loading, route.kind]);
  useEffect(() => {
    if (loading || route.kind !== 'endpoint') return;
    document.getElementById(`endpoint-${route.endpointId}`)?.scrollIntoView({ block: 'nearest' });
  }, [loading, route.kind, route.endpointId, endpoints.length]);

  function addEndpoint(name = '', baseUrl = '') {
    newEndpointId.current = randomUuid();
    setEndpoints(current => [...current, { id: newEndpointId.current, name, baseUrl, hasApiKey: false, saved: false }]);
    onNavigate('/settings/endpoints/new');
  }

  async function removeEndpoint(endpoint: Endpoint) {
    if (endpoint.saved) {
      const { response, error: failure } = await api
        .DELETE('/api/model-endpoints/{id}', { params: { path: { id: endpoint.id } } })
        .catch(() => ({ response: undefined, error: undefined }));
      if (!response?.ok) throw new Error(failure?.message ?? 'Could not remove the saved endpoint.');
    }
    setEndpoints(current => current.filter(item => item.id !== endpoint.id));
    if (route.endpointId === endpoint.id || (route.kind === 'endpoint-new' && !endpoint.saved)) onNavigate('/settings');
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description={
          admin
            ? 'Your account, users, organizations, model connections, Knowledge, the audit log and swarm limits.'
            : 'Your account, organizations, model connections and Knowledge.'
        }
        width="max-w-3xl"
        sticky
      />
      {/* Users see their own account, connections, organizations and Knowledge; the rest is admin's (docs/users.md). */}
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 pb-8 pt-6 md:px-6 md:pb-10">
        <AccountSettings />
        {admin && <UserSettings />}
        {admin && <SecuritySettings onNavigate={onNavigate} />}
        <CodexConnection />
        <OrganizationSettings card={settingsCard} />
        <section aria-labelledby="knowledge-title" className="space-y-4">
          <div>
            <h3 id="knowledge-title" className="text-lg font-semibold">
              Swarm Knowledge
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Review the operator-curated, read-only topic hierarchy. Anyone with dashboard access can read these
              entries.
            </p>
          </div>
          <div className={settingsCard}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-0"
              onClick={() => onNavigate('/settings/knowledge')}
            >
              Browse Swarm Knowledge
            </Button>
          </div>
        </section>
        {admin && (
          <section aria-labelledby="audit-title" className="space-y-4">
            <div>
              <h3 id="audit-title" className="text-lg font-semibold">
                Audit log
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign-in attempts (name, address, time to the millisecond), agents, computers and organizations created,
                edited or deleted, and the platform starting and stopping.
              </p>
            </div>
            <div className={settingsCard}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-0"
                onClick={() => onNavigate('/settings/audit')}
              >
                Open the audit log
              </Button>
            </div>
          </section>
        )}
        <section aria-labelledby="endpoints-title" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 id="endpoints-title" className="text-lg font-semibold">
                API endpoints
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Connect OpenRouter, another OpenAI-compatible provider, or a local server.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-0"
                disabled={loading}
                onClick={() => addEndpoint('OpenRouter', OPENROUTER_URL)}
              >
                Add OpenRouter
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-0"
                disabled={loading}
                onClick={() => addEndpoint()}
              >
                <span aria-hidden="true" className="mr-2 text-lg leading-none">
                  +
                </span>
                Add endpoint
              </Button>
            </div>
          </div>
          <div className="space-y-4">
            {error && (
              <p role="alert" className="text-sm">
                {error}
              </p>
            )}
            {loading && (
              <p role="status" className="text-sm text-muted-foreground">
                Loading endpoints…
              </p>
            )}
            {!loading && endpoints.length === 0 && (
              <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
                <p className="text-sm font-medium">No endpoints yet</p>
                <p className="mt-2 text-xs text-muted-foreground">Add a connection to check its available models.</p>
              </div>
            )}
            {route.kind === 'endpoint' &&
              !loading &&
              !error &&
              !endpoints.some(item => item.id === route.endpointId) && (
                <p role="alert" className="text-sm">
                  Endpoint not found.{' '}
                  <button type="button" className="cursor-pointer underline" onClick={() => onNavigate('/settings')}>
                    Return to settings
                  </button>
                </p>
              )}
            {endpoints.map(endpoint => (
              <div key={endpoint.id} id={`endpoint-${endpoint.id}`}>
                <EndpointCard
                  endpoint={endpoint}
                  focused={route.endpointId === endpoint.id}
                  onSaved={saved => {
                    setEndpoints(current => current.map(item => (item.id === endpoint.id ? saved : item)));
                    onNavigate(endpointPath(saved.id));
                  }}
                  onRemove={() => removeEndpoint(endpoint)}
                />
              </div>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Save endpoints to keep them after restart. Keys are stored on the backend, never in browser storage.
            Changing a saved URL clears its key unless you enter a replacement. Use HTTPS for remote providers.
          </p>
        </section>
        <DiscordOwnerSettings card={settingsCard} />
        {admin && <SwarmSettings card={settingsCard} />}
        {admin && <ComputerStorageSettings card={settingsCard} />}
      </div>
    </div>
  );
}
