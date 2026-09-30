import type { ActivityEntry } from '@/use-chat';

/** What a tool call looks like from outside, in plain words ("Aether is browsing the web…"). */
const phrases: [RegExp, string][] = [
  [/^(list|search|read)_knowledge$/, 'reading Knowledge'],
  [/^(web_search|fetch_content|get_search_content|source_check|code_search)$/, 'browsing the web'],
  [/^(terminal_\w+|watch_terminal|bash)$/, 'working in a terminal'],
  [/^(use_computer|look_at|glance|run_actions|watch_desktop|list_computers)$/, 'using a computer'],
  [/^(read|write|edit)$/, 'editing files on a computer'],
  [/^scratch_(read|list)$/, 'reading its scratchpad'],
  [/^(scratch_\w+|present_scratch)$/, 'writing in its scratchpad'],
  [/^(upload_file|read_file|copy_file|list_files|delete_file)$/, 'handling files'],
  [
    /^(read_messages|search_messages|list_chats|read_group_messages|search_group_messages|read_dm_messages|read_dm_inbox|list_dm_contacts)$/,
    'reading chat history',
  ],
  [/^send_dm$/, 'messaging another agent'],
  [/^(react_to_message|read_reactions|search_emojis)$/, 'reacting'],
  [/^(set_timer|set_reminder|cancel_timer|list_timers)$/, 'setting a timer'],
  [/^current_time$/, 'checking the time'],
  [
    /^discord_(send_message|edit_message|forward_message|react|create_poll|start_thread|pin_message|delete_message|open_dm)$/,
    'posting on Discord',
  ],
  [/^discord_\w+$/, 'reading Discord'],
];
export function describeTool(name: string) {
  return phrases.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}
/** Unnamed work shorter than this keeps the last named activity on screen. */
export const DOING_HOLD_MS = 5000;

/**
 * What an agent is doing in its current run, from its activity: the latest named tool call, kept while newer work
 * is still named, and dropped back to plain "working" (null) once something unnamed (thinking, an unmapped tool) has
 * run for DOING_HOLD_MS. Publishing (send_message) changes nothing: typing already shows it.
 */
export function describeDoing(entries: readonly ActivityEntry[], now: number) {
  const run = entries.at(-1)?.runId;
  let label: string | null = null;
  let unnamedSince: number | null = null;
  for (const entry of entries) {
    if (entry.runId !== run) continue;
    if (entry.kind === 'tool_call') {
      if (entry.label === 'send_message') continue;
      const phrase = describeTool(entry.label);
      if (phrase) {
        label = phrase;
        unnamedSince = null;
      } else unnamedSince ??= entry.timestamp;
    } else if (entry.kind === 'thinking' && label) unnamedSince ??= entry.timestamp;
  }
  return label && (unnamedSince === null || now - unnamedSince < DOING_HOLD_MS) ? label : null;
}
