import { expect, it } from 'vitest';
import { createActivityRecorder } from './agent-activity';
const usage = {
  input: 10,
  output: 20,
  cacheRead: 3,
  cacheWrite: 4,
  totalTokens: 37,
  reasoning: 7,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
};
const message = (content: any[], stopReason = 'stop') => ({
  role: 'assistant',
  content,
  api: 'openai-completions',
  provider: 'test',
  model: 'model',
  responseId: 'response-1',
  usage,
  stopReason,
  timestamp: 1,
});
function fixture() {
  const rows = new Map<string, any>();
  const recorder = createActivityRecorder(
    'agent',
    'channel',
    'private-key',
    event => {
      const e = event as any;
      rows.set(e.entry.id, e.entry);
    },
    'run',
  );
  return { recorder, rows, all: () => [...rows.values()], text: () => JSON.stringify([...rows.values()]) };
}
it('reconciles final blocks even without streaming deltas and records safe model usage/outcome', () => {
  const f = fixture();
  f.recorder.onEvent({ type: 'message_start', message: message([]) } as any);
  f.recorder.onEvent({
    type: 'message_end',
    message: message(
      [
        { type: 'thinking', thinking: 'Visible summary', thinkingSignature: 'HIDDEN_SIGNATURE' },
        { type: 'text', text: 'Complete answer' },
      ],
      'length',
    ),
  } as any);
  expect(f.text()).toContain('Visible summary');
  expect(f.text()).toContain('Complete answer');
  expect(f.text()).toContain('response-1');
  expect(f.text()).toContain('length');
  expect(f.text()).toContain('cacheRead');
  expect(f.text()).not.toContain('HIDDEN_SIGNATURE');
});
it('keeps tool progress, final text and details correlated without persisting image bytes or credentials', () => {
  const f = fixture();
  f.recorder.onEvent({
    type: 'tool_execution_start',
    toolCallId: 'call-1',
    toolName: 'read',
    args: { path: 'file' },
  } as any);
  f.recorder.onEvent({
    type: 'tool_execution_update',
    toolCallId: 'call-1',
    toolName: 'read',
    args: { path: 'file' },
    partialResult: { content: [{ type: 'text', text: 'Working' }], details: { percent: 40 } },
  } as any);
  f.recorder.onEvent({
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: 'read',
    isError: false,
    result: {
      content: [
        { type: 'text', text: 'File contents' },
        { type: 'image', data: 'RAW_IMAGE_BYTES', mimeType: 'image/png' },
      ],
      details: { diagnostic: 'useful detail', apiKey: 'UNREGISTERED_SECRET', validationToken: 'CAPABILITY_TOKEN' },
      usage,
      terminate: true,
    },
  } as any);
  expect(f.text()).toContain('Working');
  expect(f.text()).toContain('40');
  expect(f.text()).toContain('File contents');
  expect(f.text()).toContain('useful detail');
  expect(f.text()).toContain('call-1');
  for (const secret of ['RAW_IMAGE_BYTES', 'UNREGISTERED_SECRET', 'CAPABILITY_TOKEN'])
    expect(f.text()).not.toContain(secret);
  expect(f.all().find(e => e.kind === 'tool_call')?.state).toBe('complete');
});
it('isolates fork counters and logs cancellation, compaction and safe provider errors', async () => {
  const f = fixture(),
    branch = f.recorder.branch('Interruption triage');
  f.recorder.onEvent({ type: 'message_start', message: message([]) } as any);
  branch.onEvent({ type: 'message_start', message: message([]) } as any);
  f.recorder.onEvent({ type: 'message_end', message: message([{ type: 'text', text: 'Main' }]) } as any);
  branch.onEvent({
    type: 'message_end',
    message: {
      ...message([{ type: 'text', text: 'Fork' }], 'error'),
      errorMessage: '401 Bearer TOKEN_SHOULD_NOT_LEAK private-key',
    },
  } as any);
  f.recorder.onEvent({ type: 'compaction_start', reason: 'threshold' } as any);
  f.recorder.onEvent({
    type: 'compaction_end',
    reason: 'threshold',
    result: { summary: 'Retained summary', tokensBefore: 100 },
    aborted: false,
    willRetry: false,
  } as any);
  await f.recorder.finish(true);
  expect(f.text()).toContain('Main');
  expect(f.text()).toContain('Fork');
  expect(f.text()).toContain('Interruption triage');
  expect(f.text()).toContain('Retained summary');
  expect(f.text()).toContain('authentication');
  expect(f.text()).not.toContain('TOKEN_SHOULD_NOT_LEAK');
  expect(f.text()).not.toContain('private-key');
});
it('does not merge calls when a provider reuses a tool ID on later responses', () => {
  const f = fixture();
  for (const value of ['first', 'second']) {
    f.recorder.onEvent({ type: 'message_start', message: message([]) } as any);
    f.recorder.onEvent({
      type: 'message_end',
      message: message([{ type: 'toolCall', id: 'reused', name: 'read', arguments: { path: value } }], 'toolUse'),
    } as any);
    f.recorder.onEvent({
      type: 'tool_execution_start',
      toolCallId: 'reused',
      toolName: 'read',
      args: { path: value },
    } as any);
    f.recorder.onEvent({
      type: 'tool_execution_end',
      toolCallId: 'reused',
      toolName: 'read',
      isError: false,
      result: { content: [{ type: 'text', text: value }], details: {} },
    } as any);
  }
  expect(f.all().filter(row => row.kind === 'tool_call')).toHaveLength(2);
  expect(
    f
      .all()
      .filter(row => row.label === 'read — result')
      .map(row => row.text),
  ).toEqual(['first', 'second']);
});
it('retains an image reference when SDK dimension notes make the primary text non-JSON', () => {
  const f = fixture();
  f.recorder.onEvent({
    type: 'tool_execution_end',
    toolCallId: 'image',
    toolName: 'read',
    isError: false,
    result: {
      content: [
        { type: 'text', text: 'Reference followed by image dimension note' },
        { type: 'image', data: 'IMAGE_BYTES', mimeType: 'image/png' },
      ],
      details: { computerImage: { id: 'image-id', agentId: 'agent', width: 10, height: 10 } },
    },
  } as any);
  expect(f.all().find(row => row.label === 'read — image')?.text).toContain('image-id');
  expect(f.text()).not.toContain('IMAGE_BYTES');
});
it('replaces partial streaming snapshots with exact final content rather than losing or doubling it', () => {
  const f = fixture();
  f.recorder.onEvent({ type: 'message_start', message: message([]) } as any);
  f.recorder.onEvent({
    type: 'message_update',
    message: message([]),
    assistantMessageEvent: {
      type: 'text_delta',
      contentIndex: 0,
      delta: 'partial',
      partial: message([{ type: 'text', text: 'partial' }]),
    },
  } as any);
  expect(f.all().find(row => row.kind === 'assistant')).toMatchObject({ text: 'partial', state: 'streaming' });
  f.recorder.onEvent({ type: 'message_end', message: message([{ type: 'text', text: 'complete final text' }]) } as any);
  expect(f.all().filter(row => row.kind === 'assistant')).toHaveLength(1);
  expect(f.all().find(row => row.kind === 'assistant')).toMatchObject({
    text: 'complete final text',
    state: 'complete',
  });
});
it('never mistakes provider-redacted thinking for readable reasoning', () => {
  const f = fixture();
  f.recorder.onEvent({ type: 'message_start', message: message([]) } as any);
  f.recorder.onEvent({
    type: 'message_end',
    message: message([
      { type: 'thinking', redacted: true, thinking: 'OPAQUE_HIDDEN_CONTENT', thinkingSignature: 'ENCRYPTED' },
    ]),
  } as any);
  expect(f.text()).not.toContain('OPAQUE_HIDDEN_CONTENT');
  expect(f.text()).not.toContain('ENCRYPTED');
  expect(f.text()).toContain('redacted');
});
