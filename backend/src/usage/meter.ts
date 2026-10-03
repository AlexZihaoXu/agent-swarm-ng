import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { usageRecorder, usageRow, type PiUsage, type UsagePurpose } from './recorder';

export type UsageTag = {
  agentId: string;
  /** Fixed, or read when each call completes (a heartbeat becomes a turn once promoted). */
  purpose: UsagePurpose | (() => UsagePurpose);
  /**
   * The session is the agent's saved session: its messages get `entry:<agentId>:<entryId>`, the key the start-up
   * backfill uses for the same saved entry, so one message is never counted twice.
   */
  saved?: boolean;
};

type Message = {
  role?: string;
  provider?: string;
  model?: string;
  timestamp?: number;
  usage?: PiUsage;
};

const purposeOf = (tag: UsageTag) => (typeof tag.purpose === 'function' ? tag.purpose() : tag.purpose);
const when = (timestamp: unknown) =>
  typeof timestamp === 'number' && Number.isFinite(timestamp) ? new Date(timestamp) : new Date();

/** Records one completed assistant message's usage. */
export function recordMessage(message: Message, tag: UsageTag, sourceKey: string | null = null) {
  if (message.role !== 'assistant') return;
  usageRecorder.record(
    usageRow(message.usage, {
      at: when(message.timestamp),
      agentId: tag.agentId,
      provider: message.provider ?? 'unknown',
      model: message.model ?? 'unknown',
      purpose: purposeOf(tag),
      sourceKey,
    }),
  );
}

/**
 * Meters a Pi session. Every model response of the agent loop ends in exactly one `message_end` event (also errored,
 * aborted and retried attempts, each its own message), so that event is the one hook for turns and forks. The SDK's
 * own (blocking) compaction calls the model outside the loop; its `compaction_end` result carries that usage.
 * Background compaction calls the model outside the session's events: see meterStream. Returns the detach function.
 */
export function meterSession(
  session: Pick<AgentSession, 'subscribe' | 'sessionManager' | 'model'>,
  tag: UsageTag,
): () => void {
  return session.subscribe((event: AgentSessionEvent) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const message = event.message;
      if (!tag.saved) return recordMessage(message, tag);
      // The session appends the message to its manager right after notifying listeners (same tick): its entry ID is
      // known one microtask later.
      const purpose = purposeOf(tag);
      queueMicrotask(() => {
        const entries = session.sessionManager.getEntries();
        let id: string | undefined;
        for (let index = entries.length - 1; index >= 0 && index >= entries.length - 16; index--) {
          const entry = entries[index];
          if (entry.type === 'message' && entry.message === message) {
            id = entry.id;
            break;
          }
        }
        recordMessage(message, { ...tag, purpose }, id ? `entry:${tag.agentId}:${id}` : null);
      });
    } else if (event.type === 'compaction_end' && event.result?.usage) {
      const model = session.model;
      usageRecorder.record(
        usageRow(event.result.usage, {
          at: new Date(),
          agentId: tag.agentId,
          provider: model?.provider ?? 'unknown',
          model: model?.id ?? 'unknown',
          purpose: 'compaction',
          sourceKey: null,
        }),
      );
    }
  });
}

type StreamFn = AgentSession['agent']['streamFunction'];

/**
 * Meters a stream function used outside a session's agent loop (background compaction): each call's final message is
 * recorded when its stream completes, including failed attempts a retry replaces.
 */
export function meterStream(streamFn: StreamFn, tag: UsageTag): StreamFn {
  return (async (...args: Parameters<StreamFn>) => {
    const stream = await streamFn(...args);
    void stream
      .result()
      .then(message => recordMessage(message, tag))
      .catch(() => {});
    return stream;
  }) as StreamFn;
}
