import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { classify, type AgentTool } from '../tool-access';
import { ComputerUseError } from './service';
import { WatchError } from './watches';
import { DEFAULT_LISTENER_EVENTS, LISTENER_EVENTS, LISTENER_MAX, type HarnessListeners } from './harness-listeners';

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
 * Harness listeners (harness-listeners.ts): be woken by the coding harness in a terminal (Claude Code, Codex, OpenCode,
 * Pi: finished, asks permission or a question, failed, ended, messages from it) instead of watching its screen. Needs
 * Harness assist installed for that harness (practices/harnesses says how, with the human's consent).
 */
export function createHarnessListenerTools(
  listeners: HarnessListeners,
  agentId: string,
  human: () => boolean,
): AgentTool[] {
  return classify({ harness_listener_add: 'w', harness_listener_remove: 'w', harness_listener_list: 'r' }, [
    defineTool({
      name: 'harness_listener_add',
      label: 'Listen to a coding harness',
      description: `Wake me when the coding harness in a terminal (Claude Code, Codex, OpenCode or Pi) does something, with no model watching the screen: finished (its turn ended, with the start of its answer), permission (it asks to use a tool), question (it waits for an answer), failure (an error stopped it), session_end, message (it called notify_supervisor to tell you something), and on request idle (Claude Code: about a minute waiting) or session_start. Not every harness reports every event (practices/harnesses). Default: ${DEFAULT_LISTENER_EVENTS.join(', ')}. Works on the computer you read (use_computer) or the one you name, with an assignment only (no claim). It lasts across turns until harness_listener_remove, the session ends, the computer is no longer assigned to you, or the platform restarts. Adding again for the same terminal changes its events. Needs Harness assist installed for that harness on the computer: /opt/swarm/harness-assist/install --status shows which have it; practices/harnesses says how to install, after asking the human. At most ${LISTENER_MAX}.`,
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
      name: 'harness_listener_remove',
      label: 'Stop listening to a harness',
      description: 'Stop a harness listener, by terminal name or ID, or by listener ID.',
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
            : { removed: false, note: 'No such listener; harness_listener_list shows yours.' };
        });
      },
    }),
    defineTool({
      name: 'harness_listener_list',
      label: 'List harness listeners',
      description: 'Your harness listeners: terminal, computer, events, how often each fired and when last.',
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        return reply({ listeners: listeners.list(agentId) });
      },
    }),
  ]);
}
