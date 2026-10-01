import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { classify, type AgentTool } from './tool-access';
import { Type } from '@sinclair/typebox';
import {
  MAX_ACTIVE_TIMERS,
  MAX_DELAY_SECONDS,
  MIN_REMINDER_SECONDS,
  TIMER_NOTE_MAX,
  TimerError,
  type AgentTimers,
} from './agent-timers';
import type { ComputerWatches } from './computer-use/watches';

const reply = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: {},
  ...(isError ? { isError: true } : {}),
});
/** Timer mistakes (a bad range, too many timers) are the agent's to correct, not failures of the platform. */
const guarded = async (work: () => Promise<unknown>) => {
  try {
    return reply(await work());
  } catch (error) {
    if (error instanceof TimerError) return reply({ error: error.message }, true);
    throw error;
  }
};
const note = Type.String({
  maxLength: TIMER_NOTE_MAX,
  description: `Up to ${TIMER_NOTE_MAX} characters, shown when it fires.`,
});

/** The platform clock in a given IANA time zone (the server's own zone by default). */
export function currentTime(timeZone?: string, now = new Date()) {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'long',
    timeZoneName: 'longOffset',
  }).format(now);
  return { utc: now.toISOString(), unixMs: now.getTime(), timeZone: zone, local };
}

/**
 * Time awareness for every agent, with or without a computer: the current time, one-shot timers and repeating
 * reminders that wake the agent with a platform event. Not cron: the agent computes delays itself.
 */
export function createTimeTools(
  timers: AgentTimers,
  agentId: string,
  humanAuthority: () => boolean,
  watches?: ComputerWatches,
): AgentTool[] {
  return classify({ current_time: 'r', set_timer: 'w', set_reminder: 'w', list_timers: 'r', cancel_timer: 'w' }, [
    defineTool({
      name: 'current_time',
      label: 'Current time',
      description:
        'The current date and time (UTC, Unix ms, and local time in an IANA time zone such as "America/Toronto"; the platform zone by default). Use it before computing a delay for set_timer or set_reminder. Read practices/scheduling for scheduling patterns.',
      parameters: Type.Object(
        { timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })) },
        { additionalProperties: false },
      ),
      async execute(_call, { timezone }) {
        try {
          return reply(currentTime(timezone));
        } catch {
          return reply({ error: 'Unknown time zone; use an IANA name such as "Europe/London".' }, true);
        }
      },
    }),
    defineTool({
      name: 'set_timer',
      label: 'Set timer',
      description: `Wake yourself once after a number of seconds (1..${MAX_DELAY_SECONDS}, i.e. up to 30 days; accurate to about a second). When it fires you receive a platform event with your note, in your own turn: if you are idle it starts one; if you are busy it arrives like a new message. Typical use: start something long, set_timer({seconds:60, note:"check the build in terminal X"}), then finish your turn instead of waiting. Survives restarts. At most ${MAX_ACTIVE_TIMERS} timers and reminders at once.`,
      parameters: Type.Object(
        { seconds: Type.Number({ minimum: 1, maximum: MAX_DELAY_SECONDS }), note: Type.Optional(note) },
        { additionalProperties: false },
      ),
      async execute(_call, { seconds, note }) {
        return guarded(() =>
          timers.create(agentId, { kind: 'timer', delaySeconds: seconds, note, human: humanAuthority() }),
        );
      },
    }),
    defineTool({
      name: 'set_reminder',
      label: 'Set reminder',
      description: `A repeating reminder: fires every every_seconds (${MIN_REMINDER_SECONDS}..${MAX_DELAY_SECONDS}), times times in all (1 or more; leave out to repeat until cancel_timer). The first firing is start_in_seconds from now (default: one interval). Each firing wakes you with your note (required, up to ${TIMER_NOTE_MAX} characters), its index/total, the previous firing time, and whether it is the last. Survives restarts; occurrences missed while the platform was offline are counted, not replayed.`,
      parameters: Type.Object(
        {
          every_seconds: Type.Number({ minimum: MIN_REMINDER_SECONDS, maximum: MAX_DELAY_SECONDS }),
          times: Type.Optional(Type.Integer({ minimum: 1 })),
          note: Type.String({ minLength: 1, maxLength: TIMER_NOTE_MAX }),
          start_in_seconds: Type.Optional(Type.Number({ minimum: 0, maximum: MAX_DELAY_SECONDS })),
        },
        { additionalProperties: false },
      ),
      async execute(_call, { every_seconds, times, note, start_in_seconds }) {
        return guarded(() =>
          timers.create(agentId, {
            kind: 'reminder',
            delaySeconds: start_in_seconds ?? every_seconds,
            everySeconds: every_seconds,
            times,
            note,
            human: humanAuthority(),
          }),
        );
      },
    }),
    defineTool({
      name: 'list_timers',
      label: 'List timers',
      description:
        'Your pending timers and reminders, soonest first, with their ids, notes and next firing time, and your computer watches (watch_terminal/watch_desktop) and monitors (monitor), under watches, with their next check or output and timeout.',
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        const watching = watches?.list(agentId) ?? [];
        return reply({ timers: await timers.list(agentId), ...(watching.length ? { watches: watching } : {}) });
      },
    }),
    defineTool({
      name: 'cancel_timer',
      label: 'Cancel timer',
      description:
        'Cancel one of your timers, reminders, computer watches or monitors by id (from set_timer, set_reminder, watch_terminal, watch_desktop, monitor or list_timers).',
      parameters: Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false }),
      async execute(_call, { id }) {
        const cancelled = (await watches?.cancel(agentId, id)) || (await timers.cancel(agentId, id));
        return reply(
          cancelled ? { cancelled: true, id } : { error: 'No such timer, reminder, watch or monitor of yours.' },
          !cancelled,
        );
      },
    }),
  ]);
}

export const TIME_GUIDANCE = `## Time, timers and reminders
You have a sense of time. Call current_time instead of guessing the date or time. To come back to something later, set_timer({seconds, note}) and end your turn rather than waiting or polling; the note (up to 256 characters) is what you will see when it fires. set_reminder repeats every N seconds for a number of times (or until cancel_timer). A firing arrives as a platform event, not a human message: act on your note and message the human only if useful. There is no cron yet: compute the delay to a clock time yourself and chain timers for recurring schedules. Read Swarm Knowledge practices/waiting and practices/scheduling before relying on these for anything scheduled.`;
