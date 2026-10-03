// Harness assist for OpenCode (agent swarm): tells the swarm agent supervising this terminal when OpenCode finishes,
// asks permission or a question, or fails, and gives the model a notify_supervisor tool. Installed by
// /opt/swarm/harness-assist/install opencode into ~/.config/opencode/plugins/. Events are written by the shared
// Harness assist scripts (one compact line each, inside the computer); permission requests are observed, never answered.
import { spawn, spawnSync } from 'node:child_process';
import { type Plugin, tool } from '@opencode-ai/plugin';

const ROOT = '/opt/swarm/harness-assist';

/** Writes one event line in the background (never blocks or fails OpenCode). */
function emit(event: string, text = '', session = '', cwd = '') {
  try {
    const child = spawn('python3', [`${ROOT}/harness_event.py`, 'emit'], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => {});
    child.stdin.end(JSON.stringify({ harness: 'opencode', event, text, session, cwd }));
  } catch {
    /* the swarm's listener is optional */
  }
}

export const SwarmAssist: Plugin = async ({ directory }) => {
  // The last finished text of each session's answer, to send with "finished".
  const lastText = new Map<string, string>();
  return {
    'experimental.text.complete': async (input: { sessionID: string }, output: { text: string }) => {
      if (output?.text?.trim()) lastText.set(input.sessionID, output.text);
    },
    event: async ({ event }: { event: { type: string; properties: Record<string, any> } }) => {
      const p = event.properties ?? {};
      switch (event.type) {
        case 'session.status':
          if (p.status?.type === 'idle') emit('finished', lastText.get(p.sessionID) ?? '', p.sessionID, directory);
          break;
        case 'permission.asked':
          emit('permission', [p.permission, ...(p.patterns ?? [])].filter(Boolean).join(': '), p.sessionID, directory);
          break;
        case 'question.asked':
          emit('question', p.questions?.[0]?.question ?? '', p.sessionID, directory);
          break;
        case 'session.error':
          emit('failure', p.error?.data?.message ?? p.error?.name ?? 'error', p.sessionID ?? '', directory);
          break;
        case 'session.created':
          emit('session_start', 'startup', p.info?.id ?? p.sessionID ?? '', directory);
          break;
      }
    },
    tool: {
      notify_supervisor: tool({
        description:
          'Send a short message to the swarm agent supervising this terminal (the agent that asked you for this work): a question you need answered, a blocker, a decision to make, or that you are done. It reaches the agent at once; the agent may reply by typing into this session.',
        args: { message: tool.schema.string().min(1).max(1000) },
        async execute(args: { message: string }) {
          const result = spawnSync('python3', [`${ROOT}/supervisor_mcp.py`, 'opencode', '--notify'], {
            input: args.message,
            encoding: 'utf8',
            timeout: 5000,
          });
          return (result.stdout || 'The message could not be sent.').trim();
        },
      }),
    },
  };
};
