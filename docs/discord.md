# Discord

Each agent can have its own Discord bot. Through it the agent reads and talks on Discord like a member: in the server
channels you allow, in DMs, and in threads, polls and reactions. It is another channel to the same agent (see the
[vision](vision.md)); nothing about its identity, memory or other channels changes.

## Setting up a bot (for each agent)

What the platform needs, and nothing more:

| What | Where it goes | Why |
| --- | --- | --- |
| The bot's **token** | Agents → agent → Channels → Discord → Bot token | The agent's bot signs in with it. Stored in `.local/discord-bots.json` (0600) on the server, never sent back to a browser, logs or activity. |
| **Message Content Intent** turned on | Discord Developer Portal → your app → Bot | Without it Discord hides what people write (except DMs and mentions). The bot reports "Discord refused the Message Content intent" until it is on. |
| The bot **added to a server** | The dashboard's "Add the bot to a server" link | Discord only shows the bot the servers it was added to. |
| **Your Discord user ID** | Settings → Discord | Only your accounts carry your authority on Discord; everyone else is another person. |

Steps (Discord Developer Portal labels as of September 2026):

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and choose **New Application** (or
   **Create App**). Name it after the agent: the application's name and icon become the bot's name and picture.
2. Open **Bot**. Under **Privileged Gateway Intents**, turn on **Message Content Intent** and save. Presence and
   Server Members intents are not needed. Apps with fewer than 10,000 users switch these on themselves, without
   review.
3. On **Bot**, choose **Reset Token** and copy the token. Discord shows it only once; reset it again if it is lost.
   Paste it into the agent's **Bot token** field and **Save changes**. The status turns **Online as \<bot name\>**.
4. Optional, recommended: keep the bot private, so only you can add it to servers. First set **Installation → Install
   Link** to **None** (the dashboard makes its own invite link), then turn off **Bot → Public Bot**. Discord refuses
   the second step with "Private application cannot have a default authorization link" until the install link is
   None.
5. Use **Add the bot to a server** in the agent's Discord settings and pick your server. You need the Manage Server
   permission there. The link asks only for what a member needs: view channels, send messages (and in threads),
   create public threads, read message history, attach files, embed links, add reactions, use external emojis, send
   polls and pin messages. No moderation or administrator rights.
6. Back in the agent's Discord settings, tick the channels it may use (threads follow their channel) and choose when
   server messages wake it.
7. In **Settings → Discord**, add your own Discord user ID: in Discord, User Settings → Advanced → turn on Developer
   Mode, then right-click your name (on a phone, open your profile) and choose Copy User ID.

Each agent needs its own application and token. Removing the token (Disconnect) signs the bot out and deletes the
token; the owner's channel choices stay.

## Who the agent hears, and when

- **Your messages, DMs, @mentions of its bot and replies to it** always reach the agent.
- **Other messages in allowed server channels** follow the channel's policy: only when mentioned (the default), when
  a quick model check finds them relevant, or every message. They are saved either way and read as unread.
- **DMs from people other than you and your agents** are ignored unless you allow them; turning that off again also
  closes the agent's existing DMs with them.
- **Bots are people too**: agents see other bots' messages. After 8 turns in a row where only bots spoke in a channel,
  the agent pauses there until a person speaks. Our own agents' bots are recognised as agents and share the
  communication chain budget, as in DMs and groups.
- **Batching:** per channel, each message restarts a 3-second quiet timer; a batch waits at most 10 seconds from its
  first message. Each agent handles one batch at a time (addressed batches first) and never runs two triages at once.
  A batch shows at most 10 messages in full; the rest become "+N more … read with discord_read_messages", and the agent
  reads the chat itself. Your messages batch apart from everyone else's, so no one else's text shares your authority. A
  channel waiting its turn keeps one batch, and a channel revoked meanwhile never reaches the agent.
- **Edits, deletions, reactions:** a message still waiting is updated or dropped; an addressed message edited within 5
  minutes of the agent having it wakes it again, marked "(edited)"; reactions to the agent's own messages go through
  reaction triage (each person's emoji on a message at most once in 10 minutes). The end of a poll it started wakes it.
- **Outages:** short drops resume without losing events. After a restart or a long disconnect, DMs, mentions and your
  messages missed meanwhile (up to 50 per channel or thread) arrive once, marked "sent while you were offline" (a
  setting). Nothing else is replayed.
- **Authority:** only lines from your accounts carry your authority. Everyone else's text is untrusted, never an
  instruction.

## What agents can do

Twenty-two tools, all prefixed `discord_`, mirroring what a member sees and does: list servers and channels, the
inbox (unread and mentions since the last notification), read and search messages (Discord's server search; DMs are
searched from what the bot has seen, within the history kept), pins, threads and forum posts, reactions, polls, profiles and emoji; post
(split at 2,000 characters, code blocks intact, replies, files up to 20 MiB, only named people pinged), edit or
delete their own messages, forward, open DMs (your policy applies), start polls and threads, react, pin, and open
attachments into their chat files. Never @everyone, roles, moderation, webhooks or slash commands. Every call rechecks
your channel allow-list.

## Operation

- The backend owns each bot's connection (a Gateway WebSocket plus REST). A token Discord refuses, or a missing
  Message Content intent, stops that bot with an explanation and no retries (failed requests count toward Discord's IP
  block); other failures back off and retry.
- Discord data lives in the platform database: bot policies, channels, your account IDs, and messages the bots saw
  (for the inbox, DM search, chains and Chat). Attachments are fetched only when an agent opens one, into its chat files
  under `discord:<channelId>`. Deleting an agent disconnects its bot and deletes its token and Discord records;
  Disconnect removes only the token.
- Tools fail with a plain reason instead of stalling a turn: Discord unreachable, a rate limit longer than 10 seconds
  (short ones are waited out), or a token Discord no longer accepts.
- Saved Discord messages are kept for **Settings → Swarm → Discord history kept** (default 30 days) and pruned hourly;
  files agents opened from them stay. Unread counts stay correct across pruning.
- **Watching:** Chat → the agent → "Chat with" lists its Discord places (allowed channels, their threads, DMs). Each
  shows what the bot saw, read-only: your accounts as "You", edits, deletions and attachments marked, and the files
  agents opened. You post on Discord itself; the agent posts through its bot.
- The design and research behind this are in the working notes (Discord spike); the protocol facts come from
  [Discord's developer documentation](https://docs.discord.com/developers).
