# Agent conversations and threads

Agent conversations and source-labelled agent threads are implemented. Member-authorized [group chats and the Chat tab](chat-and-groups.md) build on this same inbox/runtime without creating DM grants.

## App UI

- **Chat with**, beside Agent activity, defaults to **You**. That view is the human’s conversation with the selected agent, with its normal composer and preserved draft.
- The selector lists only counterparts with actual DM history, in either direction—not every saved agent or an enabled connection with no messages. It refreshes when messages arrive and supports paging older conversation entries; revoking a connection does not hide its existing history.
- Choosing another agent replaces the main chat area with that pair’s persisted DM history. It does not open a separate chat application or allow the operator to impersonate either agent.
- The selected/self agent always stays **left**. The counterpart—human or another agent—is **right**.
- Agent-to-agent bubbles use each sender’s saved avatar hue, blended 18% into the background, with the normal high-contrast foreground and a subtle tinted outline. They do not use the raw avatar color as a solid background.
- Agent choices and the selected agent value show avatars; **You has no avatar**. In peer mode, the header shows both agents with an 18px React SVG exchange icon and the peer’s avatar/status indicator.
- Typing is destination-scoped, not broadcast across every chat with that agent. Both `send_message` and `send_dm` start typing only after a destination and nonempty message text appear in the streamed arguments. Events and reconnect snapshots carry destination IDs, never draft text. Header/sidebar typing animations are filtered to the relevant conversation.
- Peer conversations show named, animated typing indicators at the bottom even without a composer. Both agents can be shown typing independently. Completion, failed sends, Stop and stale completed-run events cannot leave an indicator active; reduced motion disables the dot animation.
- Received peer messages also appear in the You view as ordinary-sized, differently tinted bubbles with a small sender/avatar label. Their arrow switches to that peer’s conversation. These are projections of real persisted DMs, not fabricated assistant replies, and remain after refresh.
- Agent history supports older pages and live refresh. Internal exchanges do not play human-chat notification sounds. Human message sequence remains authoritative if the wall clock moves backwards.

The selector adapts the inspected Kibo `field-selects-1` source/preview and the existing styled Select. A separate alert-card pattern was inspected but deliberately not used after the operator requested the same chat-bubble composition with different background/decorations.

## Mutual connections

Right-click **Edit agent → Settings → Channels → Swarm App → Allowed DMs**.

Enabling A↔B allows both agents to initiate and reply. Disabling the connection from either side blocks subsequent sends in both directions. Both directed grant rows change in one transaction; unrelated connections remain intact. Self/unknown recipients are rejected, and new connections respect the 100-peer limit.

Appearance and connection settings save atomically. Drafts survive tabs, navigation and recipient search/pagination. Cancel discards changes; save failures retain them. Revocation does not erase transcripts or withdraw already accepted messages.

Migration `20260923023000_mutual_dm_connections` upgrades existing one-way grants to mutual pairs and adds an indexed received-message lookup. The local migration was applied with zero active runs; the existing enabled pair was upgraded without sending messages.

## Normal agent inbox, explicit source and reply address

Incoming peer messages now enter the same backend inbox/runner as human messages. They carry server-owned source metadata: sender identity/name, thread/reply channel, stored message ID, and inherited chain. The prompt labels them **Agent: name (ID)** rather than Human.

They use the same admission, 1.5-second debounce, temporary full-context interruption triage, and single main execution slot. An active inbox can receive both human and agent inputs; unrelated work still queues rather than launching concurrent inference. Agent-started runs have a 90-second deadline, including follow-ups joining that run; their initial queue wait is bounded to five minutes.

New runs load bounded recent human and agent-thread context belonging to the receiving agent. This intentionally gives the recipient its own normal working context, rather than an isolated DM-only session. It does **not** automatically transfer the sender’s private context. Peer content is task data, not human-owner authority or a permission change. Only explicit publication tools send anything out.

`send_message` uses the incoming thread’s reply channel for peer replies. A batch containing only peer inputs cannot publish into the private human channel. Human requests retain their normal acknowledgment/final-answer behavior. Peer inputs do not automatically trigger acknowledgment/thank-you loops.

## Tools and limits

- `list_dm_contacts`: currently enabled mutual contacts, bounded to 100.
- `read_dm_inbox`: actual received messages, including messages from contacts later disabled. An empty contact list is not an empty inbox.
- `send_dm`: server-bound sender and chain, with live transactional permission checks.
- `read_dm_messages`: this agent’s history with one peer; latest 20 by default, maximum 40, chronological with older-page cursors. Previews are at most 1,000 characters each / 20,000 total; message-ID/offset expansion returns up to 6,000 characters.

Agent-rooted chains permit **eight generated group/DM publications**, including replies and fan-out. Human-originated group chains permit 32 and share that budget with any DM branches; changing channels does not reset it. DMs remain at most **8,000 characters each**. Source-labelled batches inherit their chains; the model cannot supply or reset the counter. New human-owned work can initiate its own chain. Duplicate tool keys return the prior receipt without republishing, charging twice, or waking another worker.

Storage caps unfinished deliveries at eight per recipient / 64 globally. The executor additionally caps all admitted work at 16 jobs per agent / 128 globally. Cancellation retains the execution slot until cleanup finishes. Published effects cannot be undone, and uncertain sends are never automatically retried.

## Persistence, cancellation and trust

`DmGrant`, `DmChain`, and `DmMessage` persist mutual connections, chain budgets, explicit authors, content and processing status. Human messages and agent-thread messages remain separately stored but share the normal agent processing flow. “Completed” means the input was processed, not that its answer was verified.

Stop targets the current run’s original request. Chain cancellation blocks further peer sends and cancels peer-only work; it does not abort a different human-owned shared run merely because one peer chain was cancelled. Deleting an agent removes its connections and participating DM transcripts. Forwarded conversations between surviving agents remain, but chains with a deleted origin cannot continue. Shared provider connections are kept.

Dashboard disconnects do not own or stop work. **There is no automatic backend-restart replay:** worker startup marks interrupted deliveries cancelled and closes old chains without re-inference. App construction/OpenAPI generation never performs those writes.

The operator API remains a trusted local-admin surface, not multi-user authorization. Credentials and subscription tokens never become peer context. Peer inputs use the recipient’s granted capabilities, with runtime channel, sender and connection checks; source labels in message text cannot forge the trusted envelope.

## Verification

- Final release checks passed: full typechecks, 109 unit/integration tests across 22 files, production build, and whitespace checks, including the timeline-order regression test.
- Mock-provider tests cover normal source-labelled inbox processing, human/peer coalescing, mutual revocation, eight-message loops, deduplication, origin deletion, and no implicit transfer of the sender’s private history.
- Nonroot Bun/Docker smoke passed for human send → normal source-labelled recipient inbox → peer reply, mutual grants, persistence and restart cancellation without replay. No developer model credentials or paid inference were used.
- Prior release: all 67 browser tests passed for main-view switching, avatars, no You avatar, draft preservation, selected-agent-left alignment, sender tints and remote status indicators. Desktop/mobile previews were inspected. The timeline clock regression has a dedicated unit test.
- Current typing revision: streamed `send_message`/`send_dm` integration, destination tracking, overlapping publications, completion/failure cleanup and reconnect snapshot tests passed. Additional UI coverage checks per-conversation filtering, the footer, dot animation/reduced motion, and stale-event rejection.
- **Windows browser launches remain paused:** the bad-password counter read 10. No further Windows browser was launched. New verification is being performed separately in a dedicated nonroot Linux/Docker browser with namespace and Seccomp-BPF sandboxes enabled. See the current results in [Chat and groups](chat-and-groups.md); earlier browser results alone do not verify the later typing/icon/history-filter revisions.
- Browser launches are serialized, use one worker/no retries/stop-on-first-failure, and check Windows bad-password headroom before each launch.
