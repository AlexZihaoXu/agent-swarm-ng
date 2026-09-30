import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '@/use-chat';
import { describeDoing, describeTool } from './agent-doing';

const entry = (kind: string, label: string, timestamp: number, runId = 'run-1') =>
  ({ id: `${label}-${timestamp}`, runId, channelId: 'c', kind, label, text: '', timestamp }) as ActivityEntry;

describe('what an agent is doing', () => {
  it('names tools in plain words', () => {
    expect(describeTool('read_knowledge')).toBe('reading Knowledge');
    expect(describeTool('web_search')).toBe('browsing the web');
    expect(describeTool('terminal_run_actions')).toBe('working in a terminal');
    expect(describeTool('run_actions')).toBe('using a computer');
    expect(describeTool('discord_send_message')).toBe('posting on Discord');
    expect(describeTool('discord_read_messages')).toBe('reading Discord');
    expect(describeTool('mystery_tool')).toBeNull();
  });
  it('keeps the last named activity, switches at once, and falls back to working after 5 s of unnamed work', () => {
    const entries = [entry('thinking', 'Thinking', 0), entry('tool_call', 'search_knowledge', 1000)];
    expect(describeDoing(entries, 1500)).toBe('reading Knowledge');
    entries.push(entry('tool_result', 'search_knowledge — result', 2000));
    expect(describeDoing(entries, 60_000)).toBe('reading Knowledge'); // nothing else ran: keep the last state
    entries.push(entry('tool_call', 'web_search', 3000));
    expect(describeDoing(entries, 3100)).toBe('browsing the web');
    entries.push(entry('thinking', 'Thinking', 4000));
    expect(describeDoing(entries, 8999)).toBe('browsing the web');
    expect(describeDoing(entries, 9000)).toBeNull(); // 5 s of unnamed work: plain "working"
    entries.push(entry('tool_call', 'send_message', 9500));
    expect(describeDoing(entries, 9600)).toBeNull();
    entries.push(entry('tool_call', 'use_computer', 10_000));
    expect(describeDoing(entries, 10_100)).toBe('using a computer');
    // A new run starts fresh.
    expect(describeDoing([...entries, entry('thinking', 'Thinking', 11_000, 'run-2')], 11_100)).toBeNull();
  });
});
