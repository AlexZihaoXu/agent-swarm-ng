# Agent todo lists

Agents keep a todo list for work with several steps, like a coding assistant does, and the platform makes sure an unfinished list is not simply forgotten when a turn ends.

## The list

`todo_write({todos: [{content, status}]})` replaces the agent's whole list: at most 30 items of up to 200 characters, each `pending`, `in_progress` (one at a time) or `completed`; `[]` clears it. It is a `w` tool (it changes what the owner sees, so it promotes a heartbeat). The list is saved on the agent (`Agent.todos`), survives restarts and compaction, and is in the agent API view; every change is broadcast as a `todos_updated` event. The system prompt asks agents to write the list when they start, mark items as they go, and skip it for one-step requests. Agents with a Discord bot are also told their current item makes a good custom status (`discord_set_status`) when nothing more important is set, without any private or sensitive detail.

## The turn-end check

When a real turn ends (the model stops, or its final reply was delivered) while the list has unfinished items, the platform immediately runs a **check**: a temporary fork of the agent's live conversation with the main request's exact system prompt, tool list and transcript, so the provider reuses its cached prefix (`backend/src/todo-check.ts`).

- Only the agent's `r` tools run in the fork; anything else is refused at execution. At most **10 model turns** and 4 minutes.
- It answers in plain text: `STOP: <reason>` (done but not ticked off, blocked on something that will wake the agent such as a timer, watch, monitor or a reply it asked for, needs the owner, or continuing would not help) or `CONTINUE: <note>`.
- `CONTINUE` sends the note to the main branch as a hidden platform message (not a human message) and the agent continues at once; a continuation that ends without sending anything gets the usual reminder that plain output is internal. At most **3 continuations in a row**; then the turn ends, noted in Activity, and that list is not checked again until it changes.
- `STOP` ends the turn. The list it stopped on is remembered: later turns do not check it again until it changes, so a stale list costs nothing.
- Any failure (timeout, provider error, no decision) counts as `STOP` for this turn, so a broken check never loops the agent, but it is not remembered: the next turn may check again. New messages come first: the check does not start while messages are waiting and is cancelled the moment one arrives (it runs outside the agent's triage lock, so their triage never waits for it). An unpromoted heartbeat is never checked.

Each check appears in Activity (`Todo check`, its fork's trace, then `Todo check: continue` or `Todo check: stop` with the note) and its model calls are metered as purpose `todo`.

## In the dashboard

While an agent has a list, a strip under its conversation header shows icons with counts (pending, in progress, done) and the item in progress; it expands to the items (Kibo `collapsible/card/collapsible-card-4` with `checkbox/standard/checkbox-standard-5` rows, read-only). It updates live.
