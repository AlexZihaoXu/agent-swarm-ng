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

Timers and reminders are rows in the platform database (`AgentTimer`), committed with `synchronous=FULL` before the tool returns, so they survive backend restarts and power loss; the containers restart on boot. On start the scheduler fires whatever came due while the platform was down, once, saying how late it is. Reminder occurrences that were missed are counted toward `times` rather than replayed. A firing is committed before it is delivered, so it is never delivered twice (at most once). Deleting an agent deletes its timers.

## Computer events

The same platform-event path carries **computer events**: while an agent holds a computer, a watcher lists that computer's terminals every 5 seconds and tells the holder when one exits (with its exit code) or is closed by someone else. The agent's own `terminal_delete` is not reported back. The agent decides whether to read the output, tell the human, or clean up; see [persistent terminals](persistent-terminals.md). Watch results (fired, timed out, failed, ended) arrive through the same `computer` kind; see [watches](agent-computer-use.md#watches).

## Heartbeat

An agent can also wake up on its own on a schedule its owner sets in **Agents → agent → Heartbeat**: on/off (off by default), every 5–1440 minutes (default 30) counted from the later of its last heartbeat and its last real turn, optional active hours in the server's time zone (both or neither; a range past midnight wraps), and a checklist the heartbeat prompt includes. The scheduler (`backend/src/heartbeat.ts`, checked every 30 s) starts one only while the agent is idle and no summary is being written; a busy agent is checked again on the next tick. The first heartbeat comes one interval after it is turned on or the backend starts.

A heartbeat is a platform event (`heartbeat`, with the owner's authority) run as a **branch** of the agent's saved session: nothing it does is saved while it only reads. Every tool declares a class (`backend/src/tool-access.ts`): `r` tools are free; just before the first `w` or `rw` tool runs, or when a real message arrives, the branch is **promoted**: it is saved and continues as the agent's real turn, and the agent is told so (in that tool's result, or before the next input). `use_computer` is a claim, not a change: it promotes only when it gives up or switches away from a claim the agent held before the heartbeat. A heartbeat that changes nothing is asked once, with only `leave_note` allowed, whether to leave a note (at most 300 characters); then it is **dropped**: its context is discarded, a note is appended to the saved session as a hidden custom entry (`[heartbeat … UTC, note to self] …`, never chat), a claim it took is released and the reading selection put back. Computer notices wait for the next real turn. An unpromoted heartbeat does not start or apply background summaries and does not count as activity for idle compaction or the next heartbeat. The activity log shows every heartbeat in full (`Heartbeat active/ended`, `Heartbeat promoted`, `Heartbeat dropped` with any note). A backend restart drops an unpromoted heartbeat; nothing is replayed.

## Guidance

The system prompt carries a short "Time, timers and reminders" section, and Swarm Knowledge `concepts/time` defines timers and reminders, `practices/scheduling` gives the scheduling patterns (a clock time → compute the delay; recurring → chain timers or use a reminder), and `practices/waiting` compares timers, reminders, [computer watches](agent-computer-use.md#watches) and terminal events. `list_timers` and `cancel_timer` also cover watches.
