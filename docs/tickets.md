# Tickets

An organization can keep a **board of tickets**: work for its people and agents, with a status, an assignee and a history, that the owner follows from the dashboard (also on a phone) and agents work through their own tools. It is **off** for every organization until its owner turns it on.

## Turning it on

**Settings → Tickets** (one organization at a time; the organization in view by default). Switching it on adds a **Tickets** tab; switching it off hides the tab and keeps the tickets. Options, saved at once:

| Option | Default | Meaning |
| --- | --- | --- |
| Assigning an agent wakes it | on | The agent gets the ticket as a platform event (below) |
| Agents can create tickets | on | `ticket_create` works (still only for agents granted it) |
| Agents may pick up unassigned tickets | off | Agents may change unassigned tickets, not only their own |
| Notify me when a ticket reaches In review | on | A push (or a toast in front of the dashboard) when someone else moves one to In review |
| Ticket prefix | from the name | Ids show as `PREFIX-N` (`HOME-14`): 1–6 letters and digits, starting with a letter |

`PATCH /api/organizations/:id {tickets: {...}}`; the organization list carries each one's ticket settings. Columns on `Organization` (`ticketsEnabled`, `ticketPrefix`, `ticketWakeOnAssign`, `ticketAgentsCreate`, `ticketAgentsPickUp`, `ticketPushReview`, `ticketNext`).

## A ticket

A number (per organization, never reused), title (≤ 200 characters), description (≤ 8,000), status (Backlog, Todo, In progress, In review, Done, Cancelled), priority (Urgent, High, Medium, Low, none), up to 8 labels, up to 20 links (a computer of the organization, or a chat file), an assignee (the organization's **owner**, one of its **agents**, or nobody) and its **activity**: comments and every change, with who made it. `Ticket` and `TicketEvent` rows (`backend/src/tickets/store.ts`).

Each ticket remembers who wrote its title and description. Text by the organization's owner is their request; text by anyone else (another agent, or admin in someone else's organization) is **untrusted** for agents: `ticket_read` labels it and neutralizes lines that look like the platform's own labels, and the wake-up says so.

## In the dashboard

The **Tickets** tab shows while the organization in view (or the only one) has tickets on: a **Board** (one column per status, Cancelled aside; Kibo kanban's board and card composition, without drag and drop: statuses change in the ticket) or a **List** grouped by status (Kibo list), filters (All, Assigned to agents, Assigned to me) and **New ticket** (title, description, assignee, priority; it says whether the agent will be woken). A ticket opens at `/tickets/HOME-14`: its text (editable), links (link a computer; files open as downloads), activity and comments (with `@Name` to ask an agent something), and beside it (below, on a phone) its status, assignee, priority, labels, the assignee's chat and **Delete ticket**. A card shows "working" while its In progress agent is running a turn. Everything follows `tickets_updated` events live. On a phone the board's columns scroll sideways.

Routes, all checked against the organization they name (`backend/src/users/rules.ts`): `GET|POST /api/organizations/:id/tickets`, `GET|PATCH|DELETE /api/organizations/:id/tickets/:number`, `POST /api/organizations/:id/tickets/:number/comments`. Creating, editing and deleting tickets are audited (`ticket.create`, `ticket.update` with the field names, `ticket.delete`, under Organizations); comments are content, not audited.

## Agents

**Agent settings → Tickets** grants the tools, none by default (`Agent.ticketTools`); they are offered only while the agent's organization has tickets on, and every call checks the grant, the organization and the option again:

| Tool | Class | Does |
| --- | --- | --- |
| `ticket_list` | r | The board's tickets, open ones by default; filter by status, assignee, words |
| `ticket_read` | r | One ticket with its links, comments and activity (30 at a time, paging back) |
| `ticket_create` | w | File a ticket (when agents may create them), optionally assigned |
| `ticket_update` | w | Status, assignee, priority, labels, link a computer or file, unlink |
| `ticket_comment` | w | Comment on any ticket of its organization |

Enforced where the change is made (the store, for people and agents alike): only the agent's own organization; it changes only tickets **assigned to it** (or unassigned ones, with the pick-up option); it assigns only the owner, itself, another agent of the organization or nobody, never another person; it never sets **Done** or **Cancelled** and never changes the status of a closed ticket: agents stop at In review.

**Waking.** Assigning an agent (by a person or another agent, with the option on) saves a platform `ticket` event for it in the same transaction as the change (a `PendingTimerEvent` row) and hands it over: idle, it starts a turn; busy, triage decides. A turn that finishes clears it; one the platform stopped before (a restart, a crash) is delivered again at the next start, marked; a paused agent gets it when resumed. The event names the ticket, who assigned it, its priority, status and description (labelled when untrusted) and what to do next; it carries the owner's authority only when the owner assigned it. An `@Name` in a comment wakes that agent the same way, to answer, not to take the ticket over. Wake-ups agents cause on one ticket (assigning each other, mentioning each other) are limited to 10 an hour; past that the change is saved and nobody is woken (the comment's result says so). People's are not limited.

The system prompt has a short "Tickets" section when any ticket tool is granted; Swarm Knowledge `concepts/tickets` has the details.

## Notifications

When someone other than the owner moves a ticket to In review and the option is on, the owner is pushed (Agent messages preference; with Show message text off, without the title) and a toast shows in an open dashboard that is not on that ticket ([notifications](notifications.md)). Never for the owner's own moves.

## Organizations and deleting

Tickets never leave their organization. Moving an agent to another organization unassigns the tickets it had in the old one (the move preview lists them). Deleting an agent unassigns its tickets; their activity keeps its name. Deleting an organization deletes its tickets. Exported agents carry their ticket grant, not tickets.

## Not in this version

Projects, cycles, estimates, sub-issues, syncing with Linear, ticket chips in chats, creating a ticket from a message, links to chat messages and recordings (a recording lives on its computer: link the computer), and tickets in agent exports.
