import type { PlatformStore } from '../platform-store';
import type { Reach } from '../users/reach';
import type { RunEvent } from '../agent-runs';
import type { CriticalEvent } from '../security/alerts';
import type { Presence } from './presence';
import type { PushPayload, PushSender } from './sender';
import type { Preferences, PushStore } from './store';
import { plainText } from './preview';

/** Messages of one conversation within this quiet time go out as one notification… */
export const DEBOUNCE_MS = 3_000;
/** …but a steady stream still notifies at least this often. */
export const MAX_WAIT_MS = 10_000;

type Kind = 'message' | 'group' | 'stuck' | 'critical';
const PREFERENCE: Record<Kind, keyof Preferences> = {
  message: 'agentMessages',
  group: 'groupChats',
  stuck: 'agentProblems',
  critical: 'critical',
};
/** The Swarm itself: updated, started, stopping (each person chooses which). */
export type SwarmEvent = 'update' | 'start' | 'stop';
const SWARM_PREFERENCE: Record<SwarmEvent, keyof Preferences> = {
  update: 'swarmUpdates',
  start: 'swarmStarts',
  stop: 'swarmStops',
};
type Item = { kind: Kind; tag: string; title: string; text: string; url: string; icon?: string };
type Batch = { userId: string; first: number; count: number; latest: Item; timer?: ReturnType<typeof setTimeout> };
type Run = { agentId: string; errors: string[]; published: boolean };
type Log = { warn(object: object, message: string): void };

/** Where a critical event's banner links (frontend/src/components/alert-banner.tsx), for a tap on its notification. */
const CRITICAL_URL: Record<string, string> = {
  lockdown: '/settings/audit?category=signin',
  'signin-failures': '/settings/audit?category=signin',
  outage: '/settings/audit?category=system',
  'disk-full': '/dashboard',
};

/**
 * Turns platform events into push notifications (docs/notifications.md): an agent's message in a private chat or a
 * group to the owner of its organization, an agent run that failed before publishing anything to the person waiting,
 * and critical events to admin. Watches the run event bus (never the chat path itself), so nothing here can delay or
 * fail a chat message. Each conversation is batched (DEBOUNCE_MS); nothing is sent while the person has the dashboard
 * in front of them (presence) or turned that kind off.
 */
export class PushNotifier {
  private readonly batches = new Map<string, Batch>();
  private readonly runs = new Map<string, Run>();
  private closed = false;

  constructor(
    private readonly deps: {
      platform: PlatformStore;
      reach: Reach;
      store: PushStore;
      sender: PushSender;
      presence: Presence;
      log: Log;
      debounceMs?: number;
      maxWaitMs?: number;
      now?: () => number;
    },
  ) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  /** One run event (AgentRuns.subscribe). Never throws: the bus drops a listener that throws. */
  observe = (event: RunEvent) => {
    try {
      this.handle(event);
    } catch (error) {
      this.fail(error);
    }
  };

  private fail = (error: unknown) =>
    this.deps.log.warn({ err: error instanceof Error ? error.message : 'unknown' }, 'Push: notification skipped');

  private run(event: RunEvent) {
    let run = this.runs.get(event.runId);
    if (!run) this.runs.set(event.runId, (run = { agentId: event.agentId, errors: [], published: false }));
    return run;
  }

  private handle(event: RunEvent) {
    if (event.type === 'channel_message' && event.role === 'assistant') {
      this.run(event).published = true;
      void this.agentMessage(event.agentId, String(event.text ?? '')).catch(this.fail);
      return;
    }
    if (event.type === 'group_updated' && event.publication) {
      const message = event.message as
        { role?: string; authorId?: string | null; authorName?: string; text?: string } | undefined;
      if (message?.role !== 'assistant' || !message.authorId) return;
      // One run at a time per agent: its group message belongs to its current run.
      for (const run of this.runs.values()) if (run.agentId === message.authorId) run.published = true;
      void this.groupMessage(
        String(event.groupId),
        message.authorId,
        message.authorName ?? 'Agent',
        message.text ?? '',
      ).catch(this.fail);
      return;
    }
    // Fallback models (docs/agent-models.md): told once when an agent drops off its #1, not on every later switch.
    if (event.type === 'model_choice' && event.from === 0 && Number(event.active) > 0) {
      void this.fallback(event.agentId, Number(event.active), String(event.reason ?? '')).catch(this.fail);
      return;
    }
    if (event.runId === 'platform') return;
    if (event.type === 'run_queued' || event.type === 'run_started') this.run(event);
    else if (event.type === 'error') this.run(event).errors.push(String(event.message ?? ''));
    else if (event.type === 'done') {
      const run = this.runs.get(event.runId);
      this.runs.delete(event.runId);
      // A person's private-chat message started it (not Discord, a group, a timer or a heartbeat), it ended on an
      // error, and nothing reached them. A Stop (by a person or the platform shutting down) is not a problem.
      if (run && run.errors.length && !run.published && event.fromChat === true && !event.stoppedBy)
        void this.stuck(event.agentId, run.errors[0]!).catch(this.fail);
    }
  }

  private async client() {
    await this.deps.platform.initialize();
    return this.deps.platform.client;
  }

  private async agentMessage(agentId: string, text: string) {
    const agent = await (await this.client()).agent.findUnique({ where: { id: agentId }, select: { name: true } });
    const owner = await this.deps.reach.ownerOfAgent(agentId);
    if (!agent || !owner) return;
    this.queue(owner, {
      kind: 'message',
      tag: `agent:${agentId}`,
      title: agent.name,
      text: plainText(text) || 'Sent files',
      url: `/chat/agents/${encodeURIComponent(agentId)}`,
      icon: `/api/agents/${encodeURIComponent(agentId)}/avatar.png`,
    });
  }

  private async groupMessage(groupId: string, authorId: string, author: string, text: string) {
    const group = await (await this.client()).groupChat.findUnique({ where: { id: groupId }, select: { name: true } });
    const owner = await this.deps.reach.ownerOf(await this.deps.reach.organizationOfGroup(groupId));
    if (!group || !owner) return;
    this.queue(owner, {
      kind: 'group',
      tag: `group:${groupId}`,
      title: group.name,
      text: plainText(`${author}: ${text}`) || `${author} sent files`,
      url: `/chat/groups/${encodeURIComponent(groupId)}`,
      icon: `/api/agents/${encodeURIComponent(authorId)}/avatar.png`,
    });
  }

  private async stuck(agentId: string, reason: string) {
    const agent = await (await this.client()).agent.findUnique({ where: { id: agentId }, select: { name: true } });
    const owner = await this.deps.reach.ownerOfAgent(agentId);
    if (!agent || !owner) return;
    this.queue(
      owner,
      {
        kind: 'stuck',
        tag: `stuck:${agentId}`,
        title: `${agent.name} couldn’t finish`,
        text: plainText(reason) || 'Its run ended on an error.',
        url: `/chat/agents/${encodeURIComponent(agentId)}`,
      },
      0,
    );
  }

  private async fallback(agentId: string, active: number, reason: string) {
    const agent = await (await this.client()).agent.findUnique({ where: { id: agentId }, select: { name: true } });
    const owner = await this.deps.reach.ownerOfAgent(agentId);
    if (!agent || !owner) return;
    this.queue(
      owner,
      {
        kind: 'stuck',
        tag: `model:${agentId}`,
        title: `${agent.name} switched to model #${active + 1}`,
        text: `Its #1 model failed${reason ? ` (${reason.replace(/\.$/, '')})` : ''}. Check that model's connection.`,
        url: `/agents/${encodeURIComponent(agentId)}`,
      },
      0,
    );
  }

  /** A critical event (security/alerts.ts): to every admin. */
  critical = (event: CriticalEvent) => {
    void (async () => {
      const admins = await (
        await this.client()
      ).user.findMany({ where: { role: 'admin', disabledAt: null }, select: { id: true } });
      for (const admin of admins)
        this.queue(
          admin.id,
          {
            kind: 'critical',
            tag: `alert:${event.kind}`,
            title: event.title,
            // A sign-in burst's detail names the accounts tried: whatever an attacker typed stays in the log.
            text:
              event.kind === 'signin-failures'
                ? 'See the sign-in log for the accounts and addresses tried.'
                : plainText(event.detail),
            url: CRITICAL_URL[event.kind] ?? '/dashboard',
          },
          0,
        );
    })().catch(this.fail);
  };

  /**
   * An event of the Swarm itself, now (no batching: a stop must go out before the process ends), to every person who
   * keeps that kind on. Presence is not checked: a restart forgets it, and a stop is worth knowing even in front of
   * the dashboard, which is about to disconnect.
   */
  async swarm(event: SwarmEvent, title: string, text: string) {
    const people = await (await this.client()).user.findMany({ where: { disabledAt: null }, select: { id: true } });
    await Promise.all(
      people.map(async ({ id }) => {
        if (!(await this.deps.store.preferences(id))[SWARM_PREFERENCE[event]]) return;
        await this.deps.sender.send(
          id,
          { title, body: text, tag: 'swarm', url: '/dashboard', timestamp: this.now(), renotify: true },
          'high',
        );
      }),
    );
  }

  /** "Send test notification": now, to every device of the person, whatever their settings and presence. */
  test(userId: string) {
    return this.deps.sender.send(
      userId,
      {
        title: 'Agent Swarm',
        body: 'Notifications work on this device.',
        tag: 'test',
        url: '/settings',
        timestamp: this.now(),
        renotify: true,
      },
      'high',
    );
  }

  private queue(userId: string, item: Item, delay = this.deps.debounceMs ?? DEBOUNCE_MS) {
    if (this.closed) return;
    const key = `${userId}\n${item.tag}`;
    const now = this.now();
    let batch = this.batches.get(key);
    if (!batch) this.batches.set(key, (batch = { userId, first: now, count: 0, latest: item }));
    batch.count++;
    batch.latest = item;
    clearTimeout(batch.timer);
    const wait = Math.max(0, Math.min(delay, batch.first + (this.deps.maxWaitMs ?? MAX_WAIT_MS) - now));
    batch.timer = setTimeout(() => void this.flush(key).catch(this.fail), wait);
    batch.timer.unref?.();
  }

  private async flush(key: string) {
    const batch = this.batches.get(key);
    if (!batch) return;
    this.batches.delete(key);
    const { userId, count, latest } = batch;
    const preferences = await this.deps.store.preferences(userId);
    if (!preferences[PREFERENCE[latest.kind]]) return;
    // In front of the dashboard: the in-app sound, unread marks and banners have it.
    if (this.deps.presence.present(userId)) return;
    const chat = latest.kind === 'message' || latest.kind === 'group';
    const payload: PushPayload = {
      title: chat && count > 1 ? `${latest.title} · ${count} new messages` : latest.title,
      body: chat && !preferences.preview ? (count > 1 ? 'New messages' : 'New message') : latest.text,
      tag: latest.tag,
      url: latest.url,
      ...(latest.icon ? { icon: latest.icon } : {}),
      timestamp: this.now(),
      renotify: true,
    };
    await this.deps.sender.send(userId, payload, 'high');
  }

  /** Sends what is waiting now (tests), or drops it (`close`). */
  async drain() {
    await Promise.all(
      [...this.batches.entries()].map(([key, batch]) => {
        clearTimeout(batch.timer);
        return this.flush(key);
      }),
    );
  }

  close() {
    this.closed = true;
    for (const batch of this.batches.values()) clearTimeout(batch.timer);
    this.batches.clear();
    this.runs.clear();
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Push notifications (tests drain or inspect them). */
    push: PushNotifier;
  }
}
