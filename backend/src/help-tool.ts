import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { ACCESS_MEANING, accessOf, classify, type AgentTool, type ToolAccess } from './tool-access';

/** The Knowledge entries that document each family of tools (first match wins). */
const KNOWLEDGE: [RegExp, string[]][] = [
  [/^discord_/, ['concepts/discord', 'practices/discord']],
  [/^terminal_/, ['concepts/computers/terminals', 'practices/terminals']],
  [/^(read|write|edit|bash)$/, ['concepts/computers/files', 'practices/files']],
  [/^(glance|look_at|run_actions)$/, ['concepts/computers/desktop', 'practices/desktop']],
  [/^(use_computer|list_computers)$/, ['concepts/computers', 'practices/computer-use']],
  [/^(watch_|monitor$)/, ['concepts/computers/watches', 'practices/waiting']],
  [/^(scratch_|present_scratch$)/, ['concepts/scratchpad']],
  [
    /^(list_files|read_file|upload_file|delete_file|copy_file|save_screenshot)$/,
    ['concepts/chat-files', 'practices/sharing-files'],
  ],
  [/^(current_time|set_timer|set_reminder|list_timers|cancel_timer)$/, ['concepts/time', 'practices/scheduling']],
  [
    /^(send_message|send_dm|list_dm_contacts|read_dm_|list_chats|read_messages|search_messages|read_group_messages|search_group_messages)/,
    ['concepts/channels', 'practices/communication'],
  ],
  [/^(react_to_message|read_reactions|search_emojis)$/, ['practices/communication']],
  [/_knowledge$|^help$/, ['concepts/tools']],
];
const knowledgeOf = (name: string) => KNOWLEDGE.find(([pattern]) => pattern.test(name))?.[1] ?? [];
const FIELDS = ['class', 'params', 'description', 'knowledge'] as const;
type Field = (typeof FIELDS)[number];

/**
 * help: the agent's own tools, filtered by which tools and which fields, so it pays only for what it asks
 * (prefill tokens). Classes come from the same declarations the platform enforces.
 */
export function createHelpTool(
  tools: () => AgentTool[],
  /** Where the agent is now, for what a class means (a heartbeat promotes on w and rw). */
  heartbeat: () => boolean = () => false,
): AgentTool {
  const [help] = classify({ help: 'r' }, [
    defineTool({
      name: 'help',
      label: 'Help',
      description:
        'Your own tools, filtered to save context: which tools (tools by name, class r/w/rw/claim, match a text in the name) and which fields (class by default; params, description, knowledge). Example: help({tools:["bash"], fields:["params"]}). Deeper guidance is in Knowledge.',
      parameters: Type.Object(
        {
          tools: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { minItems: 1, maxItems: 50 })),
          class: Type.Optional(
            Type.Union([Type.Literal('r'), Type.Literal('w'), Type.Literal('rw'), Type.Literal('claim')]),
          ),
          match: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
          fields: Type.Optional(
            Type.Array(Type.Union(FIELDS.map(field => Type.Literal(field))), { minItems: 1, maxItems: 4 }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_call, params) {
        const fields = new Set<Field>(params.fields ?? ['class']);
        const all = [...tools(), help];
        const unknown = (params.tools ?? []).filter(name => !all.some(tool => tool.name === name));
        const match = params.match?.toLowerCase();
        const chosen = all.filter(
          tool =>
            (!params.tools || params.tools.includes(tool.name)) &&
            (!params.class || accessOf(tool) === params.class) &&
            (!match || tool.name.toLowerCase().includes(match)),
        );
        const lines: string[] = [];
        if (unknown.length) lines.push(`Not your tools: ${unknown.join(', ')}.`);
        if (!chosen.length) {
          lines.push('No tool matches.');
          return { content: [{ type: 'text' as const, text: lines.join('\n') }], details: {} };
        }
        if (fields.has('class')) {
          const used = [...new Set(chosen.map(tool => accessOf(tool)!))];
          lines.push(`Classes: ${used.map(level => `${level} = ${ACCESS_MEANING[level]}`).join('; ')}.`);
          if (heartbeat() && used.some(level => level === 'w' || level === 'rw'))
            lines.push('In this heartbeat: r is free; the first w or rw call makes it your real turn.');
        }
        const simple = fields.size === 1 && fields.has('class');
        for (const tool of chosen) {
          if (simple) {
            lines.push(`${tool.name}: ${accessOf(tool)}`);
            continue;
          }
          const parts: string[] = [`# ${tool.name}${fields.has('class') ? ` (${accessOf(tool) as ToolAccess})` : ''}`];
          if (fields.has('description')) parts.push(tool.description);
          if (fields.has('params')) parts.push(`params: ${JSON.stringify(tool.parameters)}`);
          if (fields.has('knowledge')) {
            const entries = knowledgeOf(tool.name);
            parts.push(`knowledge: ${entries.length ? entries.join(', ') : 'none'}`);
          }
          lines.push(parts.join('\n'));
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n') }], details: {} };
      },
    }),
  ]);
  return help;
}
