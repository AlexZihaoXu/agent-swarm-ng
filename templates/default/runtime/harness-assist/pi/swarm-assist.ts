// Harness assist for Pi (agent swarm): tells the swarm agent supervising this terminal when Pi has settled (finished
// and waiting), fails, waits on a dialog, or starts and ends a session, and gives the model a notify_supervisor tool.
// Installed by /opt/swarm/harness-assist/install pi into ~/.pi/agent/extensions/. Pi has no permission prompts.
import { spawn, spawnSync } from 'node:child_process';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const ROOT = '/opt/swarm/harness-assist';

/** Writes one event line in the background (never blocks or fails Pi). */
function emit(event: string, text = '', session = '', cwd = '') {
  try {
    const child = spawn('python3', [`${ROOT}/harness_event.py`, 'emit'], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => {});
    child.stdin.end(JSON.stringify({ harness: 'pi', event, text, session, cwd }));
  } catch {
    /* the swarm's listener is optional */
  }
}

const textOf = (message: any) =>
  Array.isArray(message?.content)
    ? message.content
        .filter((part: any) => part?.type === 'text')
        .map((part: any) => part.text)
        .join('\n')
    : '';

export default function (pi: ExtensionAPI) {
  let lastText = '';
  let failed = '';
  const session = (ctx: any) => {
    try {
      return String(ctx?.sessionManager?.getSessionFile?.() ?? '');
    } catch {
      return '';
    }
  };
  pi.on('session_start', async (event: any, ctx: any) => emit('session_start', event?.reason ?? 'startup', session(ctx), process.cwd()));
  pi.on('session_shutdown', async (event: any, ctx: any) => emit('session_end', event?.reason ?? 'quit', session(ctx), process.cwd()));
  pi.on('message_end', async (event: any) => {
    const message = event?.message;
    if (message?.role !== 'assistant') return;
    const text = textOf(message);
    if (text.trim()) lastText = text;
    if (message.stopReason === 'error') failed = message.errorMessage || 'model error';
  });
  pi.on('ui_prompt_start', async (event: any, ctx: any) => emit('question', event?.title ?? event?.kind ?? '', session(ctx), process.cwd()));
  // Settled: Pi will not continue on its own (no retry, compaction or queued follow-up left).
  pi.on('agent_settled', async (_event: any, ctx: any) => {
    if (failed) emit('failure', failed, session(ctx), process.cwd());
    else emit('finished', lastText, session(ctx), process.cwd());
    failed = '';
    lastText = '';
  });
  pi.registerTool({
    name: 'notify_supervisor',
    label: 'Notify supervisor',
    description:
      'Send a short message to the swarm agent supervising this terminal (the agent that asked you for this work): a question you need answered, a blocker, a decision to make, or that you are done. It reaches the agent at once; the agent may reply by typing into this session.',
    promptSnippet: 'notify_supervisor: message the swarm agent supervising this terminal (questions, blockers, done).',
    parameters: Type.Object({ message: Type.String({ minLength: 1, maxLength: 1000 }) }),
    async execute(_id: string, params: { message: string }) {
      const result = spawnSync('python3', [`${ROOT}/supervisor_mcp.py`, 'pi', '--notify'], {
        input: params.message,
        encoding: 'utf8',
        timeout: 5000,
      });
      const text = (result.stdout || 'The message could not be sent.').trim();
      if (result.status !== 0) throw new Error(text);
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  });
}
