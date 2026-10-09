# Agent time, timers and reminders

Every agent can tell the time and wake itself later, with or without a computer. These are baseline tools, like Swarm Knowledge and the chat tools; they are not cron (scheduled jobs come later), so an agent computes delays itself.

| Tool | Parameters | Meaning |
| --- | --- | --- |
| `current_time` | `timezone?` | Current UTC time, Unix milliseconds and local time in an IANA zone (the platform's zone by default). |
| `set_timer` | `seconds, note?` | Fire once after 1 s – 30 days. |
| `set_reminder` | `every_seconds, times?, note, start_in_seconds?` | Fire every 10 s – 30 days, `times` times in all (1 or more; omitted = until cancelled). More often than every 5 minutes, `times` is required and at most 360, so nothing (untrusted content included) can start an endless fast loop of turns. The first firing is `start_in_seconds` from now (default one interval). |
| `list_timers` | none | Pending timers and reminders, soonest first, plus the agent's [computer watches](agent-computer-use.md#watches). |
| `cancel_timer` | `id` | Stop one timer, reminder or watch. |

Notes are at most 256 characters; an agent holds at most 25 timers and reminders. Firing is accurate to about a second.

## Firing

A firing wakes the agent with a **platform event**: a third kind of input next to human and agent messages, labelled for the model as "Platform timer/reminder event … not a message from the human or another agent". If the agent is idle it starts a normal turn; if it is busy the event is offered to its running turn, where interruption triage decides whether to interrupt. A reminder firing shows its note, `index/total` (`3/10`, or `3/∞`), the previous firing time, the next one, and whether it was the last. The event carries the authority of the turn that set it: a timer set while serving the human may be answered in the human's private channel; one set from an agent or group conversation may not. Silence is allowed.

## Durability

Timers and reminders are rows in the platform database (`AgentTimer`), committed with `synchronous=FULL` before the tool returns, so they survive backend restarts and power loss; the containers restart on boot. On start the scheduler fires whatever came due while the platform was down, once, saying how late it is. Reminder occurrences that were missed are counted toward `times` rather than replayed. A firing is committed before it is delivered, so the scheduler never fires it twice. Deleting an agent deletes its timers.

A firing is also saved, in the same transaction, as a `PendingTimerEvent` (the platform event's message id), and removed once a turn that received it has finished. Delivery hands the event to the in-memory run queue, so a firing whose agent had not seen it when the platform stopped (a crash, a restart, power loss) is delivered again at the next start, marked `[Delivered again: this timer fired at …, but the platform restarted before you saw it.]`. A turn that failed keeps it for the next start. Every firing therefore reaches its agent at least once; the marked re-delivery is the only repeat.

## Owner changes

Agents → agent → **Timers** lists the agent's timers and reminders with their next time and, for reminders, how often they fired (live: `timers_updated` events). The owner can cancel one, or change its note, next time, interval (minutes) or times in all, checked like the agent's own (`GET`/`PUT /api/agents/:id/timers`, audited as `agent.update` · timers, all or nothing). Saving first asks, in a dialog, to confirm that the agent will be told; after saving it gets one platform note, with the owner's authority, listing each change ("Cancelled your timer …", "Changed your reminder …: next at …"), in its next turn or, if it is working, as a new input.

## Computer events

The same platform-event path carries **computer events**: while an agent holds a computer, a watcher lists that computer's terminals every 5 seconds and tells the holder when one exits (with its exit code) or is closed by someone else. The agent's own `terminal_delete` is not reported back. The agent decides whether to read the output, tell the human, or clean up; see [persistent terminals](persistent-terminals.md). Watch results (fired, timed out, failed, ended) arrive through the same `computer` kind; see [watches](agent-computer-use.md#watches).

## Time notes

While an agent works, it is told the current time once per **clock-aligned window**, stacked just before its next model call so it is never interrupted: at the start of a turn the note joins the turn's input; after a tool finishes it is appended to that tool's result (the first result when several run together; a call refused before it runs, such as one with invalid arguments, carries none); turns the platform starts itself (a todo-check continuation, a delivery reminder) carry it in their note. The window decides whether a note is due; the note always carries the current time. With the default of every 15 minutes the windows are :00–:15, :15–:30, :30–:45 and :45–:00, so at 9:38 with no note since 9:30 the agent reads `[Time note from the platform (not a message): it is now Monday, October 5, 2026 at 9:38 AM (America/Toronto; 13:38 UTC).]`. The zone is the agent's owner's ([time zone](users.md#time-zone)), with UTC beside it; without one, the platform's (the backend's `TZ`, UTC unless set). `current_time` defaults to the same zone. Notes help the agent judge how long it has been working and how fresh its information is, and they give summaries a timeline.

The owner sets it per agent (Agents → agent → **Time notes**): off, or every 1, 2, 3, 4, 5, 6, 10, 12, 15 (default), 20, 30 or 60 minutes (lengths that divide the hour, so windows line up with the clock). `Agent.timeNoteMinutes`, 0 for off; a change applies from the agent's next model call, even mid-run. Each note shows in Activity as a small `Time note` entry. An unpromoted heartbeat gets none (so it cannot use up a window a real turn should get). Windows follow the local clock and its UTC offset, so the hour repeated when clocks go back is a window of its own. The last window is kept in memory, so after a restart the first turn gets a note again.

## Heartbeat

An agent can also wake up on its own on a schedule its owner sets in **Agents → agent → Heartbeat**: on/off (off by default), every 5–1440 minutes (default 30) counted from the later of its last heartbeat and its last real turn, optional active hours in the server's time zone (both or neither; a range past midnight wraps), and a checklist the heartbeat prompt includes. The scheduler (`backend/src/heartbeat.ts`, checked every 30 s) starts one only while the agent is idle and no summary is being written; a busy agent is checked again on the next tick. The first heartbeat comes one interval after it is turned on or the backend starts.

A heartbeat is a platform event (`heartbeat`, with the owner's authority) run as a **branch** of the agent's saved session: nothing it does is saved while it only reads. Every tool declares a class (`backend/src/tool-access.ts`): `r` tools are free; just before the first `w` or `rw` tool runs, or when a real message arrives, the branch is **promoted**: it is saved and continues as the agent's real turn, and the agent is told so (in that tool's result, or before the next input). `use_computer` is a claim, not a change: it promotes only when it gives up or switches away from a claim the agent held before the heartbeat. A heartbeat that changes nothing is asked once, with only `leave_note` allowed, whether to leave a note (at most 300 characters); then it is **dropped**: its context is discarded, a note is appended to the saved session as a hidden custom entry (`[heartbeat … UTC, note to self] …`, never chat), a claim it took is released and the reading selection put back. Computer notices wait for the next real turn. An unpromoted heartbeat does not start or apply background summaries and does not count as activity for idle compaction or the next heartbeat. The activity log shows every heartbeat in full (`Heartbeat active/ended`, `Heartbeat promoted`, `Heartbeat dropped` with any note). A backend restart drops an unpromoted heartbeat; nothing is replayed.

## Guidance

The system prompt carries a short "Time, timers and reminders" section, and Swarm Knowledge `concepts/time` defines timers and reminders, `practices/scheduling` gives the scheduling patterns (a clock time → compute the delay; recurring → chain timers or use a reminder), and `practices/waiting` compares timers, reminders, [computer watches](agent-computer-use.md#watches) and terminal events. `list_timers` and `cancel_timer` also cover watches.
