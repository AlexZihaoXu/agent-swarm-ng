import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { classify, type AgentTool } from '../tool-access';
import { ComputerUseError } from './service';
import type { ScreenshotPool } from './image-pool';
import { AgentRecordings, DESKTOP_EVENTS, RecordingError, TERMINAL_EVENTS, type EventRule } from './recordings';
import type { SwarmSettingsStore } from '../swarm-settings';

const reply = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: {},
  ...(isError ? { isError: true } : {}),
});
const rule = Type.Union([
  Type.String({ minLength: 1, maxLength: 40 }),
  Type.Object(
    {
      on: Type.String({ minLength: 1, maxLength: 40 }),
      before: Type.Optional(Type.Number({ minimum: 0, maximum: 30 })),
      after: Type.Optional(Type.Number({ minimum: 0, maximum: 30 })),
    },
    { additionalProperties: false },
  ),
]);
const rulesOf = (events?: (string | { on: string; before?: number; after?: number })[]) =>
  events &&
  (Object.fromEntries(
    events.map(item => (typeof item === 'string' ? [item, {}] : [item.on, { before: item.before, after: item.after }])),
  ) as Record<string, EventRule>);
const failing = async <T>(work: () => Promise<T>) => {
  try {
    return reply(await work());
  } catch (error) {
    if (error instanceof RecordingError || error instanceof ComputerUseError)
      return reply({ error: error.message }, true);
    throw error;
  }
};

/**
 * Agent recordings: record a computer's desktop (with its sound) or a terminal, as one whole video or as clips around
 * events; kept alive by a lease the agent renews. See Knowledge concepts/computers/recording.
 */
export function createRecordingTools(
  recordings: AgentRecordings,
  agentId: string,
  humanAuthority: () => boolean,
  images: ScreenshotPool,
  settings: SwarmSettingsStore,
): AgentTool[] {
  return classify(
    { start_recording: 'rw', renew_recording: 'w', stop_recording: 'rw', mark_clip: 'w', recording_events: 'r' },
    [
      defineTool({
        name: 'start_recording',
        label: 'Start recording',
        description:
          'Record a computer you can read (the one you read or hold, or computer: an assigned one): sources is a list of "desktop" (screen, cursor and sound) and/or {terminal: <session ID>} (that terminal only), up to 3. mode "session" keeps everything as one video per source; mode "events" keeps only clips around events: for a desktop source its desktop actions (run_actions), for a terminal source the actions typed into that terminal (terminal_run_actions), plus mark_clip; nothing else counts. events picks types with their padding, e.g. [{on:"mouse.move_to", before:2.5, after:2.5}, {on:"keyboard.type", before:1.5, after:3}, "mark"] (recording_events lists them; omitted = all of the sources\' events at the default padding). keep_start/keep_end keep the untrimmed start or end (see their descriptions). Saved in ~/Videos/agent-recordings/<time>_<you>/ on that computer as clip-NN-<source>.mp4 (+ .cast for terminals) with events.log. It stops and saves by itself unless you renew_recording within the lease (you are reminded halfway). hide_typed:true logs typed text only as a length (use it when typing secrets). Read Swarm Knowledge concepts/computers/recording first.',
        parameters: Type.Object(
          {
            sources: Type.Array(
              Type.Union([
                Type.Literal('desktop'),
                Type.Object(
                  { terminal: Type.String({ minLength: 36, maxLength: 36 }) },
                  { additionalProperties: false },
                ),
              ]),
              { minItems: 1, maxItems: 3 },
            ),
            mode: Type.Union([Type.Literal('session'), Type.Literal('events')]),
            computer: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
            to: Type.Optional(
              Type.String({
                minLength: 1,
                maxLength: 200,
                description: 'A folder in the computer home instead of ~/Videos/agent-recordings/<time>_<you>.',
              }),
            ),
            fps: Type.Optional(
              Type.Integer({
                minimum: 1,
                maximum: 60,
                description: 'Desktop up to 60, terminal up to 30; Settings defaults.',
              }),
            ),
            events: Type.Optional(Type.Array(rule, { minItems: 1, maxItems: 20 })),
            hide_typed: Type.Optional(Type.Boolean()),
            audio: Type.Optional(Type.Boolean({ description: 'Desktop sound (default true).' })),
            keep_start: Type.Optional(
              Type.Boolean({
                description:
                  'Events mode: the first clip reaches back to the moment recording started (nothing before the first event is cut).',
              }),
            ),
            keep_end: Type.Optional(
              Type.Boolean({
                description:
                  'Events mode: the last clip runs on until the recording stops (nothing after the last event is cut). With keep_start and no events at all: the whole recording.',
              }),
            ),
          },
          { additionalProperties: false },
        ),
        async execute(_call, params) {
          return failing(() =>
            recordings.start(agentId, {
              computer: params.computer,
              to: params.to,
              sources: params.sources,
              mode: params.mode,
              fps: params.fps,
              events: rulesOf(params.events),
              hideTyped: params.hide_typed,
              audio: params.audio,
              keepStart: params.keep_start,
              keepEnd: params.keep_end,
              human: humanAuthority(),
            }),
          );
        },
      }),
      defineTool({
        name: 'renew_recording',
        label: 'Renew recording',
        description:
          'Keep all your recordings going for another lease (one call renews them all). Optionally change your events-mode recordings from now on: events replaces their event rules (each source keeps its own kinds), keep_start/keep_end turn the untrimmed start or end on or off.',
        parameters: Type.Object(
          {
            events: Type.Optional(Type.Array(rule, { minItems: 1, maxItems: 20 })),
            keep_start: Type.Optional(
              Type.Boolean({
                description:
                  'Events mode: the first clip reaches back to the moment recording started (nothing before the first event is cut).',
              }),
            ),
            keep_end: Type.Optional(
              Type.Boolean({
                description:
                  'Events mode: the last clip runs on until the recording stops (nothing after the last event is cut). With keep_start and no events at all: the whole recording.',
              }),
            ),
          },
          { additionalProperties: false },
        ),
        async execute(_call, params) {
          return failing(() =>
            recordings.renew(agentId, rulesOf(params.events), {
              keepStart: params.keep_start,
              keepEnd: params.keep_end,
            }),
          );
        },
      }),
      defineTool({
        name: 'mark_clip',
        label: 'Mark a clip',
        description:
          'Mark this moment in your events-mode recordings: a clip is kept around it. Its padding is before/after if you give them (seconds, 0–30, this mark only), else the "mark" rule of start_recording\'s events, else the default padding; a mark with its own padding counts even if you chose no "mark" rule. label is written in events.log.',
        parameters: Type.Object(
          {
            label: Type.Optional(Type.String({ maxLength: 200 })),
            before: Type.Optional(
              Type.Number({ minimum: 0, maximum: 30, description: 'Seconds kept before this mark.' }),
            ),
            after: Type.Optional(
              Type.Number({ minimum: 0, maximum: 30, description: 'Seconds kept after this mark.' }),
            ),
          },
          { additionalProperties: false },
        ),
        async execute(_call, params) {
          return failing(() =>
            recordings.mark(agentId, params.label, {
              ...(params.before !== undefined ? { before: params.before } : {}),
              ...(params.after !== undefined ? { after: params.after } : {}),
            }),
          );
        },
      }),
      defineTool({
        name: 'stop_recording',
        label: 'Stop recording',
        description:
          'Stop and save your recordings (all, or one id). Returns the saved files and one contact sheet of stills to check what was captured before you share anything (upload_file from computer:<name>:<path>). Saving events-mode clips can take a little while.',
        parameters: Type.Object(
          { id: Type.Optional(Type.String({ minLength: 36, maxLength: 36 })) },
          { additionalProperties: false },
        ),
        async execute(_call, params, _signal, _update, ctx) {
          try {
            const results = await recordings.stop(agentId, params.id);
            const sheet = results.find(result => result.sheet)?.sheet;
            const text = {
              saved: results.map(({ sheet: _sheet, ...result }) => result),
              note: 'Recordings are files on the computer; share one with upload_file, then send_message or discord_send_message with its fileId.',
            };
            if (!sheet || !ctx?.model?.input.includes('image')) return reply(text);
            const reference = await images.put(agentId, {
              mimeType: 'image/jpeg',
              data: Buffer.from(sheet.data, 'base64'),
              width: sheet.width,
              height: sheet.height,
              bounds: [],
            });
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ ...text, stills: 'A contact sheet of stills is attached.' }),
                },
                { type: 'image' as const, data: sheet.data, mimeType: 'image/jpeg' },
              ],
              details: { computerImage: reference },
            };
          } catch (error) {
            if (error instanceof RecordingError) return reply({ error: error.message }, true);
            throw error;
          }
        },
      }),
      defineTool({
        name: 'recording_events',
        label: 'Recording events',
        description:
          'The event types a recording can clip around, with the default padding: desktop recordings use desktop actions, terminal recordings the actions typed into that terminal, and mark is for both. match filters by name.',
        parameters: Type.Object(
          {
            match: Type.Optional(Type.String({ maxLength: 40 })),
            source: Type.Optional(Type.Union([Type.Literal('desktop'), Type.Literal('terminal')])),
          },
          { additionalProperties: false },
        ),
        async execute(_call, params) {
          const current = await settings.get();
          const padding = { before: current.recordingPadBeforeMs / 1000, after: current.recordingPadAfterMs / 1000 };
          const rows = [
            ...DESKTOP_EVENTS.map(type => ({ type, source: 'desktop' })),
            ...TERMINAL_EVENTS.map(type => ({ type, source: 'terminal' })),
            { type: 'mark', source: 'desktop, terminal' },
          ].filter(
            row =>
              (!params.source || row.source.includes(params.source)) &&
              (!params.match || row.type.includes(params.match.toLowerCase())),
          );
          return reply({ defaults: padding, events: rows });
        },
      }),
    ],
  );
}
