import type { ModelRuntime, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { createActivityRecorder } from './agent-activity';
import { channelInput, createChatSession, type ChatConfiguration, type ChannelMessage } from './chat-runtime';
import { createWebTools } from './web-tools';
import type { RunContext } from './agent-runs';
import { evaluateInterruption } from './interruption-triage';
import { formatContextUsage } from './context-usage';

export async function runChat({ runId, signal, emit, inbox }: RunContext, config: ChatConfiguration, history: ChannelMessage[], message: ChannelMessage,
  publish: (text: string) => Promise<object>, accessKey: string, subscriptionRuntime?: ModelRuntime, historyTools: ToolDefinition[] = []) {
  const { channel } = config;
  inbox.add(message);
  const activity = createActivityRecorder(channel.agentId, channel.id, accessKey, emit, runId);
  const pendingSends = new Set<string>();
  let typing = false, published = 0, finalPublished = false;
  let web: Awaited<ReturnType<typeof createWebTools>> | undefined;
  let session: Awaited<ReturnType<typeof createChatSession>> | undefined;
  let unsubscribe = () => {};
  const abort = () => { void session?.abort(); };
  const updateTyping = () => {
    const next = pendingSends.size > 0;
    if (next !== typing) { typing = next; emit({ type: 'typing', active: next }); }
  };
  const clearTyping = () => { pendingSends.clear(); updateTyping(); };
  try {
    signal.throwIfAborted();
    web = await createWebTools();
    signal.throwIfAborted();
    session = await createChatSession(config, history, async (text, toolCallId, final) => {
      signal.throwIfAborted();
      // Publication belongs to the channel, not any connected browser.
      const saved = await publish(text);
      pendingSends.delete(toolCallId); updateTyping(); published++;
      if (final) finalPublished = true;
      activity.record('channel', 'Channel publication', text);
      emit({ type: 'channel_message', ...saved });
    }, [...historyTools, ...web.tools], subscriptionRuntime);
    signal.addEventListener('abort', abort, { once: true });
    signal.throwIfAborted();
    activity.record('system', 'System prompt', session.agent.state.systemPrompt);
    const reportContext = () => activity.record('status', 'Context usage', formatContextUsage(session!.getContextUsage()), 'context-usage');
    reportContext();
    unsubscribe = session.subscribe(event => {
      // OAuth tokens can rotate during long runs. Never expose provider error bodies.
      if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.errorMessage) {
        const cancelled = event.message.stopReason === 'aborted';
        activity.record(cancelled ? 'status' : 'error', cancelled ? 'Generation stopped' : 'Model request error', cancelled ? 'Generation cancelled; committed effects remain.' : 'The provider request failed. Check the model connection.');
      }
      else activity.onEvent(event);
      if (event.type === 'message_end') reportContext();
      if (event.type === 'message_update') {
        const update = event.assistantMessageEvent;
        if (update.type === 'toolcall_start' || update.type === 'toolcall_delta' || update.type === 'toolcall_end') {
          const tool = update.type === 'toolcall_end' ? update.toolCall : update.partial.content[update.contentIndex];
          if (tool?.type === 'toolCall' && tool.name === 'send_message') { pendingSends.add(tool.id); updateTyping(); }
        }
      } else if (event.type === 'tool_execution_end' && event.toolName === 'send_message') { pendingSends.delete(event.toolCallId); updateTyping(); }
    });
    const main = session;
    const lastAssistant = () => [...main.messages].reverse().find(item => item.role === 'assistant');
    while (inbox.hasPending() && !signal.aborted) {
      const batch = await inbox.take(signal);
      published = 0; finalPublished = false;
      if (batch.note) await main.sendCustomMessage({ customType: 'interruption-decision', display: false, content: batch.note }, { triggerTurn: false });
      const interrupted = await inbox.during(async () => {
        await main.prompt(batch.messages.map(item => channelInput(channel.id, item.text, item)).join('\n\n'), { expandPromptTemplates: false });
        if (!finalPublished && !signal.aborted && !main.isStreaming && lastAssistant()?.stopReason === 'stop') {
          clearTyping();
          await main.sendCustomMessage({
            customType: 'channel-delivery-reminder', display: false,
            content: published
              ? `Automatic channel reminder: your earlier messages reached channel ${channel.id}, but no final reply was delivered. Plain assistant output is internal. Continue unfinished work, or deliver the actual result/limitation using send_message with channelId=${JSON.stringify(channel.id)} and final:true. Do not repeat delivered parts or the acknowledgment, or merely promise to send the result. If several sections remain, send them sequentially with final:false and use final:true only for the last part.`
              : `Automatic channel reminder: nothing was sent to channel ${channel.id}. Plain assistant output is internal. For an actionable task, acknowledge now with send_message and final:false, then continue working and publish the result with final:true. If the answer is already ready, deliver it now with final:true. Use channelId=${JSON.stringify(channel.id)}. If no reply was appropriate or the user requested silence, remain silent.`,
          }, { triggerTurn: true });
        }
      }, async (messages, triageSignal) => {
        activity.record('status', 'Interruption triage', 'Evaluating new messages in a temporary full-context fork.');
        const decision = await evaluateInterruption(main, channel.id, messages, triageSignal);
        if (!triageSignal.aborted) activity.record('status', 'Triage decision', `${decision.action}: ${decision.reason}`);
        return decision;
      }, async () => { await main.abort(); }, signal);
      clearTyping(); reportContext();
      if (!interrupted && (signal.aborted || ['error', 'aborted'].includes(lastAssistant()?.stopReason ?? '') || (!published && lastAssistant()?.stopReason !== 'stop'))) emit({ type: 'error', message: 'The agent could not finish its response. It may have been stopped, timed out, or encountered a model error.' });
      const missingFinal = !interrupted && published > 0 && !finalPublished && !signal.aborted && lastAssistant()?.stopReason === 'stop';
      if (missingFinal) emit({ type: 'error', message: 'The agent acknowledged the request but did not deliver a final reply.' });
      activity.record('status', signal.aborted ? 'Stopped' : interrupted ? 'Interrupted for new messages' : missingFinal ? 'Final reply missing' : 'Turn complete', published ? `${published} channel message(s) published.` : 'No channel message published.');
    }
    inbox.close();
  } catch {
    activity.record('error', signal.aborted ? 'Stopped' : 'Request failed', signal.aborted ? 'The agent run was stopped.' : 'The model request failed. Check the endpoint and model configuration.');
    emit({ type: 'error', message: signal.aborted ? 'The agent was stopped.' : 'The model request failed. Check the endpoint, model, and tool-calling support.' });
  } finally {
    inbox.close(); clearTyping(); unsubscribe(); signal.removeEventListener('abort', abort); session?.dispose();
    await web?.close();
  }
}
