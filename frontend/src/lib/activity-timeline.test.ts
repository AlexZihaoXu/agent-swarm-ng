import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from './activity-history';
import { buildActivityRuns, toolStatus } from './activity-timeline';

let sequence = 0;
const entry = (kind: ActivityEntry['kind'], label: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: `e${++sequence}`,
  runId: 'run-1',
  channelId: 'channel',
  kind,
  label,
  text: label,
  timestamp: 1000 + sequence,
  state: 'complete',
  ...extra,
});

describe('buildActivityRuns', () => {
  it('pairs tool calls with their results and details, and keeps bookkeeping out of the steps', () => {
    const [run] = buildActivityRuns([
      entry('metadata', 'Provider request'),
      entry('thinking', 'Thinking'),
      entry('tool_call', 'web_search'),
      entry('metadata', 'web_search — execution details'),
      entry('tool_result', 'web_search — result'),
      entry('tool_call', 'send_message'),
      entry('tool_result', 'send_message — result'),
      entry('channel', 'Channel publication'),
      entry('metadata', 'SDK generation ended'),
      entry('status', 'Turn ended'),
    ]);
    expect(run.steps.map(step => step.type)).toEqual(['thinking', 'tool', 'tool', 'publish']);
    const search = run.steps[1];
    expect(search.type === 'tool' && [search.name, search.result?.label, search.details.length]).toEqual([
      'web_search',
      'web_search — result',
      1,
    ]);
    expect(run.details.map(item => item.label)).toEqual(['Provider request', 'SDK generation ended']);
    expect(run.outcome?.label).toBe('Turn ended');
    expect(run.active).toBe(false);
  });

  it('splits runs, marks a streaming run active, and reports tool status', () => {
    const runs = buildActivityRuns([
      entry('tool_call', 'bash', { runId: 'a' }),
      entry('tool_call', 'read', { runId: 'b', state: 'running' }),
    ]);
    expect(runs.map(run => [run.id, run.active])).toEqual([
      ['a', false],
      ['b', true],
    ]);
    const bash = runs[0].steps[0];
    expect(bash.type === 'tool' && toolStatus(bash)).toBe('running');
    const [done] = buildActivityRuns([entry('tool_call', 'x'), entry('tool_result', 'x — result')]);
    expect(done.steps[0].type === 'tool' && toolStatus(done.steps[0])).toBe('done');
  });
});
