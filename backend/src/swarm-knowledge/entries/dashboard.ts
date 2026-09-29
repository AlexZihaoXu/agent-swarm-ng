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
- practices/dashboard/chat: private chat, stopping an agent, viewing agent DMs, groups, reactions and replies.
- practices/dashboard/settings: ChatGPT/Codex subscription, OpenRouter and other endpoints, the Knowledge browser.

Not in the app: any view of agents' timers, reminders or watches (agents list them with list_timers; reminder entries can appear in the activity log); per-tool switches or system-prompt editing; theme, notification or user-account settings; uploading or deleting files through the file browser; editing Knowledge.`,
} satisfies KnowledgeEntry;

export const dashboardAgents = {
  id: 'practices/dashboard/agents',
  parentId: 'practices/dashboard',
  title: 'Dashboard: agents',
  summary:
    'Create an agent, edit its settings (DMs, model, computers, avatar), assign computers, delete it, find its activity.',
  source: 'frontend/src/components/edit-agent-form.tsx',
  related: ['practices/dashboard', 'concepts/agents', 'concepts/computers', 'concepts/channels'],
  content: `Agents tab. The left sidebar lists agents with a "Search agents" box and a + button ("Create new agent"). Clicking an agent opens its settings (not a chat). Right-click the sidebar for Create new agent / Delete agent. On a phone the list and the settings page are separate screens ("‹ Agents" goes back).

Create an agent: + (or /agents/new). The "Create new agent" dialog asks for Agent name, an optional Avatar, Endpoint (a model connection; if none exist, connect one in Settings first), Model and Thinking level, then "Create agent". A new agent can use the public web and read Swarm Knowledge; it has no computer, file or command access until a computer is assigned.

Agent settings (/agents/<id>), sections in order, with jump links in the header:
1. Channels: "Allowed DMs", one checkbox per other agent (with "Find agents" search; up to 100). Allowing a DM lets both agents message each other (off by default; automated chains are limited to eight DMs). "View DM" opens their read-only conversation.
2. Model: Name, Endpoint, Model, Thinking level.
3. Computers: cards of all computers with live previews; click a card to tick or untick it. This is where computers are assigned (not on the Computers tab).
4. Avatar: preview (idle/working/typing), variations, randomize, undo, shape, colour, eyes, mouth, markings, accessory, accent colour, fine-tune sliders.
5. Delete agent.
Changes are saved together: a bar slides up from the bottom when something changed, with "Discard changes" and "Save changes". Leaving with unsaved changes asks "Discard unsaved changes?".

Assigning a computer ("how do I give you a computer?"): Agents tab → pick the agent → Computers section → click the computer's card so it is ticked → Save changes. If no computers exist, create one first (practices/dashboard/computers). Assignment is permission; the agent then claims the computer itself when it needs it, and the viewer shows "<agent> is on this computer" while it holds control. Unticking releases control once active input and commands finish.

Delete an agent: the "Delete <name>…" button at the bottom of its settings (or right-click → Delete agent). Type the exact name into "Confirm agent name", then "Delete agent". This removes its private chat, DMs and DM permissions (and its timers, watches and saved conversation).

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
  content: `Computers tab (/computers): "Computers · N of M in use" with a "Create computer" button at the top right (disabled when the limit is reached or the controller is offline). Each card shows a live preview, status (Running, Stopped, Creating, Deleting, Unavailable), CPU and memory dials, and a ⋯ menu (also right-click): Open, Power on / Power off, File browser, Terminals, Settings, and Danger zone → Remove.

Create a computer: "Create computer" → name (suggested), CPU cores and Memory (GiB) with −/+, Timezone → "Create computer". Then assign it to agents in their settings (practices/dashboard/agents).

Power: ⋯ → Power on / Power off (confirms, and warns if an agent is using it). Powering off ends its terminals and running programs; files on its disk remain. Computers do not start by themselves after the host machine restarts: power them on here.

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

Force release: takes control away from the agent now, after stopping its active operation; the agent keeps its assignment and its terminal programs keep running. The agent is told on its next turn.

Terminals: the "‹" handle on the right edge ("Terminals") opens a drawer of live terminal previews: click one to float it as a window (several can be open; drag by the title bar, resize from any edge, click to bring to front, red light returns it to the drawer); "+" makes a new terminal (name, optional initial command, working directory, default ~/Desktop). The Terminal view (Desktop | Terminal switch, /computers/<id>/terminal) lists sessions with "+", delete, and right-click Rename…, Window size (80×24 up to 200×50) and Delete terminal…. A small avatar badge shows when an agent is typing in a terminal. On phones a key bar offers Ctrl, Esc, Tab and common shortcuts.

The "^" handle at the bottom ("All computers") switches between computers.`,
} satisfies KnowledgeEntry;

export const dashboardChat = {
  id: 'practices/dashboard/chat',
  parentId: 'practices/dashboard',
  title: 'Dashboard: chat',
  summary: 'Private chat, stopping an agent, viewing agent-to-agent DMs, group chats, reactions and replies.',
  source: 'frontend/src/components/chat-panel.tsx',
  related: ['practices/dashboard', 'concepts/channels', 'practices/communication'],
  content: `Chat tab (/chat). The sidebar ("Search chats", + for a new group) mixes agent chats and groups, newest first; right-click for Open chat, Create group chat, Edit/Delete group chat, or View in Agents.

Private chat (/chat/agents/<id>): the message box ("Message <name>…"; Enter sends on a computer, Shift+Enter for a new line; on a phone use the ↑ button). While the agent works a square "Stop response" button appears next to Send: it stops the current run. The line above the box shows when the agent is working or typing. Older messages load as you scroll up. DMs the agent received from other agents appear inline as "Received from <agent>".

Agent-to-agent DMs: read-only. Pick the other agent in the header's "Chat with" menu (or Agents → Channels → View DM). Allow or disallow DMs in the agent's settings (practices/dashboard/agents).

Groups: + (or right-click → Create group chat) → Group name and up to 16 agents → "Create group". The group header lists members and has Edit group (rename, change members, "Delete group chat"). Stop in a group stops every member's run started from that group. Group membership does not allow members to DM each other.

Reactions and replies (private, group and floating chats): right-click a message (long-press on touch) for recent emojis, "Add reaction ›" (emoji search) and Reply. Existing reactions under a message toggle yours. An agent may respond to a reaction, which uses its model.

Floating chat: in a computer's desktop viewer, click "<agent> is on this computer" to chat with that agent in a floating window ("Open in Chat" opens the full chat).

Activity log: the "Agent activity" icon in a private chat's header (practices/dashboard/agents).`,
} satisfies KnowledgeEntry;

export const dashboardSettings = {
  id: 'practices/dashboard/settings',
  parentId: 'practices/dashboard',
  title: 'Dashboard: settings',
  summary: 'Connect the ChatGPT/Codex subscription, OpenRouter or another endpoint; browse Swarm Knowledge.',
  source: 'frontend/src/components/settings.tsx',
  related: ['practices/dashboard', 'concepts/system'],
  content: `Settings tab (/settings), three sections.

OpenAI Codex: use a ChatGPT Plus or Pro subscription without an API key. "Connect ChatGPT" shows a one-time sign-in code and an "Open OpenAI sign-in" link; enter the code there (device code sign-in may need enabling in ChatGPT → Settings → Security). Status reads Not connected, Waiting for sign-in… or Connected to ChatGPT; "Disconnect" removes it.

API endpoints: "Add OpenRouter" (prefills https://openrouter.ai/api/v1) or "+ Add endpoint" for another OpenAI-compatible provider or a local server: Name, Base URL, API key, then "Save endpoint". "Test connection" lists the models (no model request). Saved endpoints can be edited or removed (×). Agents choose an endpoint and model in their settings (Model section).

Swarm Knowledge: "Browse Swarm Knowledge" (/settings/knowledge) opens this catalog read-only: topics with search on the left, the entry with its breadcrumb and related links on the right. It cannot be edited in the app.

There are no other settings (no theme, notifications or user accounts).`,
} satisfies KnowledgeEntry;
