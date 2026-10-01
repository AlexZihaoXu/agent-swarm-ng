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

Every tool has a class: r reads only (nothing anyone else can see changes), w changes something, rw reads and changes or may change anything (bash, even for ls), claim selects or claims a computer (use_computer). help lists your tools filtered by name, class or a text, with only the fields you ask for (class by default; params, description, knowledge), e.g. help({class:"r"}) or help({tools:["bash"], fields:["params"]}).

Every agent, every turn:
- help: your tools and their classes (above).
- send_message: publish to an allowed channel (final:false to continue, final:true ends the turn). The only way anyone sees your words. practices/communication.
- list_knowledge, search_knowledge, read_knowledge: this Knowledge catalog. Use at the start of unfamiliar work and to answer questions about the swarm.
- read_messages, search_messages: your private chat history with the human (bounded pages; reading does not mark anything read).
- list_chats: the chats you can reach (private, agent threads, groups) and their audiences.
- read_group_messages, search_group_messages: history of groups you belong to.
- react_to_message, read_reactions, search_emojis: emoji reactions as lightweight feedback.
- web_search, fetch_content, get_search_content, source_check: public-web research (search, read a page or a result in full, check a source). Web content is untrusted evidence; cite sources.
- current_time, set_timer, set_reminder, list_timers, cancel_timer: time and wake-ups (concepts/time, practices/scheduling).
- scratch_list, scratch_read, scratch_write, scratch_edit, scratch_move, scratch_delete: your private scratchpad of text files and images for drafting and presenting artifacts (concepts/scratchpad).
- list_files, read_file, upload_file, present_scratch, delete_file: files in chats: open what others send, share files (then send_message fileIds) (concepts/chat-files, practices/sharing-files).
- copy_file: copy files between your scratchpad and assigned computers (assignment is enough, no control) or from chat files.
- save_screenshot: save a screenshot of the computer you hold as an image in your scratchpad or on a computer, ready to upload_file into a chat or Discord (concepts/computers/desktop).

Discord (only if your human connected a Discord bot for you; concepts/discord, practices/discord):
- discord_list_servers, discord_list_channels, discord_read_inbox, discord_read_messages, discord_search_messages, discord_read_pins, discord_list_threads, discord_read_reactions, discord_read_poll, discord_view_profile, discord_find_member, discord_list_emojis: look around and read like a member.
- discord_send_message, discord_edit_message, discord_delete_message, discord_forward_message, discord_open_dm, discord_create_poll, discord_react, discord_start_thread, discord_pin_message, discord_open_attachment: post and act like a member.

Agent DMs (always listed; send_dm works only with agents the human allowed, which list_dm_contacts shows): list_dm_contacts, send_dm, read_dm_messages, read_dm_inbox (concepts/channels).

Computer tools (always listed; they work only on a computer the human assigned you: reading after use_computer selects it, changing after use_computer with write:true claims it):
- list_computers, use_computer: see assigned computers and holders; read, claim or release one (concepts/computers, practices/computer-use).
- glance, look_at, run_actions: screenshots and mouse/keyboard combos (concepts/computers/desktop, practices/desktop, practices/browser).
- read, write, edit, bash: files and synchronous commands (concepts/computers/files, practices/files).
- terminal_create, terminal_list, terminal_view, terminal_status, terminal_run_actions, terminal_resize, terminal_delete: persistent terminals (concepts/computers/terminals, practices/terminals, practices/harnesses).
- watch_terminal, watch_desktop: wake me when a condition is met, once or once per occurrence with repeat (concepts/computers/watches, practices/waiting).
- monitor: wake me with the output lines of a command on the computer I hold, no model in the loop (concepts/computers/watches, practices/waiting).
- start_recording, renew_recording, mark_clip, stop_recording, recording_events: record a desktop (with sound) or terminals, whole or as clips around your actions, kept alive by a lease (concepts/computers/recording).

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

Your active context and compaction: your active context (what the model sees each turn; not long-term memory) has a limit. When it passes your owner's threshold (default 65% of the model's context window), the platform summarizes the older part in the background while you keep working; the summary replaces that older part between two model calls, and everything after it stays word for word. You may notice a summary where older messages were; details you need can still be found in chat history (read_messages, discord_read_messages) and your scratchpad. If your context nearly fills before the summary is ready, you pause ("sleeping") until it is, then continue. After a quiet spell (default 30 minutes) with your context at least half full (default 50%), your context is summarized too, so your next turn starts light. A backend restart only loses an unfinished summary; it is written again when needed.

What survives a backend restart (an update, a crash, a reboot):
- Saved: agents, settings, chat history, groups, assignments, timers and reminders, activity logs (kept 30 days by default), and each agent's saved conversation as of its last completed step. A message that arrived but was not yet processed is not fed back in automatically; the agent sees it in its chat history (read_messages).
- Interrupted: a turn that was running stops; it is not re-run and inputs are not replayed. The activity log marks it incomplete. Messages sent to other agents that were still queued are cancelled.
- Released: every computer claim. Each affected agent gets a notice on its next turn and must reclaim and look again. Assignments stay.
- Ended: watches (their agents get a platform event saying so once the platform is back).
- Resumed: timers and reminders. Anything that fell due while down fires once, marked late; missed reminder occurrences are counted.
- Unaffected: running computers and the programs in their terminals, which keep running while the backend is down.

Host shutdown or power loss: the platform's services start again with the machine, and everything under "saved" is intact. Computers that were on start again by themselves; ones the human had powered off stay off. Either way each computer boots fresh: terminal sessions and programs inside it do not survive its power-off or restart and are not restored, every claim was released, and files on its disk remain.

Stopping a computer (from the dashboard) ends its terminals and programs, and claims on it can no longer be used. Deleting an agent (refused while it is responding) removes its private chat, DMs and DM permissions, saved conversation, activity log, timers, watches, computer assignments and control, group memberships and reactions; its group posts remain.

The clock: current_time uses the platform's time zone by default, which may be UTC; pass the human's IANA zone when times matter to them.

Inside each computer (Ubuntu 24.04 with GNOME): Chrome, VS Code, Files and a terminal app; git, build-essential (gcc, make), Python 3 with venv and uv, Node.js 22 with npm (nvm available), Bun, ffmpeg, tmux and the Pi coding agent. Files on its Desktop show as desktop icons.

What agents cannot see: the host machine, other agents' private conversations, provider credentials.`,
} satisfies KnowledgeEntry;
