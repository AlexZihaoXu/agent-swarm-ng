import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { classify, type AgentTool } from '../tool-access';
import { Type } from '@sinclair/typebox';
import {
  WATCH_DEFAULT_TIMEOUT_SECONDS,
  WATCH_FORK_BELOW_SECONDS,
  WATCH_MAX_ACTIVE,
  WATCH_MAX_SECONDS,
  WATCH_MAX_TIMEOUT_SECONDS,
  WATCH_MIN_SECONDS,
  WATCH_UNTIL_MAX,
  WATCH_REPEAT_DEFAULT_COOLDOWN_SECONDS,
  WATCH_REPEAT_DEFAULT_MAX_FIRES,
  WATCH_REPEAT_MAX_FIRES,
  WatchError,
  type ComputerWatches,
  type WatchSpec,
} from './watches';
import { ComputerUseError } from './service';
import { WATCH_MAX_TURNS } from './watch-judge';
import {
  MONITOR_COMMAND_MAX,
  MONITOR_DEFAULT_MAX_EVENTS,
  MONITOR_DEFAULT_TIMEOUT_SECONDS,
  MONITOR_MAX_ACTIVE,
  MONITOR_MAX_EVENTS,
  MONITOR_MAX_TIMEOUT_SECONDS,
} from './monitors';

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
      description: `Give up after this long: at least every_seconds, at most 24 hours (default: the larger of ${WATCH_DEFAULT_TIMEOUT_SECONDS} and 10 × every_seconds). Every watch gets at least one check. You are told when it times out.`,
    }),
  ),
  check_now: Type.Optional(
    Type.Boolean({ description: 'First check immediately (default true); false waits one interval.' }),
  ),
  repeat: Type.Optional(
    Type.Object(
      {
        cooldown_seconds: Type.Optional(
          Type.Number({
            minimum: WATCH_MIN_SECONDS,
            maximum: WATCH_MAX_SECONDS,
            description: `Least time between two wake-ups (default the larger of ${WATCH_REPEAT_DEFAULT_COOLDOWN_SECONDS} and every_seconds); firings meanwhile are merged into one.`,
          }),
        ),
        max_fires: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: WATCH_REPEAT_MAX_FIRES,
            description: `End after this many firings (default ${WATCH_REPEAT_DEFAULT_MAX_FIRES}).`,
          }),
        ),
      },
      {
        additionalProperties: false,
        description:
          'Keep watching after it fires (omit for once only): it fires once per occurrence (again only after the condition clears and comes back), pauses while you handle a wake-up, and merges firings that come faster than the cooldown. Use for recurring events (each failing test run, each new error); it costs a model check per interval for as long as it runs.',
      },
    ),
  ),
  context: Type.Optional(
    Type.Union([Type.Literal('fresh'), Type.Literal('fork')], {
      description: `fresh (default): a new watcher with only your condition. fork: a copy of your own conversation decides, for conditions that need your context; allowed only when every_seconds is below ${WATCH_FORK_BELOW_SECONDS}.`,
    }),
  ),
};
const facts = `Once only by default: the first check that finds the condition wakes you with one platform event (the watcher's report) and removes the watch; repeat keeps it watching (see repeat). Each check a watcher (your own model, up to ${WATCH_MAX_TURNS} turns and 120 s, 240 s for a fork, look-only tools) gets your condition, the current view, the view when the watch started, and how long the view has been unchanged (it never skips a check because nothing changed). You are also woken, and the watch removed, when it times out, when a check fails (a repeating watch: three in a row), when the watched terminal is gone, or when you lose the computer; your own release, cancel_timer or deleting the watched terminal ends it quietly. At most ${WATCH_MAX_ACTIVE} watches; list_timers shows them. A watch neither types nor clicks, and grants no input allowance: look yourself after waking. Watches end on a platform restart (you are told). Read Swarm Knowledge practices/waiting before first use.`;

export function createWatchTools(
  watches: ComputerWatches,
  agentId: string,
  humanAuthority: () => boolean,
): AgentTool[] {
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
    repeat?: { cooldown_seconds?: number; max_fires?: number };
  }) => ({
    until: params.until,
    everySeconds: params.every_seconds ?? WATCH_MIN_SECONDS,
    timeoutSeconds: params.timeout_seconds,
    checkNow: params.check_now,
    context: params.context,
    ...(params.repeat
      ? { repeat: { cooldownSeconds: params.repeat.cooldown_seconds, maxFires: params.repeat.max_fires } }
      : {}),
  });
  const monitors = watches.monitors;
  const monitorTool = monitors
    ? [
        defineTool({
          name: 'monitor',
          label: 'Monitor a command',
          description: `Wake me with the output of a command running on the computer I hold, with no model in the loop: each line it prints is an event. Use it for exact signals (a log line, a file appearing, a port opening): tail -F /tmp/build/log | grep --line-buffered -E "ERROR|FAILED|ready". For a program in a terminal, start it there with its output teed to a file in /tmp and monitor that file. Filter for failures as well as success: silence is not success. Lines printed close together come as one wake-up; while I handle a wake-up, output waits and comes in one wake-up after my turn ends. It stops on its own at timeout_seconds (default ${MONITOR_DEFAULT_TIMEOUT_SECONDS / 60} minutes, at most 24 hours), after max_events wake-ups (default ${MONITOR_DEFAULT_MAX_EVENTS}), if it prints more than 300 lines in 10 seconds, when the command exits, or when I lose the computer; I am told why. Releasing the computer, or cancel_timer, stops it quietly. At most ${MONITOR_MAX_ACTIVE} at once; list_timers shows them. It runs as the agent user in my home folder: the command can do anything that user can (it is not read-only), and it grants no screenshot allowance. Stopping it sends SIGTERM to its process group; a program that detaches itself keeps running. Read Swarm Knowledge practices/waiting before first use.`,
          parameters: Type.Object(
            {
              command: Type.String({
                minLength: 1,
                maxLength: MONITOR_COMMAND_MAX,
                description: 'A shell command whose stdout lines wake me (stderr is not an event).',
              }),
              timeout_seconds: Type.Optional(Type.Number({ minimum: 60, maximum: MONITOR_MAX_TIMEOUT_SECONDS })),
              max_events: Type.Optional(Type.Integer({ minimum: 1, maximum: MONITOR_MAX_EVENTS })),
            },
            { additionalProperties: false },
          ),
          async execute(_call, params) {
            try {
              return reply(
                await monitors.create(agentId, {
                  command: params.command,
                  timeoutSeconds: params.timeout_seconds,
                  maxEvents: params.max_events,
                  human: humanAuthority(),
                }),
              );
            } catch (error) {
              if (error instanceof WatchError || error instanceof ComputerUseError)
                return reply({ error: error.message }, true);
              throw error;
            }
          },
        }),
      ]
    : [];
  return classify({ monitor: 'w', watch_terminal: 'w', watch_desktop: 'w' }, [
    ...monitorTool,
    defineTool({
      name: 'watch_terminal',
      label: 'Watch terminal',
      description: `Wake me when something happens in a terminal on the computer I hold, e.g. a long command or a coding agent finishes and waits at its prompt, a test run fails, a server prints "ready". Instead of waiting or re-viewing, set this and end your turn. For Claude Code, use claude_code_listener_add instead (its own events, at once, no model checks; needs the Swarm assist plugin: practices/harnesses/claude-code). ${facts}`,
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
      description: `Wake me when something changes on the desktop of the computer I hold, e.g. a download or install finishes, a dialog appears, a page finishes loading, a value in one part of the screen changes. region {x,y,size} (like look_at, [0,999]) focuses the watcher on one area; the whole screen otherwise. Needs a vision model. ${facts}`,
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
  ]);
}
