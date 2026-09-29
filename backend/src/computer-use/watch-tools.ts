import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import {
  WATCH_DEFAULT_TIMEOUT_SECONDS,
  WATCH_FORK_BELOW_SECONDS,
  WATCH_MAX_ACTIVE,
  WATCH_MAX_SECONDS,
  WATCH_MAX_TIMEOUT_SECONDS,
  WATCH_MIN_SECONDS,
  WATCH_UNTIL_MAX,
  WatchError,
  type ComputerWatches,
  type WatchSpec,
} from './watches';
import { ComputerUseError } from './service';
import { WATCH_MAX_TURNS } from './watch-judge';

const reply = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: {},
  ...(isError ? { isError: true } : {}),
});
const coordinate = Type.Number({ minimum: 0, maximum: 999 });
const common = {
  until: Type.String({
    minLength: 1,
    maxLength: WATCH_UNTIL_MAX,
    description:
      'The condition, written for the watcher that checks it (it sees only this, the view and the facts below): what counts as done, and anything else worth waking you for.',
  }),
  every_seconds: Type.Optional(
    Type.Number({
      minimum: WATCH_MIN_SECONDS,
      maximum: WATCH_MAX_SECONDS,
      description: `Seconds between checks (default ${WATCH_MIN_SECONDS}).`,
    }),
  ),
  timeout_seconds: Type.Optional(
    Type.Number({
      minimum: WATCH_MIN_SECONDS,
      maximum: WATCH_MAX_TIMEOUT_SECONDS,
      description: `Give up after this long (default: the larger of ${WATCH_DEFAULT_TIMEOUT_SECONDS} and 10 × every_seconds; at most 24 hours). You are told when it times out.`,
    }),
  ),
  check_now: Type.Optional(
    Type.Boolean({ description: 'First check immediately (default true); false waits one interval.' }),
  ),
  context: Type.Optional(
    Type.Union([Type.Literal('fresh'), Type.Literal('fork')], {
      description: `fresh (default): a new watcher with only your condition. fork: a copy of your own conversation decides, for conditions that need your context; allowed only when every_seconds is below ${WATCH_FORK_BELOW_SECONDS}.`,
    }),
  ),
};
const facts = `Once only: the first check that finds the condition wakes you with one platform event (the watcher's report) and removes the watch; set a new watch to keep watching. Each check a watcher (your own model, up to ${WATCH_MAX_TURNS} turns, look-only tools) gets your condition, the current view, the view when the watch started, and how long the view has been unchanged (it never skips a check because nothing changed). You are also woken, and the watch removed, when it times out, when a check fails, or when you lose the computer; your own release or cancel_timer ends it quietly. At most ${WATCH_MAX_ACTIVE} watches; list_timers shows them. A watch neither types nor clicks, and grants no input allowance: look yourself after waking. Watches end on a platform restart (you are told). Read Swarm Knowledge practices/waiting before first use.`;

export function createWatchTools(
  watches: ComputerWatches,
  agentId: string,
  humanAuthority: () => boolean,
): ToolDefinition[] {
  const create = async (spec: Omit<WatchSpec, 'human'>) => {
    try {
      return reply(await watches.create(agentId, { ...spec, human: humanAuthority() }));
    } catch (error) {
      if (error instanceof WatchError || error instanceof ComputerUseError)
        return reply({ error: error.message }, true);
      throw error;
    }
  };
  const options = (params: {
    until: string;
    every_seconds?: number;
    timeout_seconds?: number;
    check_now?: boolean;
    context?: 'fresh' | 'fork';
  }) => ({
    until: params.until,
    everySeconds: params.every_seconds ?? WATCH_MIN_SECONDS,
    timeoutSeconds: params.timeout_seconds,
    checkNow: params.check_now,
    context: params.context,
  });
  return [
    defineTool({
      name: 'watch_terminal',
      label: 'Watch terminal',
      description: `Wake me once when something happens in a terminal on the computer I hold, e.g. a long command or a coding agent finishes and waits at its prompt, a test run fails, a server prints "ready". Instead of waiting or re-viewing, set this and end your turn. ${facts}`,
      parameters: Type.Object(
        {
          session: Type.String({
            pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$',
            description: 'Exact session ID from terminal_create/list.',
          }),
          ...common,
        },
        { additionalProperties: false },
      ),
      async execute(_call, params) {
        return create({ kind: 'terminal', session: params.session, ...options(params) });
      },
    }),
    defineTool({
      name: 'watch_desktop',
      label: 'Watch desktop',
      description: `Wake me once when something changes on the desktop of the computer I hold, e.g. a download or install finishes, a dialog appears, a page finishes loading, a value in one part of the screen changes. region {x,y,size} (like look_at, [0,999]) focuses the watcher on one area; the whole screen otherwise. Needs a vision model. ${facts}`,
      parameters: Type.Object(
        {
          region: Type.Optional(
            Type.Object(
              { x: coordinate, y: coordinate, size: Type.Number({ exclusiveMinimum: 0, maximum: 999 }) },
              { additionalProperties: false },
            ),
          ),
          ...common,
        },
        { additionalProperties: false },
      ),
      async execute(_call, params, _signal, _update, ctx) {
        if (!ctx?.model?.input.includes('image'))
          return reply({ error: 'Watching the desktop needs a vision model; watch a terminal instead.' }, true);
        return create({ kind: 'desktop', region: params.region, ...options(params) });
      },
    }),
  ];
}
