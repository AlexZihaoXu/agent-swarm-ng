import type { KnowledgeEntry } from '../catalog';

export const time = {
  id: 'swarm/time',
  parentId: 'swarm',
  title: 'Time, timers and reminders',
  summary:
    'Know the current time, wake yourself later with a timer, and repeat reminders; how to schedule work until cron exists.',
  source: 'docs/agent-time.md',
  content: `These tools work for every agent, with or without a computer.

current_time({timezone?}) returns the current UTC time, Unix milliseconds and the local time in an IANA zone (the platform's zone by default). Never guess the date or time from memory or from message timestamps: call current_time.

set_timer({seconds, note?}) wakes you once after 1..2592000 seconds (up to 30 days), accurate to about a second. The note (up to 256 characters) is shown to you when it fires, so write what you meant to do: "check build in terminal build-2 and report to the human". When a timer fires you receive a platform event in your own turn: if you are idle it starts a new turn; if you are busy it arrives like a new message and interruption triage decides whether to interrupt. It is not a human message; act on your note, and message the human only if that is useful to them.

set_reminder({every_seconds, times?, note, start_in_seconds?}) repeats: every 10..2592000 seconds, times firings in all (1 or more; leave it out to repeat until cancelled). The first firing is start_in_seconds from now (default one interval). Each firing shows your note, index/total (for example 3/10, or 3/∞), the previous firing time, the next one, and whether this was the last. list_timers shows your pending timers and reminders; cancel_timer({id}) stops one. At most 25 at once, so cancel what you no longer need. An unlimited reminder keeps waking you: cancel it when its purpose is done.

Waiting well: do not keep a turn busy (or poll in a loop) waiting for something slow. Start the work, set_timer for when it should be worth checking, tell the human if they are waiting, and end the turn. When the timer fires, look at the result, then finish or set another timer.

Scheduling without cron (cron comes later): compute the delay yourself. For "at 9:00 tomorrow in Toronto", call current_time({timezone:"America/Toronto"}), work out the seconds until then, and set_timer with a note describing the task. For "every weekday at 9:00", set a timer to the next 9:00 and, when it fires, do the task and set the next one (skipping weekends). For "every 15 minutes, three times", use set_reminder({every_seconds:900, times:3, note:"..."}).

Timers and reminders are saved with the platform, so they survive restarts and power loss. If a firing fell due while the platform was down, it fires as soon as the platform is back and says how late it is; repeated reminders that were missed are counted, not replayed. A late or missed firing is normal after an outage: check the current state before acting on old assumptions.`,
} satisfies KnowledgeEntry;
