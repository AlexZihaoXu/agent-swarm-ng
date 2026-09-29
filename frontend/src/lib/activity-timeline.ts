import type { ActivityEntry } from './activity-history';

/** One visible step of a run. Tool calls absorb their result and execution details into a single step. */
export type ActivityStep =
  | { type: 'tool'; id: string; name: string; call?: ActivityEntry; result?: ActivityEntry; details: ActivityEntry[] }
  | { type: 'thinking' | 'message' | 'reply' | 'publish' | 'error' | 'note'; id: string; entry: ActivityEntry };

export type ActivityRun = {
  id: string;
  channelId: string;
  started: number;
  ended?: number;
  /** "Turn ended" and similar summary line, when the run has finished. */
  outcome?: ActivityEntry;
  steps: ActivityStep[];
  /** Provider/SDK bookkeeping (requests, responses, lifecycle), kept out of the step list. */
  details: ActivityEntry[];
  active: boolean;
};

const toolName = (label: string) => label.split(' — ')[0].trim();
const suffix = (label: string) => label.split(' — ')[1]?.trim() ?? '';

/**
 * Turns the flat, durable activity log into runs of meaningful steps: what the agent read, thought, called and
 * published. Bookkeeping stays available under each run's Details instead of competing with the steps.
 */
export function buildActivityRuns(entries: ActivityEntry[]): ActivityRun[] {
  const runs = new Map<string, ActivityRun>();
  for (const entry of entries) {
    let run = runs.get(entry.runId);
    if (!run) {
      run = {
        id: entry.runId,
        channelId: entry.channelId,
        started: entry.timestamp,
        steps: [],
        details: [],
        active: false,
      };
      runs.set(entry.runId, run);
    }
    run.started = Math.min(run.started, entry.timestamp);
    if (['streaming', 'running', 'pending'].includes(entry.state ?? '')) run.active = true;
    const name = toolName(entry.label);
    const open = () =>
      [...run.steps]
        .reverse()
        .find((step): step is Extract<ActivityStep, { type: 'tool' }> => step.type === 'tool' && step.name === name);
    switch (entry.kind) {
      case 'tool_call':
        run.steps.push({ type: 'tool', id: entry.id, name, call: entry, details: [] });
        break;
      case 'tool_result': {
        const step = open();
        if (step && !step.result) step.result = entry;
        else run.steps.push({ type: 'tool', id: entry.id, name, result: entry, details: [] });
        break;
      }
      case 'metadata': {
        // "<tool> — execution details" belongs to that tool's card; everything else is run bookkeeping.
        const step = suffix(entry.label) === 'execution details' ? open() : undefined;
        if (step) step.details.push(entry);
        else run.details.push(entry);
        break;
      }
      case 'status':
        // The context estimate lives in the panel header, not in any run.
        if (entry.label === 'Context usage') break;
        run.outcome = entry;
        run.ended = entry.timestamp;
        break;
      case 'thinking':
        run.steps.push({ type: 'thinking', id: entry.id, entry });
        break;
      case 'user':
        run.steps.push({ type: 'message', id: entry.id, entry });
        break;
      case 'assistant':
        run.steps.push({ type: 'reply', id: entry.id, entry });
        break;
      case 'channel':
        run.steps.push({ type: 'publish', id: entry.id, entry });
        break;
      case 'error':
        run.steps.push({ type: 'error', id: entry.id, entry });
        break;
      default:
        // system prompts and reminders: context, not actions.
        run.details.push(entry);
    }
  }
  return [...runs.values()];
}

/** Tool card status from its call/result states. */
export function toolStatus(step: Extract<ActivityStep, { type: 'tool' }>): 'running' | 'done' | 'error' {
  const state = (step.result ?? step.call)?.state ?? '';
  if (step.result?.kind === 'error' || state === 'error' || state === 'failed') return 'error';
  if (!step.result || ['streaming', 'running', 'pending'].includes(state)) return 'running';
  return 'done';
}
