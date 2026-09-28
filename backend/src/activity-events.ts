import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { ActivityEntry } from './agent-activity';
import { activityJson, providerFailure } from './activity-safety';
export interface ActivityTrace {
  attach(session: AgentSession): () => void;
  record: ActivityWrite;
  close(state?: string): void;
}
export type ActivityWrite = (
  kind: ActivityEntry['kind'],
  label: string,
  text: string,
  id?: string,
  append?: boolean,
  state?: string,
) => void;
const responseState = (reason?: string) =>
  reason === 'error'
    ? 'failed'
    : reason === 'aborted'
      ? 'interrupted'
      : ['length', 'pending'].includes(reason ?? '')
        ? 'partial'
        : 'complete';
const text = (content: any) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter(block => block?.type === 'text')
          .map(block => block.text)
          .join('\n')
      : '';
function describeContent(content: unknown) {
  if (!Array.isArray(content)) return undefined;
  return content.map((block, index) => {
    if (!block || typeof block !== 'object' || ArrayBuffer.isView(block)) return { index, unsupportedContent: block };
    return block.type === 'text'
      ? { index, type: 'text', textBytes: typeof block.text === 'string' ? Buffer.byteLength(block.text) : undefined }
      : { ...block, index }; // Image/binary bytes are removed by activityJson.
  });
}

/** Maps SDK evidence explicitly; never serialize the entire provider/session object. */
export function createActivityEvents(record: ActivityWrite) {
  let assistant = 0,
    turn = 0,
    request = 0;
  let responseStarted = 0,
    turnStarted = 0,
    compaction = 0,
    compactionStarted = 0;
  type Call = {
    entry: string;
    name: string;
    args: unknown;
    started?: number;
    progress: number;
    final?: boolean;
    state?: string;
  };
  const calls = new Map<string, Call>();
  const meta = (label: string, value: unknown, id?: string, state = 'complete') =>
    record('metadata', label, activityJson(value), id, false, state);
  const block = (value: any, index: number, complete: boolean, finalState = 'complete') => {
    const id = `assistant-${assistant}-${index}`;
    if (value.type === 'thinking')
      record(
        'thinking',
        'Thinking',
        value.redacted ? '[Provider-redacted thinking: no readable text available]' : (value.thinking ?? ''),
        id,
        false,
        complete ? finalState : 'streaming',
      );
    else if (value.type === 'text')
      record('assistant', 'Direct model output', value.text ?? '', id, false, complete ? finalState : 'streaming');
    else if (value.type === 'toolCall') {
      const key = `${assistant}:${value.id}`,
        previous = calls.get(key);
      const entry = previous?.entry ?? id;
      if (value.id)
        calls.set(key, {
          ...previous,
          entry,
          name: value.name || 'Tool call',
          args: value.arguments ?? {},
          progress: previous?.progress ?? 0,
        });
      record(
        'tool_call',
        value.name || 'Tool call',
        activityJson(value.arguments ?? {}),
        entry,
        false,
        previous?.final ? previous.state : previous?.started ? 'running' : 'pending',
      );
    }
  };
  const result = (event: any, final: boolean) => {
    const id = event.toolCallId || `unknown-${crypto.randomUUID()}`;
    const key = `${assistant}:${id}`;
    const call: Call = calls.get(key) ?? {
      entry: `assistant-${assistant}-call-${id}`,
      name: event.toolName,
      args: undefined,
      progress: 0,
    };
    calls.set(key, call);
    const value = event.result ?? event.partialResult ?? event.message ?? {};
    const isError = Boolean(event.isError || value.isError);
    const content = text(value.content);
    const extra =
      value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value)
        ? Object.fromEntries(
            Object.entries(value).filter(
              ([key]) =>
                ![
                  'content',
                  'details',
                  'usage',
                  'terminate',
                  'isError',
                  'addedToolNames',
                  'role',
                  'toolCallId',
                  'toolName',
                  'timestamp',
                ].includes(key),
            ),
          )
        : value;
    const contentBlocks = describeContent(value.content);
    if (!final) {
      const n = ++call.progress;
      record(
        'tool_result',
        `${event.toolName} — progress ${n}`,
        content,
        `${call.entry}-progress-${n}`,
        false,
        'complete',
      );
      meta(
        `${event.toolName} — progress details`,
        { toolCallId: id, progress: n, details: value.details, extra, contentBlocks },
        `${call.entry}-progress-${n}-details`,
      );
      return;
    }
    if (call.final) return; // tool_execution_end and message_end describe the same result.
    call.final = true;
    call.state = isError ? (call.started === undefined ? 'rejected' : 'failed') : 'complete';
    if (call.args !== undefined) record('tool_call', call.name, activityJson(call.args), call.entry, false, call.state);
    record(
      'tool_result',
      `${event.toolName}${isError ? ' — failed' : ' — result'}`,
      content,
      `${call.entry}-result`,
      false,
      isError ? 'failed' : 'complete',
    );
    const image = value.details?.computerImage;
    if (image && typeof image.id === 'string' && typeof image.agentId === 'string') {
      let primary: any;
      try {
        primary = JSON.parse(content);
      } catch {
        /* e.g. SDK-added image dimension notes */
      }
      if (primary?.id !== image.id || primary?.agentId !== image.agentId)
        record(
          'tool_result',
          `${event.toolName} — image`,
          activityJson(image),
          `${call.entry}-image`,
          false,
          'complete',
        );
    }
    meta(
      `${event.toolName} — execution details`,
      {
        toolCallId: id,
        argumentsEntry: call.entry,
        resultEntry: `${call.entry}-result`,
        startedAt: call.started,
        finishedAt: Date.now(),
        durationMs: call.started === undefined ? undefined : Math.max(0, Date.now() - call.started),
        isError,
        details: value.details,
        extra,
        usage: value.usage,
        terminate: value.terminate,
        addedToolNames: value.addedToolNames,
        contentBlocks,
        toolHandlerStarted: call.started !== undefined,
      },
      `${call.entry}-details`,
    );
  };
  const onEvent = (event: AgentSessionEvent) => {
    switch (event.type) {
      case 'agent_start':
        meta('SDK generation started', { turn }, undefined, 'complete');
        break;
      case 'turn_start':
        turn++;
        turnStarted = Date.now();
        meta('Turn started', { turn }, `turn-${turn}`, 'running');
        break;
      case 'message_start':
        if (event.message.role === 'assistant') {
          assistant++;
          responseStarted = Date.now();
        } else if (event.message.role === 'user')
          record('user', 'Model-facing input', text(event.message.content), undefined, false, 'complete');
        else if (event.message.role === 'custom')
          record(
            'reminder',
            `System reminder${event.message.customType ? ` · ${event.message.customType}` : ''}`,
            text(event.message.content),
            undefined,
            false,
            'complete',
          );
        else if (event.message.role === 'compactionSummary' || event.message.role === 'branchSummary')
          record('reminder', `${event.message.role} input`, event.message.summary, undefined, false, 'complete');
        else if (event.message.role === 'bashExecution') meta('SDK shell execution', event.message);
        if (event.message.role === 'custom' && event.message.details !== undefined)
          meta('Custom message details', { customType: event.message.customType, details: event.message.details });
        if (
          (event.message.role === 'user' || event.message.role === 'custom') &&
          Array.isArray(event.message.content) &&
          event.message.content.some(item => item.type !== 'text')
        )
          meta('Input non-text content', { role: event.message.role, content: describeContent(event.message.content) });
        break;
      case 'message_update': {
        const update = event.assistantMessageEvent;
        if (!('contentIndex' in update)) break;
        const value = update.partial.content[update.contentIndex];
        if (value) block(value, update.contentIndex, update.type.endsWith('_end'));
        break;
      }
      case 'message_end':
        if (event.message.role === 'assistant') {
          const message = event.message;
          message.content.forEach((value, index) =>
            block(
              value,
              index,
              true,
              ['error', 'aborted', 'length', 'pending'].includes(message.stopReason) ? 'partial' : 'complete',
            ),
          );
          meta(
            'Model response details',
            {
              turn,
              assistant,
              provider: message.provider,
              api: message.api,
              model: message.model,
              responseModel: message.responseModel,
              responseId: message.responseId,
              providerThinkingLevel: message.providerThinkingLevel,
              stopReason: message.stopReason,
              rawStopReason: message.rawStopReason,
              endTurn: message.endTurn,
              messageTimestamp: message.timestamp,
              streamStartedAt: responseStarted || undefined,
              finishedAt: Date.now(),
              usage: message.usage,
              usageNote: 'SDK usage fields: zero can mean unreported usage. Cost estimates are not billing receipts.',
              streamDurationMs: responseStarted ? Math.max(0, Date.now() - responseStarted) : undefined,
              content: message.content.map(value => ({
                type: value.type,
                ...(value.type === 'thinking'
                  ? { utf16CodeUnits: value.redacted ? 0 : value.thinking.length, redacted: Boolean(value.redacted) }
                  : value.type === 'text'
                    ? { utf16CodeUnits: value.text.length }
                    : { toolCallId: value.id, name: value.name }),
              })),
              reasoningVisibility:
                'Only provider-exposed text or summaries are available; token counts can include hidden reasoning.',
              diagnostics: message.diagnostics?.map(d => ({
                type: d.type,
                timestamp: d.timestamp,
                error: d.error
                  ? { name: d.error.name, code: d.error.code, ...providerFailure(d.error.message) }
                  : undefined,
                detailFields: Object.keys(d.details ?? {}),
              })),
              error: message.errorMessage ? providerFailure(message.errorMessage) : undefined,
            },
            `assistant-${assistant}-details`,
            responseState(message.stopReason),
          );
          if (message.errorMessage)
            record(
              message.stopReason === 'aborted' ? 'status' : 'error',
              message.stopReason === 'aborted' ? 'Generation stopped' : 'Model request error',
              activityJson(
                message.stopReason === 'aborted'
                  ? { stopReason: message.stopReason, note: 'Generation cancelled; committed effects remain.' }
                  : providerFailure(message.errorMessage),
              ),
              `assistant-${assistant}-error`,
              false,
              message.stopReason === 'aborted' ? 'interrupted' : 'failed',
            );
        } else if (event.message.role === 'toolResult') result({ ...event.message, result: event.message }, true);
        break;
      case 'tool_execution_start': {
        const id = event.toolCallId,
          key = `${assistant}:${id}`,
          previous = calls.get(key);
        const call = {
          ...previous,
          entry: previous?.entry ?? `assistant-${assistant}-call-${id}`,
          name: event.toolName,
          args: event.args,
          started: Date.now(),
          progress: previous?.progress ?? 0,
        };
        calls.set(key, call);
        record('tool_call', event.toolName, activityJson(event.args ?? {}), call.entry, false, 'running');
        meta(
          `${event.toolName} — execution details`,
          { toolCallId: id, argumentsEntry: call.entry, startedAt: call.started, state: 'running' },
          `${call.entry}-details`,
          'running',
        );
        break;
      }
      case 'tool_execution_update':
        result(event, false);
        break;
      case 'tool_execution_end':
        result(event, true);
        break;
      case 'turn_end':
        meta(
          'Turn finished',
          {
            turn,
            startedAt: turnStarted,
            finishedAt: Date.now(),
            durationMs: Math.max(0, Date.now() - turnStarted),
            stopReason: event.message.role === 'assistant' ? event.message.stopReason : undefined,
            toolResults: event.toolResults.map(item => ({
              toolCallId: item.toolCallId,
              name: item.toolName,
              isError: item.isError,
            })),
          },
          `turn-${turn}`,
          responseState(event.message.role === 'assistant' ? event.message.stopReason : undefined),
        );
        break;
      case 'agent_end':
        meta('SDK generation ended', { willRetry: event.willRetry, messageCount: event.messages.length });
        break;
      case 'agent_settled':
        meta('SDK generation settled', {});
        break;
      case 'queue_update':
        meta('SDK queue updated', { steering: event.steering, followUp: event.followUp });
        break;
      case 'compaction_start':
        compaction++;
        compactionStarted = Date.now();
        meta('Compaction started', { reason: event.reason }, `compaction-${compaction}`, 'running');
        break;
      case 'compaction_end':
        meta(
          'Compaction finished',
          {
            reason: event.reason,
            startedAt: compactionStarted,
            finishedAt: Date.now(),
            aborted: event.aborted,
            willRetry: event.willRetry,
            result: event.result,
            error: event.errorMessage ? providerFailure(event.errorMessage) : undefined,
          },
          `compaction-${compaction}`,
          event.aborted ? 'interrupted' : event.errorMessage ? 'failed' : 'complete',
        );
        break;
      case 'auto_retry_start':
        meta('Provider retry scheduled', {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          error: providerFailure(event.errorMessage),
        });
        break;
      case 'auto_retry_end':
        meta('Provider retry finished', {
          success: event.success,
          attempt: event.attempt,
          error: event.finalError ? providerFailure(event.finalError) : undefined,
        });
        break;
      case 'summarization_retry_scheduled':
        meta('Summary retry scheduled', {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          error: providerFailure(event.errorMessage),
        });
        break;
      case 'summarization_retry_attempt_start':
        meta('Summary retry started', { source: event.source, ...('reason' in event ? { reason: event.reason } : {}) });
        break;
      case 'summarization_retry_finished':
        meta('Summary retry finished', {});
        break;
      case 'entry_appended':
        meta('Private session entry appended', {
          id: event.entry.id,
          parentId: event.entry.parentId,
          type: event.entry.type,
          timestamp: event.entry.timestamp,
        });
        break;
      case 'session_info_changed':
        meta('Session information changed', { name: event.name });
        break;
      case 'thinking_level_changed':
        meta('Thinking level changed', { level: event.level });
        break;
      case 'bash_execution_update':
        record('tool_result', 'SDK shell output', event.delta, `sdk-shell-${event.id ?? 'output'}`, true, 'streaming');
        break;
      default:
        meta('Unrecognized SDK event', { type: (event as { type: string }).type, fields: Object.keys(event) });
    }
  };
  const attach = (session: AgentSession) => {
    const model = session.model;
    record('system', 'System prompt', session.agent.state.systemPrompt, undefined, false, 'complete');
    meta('Runtime configuration', {
      provider: model?.provider,
      api: model?.api,
      model: model?.id,
      contextWindow: model?.contextWindow,
      maxTokens: model?.maxTokens,
      input: model?.input,
      reasoning: model?.reasoning,
      imageAutoResize: session.settingsManager.getImageAutoResize(),
      thinkingLevel: session.thinkingLevel,
      retainedMessages: session.messages.length,
      contextNote:
        'Retained context is not duplicated on every request; new messages, tool results and compaction summaries are recorded separately.',
      tools: session.agent.state.tools.map(tool => ({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters,
      })),
    });
    for (const message of session.messages)
      if (message.role === 'compactionSummary' || message.role === 'branchSummary')
        record('reminder', `Retained ${message.role}`, message.summary, undefined, false, 'complete');
    const oldPayload = session.agent.onPayload,
      oldResponse = session.agent.onResponse;
    const payload: NonNullable<typeof session.agent.onPayload> = async (value, model) => {
      const changed = await oldPayload?.(value, model),
        data = (changed ?? value) as any;
      const settings = Object.fromEntries(
        [
          'model',
          'stream',
          'max_tokens',
          'max_output_tokens',
          'max_completion_tokens',
          'temperature',
          'top_p',
          'reasoning',
          'thinking',
          'tool_choice',
        ]
          .filter(key => data?.[key] !== undefined)
          .map(key => [key, data[key]]),
      );
      const messages = Array.isArray(data?.messages) ? data.messages : Array.isArray(data?.input) ? data.input : [];
      meta('Provider request', {
        turn,
        request: ++request,
        requestedAt: Date.now(),
        provider: model.provider,
        api: model.api,
        model: model.id,
        settings,
        inputItems: messages.map((m: any) => ({
          role: m.role,
          type: m.type,
          contentBlocks: Array.isArray(m.content) ? m.content.map((b: any) => b.type) : undefined,
        })),
        toolCount: Array.isArray(data?.tools) ? data.tools.length : undefined,
      });
      return changed;
    };
    const response: NonNullable<typeof session.agent.onResponse> = async (value, model) => {
      await oldResponse?.(value, model);
      const headers = Object.fromEntries(
        Object.entries(value.headers).filter(([name]) =>
          /^(content-type|date|x-request-id|request-id|retry-after|openai-processing-ms|x-ratelimit-(?:limit|remaining|reset)-(?:requests|tokens))$/i.test(
            name,
          ),
        ),
      );
      meta('Provider HTTP response', {
        turn,
        request,
        receivedAt: Date.now(),
        provider: model.provider,
        api: model.api,
        model: model.id,
        status: value.status,
        headers,
      });
    };
    session.agent.onPayload = payload;
    session.agent.onResponse = response;
    const unsubscribe = session.subscribe(onEvent);
    return () => {
      unsubscribe();
      if (session.agent.onPayload === payload) session.agent.onPayload = oldPayload;
      if (session.agent.onResponse === response) session.agent.onResponse = oldResponse;
    };
  };
  return { onEvent, attach };
}
