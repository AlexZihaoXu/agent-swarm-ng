import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { classify, type AgentTool } from '../tool-access';
import { ComputerUseError } from './service';
import { WatchError } from './watches';
import { DEFAULT_LISTENER_EVENTS, LISTENER_EVENTS, LISTENER_MAX, type ClaudeCodeListeners } from './claude-listeners';

const reply = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: {},
  ...(isError ? { isError: true } : {}),
});
const guard = async (work: () => Promise<unknown>) => {
  try {
    return reply(await work());
  } catch (error) {
    if (error instanceof WatchError || error instanceof ComputerUseError) return reply({ error: error.message }, true);
    throw error;
  }
};

/**
 * Claude Code listeners (claude-listeners.ts): be woken by the Claude Code session in a terminal (finished, asks
 * permission or a question, failed, ended, messages from it) instead of watching its screen. Needs the Swarm assist
 * plugin in that computer's Claude Code (practices/harnesses/claude-code says how, with the human's consent).
 */
export function createClaudeListenerTools(
  listeners: ClaudeCodeListeners,
  agentId: string,
  human: () => boolean,
): AgentTool[] {
  return classify({ claude_code_listener_add: 'w', claude_code_listener_remove: 'w', claude_code_listener_list: 'r' }, [
    defineTool({
      name: 'claude_code_listener_add',
      label: 'Listen to Claude Code',
      description: `Wake me when the Claude Code session in a terminal does something, with no model watching the screen: finished (its turn ended, with the start of its answer), permission (it asks to use a tool), question (an MCP form or input it waits for), failure (an API error stopped it), session_end, message (it called notify_supervisor to tell you something), and on request idle (about a minute waiting for input) or session_start. Default: ${DEFAULT_LISTENER_EVENTS.join(', ')}. Works on the computer you read (use_computer) or the one you name, with an assignment only (no claim). It lasts across turns until claude_code_listener_remove, the session ends, the computer is no longer assigned to you, or the platform restarts. Adding again for the same terminal changes its events. Needs the Swarm assist plugin installed in that computer's Claude Code (see practices/harnesses/claude-code). At most ${LISTENER_MAX}.`,
      parameters: Type.Object(
        {
          terminal: Type.String({ minLength: 1, maxLength: 100, description: 'Terminal name or ID (terminal_list).' }),
          events: Type.Optional(
            Type.Array(Type.Union(LISTENER_EVENTS.map(event => Type.Literal(event))), { maxItems: 8 }),
          ),
          computer: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        },
        { additionalProperties: false },
      ),
      async execute(_call, params) {
        return guard(() => listeners.add(agentId, { ...params, human: human() }));
      },
    }),
    defineTool({
      name: 'claude_code_listener_remove',
      label: 'Stop listening to Claude Code',
      description: 'Stop a Claude Code listener, by terminal name or ID, or by listener ID.',
      parameters: Type.Object(
        {
          terminal: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          id: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
        },
        { additionalProperties: false },
      ),
      async execute(_call, params) {
        return guard(async () => {
          if (!params.terminal && !params.id) throw new WatchError('Name the terminal or the listener ID.');
          return (await listeners.remove(agentId, params))
            ? { removed: true }
            : { removed: false, note: 'No such listener; claude_code_listener_list shows yours.' };
        });
      },
    }),
    defineTool({
      name: 'claude_code_listener_list',
      label: 'List Claude Code listeners',
      description: 'Your Claude Code listeners: terminal, computer, events, how often each fired and when last.',
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        return reply({ listeners: listeners.list(agentId) });
      },
    }),
  ]);
}
