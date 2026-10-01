import type { KnowledgeEntry } from '../catalog';

// Where things are in the dashboard, so an agent can tell the human exactly what to click.

export const dashboardPractice = {
  id: 'practices/dashboard',
  parentId: 'practices',
  title: 'The dashboard: guiding the human',
  summary: 'Where things are in the app (tabs, URLs) and what humans do there that agents cannot; answer "how do I…".',
  source: 'frontend/src/app.tsx',
  related: [
    'concepts/system',
    'concepts/tools',
    'practices/dashboard/agents',
    'practices/dashboard/computers',
    'practices/dashboard/chat',
    'practices/dashboard/settings',
  ],
  content: `The dashboard is the web app the human uses. When they ask how to do something, answer with the exact labels and steps from these entries (and the URL if helpful). Do not guess at controls that are not described here; say if something does not exist.

Main tabs, in order: Agents, Chat, Computers, Settings (a bar at the top on a computer; a floating pill near the bottom on a phone, hidden while a conversation or detail page is open). The tab bar is hidden inside a computer's desktop viewer; the "Computers" breadcrumb goes back.

Addresses: /agents (agents and their settings), /chat (conversations), /computers (computers and their viewers), /settings (model connections and the Knowledge browser, /settings/knowledge).

Only the human can (agents have no tools for these): create, edit and delete agents; allow agent-to-agent DMs; assign computers to agents; create, power on/off, configure and delete computers; force release a computer; create and edit groups; connect model providers. Agents can explain how.

Topics:
- practices/dashboard/agents: create an agent, its settings (DMs, model, computers, avatar), delete, the activity log.
- practices/dashboard/computers: create, power, settings, delete; the desktop viewer, input lock, terminals, floating windows, force release, file browser.
- practices/dashboard/chat: private chat, stopping an agent, viewing agent DMs and Discord channels, groups, reactions and replies.
- practices/dashboard/settings: ChatGPT/Codex subscription, OpenRouter and other endpoints, the Knowledge browser.

Not in the app: any view of agents' timers, reminders or watches (agents list them with list_timers; reminder records can appear in a run's collapsed "Details" in the activity log); per-tool switches or system-prompt editing; theme, notification or user-account settings; uploading or deleting files through the file browser; editing Knowledge.`,
} satisfies KnowledgeEntry;

export const dashboardAgents = {
  id: 'practices/dashboard/agents',
  parentId: 'practices/dashboard',
  title: 'Dashboard: agents',
  summary:
    'Create an agent, edit its settings (DMs, model, computers, scratchpad, avatar), assign computers, delete it, find its activity.',
  source: 'frontend/src/components/edit-agent-form.tsx',
  related: ['practices/dashboard', 'concepts/agents', 'concepts/computers', 'concepts/channels'],
  content: `Agents tab. The left sidebar lists agents with a "Search agents" box and a + button ("Create new agent"). Clicking an agent opens its settings (not a chat). Right-click the sidebar for Create new agent / Delete agent. On a phone the list and the settings page are separate screens ("‹ Agents" goes back).

Create an agent: + (or /agents/new). The "Create new agent" dialog asks for Agent name, an optional Avatar, Endpoint (a model connection; if none exist, connect one in Settings first), Model and Thinking level, then "Create agent". A new agent can use the public web, read Swarm Knowledge, keep a private scratchpad and open files sent in its chats; it has no computer or command access until a computer is assigned.

Agent settings (/agents/<id>), sections in order, with jump links in the header:
1. Channels: Swarm App "Allowed DMs" and Discord (below).
   Swarm App: "Allowed DMs", one checkbox per other agent (with "Find agents" search; up to 100). Allowing a DM lets both agents message each other (off by default; automated chains are limited to eight DMs). "View DM" opens their read-only conversation.
2. Model: Name, Endpoint, Model, Thinking level, and Active context: "Compact while working at (%)" (20–90, default 65), "Compact when idle for (minutes)" (0 = never, default 30) and "…if the context is at least (%)" (default 50). Active context settings apply from the next summary, also while the agent works.
   Instructions: the human's own guidance for the agent in a rich-text editor (select text for headings, lists, bold, code); saved as Markdown with Save changes after a warning that the next reply re-reads everything once (the provider's cache no longer matches). The agent sees them last in its system prompt from its next turn.
3. Computers: cards of all computers (previews refresh about every 10 s); click a card to tick or untick it. This is where computers are assigned (not on the Computers tab). A stopped computer can be ticked (it shows "Desktop offline") but cannot be used until powered on. With no computers it says "No computers yet. Create one in Computers first."
4. Scratchpad: a read-only browser of the agent's scratch files (folders, sizes, a text or image preview, usage against the limits); it refreshes as the agent writes. Ask the agent to change them.
5. Avatar: preview (idle/working/typing), variations, randomize, undo, shape, colour, eyes, mouth, markings, accessory, accent colour, fine-tune sliders.
6. Delete agent.
Changes are saved together: a bar slides up from the bottom when something changed, with "Discard changes" and "Save changes". Leaving with unsaved changes asks "Discard unsaved changes?".

Discord (Channels → Discord): the agent's own Discord bot. "Bot token" (pasted, never shown again; "Disconnect" removes it), a status pill ("Online as <bot>", or the reason it is not connected), "Add the bot to a server ↗", "Allowed DMs" (the people besides you and your agents who may DM the bot: "Add people" searches people it has seen or takes a Discord user ID; × removes; nobody else can DM it), the switch "Catch up after an outage", "In server channels, wake it" (When it seems relevant, the default / Only when mentioned / Every message), and "Channels it may use": the chosen channels grouped by server (Discord calls servers guilds), each with when it wakes the agent and × to remove; "Add channels" opens a search over every server and channel the bot can see ("All channels in <server>", or one channel at a time; threads follow their channel). A "How to create a Discord bot" guide there lists the Developer Portal steps (concepts/discord has them too). Saved with Save changes.

Assigning a computer ("how do I give you a computer?"): Agents tab → pick the agent → Computers section → click the computer's card so it is ticked → Save changes (it confirms "Computer assignments saved."). If no computers exist, create one first (practices/dashboard/computers). Several agents can be assigned the same computer; one holds it at a time. Assignment is permission; the agent then claims the computer itself when it needs it, and the viewer shows "<agent> is on this computer" while it holds control. Unticking releases control once active input and commands finish.

Delete an agent: the "Delete <name>…" button at the bottom of its settings (or right-click → Delete agent). Type the exact name into "Confirm agent name", then "Delete agent". This removes its private chat, DMs and DM permissions (and its timers, watches and saved conversation).

Background compaction on the avatar: a thin violet arc orbiting an agent's avatar (in Chat and Agents lists and headers) means it is summarizing older context in the background; the chat status line says "compacting its context in the background". Closed eyes with rising "z z z" mean it is asleep: its context filled before the summary was ready, and it continues by itself once it is. The activity log shows "Background compaction started/applied", "Sleeping" and "Idle compaction" entries.

Activity log: not in the Agents tab. Open the agent's private chat (Chat tab) and click the "Agent activity" icon at the right of the conversation header. It lists runs with their steps (thinking, received inputs, replies, tool calls with inputs and results, screenshots, errors), a Context usage bar, and loads older runs as you scroll up. Watch checks and triage appear there as their own entries.

Not available: per-tool switches, editing the system prompt.`,
} satisfies KnowledgeEntry;

export const dashboardComputers = {
  id: 'practices/dashboard/computers',
  parentId: 'practices/dashboard',
  title: 'Dashboard: computers',
  summary:
    'Create, power, configure and delete computers; the desktop viewer, input lock, terminals, force release, files.',
  source: 'frontend/src/components/computers-panel.tsx',
  related: ['practices/dashboard', 'concepts/computers', 'concepts/computers/terminals', 'concepts/system'],
  content: `Computers tab (/computers): "Computers", subtitled "Containerized Ubuntu desktops · N of M in use", with a "Create computer" button at the top right (disabled when the limit is reached, "Limit reached (M). Delete a computer to create another.", or when computer management is offline, which a banner explains; the ⋯ menus and opening cards are disabled then too). Each card shows a live preview, status (Running, Stopped, Creating, Deleting, Unavailable), CPU and memory dials, and a ⋯ menu (also right-click): Open, Power on / Power off, File browser, Terminals, Settings, and Danger zone → Remove.

Create a computer: "Create computer" (or right-click empty space → New computer, or /computers/new) → "Computer name" (suggested), "CPU cores" and "Memory (GiB RAM)" with −/+, "Timezone" → "Create computer". It starts by itself (Creating, then Running). Then assign it to agents in their settings (practices/dashboard/agents).

Power: ⋯ → Power on (starts at once) / Power off (asks to confirm, and warns if an agent is using it). Powering off ends its terminals and running programs; files on its disk remain. After the host machine restarts, computers that were on start again by themselves; ones powered off stay off.

Settings: ⋯ → Settings. CPU and memory apply live; changing the timezone requires the computer powered off, a confirmation tick and "Replace stopped computer".

Delete: ⋯ → Remove → type the name into "Confirm computer name" → "Delete computer".

Files: ⋯ → File browser: browse, preview text and download (no upload or delete).

Desktop viewer (click a running card, or Open; /computers/<id>): the header has
- "Computers / <name>" breadcrumb (back),
- a Desktop | Terminal switch,
- control status "<agent> is on this computer" (Ready, Working, Typing) or "No agent holds control"; clicking the agent opens a floating chat with it; next to it "Force release",
- the input lock (starts locked each time; unlock to use mouse and keyboard; on an upright phone the desktop is rotated and input stays locked: turn the phone sideways),
- sound on/off (HTTPS address only),
- "Send keys" (while input is live): New tab, Close tab, Address bar, Reload, New window.

Force release (confirm in "Force release computer"): takes control away from the agent now, after stopping its active operation; the agent keeps its assignment and its terminal programs keep running. The agent is told on its next turn.

Terminals: the "‹" handle on the right edge ("Terminals") opens a drawer of live terminal previews: click one to float it as a window (several can be open; drag by the title bar, resize from any edge, click to bring to front, red light returns it to the drawer); "+" makes a new terminal (name, optional initial command, working directory, default ~/Desktop). The Terminal view (Desktop | Terminal switch, /computers/<id>/terminal) lists sessions with "+", delete, and right-click Rename…, Window size (80×24 up to 200×50) and Delete terminal…. A small avatar badge shows when an agent is typing in a terminal. On phones a key bar offers Ctrl, Esc, Tab and common shortcuts.

The "^" handle at the bottom ("All computers") switches between computers.`,
} satisfies KnowledgeEntry;

export const dashboardChat = {
  id: 'practices/dashboard/chat',
  parentId: 'practices/dashboard',
  title: 'Dashboard: chat',
  summary:
    'Private chat, stopping an agent, viewing agent-to-agent DMs and Discord channels, group chats, reactions and replies.',
  source: 'frontend/src/components/chat-panel.tsx',
  related: ['practices/dashboard', 'concepts/channels', 'practices/communication'],
  content: `Chat tab (/chat). The sidebar ("Search chats", + for a new group) mixes agent chats and groups, newest first; right-click for Create group chat, Open chat, Edit group chat, Delete group chat, or View in Agents.

Private chat (/chat/agents/<id>): the message box ("Message <name>…"; Enter sends on a computer, Shift+Enter for a new line; on a phone use the ↑ button). While the agent works a square "Stop response" button appears next to Send: it stops the current run. The line above the box shows when the agent is working or typing. Older messages load as you scroll up. DMs the agent received from other agents appear inline as "Received from <agent>".

Agent-to-agent DMs: read-only. Pick the other agent in the header's "Chat with" menu (or Agents → Channels → View DM). Allow or disallow DMs in the agent's settings (practices/dashboard/agents).

Discord: read-only too. The same "Chat with" menu lists the agent's Discord places ("Discord #channel", "Discord › thread", "Discord DM name"; /chat/agents/<id>/discord/<channelId>) and shows what its bot saw there: the human's own Discord accounts as "You", the agent as itself, others with "· bot" or "· agent", and "edited", "deleted" or "attached <file>" under a message. Files agents opened from it are in the folder icon. The human posts on Discord itself; the agent posts through its bot. Saved messages are kept for Settings → Swarm → "Discord history kept" days.

Groups: + (or right-click → Create group chat) → Group name, then "Add agents" (a search; choose up to 16, then Done; the chosen ones are listed with × to remove) → "Create group". The group header lists members and has Edit group (rename, change members, "Delete group chat"). Stop in a group stops every member's run started from that group. Group membership does not allow members to DM each other.

Reactions and replies (private, group and floating chats): right-click a message (long-press on touch) for recent emojis, "Add reaction ›" (emoji search) and Reply. Existing reactions under a message toggle yours. An agent may respond to a reaction, which uses its model.

Files: the paperclip beside the message box (or drag files onto it, or paste) attaches up to 10 files to the next message; each uploads right away with progress, × removes one, and a message can be files only. In messages, images appear as a grid (click to open full size), videos (MP4, MOV, WebM) as a player under their name and size (the speed button beside the size steps 0.2×–2×), text files as a preview with Expand and a download link in the name, other files as a card whose name downloads them; a live scratch preview is marked "Live" and follows the agent's edits. The folder icon in a chat header (private chats, agent-to-agent DM views and groups) opens Files: search, sort by name, type, size or date, download, and delete (select several, then Delete); a deleted file stays in the chat as "Deleted by …" with the date. The largest file and total storage are set in Settings → Swarm.

Floating chat: in a computer's desktop viewer, click "<agent> is on this computer" to chat with that agent in a floating window ("Open in Chat" opens the full chat).

Activity log: the "Agent activity" icon in a private chat's header (practices/dashboard/agents).`,
} satisfies KnowledgeEntry;

export const dashboardSettings = {
  id: 'practices/dashboard/settings',
  parentId: 'practices/dashboard',
  title: 'Dashboard: settings',
  summary:
    'Connect the ChatGPT/Codex subscription, OpenRouter or another endpoint; browse Swarm Knowledge; Swarm limits.',
  source: 'frontend/src/components/settings.tsx',
  related: ['practices/dashboard', 'concepts/system'],
  content: `Settings tab (/settings), five sections in this order.

OpenAI Codex: use a ChatGPT Plus or Pro subscription without an API key. "Connect ChatGPT" shows a one-time sign-in code and an "Open OpenAI sign-in" link; enter the code there (device code sign-in may need enabling in ChatGPT → Settings → Security). Status reads Not connected, Waiting for sign-in… or Connected to ChatGPT; "Disconnect" removes it.

Swarm Knowledge: "Browse Swarm Knowledge" (/settings/knowledge) opens this catalog read-only: topics with search on the left, the entry with its breadcrumb and related links on the right. It cannot be edited in the app.

API endpoints: "Add OpenRouter" (prefills https://openrouter.ai/api/v1) or "+ Add endpoint" for another OpenAI-compatible provider or a local server: Name, Base URL, API key, then "Save endpoint". "Test connection" lists the models (no model request). Saved endpoints can be edited, or removed with × after a confirmation (not while an agent uses them). Agents choose an endpoint and model in their settings (Model section).

Discord: "Your Discord accounts": User ID and Name rows ("Add account", "Remove", "Save changes"). Only these accounts carry the human's authority on Discord. How to copy a user ID: Discord → User Settings → Advanced → Developer Mode on, then right-click your name → Copy User ID.

Swarm (last section): limits for the whole swarm, saved with "Save changes": Computers (most that can exist at once), Largest chat file (MB), Total file storage (GB; a chat's Files dialog warns when it is 80% used, and uploads are refused when full), Largest scratch file (KB), Scratch files per agent and Scratch space per agent (MB), and Discord history kept (days; older saved Discord messages are deleted hourly, files opened from them stay). Lowering a file limit never deletes anything; new work past it is refused.

There are no other settings (no theme, notifications or user accounts).`,
} satisfies KnowledgeEntry;
