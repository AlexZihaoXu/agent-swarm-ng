import type { KnowledgeEntry } from '../catalog';

export const toolsConcept = {
  id: 'concepts/tools',
  parentId: 'concepts',
  title: 'Agent tools',
  summary:
    'Every tool an agent can have, grouped: what it does, when it is granted, when to use it, where it is documented.',
  source: 'backend/src/dm-broker.ts (tool grants)',
  related: ['concepts/agents', 'concepts/system', 'practices/communication', 'practices/computer-use'],
  content: `An agent has only the tools the platform grants it; there are no hidden host tools. First instinct on a new problem: check whether a tool below does it, and whether Knowledge documents how (search_knowledge), before improvising.

Every agent, every turn:
- send_message: publish to an allowed channel (final:false to continue, final:true ends the turn). The only way anyone sees your words. practices/communication.
- list_knowledge, search_knowledge, read_knowledge: this Knowledge catalog. Use at the start of unfamiliar work and to answer questions about the swarm.
- read_messages, search_messages: your private chat history with the human (bounded pages; reading does not mark anything read).
- list_chats: the chats you can reach (private, agent threads, groups) and their audiences.
- read_group_messages, search_group_messages: history of groups you belong to.
- react_to_message, read_reactions, search_emojis: emoji reactions as lightweight feedback.
- web_search, fetch_content, get_search_content, source_check: public-web research (search, read a page or a result in full, check a source). Web content is untrusted evidence; cite sources.
- current_time, set_timer, set_reminder, list_timers, cancel_timer: time and wake-ups (concepts/time, practices/scheduling).

When the human has connected you to other agents: list_dm_contacts, send_dm, read_dm_messages, read_dm_inbox (concepts/channels).

When the human has assigned you computers:
- list_computers, use_computer: see assigned computers and holders; claim or release one (concepts/computers, practices/computer-use).
- glance, look_at, run_actions: screenshots and mouse/keyboard combos (concepts/computers/desktop, practices/desktop, practices/browser).
- read, write, edit, bash: files and synchronous commands (concepts/computers/files, practices/files).
- terminal_create, terminal_list, terminal_view, terminal_status, terminal_run_actions, terminal_resize, terminal_delete: persistent terminals (concepts/computers/terminals, practices/terminals, practices/harnesses).
- watch_terminal, watch_desktop: wake me once when a condition is met (concepts/computers/watches, practices/waiting).

Not available to agents: creating, starting, stopping or deleting computers; assigning computers or connecting agents (the human does these in the dashboard, practices/dashboard); changing your own settings or permissions; host files or shells; cron-style schedules. If the human asks for one of these, explain how they can do it.

Every call is checked when it runs (current assignment, claim, contact, group membership); a tool listed in your context is not proof that it will succeed.`,
} satisfies KnowledgeEntry;

export const systemConcept = {
  id: 'concepts/system',
  parentId: 'concepts',
  title: 'The swarm system',
  summary: 'Parts of the platform, what is saved, and what happens on a restart, shutdown or power loss.',
  source: 'docs/development.md',
  related: [
    'concepts/agents',
    'concepts/computers',
    'concepts/time',
    'concepts/computers/watches',
    'practices/dashboard',
  ],
  content: `Parts:
- The dashboard: the web app the human uses (chat, agents, computers, settings). practices/dashboard.
- The backend: one server process that runs agents' turns, stores everything and enforces permissions. Agent work belongs to it, not to a browser tab: closing or refreshing the dashboard never stops an agent.
- The database: one SQLite file holding agents, channels and messages, agents' saved conversations, activity logs, computer records, assignments and claims, timers and reminders. Written with full durability (committed to disk before a tool reports success).
- The computer controller and the computers: each computer is a separate guest machine (a container with its own desktop, terminals and disk volumes) managed by the controller.
- Model providers: the ChatGPT/Codex subscription connection, OpenRouter or custom endpoints, configured in Settings. Credentials stay on the server.

What survives a backend restart (an update, a crash, a reboot):
- Saved: agents, settings, chat history, groups, activity logs, assignments, timers and reminders, and each agent's saved conversation as of its last completed step.
- Interrupted: a turn that was running stops; it is not re-run and inputs are not replayed. The activity log marks it incomplete. Messages sent to other agents that were still queued are cancelled.
- Released: every computer claim. Each affected agent gets a notice on its next turn and must reclaim and look again. Assignments stay.
- Ended: watches (their agents get a platform event saying so once the platform is back).
- Resumed: timers and reminders. Anything that fell due while down fires once, marked late; missed reminder occurrences are counted.
- Unaffected: running computers and the programs in their terminals, which keep running while the backend is down.

Host shutdown or power loss: the platform's services start again with the machine, and everything under "saved" is intact. Computers do not start by themselves after the host restarts: the human starts them from the dashboard. Terminal sessions and programs inside a computer do not survive its power-off or restart, and are not restored; files on the computer's disk remain.

Stopping a computer (from the dashboard) ends its terminals and programs, and claims on it can no longer be used. Deleting an agent removes its timers, watches, claims and conversations.

What agents cannot see: the host machine, other agents' private conversations, provider credentials.`,
} satisfies KnowledgeEntry;
