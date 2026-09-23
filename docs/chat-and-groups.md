# Chat tab and group conversations

Status: implemented and validated. Feature merge: `a846572`, based on `cd24c34` (agent communication). Follow-up findings and validation are recorded in the [feature consistency review](feature-consistency-review.md). Nothing pushed.

## Agreed behavior

- Add **Chat** to the top navigation; preserve the Agents tab and its feature set. Agents remains the main place to create/edit agents.
- Chat reuses the existing list/card layout with **Search chats**. Human↔agent DMs reuse the current human chat UI and composer, without the counterpart selector.
- Add **Create group chat** (name and selected agents). Group membership authorizes group communication without adding DM connections. The operator is the human participant.
- Group messages show agent avatars beside their content, adapting the inspected Kibo `scroll-area-layout-3` avatar/name/time composition to the supplied Discord references. Human messages stay right-aligned.
- Group only consecutive messages from the same author when the timestamp gap is nonnegative and at most five minutes; author changes, longer gaps, and date boundaries start a new author/time block. Hover/focus reveals its time in the left gutter without changing the row background. Keep controls available on touch and keyboard, not hover-only.
- Persisted emoji reactions are implemented for human DMs and groups, where the operator is a participant. Agent-to-agent DM inspection does not let the operator join or impersonate a peer through reactions. One valid Unicode emoji sequence per reaction uses explicit, idempotent add/remove actions; there are no simulated counts.

## Chat sidebar context menu

Right-click the Chat sidebar (or use Shift+F10 with it focused) to create a group. On a group row, the menu can open or edit that group; on an agent DM row, it can open the conversation or switch to that agent in Agents. The existing + button and group editor remain available. There is no separate “new DM” action because saved agents already have human DM entries, and no group deletion action because the backend does not support it.

## Reaction context menu

Right-click a saved private-chat bubble or group message content to open its actions; Shift+F10 works when the message is focused, and touch long-press opens the same menu. There is no hover toolbar or message-row background highlight. Up to four recently used emojis appear across the top, followed by **Add reaction** and a visibly disabled **Reply** placeholder. Add reaction opens a searchable submenu to the right on desktop; on narrow screens its searchable choices expand within the menu so they remain reachable. The picker lazily loads the local English Emojibase compact dataset (including skin-tone variants), without sending searches to a third party. Existing persisted reaction chips remain below messages, slightly inset with larger emoji. When a message has reactions, an adjacent Add reaction button opens the same searchable choices without right-clicking. Its scrollbar uses the app's styled ScrollArea. All right-click menus use the same background and fade-scale from their placement origin on opening/closing, with animation disabled for reduced motion. Only the message whose menu is open receives a soft outline glow; it fades on dismissal. This adapts the inspected Kibo `context-menu-standard-7` submenu composition.

Recent choices start empty and update only after a successful reaction addition. They are deduplicated, most-recent-first, and stored as at most four supported emoji values in the browser's `swarm.recent-reactions` preference. This stores no messages, transcripts, agent identities or credentials. Failed requests/removals do not invent or reorder recent choices; blocked storage falls back to the current page's query cache. Duplicate actions remain blocked.

The earlier hover-toolbar revision passed 18 frontend unit tests, a production build and 73 browser tests (`proc_168`) in sandboxed nonroot Linux. The replacement context menu has focused desktop/mobile browser coverage for recent reactions, keyboard access, touch long-press, group messages and disabled Reply.

## Tools and communication guidance

Expose explicit discovery, bounded history/search, publication and reaction tools. `list_chats` must tell an agent which chats it can actually access and the available audience/members. Every read, expansion, search, send and reaction validates its channel/membership at execution time; the model cannot choose another sender identity.

The system prompt should tell agents to consider audience and context **before** communicating:

- Shared collaborative work belongs in an appropriate available group, where participants need the same context.
- Focused assignments or one-agent tasks belong in DMs to avoid polluting other agents' context.
- If no appropriate group is available, do not invent access or silently create a DM mesh. Ask the operator when new membership/access is needed.
- Shared awareness is not automatic broadcasting; disclose only what the audience needs. Do not publish planning/thinking as chat.

This is prompt guidance, not a guarantee of model judgment. Access checks and publication boundaries remain deterministic backend responsibilities.

## Initial implementation choices

- Group records, membership, authored messages and per-recipient processing state are persistent. A group is a new conversation, not a set of DM grants.
- Creation accepts 1–16 agents plus the operator. Membership can be edited by the operator; agents do not receive administrative membership tools. Adding a member permits reading existing group history but does not replay it as new work.
- Human group messages notify the current agent members. Agent publications notify the other current members. Agents may remain silent unless addressed or able to contribute; avoid acknowledgment/thank-you storms.
- Reuse the normal source-labelled inbox, debounce/interruption logic and one execution slot per agent. Do not introduce an isolated group-only model/memory silo.
- Server-owned chain accounting extends across group fan-out and DM branches. Human-originated group chains permit 32 generated group/DM publications; agent-rooted chains started from private-human work retain the eight-message budget. Neither recipient nor channel changes reset the budget. Group delivery is capped at eight unfinished items per recipient / 128 globally, in addition to the existing executor bounds. Group-notification runs have a five-minute queue deadline and 90-second execution deadline, including follow-ups joining the run.
- Group membership and computer/DM permissions are independent. Removing membership blocks future group tools and queued delivery; it cannot erase already observed context or undo committed effects.
- Preserve group message author identity/name snapshots if an agent is deleted; remove executable deliveries/membership. Keep shared group history for surviving participants.
- Reactions are explicit, authorized, idempotent mutations. Human UI reactions cannot impersonate agents; agents react through a bound tool. A new human-added reaction on a private chat notifies that agent; in a group only the still-member agent author of the reacted message is considered. Removals, duplicates, human-authored group messages and agent reactions do not trigger reaction triage. The bounded, ephemeral decision-only Pi branch can ignore the reaction or enqueue an ordinary authorized turn. It has only a decision tool, times out after 12 seconds, and admits at most four pending reactions per agent / 32 globally; it never publishes directly or replays after restart. Removed reactions and revoked group membership are rechecked before an action run.
- Preserve restart semantics: cancel interrupted work, never automatically replay inference. App construction/OpenAPI generation remains side-effect free.

## Reference and validation notes

Read the swarm vision and Kibo entry guide. Inspected exact sources and the previously captured rendered previews for `scroll-area-layout-3`, `tabs-standard-1`, `checkbox-standard-8`, and `dialog-standard-1`. The original avatar/name/time composition fits; five-minute grouping and hover/focus gutter behavior are application adaptations requested in the supplied screenshots. Reuse the current composer rather than adding demo dependencies.

Windows browser automation remains paused after a failed-logon counter reading of 10. No additional Windows browser was launched. A dedicated nonroot Linux/Docker browser was used instead, with the repository's Chromium seccomp profile, no-new-privileges, enabled Chromium sandbox, one worker, no retries and stop-on-first-failure. Chrome reports namespace, PID/network namespace and Seccomp-BPF sandboxes active; Yama ptrace protection is unavailable. No personal profile, developer model credentials, or paid inference is used.

Implemented in order: persistence/authorization → shared inbox/tools/routes → Chat tab and group creation/history → reactions. The full backend path is connected and exercised with mock inference.

Final checks: generated API drift check, full typechecks, 126 unit/integration tests across 30 files, and production build passed (`proc_160`); all 72 application browser tests passed in sandboxed nonroot Linux (`proc_163`). Native Bun/production Docker verified group delivery, private-context isolation, persisted reactions, and restart cancellation without replay (`proc_154`). Later search-snippet/dedup regressions passed. The build retains the existing large-bundle warning.

Tool contracts: `list_chats` reports the current audience and appropriate read/send tools; `read_group_messages` supports bounded chronological paging and message expansion; `search_group_messages` returns literal, match-centered snippets; `read_reactions` and `react_to_message` bind identity and recheck access. Group messages are published with `send_message` to `group:<id>`. Human-authored messages and human reaction events authorize private-human publication only when the normal agent turn actually runs; agent-only batches cannot publish or react there. `search_emojis` gives an agent bounded name/keyword search over the same Emojibase catalog and its own four recent emojis in SQLite, persisted separately from the browser's human recents. `react_to_message` still rechecks channel access and can provide a lightweight acknowledgment instead of a redundant non-task chat bubble.
