import { expect, it } from 'vitest';
import { SessionManager, type FileEntry } from '@earendil-works/pi-coding-agent';
import { createChatSession } from './chat-runtime';

it('restores the complete private Pi entry tree without creating a JSONL file', () => {
  const original = SessionManager.inMemory();
  original.appendMessage({ role: 'user', content: 'first task', timestamp: 1 });
  original.appendMessage({
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'call', name: 'search_messages', arguments: { query: 'context' } }],
    api: 'openai-completions',
    provider: 'swarm-chat',
    model: 'test',
    stopReason: 'toolUse',
    timestamp: 2,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  original.appendMessage({
    role: 'toolResult',
    toolCallId: 'call',
    toolName: 'search_messages',
    content: [{ type: 'text', text: 'private result' }],
    isError: false,
    timestamp: 3,
  });
  const snapshot: FileEntry[] = [original.getHeader()!, ...original.getEntries()];
  const restored = SessionManager.inMemory(process.cwd(), { id: original.getSessionId() }, structuredClone(snapshot));
  expect(restored.getSessionFile()).toBeUndefined();
  expect(restored.getSessionId()).toBe(original.getSessionId());
  expect(restored.getEntries()).toEqual(original.getEntries());
  expect(restored.buildSessionContext()).toEqual(original.buildSessionContext());
  const next = restored.appendMessage({ role: 'user', content: 'next task', timestamp: 4 });
  expect(restored.getEntry(next)?.parentId).toBe(original.getLeafId());
});

it('bounds Pi compaction settings below the model context threshold', async () => {
  const session = await createChatSession(
    {
      name: 'A',
      model: 'test',
      thinkingLevel: 'off',
      baseUrl: 'http://127.0.0.1:1/v1',
      channel: { id: 'private-a', agentId: 'a', kind: 'platform-chat' },
    },
    [],
    () => {},
    [],
    undefined,
    SessionManager.inMemory(),
  );
  try {
    const { enabled, reserveTokens, keepRecentTokens } = session.settingsManager.getCompactionSettings();
    expect(enabled).toBe(true);
    expect(keepRecentTokens).toBeLessThan(session.model!.contextWindow - reserveTokens);
  } finally {
    session.dispose();
  }
});

it('restores the compaction summary and kept tail once while retaining older private entries', () => {
  const original = SessionManager.inMemory();
  original.appendMessage({ role: 'user', content: 'older detail', timestamp: 1 });
  const kept = original.appendMessage({ role: 'user', content: 'keep this', timestamp: 2 });
  original.appendCompaction('summary of older detail', kept, 100);
  original.appendMessage({ role: 'user', content: 'after compaction', timestamp: 3 });
  const restored = SessionManager.inMemory(process.cwd(), { id: original.getSessionId() }, [
    original.getHeader()!,
    ...original.getEntries(),
  ]);
  expect(restored.getEntries()).toHaveLength(4);
  expect(
    restored
      .buildSessionContext()
      .messages.map(message =>
        message.role === 'user' ? message.content : message.role === 'compactionSummary' ? message.summary : '',
      ),
  ).toEqual(['summary of older detail', 'keep this', 'after compaction']);
  expect(restored.buildSessionContext()).toEqual(original.buildSessionContext());
});
