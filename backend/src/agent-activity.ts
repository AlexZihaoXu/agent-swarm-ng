import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { activityTextPreview, type ActivityStore, type ActivitySnapshot } from './activity-store';
import { activityRedactor } from './activity-safety';
import { createActivityEvents, type ActivityWrite } from './activity-events';

const kinds = [
  'system',
  'user',
  'assistant',
  'thinking',
  'tool_call',
  'tool_result',
  'reminder',
  'channel',
  'status',
  'error',
  'metadata',
] as const;
export const ActivityEntrySchema = Type.Object({
  id: Type.String(),
  runId: Type.String(),
  channelId: Type.String(),
  kind: Type.Union(kinds.map(kind => Type.Literal(kind))),
  label: Type.String(),
  text: Type.String(),
  timestamp: Type.Number(),
  state: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sequence: Type.Optional(Type.Integer()),
  revision: Type.Optional(Type.Integer()),
  offset: Type.Optional(
    Type.Integer({ description: 'UTF-8 byte offset. Continue using nextOffset, not JavaScript string length.' }),
  ),
  totalLength: Type.Optional(
    Type.Integer({ description: 'Complete text length in UTF-8 bytes; the durable archive is not truncated.' }),
  ),
  nextOffset: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
});
export type ActivityEntry = Static<typeof ActivityEntrySchema>;

/** Operator-only traces: coalesced durable checkpoints, never chat or private Pi context. */
export function createActivityRecorder(
  agentId: string,
  channelId: string,
  apiKey: string,
  emit: (event: object) => void,
  runId: string = randomUUID(),
  store?: ActivityStore,
  onFailure: () => void = () => {},
) {
  let branches = 0,
    startedAt: number | undefined;
  const entries = new Map<string, ActivitySnapshot>();
  const pending = new Map<string, ActivitySnapshot>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();
  let failure: unknown;
  let redact = activityRedactor(apiKey);
  const incomplete = (state?: string) =>
    ['streaming', 'partial', 'interrupted', 'pending', 'running', 'failed', 'rejected'].includes(state ?? '');
  const flush = async () => {
    clearTimeout(timer);
    timer = undefined;
    const batch = [...pending.values()];
    pending.clear();
    writes = writes
      .then(async () => {
        if (failure) return;
        for (const entry of batch) {
          const saved = await store!.save(agentId, { ...entry, text: redact(entry.text, incomplete(entry.state)) });
          emit({ type: 'activity', agentId, append: false, entry: saved });
        }
      })
      .catch(error => {
        failure = error;
        onFailure();
      });
    await writes;
    if (failure) throw new Error('Operator activity could not be saved.');
  };
  const record = (
    kind: ActivityEntry['kind'],
    label: string,
    text: string,
    id: string = randomUUID(),
    append = false,
    state?: string,
  ) => {
    const previous = entries.get(id);
    const entry: ActivitySnapshot = {
      id: `${runId}:${id}`,
      runId,
      channelId,
      kind,
      label: redact(label),
      text: append ? (previous?.text ?? '') + text : text,
      timestamp: previous?.timestamp ?? Date.now(),
      revision: (previous?.revision ?? 0) + 1,
      state,
    };
    if (
      previous &&
      previous.text === entry.text &&
      previous.kind === kind &&
      previous.label === entry.label &&
      previous.state === state
    )
      return;
    entries.set(id, entry);
    if (store) {
      pending.set(id, entry);
      timer ??= setTimeout(() => {
        void flush().catch(() => {});
      }, 100);
    } else {
      emit({
        type: 'activity',
        agentId,
        append: false,
        entry: { ...entry, ...activityTextPreview(redact(entry.text, incomplete(state))) },
      });
    }
  };
  const close = (prefix: string, state = 'interrupted') => {
    for (const [id, entry] of entries)
      if (id.startsWith(prefix) && ['streaming', 'pending', 'running'].includes(entry.state ?? ''))
        record(entry.kind, entry.label, entry.text, id, false, state);
  };
  const scope = (label: string, prefix: string) => {
    const write: ActivityWrite = (kind, name, text, id = randomUUID(), append, state) =>
      record(kind, label ? `${label} · ${name}` : name, text, `${prefix}${id}`, append, state);
    return { ...createActivityEvents(write), record: write, close: (state?: string) => close(prefix, state) };
  };
  return {
    ...scope('', ''),
    flush,
    protect(secret: string) {
      if (!secret) return;
      const previous = redact,
        next = activityRedactor(secret);
      redact = (text, streaming) => next(previous(text, streaming), streaming);
    },
    branch(label: string) {
      const n = ++branches;
      return scope(`${label} ${n}`, `branch-${n}:`);
    },
    async start(label = 'Run active') {
      startedAt = Date.now();
      record(
        'status',
        label,
        'Agent work started. Streaming entries may be unfinished.',
        'run-status',
        false,
        'active',
      );
      record('metadata', 'Work timing', JSON.stringify({ startedAt }), 'work-timing', false, 'running');
      await flush();
    },
    async finish(stopped = false, failed = false, label = 'Run') {
      close('', stopped ? 'interrupted' : failed ? 'failed' : 'interrupted');
      record(
        'metadata',
        'Work timing',
        JSON.stringify({
          startedAt,
          finishedAt: Date.now(),
          durationMs: startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt),
          stopped,
          failed,
        }),
        'work-timing',
        false,
        'complete',
      );
      record(
        'status',
        `${label} ${stopped ? 'stopped' : failed ? 'failed' : 'ended'}`,
        stopped
          ? 'Work stopped; committed effects remain. Partial activity may be unfinished.'
          : failed
            ? 'Work failed. See recorded request/tool errors and outcomes.'
            : 'Work ended. See turn status and errors for its outcome.',
        'run-status',
        false,
        stopped ? 'stopped' : failed ? 'failed' : 'ended',
      );
      await flush();
    },
  };
}
