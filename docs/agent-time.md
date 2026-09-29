# Agent time, timers and reminders

Every agent can tell the time and wake itself later, with or without a computer. These are baseline tools, like Swarm Knowledge and the chat tools; they are not cron (scheduled jobs come later), so an agent computes delays itself.

| Tool | Parameters | Meaning |
| --- | --- | --- |
| `current_time` | `timezone?` | Current UTC time, Unix milliseconds and local time in an IANA zone (the platform's zone by default). |
| `set_timer` | `seconds, note?` | Fire once after 1 s – 30 days. |
| `set_reminder` | `every_seconds, times?, note, start_in_seconds?` | Fire every 10 s – 30 days, `times` times in all (1 or more; omitted = until cancelled). The first firing is `start_in_seconds` from now (default one interval). |
| `list_timers` | none | Pending timers and reminders, soonest first. |
| `cancel_timer` | `id` | Stop one. |

Notes are at most 256 characters; an agent holds at most 25 timers and reminders. Firing is accurate to about a second.

## Firing

A firing wakes the agent with a **platform event**: a third kind of input next to human and agent messages, labelled for the model as "Platform timer/reminder event … not a message from the human or another agent". If the agent is idle it starts a normal turn; if it is busy the event is offered to its running turn, where interruption triage decides whether to interrupt. A reminder firing shows its note, `index/total` (`3/10`, or `3/∞`), the previous firing time, the next one, and whether it was the last. The event carries the authority of the turn that set it: a timer set while serving the human may be answered in the human's private channel; one set from an agent or group conversation may not. Silence is allowed.

## Durability

Timers and reminders are rows in the platform database (`AgentTimer`), committed with `synchronous=FULL` before the tool returns, so they survive backend restarts and power loss; the containers restart on boot. On start the scheduler fires whatever came due while the platform was down, once, saying how late it is. Reminder occurrences that were missed are counted toward `times` rather than replayed. A firing is committed before it is delivered, so it is never delivered twice (at most once). Deleting an agent deletes its timers.

## Computer events

The same platform-event path carries **computer events**: while an agent holds a computer, a watcher lists that computer's terminals every 5 seconds and tells the holder when one exits (with its exit code) or is closed by someone else. The agent's own `terminal_delete` is not reported back. The agent decides whether to read the output, tell the human, or clean up; see [persistent terminals](persistent-terminals.md).

## Guidance

The system prompt carries a short "Time, timers and reminders" section, and Swarm Knowledge `swarm/time` has the full guide and scheduling patterns (a clock time → compute the delay; recurring → chain timers or use a reminder).
