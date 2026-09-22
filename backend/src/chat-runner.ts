import type { ModelRuntime, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { createActivityRecorder } from './agent-activity';
import { channelInput, createChatSession, type ChatConfiguration, type ChannelMessage } from './chat-runtime';
import { createWebTools } from './web-tools';
import type { RunContext } from './agent-runs';

export async function runChat({ runId, signal, emit }: RunContext, config: ChatConfiguration, history: ChannelMessage[], message: ChannelMessage,
  publish: (text: string) => Promise<object>, accessKey: string, subscriptionRuntime?: ModelRuntime, historyTools: ToolDefinition[] = []) {
  const { channel } = config;
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
    unsubscribe = session.subscribe(event => {
      // OAuth tokens can rotate during long runs. Never expose provider error bodies.
      if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.errorMessage) activity.record('error', 'Model request error', 'The provider request failed. Check the model connection.');
      else activity.onEvent(event);
      if (event.type === 'message_update') {
        const update = event.assistantMessageEvent;
        if (update.type === 'toolcall_start' || update.type === 'toolcall_delta' || update.type === 'toolcall_end') {
          const tool = update.type === 'toolcall_end' ? update.toolCall : update.partial.content[update.contentIndex];
          if (tool?.type === 'toolCall' && tool.name === 'send_message') { pendingSends.add(tool.id); updateTyping(); }
        }
      } else if (event.type === 'tool_execution_end' && event.toolName === 'send_message') { pendingSends.delete(event.toolCallId); updateTyping(); }
    });
    await session.prompt(channelInput(channel.id, message.text, message), { expandPromptTemplates: false });
    const lastAssistant = () => [...session!.messages].reverse().find(item => item.role === 'assistant');
    if (!finalPublished && !signal.aborted && !session.isStreaming && lastAssistant()?.stopReason === 'stop') {
      clearTyping();
      await session.sendCustomMessage({
        customType: 'channel-delivery-reminder', display: false,
        content: published
          ? `Automatic channel reminder: your acknowledgment/progress reached channel ${channel.id}, but no final reply was delivered. Plain assistant output is internal. Continue unfinished work, or deliver the actual result/limitation using send_message with channelId=${JSON.stringify(channel.id)} and final:true. Do not repeat the acknowledgment or merely promise to send the result.`
          : `Automatic channel reminder: nothing was sent to channel ${channel.id}. Plain assistant output is internal. For an actionable task, acknowledge now with send_message and final:false, then continue working and publish the result with final:true. If the answer is already ready, deliver it now with final:true. Use channelId=${JSON.stringify(channel.id)}. If no reply was appropriate or the user requested silence, remain silent.`,
      }, { triggerTurn: true });
    }
    if (signal.aborted || ['error', 'aborted'].includes(lastAssistant()?.stopReason ?? '') || (!published && lastAssistant()?.stopReason !== 'stop')) emit({ type: 'error', message: 'The agent could not finish its response. It may have been stopped, timed out, or encountered a model error.' });
    const missingFinal = published > 0 && !finalPublished && !signal.aborted && lastAssistant()?.stopReason === 'stop';
    if (missingFinal) emit({ type: 'error', message: 'The agent acknowledged the request but did not deliver a final reply.' });
    activity.record('status', signal.aborted ? 'Stopped' : missingFinal ? 'Final reply missing' : 'Turn complete', published ? `${published} channel message(s) published.` : 'No channel message published.');
  } catch {
    activity.record('error', signal.aborted ? 'Stopped' : 'Request failed', signal.aborted ? 'The agent run was stopped.' : 'The model request failed. Check the endpoint and model configuration.');
    emit({ type: 'error', message: signal.aborted ? 'The agent was stopped.' : 'The model request failed. Check the endpoint, model, and tool-calling support.' });
  } finally {
    clearTyping(); unsubscribe(); signal.removeEventListener('abort', abort); session?.dispose();
    await web?.close();
  }
}
