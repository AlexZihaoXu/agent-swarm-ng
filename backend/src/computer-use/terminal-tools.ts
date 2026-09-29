import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from '@sinclair/typebox';
import type { ComputerUseService, CoreReceipt } from './service';
const session = Type.String({
  pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$',
  description: 'Exact session ID returned by terminal_create/list, scoped to your currently claimed computer.',
});
const target = { session };
const keys = [
  'Enter',
  'Tab',
  'BTab',
  'Escape',
  'BSpace',
  'Delete',
  'Insert',
  'Space',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ...[...'abcdefghijklmnopqrstuvwxyz'].flatMap(c => [`C-${c}`, `M-${c}`]),
];
export const terminalParameters = {
  create: Type.Object(
    {
      name: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$' }),
      command: Type.Optional(Type.String({ minLength: 1, maxLength: 32768 })),
      cwd: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    },
    { additionalProperties: false },
  ),
  list: Type.Object({}, { additionalProperties: false }),
  view: Type.Object(
    {
      ...target,
      rows: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 200, description: 'Rows to show (default: one screen of the session).' }),
      ),
      up: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: 10000,
          description:
            'Scroll position: rows above the live bottom (default 0 = bottom). Use the value the result suggests.',
        }),
      ),
    },
    { additionalProperties: false },
  ),
  delete: Type.Object(target, { additionalProperties: false }),
  status: Type.Object(target, { additionalProperties: false }),
  resize: Type.Object(
    {
      ...target,
      columns: Type.Integer({ minimum: 40, maximum: 240 }),
      rows: Type.Integer({ minimum: 10, maximum: 80 }),
    },
    { additionalProperties: false },
  ),
};
const key = Type.Union(keys.map(name => Type.Literal(name)));
const terminalAction = Type.Union([
  Type.Object(
    {
      name: Type.Literal('keyboard.type'),
      params: Type.Object(
        {
          text: Type.String({ minLength: 1, maxLength: 32768 }),
          cpm: Type.Optional(
            Type.Union([Type.Number({ exclusiveMinimum: 0, maximum: 3200 }), Type.Literal('instant')], {
              description:
                'Characters (Unicode code points) per minute, default 800; "instant" pastes the text at once (bracketed paste).',
            }),
          ),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { name: Type.Literal('keyboard.press'), params: Type.Object({ key }, { additionalProperties: false }) },
    { additionalProperties: false },
  ),
]);
export const terminalActionsParameters = Type.Object(
  {
    ...target,
    actions: Type.Array(terminalAction, { minItems: 1, maxItems: 16 }),
    per_action_pause: Type.Optional(Type.Number({ minimum: 0, maximum: 10, default: 0.2 })),
  },
  { additionalProperties: false },
);
/** Operator-only operations. Kept out of `terminalParameters`, which defines the agent tools. */
const operatorOnlyParameters = {
  rename: Type.Object(
    { ...target, name: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$' }) },
    { additionalProperties: false },
  ),
  // Single inputs for the trusted operator API; agents use terminal_run_actions after terminal_view.
  type: Type.Object(
    { ...target, text: Type.String({ minLength: 1, maxLength: 32768 }) },
    { additionalProperties: false },
  ),
  press: Type.Object({ ...target, key }, { additionalProperties: false }),
  interrupt: Type.Object(target, { additionalProperties: false }),
  // Every session's visible screen with colour escapes, for the dashboard's live previews.
  screens: Type.Object({}, { additionalProperties: false }),
};
export const terminalRequest = Type.Union(
  Object.entries({ ...terminalParameters, ...operatorOnlyParameters }).map(([operation, schema]) =>
    Type.Object({ operation: Type.Literal(operation), ...schema.properties }, { additionalProperties: false }),
  ),
);
export type TerminalRequest = Static<typeof terminalRequest>;
const descriptions = {
  create:
    'Create a named persistent tmux terminal (32/computer, names unique ignoring case). Default interactive Bash; optional command runs bash -lc and leaves an exited pane/output when finished. cwd defaults ~/Desktop; ~/ and relative paths resolve under /home/agent. Returns stable session ID. Starts at 120×36 (see terminal_resize). Does not wait for a command to finish.',
  list: 'List managed tmux sessions on this computer. Shared with other authorized agents and the operator; not private agent memory.',
  view: 'Look at the terminal like a human: by default the current screen (the session rows) at the live bottom. Scroll with up (rows above the bottom) and rows (window size ≤200); the result reports the row range, total rows, and the up value for earlier or later output. Plain text ≤50000 UTF-8 bytes. tmux retains 10000 history rows in memory, not a permanent log. A snapshot, not incremental stdout/stderr; full-screen applications may redraw it. A successful view allows five terminal_run_actions calls on THIS session within 90 real seconds.',
  delete:
    'Kill this tmux session and discard its screen/history. Destructive: may terminate its running programs. Deliberately detached/external programs are not guaranteed to stop. Inspect the exact session before deleting.',
  status:
    'Read actual pane alive/exited status, exit code when tmux has one, cwd, foreground command and size. A running interactive shell is NOT proof that its last command succeeded or that a task is complete.',
  resize:
    'Change the session grid to columns 40..240 × rows 10..80 (default 120×36). Programs see a terminal resize; every open viewer follows. Prefer the default unless output needs more room.',
};
export function createTerminalTools(service: ComputerUseService, agentId: string): ToolDefinition[] {
  const common =
    'Requires your currently assigned and claimed computer; guest uid1000 only, no platform-host access. Read swarm/computers/terminals. Await each computer operation. Sessions/programs survive tool calls, turn completion, browser disconnect, backend restart and claim release; stopping/replacing the computer ends them. Cancellation stops further API input, not persistent programs. ';
  const reply = (receipt: CoreReceipt) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(receipt.error ? { error: receipt.error, started: receipt.started } : receipt.result),
      },
    ],
    details: {},
    isError: Boolean(receipt.error),
  });
  return [
    ...(Object.keys(terminalParameters) as (keyof typeof terminalParameters)[]).map(operation =>
      defineTool({
        name: `terminal_${operation}`,
        label: `Terminal ${operation}`,
        parameters: terminalParameters[operation],
        description: common + descriptions[operation],
        async execute(_call, params, signal) {
          const request = { ...params, kind: 'terminal', operation };
          return reply(
            operation === 'view'
              ? await service.terminalView(agentId, request as { session: string }, signal)
              : await service.core(agentId, request, signal),
          );
        },
      }),
    ),
    defineTool({
      name: 'terminal_run_actions',
      label: 'Run terminal combo',
      parameters: terminalActionsParameters,
      description:
        common +
        'Execute 1–16 ordered keyboard actions in one session: keyboard.type (literal text, never key names; no Enter appended; typed newlines execute) at cpm characters per minute (default 800, max 3200, counting Unicode code points) or cpm:"instant" to paste at once, and keyboard.press (one enumerated key: Enter, Tab/BTab, Escape, BSpace, Delete/Insert, Space, arrows, Home/End/PageUp/PageDown, F1..F12, C-a..C-z incl. C-c to interrupt, M-a..M-z). Requires a terminal_view of THIS session within the past 90 real seconds with fewer than five combos since. The whole combo is validated before any input: typing time plus pauses ≤30 seconds. Default pause between actions 0.2s. Input is not atomic: on an error, view before retrying; never retry blindly. Verify the outcome with terminal_view.',
      async execute(_call, { session, actions, per_action_pause }, signal) {
        return reply(
          await service.terminalActions(
            agentId,
            {
              kind: 'terminal',
              operation: 'actions',
              session,
              actions: actions.map(action =>
                action.name === 'keyboard.press'
                  ? { type: 'press', key: action.params.key }
                  : { type: 'type', ...action.params },
              ),
              ...(per_action_pause === undefined ? {} : { pause: per_action_pause }),
            },
            signal,
          ),
        );
      },
    }),
  ];
}
