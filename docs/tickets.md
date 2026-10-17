# Tickets

An organization can keep a **board of tickets**: work for its people and agents, with a status, an assignee and a history, that the owner follows from the dashboard (also on a phone) and agents work through their own tools. It is **off** for every organization until its owner turns it on.

## Turning it on

**Organization → Tickets** (the [Organization tab](dashboard.md#header-and-settings): the organization in view). Switching it on adds a **Tickets** tab; switching it off hides the tab and keeps the tickets. Options, saved at once:

| Option | Default | Meaning |
| --- | --- | --- |
| Assigning an agent wakes it | on | The agent gets the ticket as a platform event (below) |
| Agents can create tickets | on | `ticket_create` works (still only for agents granted it) |
| Agents may pick up unassigned tickets | off | Agents may change unassigned tickets, not only their own |
| Notify me when a ticket reaches In review | on | A push (or a toast in front of the dashboard) when someone else moves one to In review |
| Ticket prefix | from the name | Ids show as `PREFIX-N` (`HOME-14`): 1–6 letters and digits, starting with a letter |

`PATCH /api/organizations/:id {tickets: {...}}`; the organization list carries each one's ticket settings. Columns on `Organization` (`ticketsEnabled`, `ticketPrefix`, `ticketWakeOnAssign`, `ticketAgentsCreate`, `ticketAgentsPickUp`, `ticketPushReview`, `ticketNext`).

## A ticket

A number (per organization, never reused), title (≤ 200 characters), description (≤ 8,000), status (Backlog, Todo, In progress, In review, Done, Cancelled), priority (Urgent, High, Medium, Low, none), up to 8 labels, up to 20 links (a computer of the organization, a chat file, or a chat message), an optional [due date](#due-dates), an optional [parent](#sub-issues), [relations](#relations), an assignee (the organization's **owner**, one of its **agents**, or nobody) and its **activity**: comments and every change, with who made it. `Ticket` and `TicketEvent` rows (`backend/src/tickets/store.ts`).

Each ticket remembers who wrote its title and description. Text by the organization's owner is their request; text by anyone else (another agent, or admin in someone else's organization) is **untrusted** for agents: `ticket_read` labels it and neutralizes lines that look like the platform's own labels, and the wake-up says so.

## In the dashboard

The **Tickets** tab shows while the organization in view (or the only one) has tickets on: a **Board** (one column per status, Cancelled aside; Kibo kanban's board and card composition, cards [dragged](#dragging) between columns and places) or a **List** grouped by status (Kibo list) in the same [order](#order), [search and filters](#search-and-filters) and **New ticket** (title, description, assignee, priority, due date; it says whether the agent will be woken). A card shows its priority, labels, **Blocked** (red) while an open ticket blocks it, its sub-issues done of all (a small ring, `1/3`), its due date (amber today, red once overdue) and "working" while its In progress agent is running a turn. A ticket opens at `/tickets/HOME-14`: its parent as a breadcrumb, its text (Markdown, editable), sub-issues, relations, links (link a computer; files open as downloads; a message opens its chat at that message), activity and comments (Markdown, with `@Name` to ask an agent something), **Copy link**, and beside it (below, on a phone) its status, assignee, priority, due date, parent, labels, the assignee's chat and **Delete ticket**. Everything follows `tickets_updated` events live. On a phone the board's columns scroll sideways.

Routes, all checked against the organization they name (`backend/src/users/rules.ts`): `GET|POST /api/organizations/:id/tickets` (`?q=` searches), `GET|PATCH|DELETE /api/organizations/:id/tickets/:number`, `POST /api/organizations/:id/tickets/:number/comments`, `PATCH|DELETE /api/organizations/:id/tickets/:number/comments/:commentId`, `GET /api/organizations/:id/ticket-refs?numbers=1,2` ([references](#references)). Creating, editing (sub-issues, relations and due dates included: `addRelations`, `removeRelations`, `parent`, `due` among the field names) and deleting tickets are audited (`ticket.create`, `ticket.update` with the field names, `ticket.delete`, under Organizations); comments, their edits and deletions are content, not audited. Migration `20261017030000_ticket_round3` adds the parent, due-date and comment columns and the `TicketRelation` table, nothing else.

### Sub-issues

A ticket may be a sub-issue of another ticket of the same organization (`Ticket.parentId`), at most three levels deep (a ticket, its sub-issues and theirs) and never of itself or of one of its own sub-issues, checked where the change is made. The detail lists its sub-issues with their done/total progress (Done of those not cancelled) and **+ Add sub-issue** (the New ticket dialog, as a sub-issue); a sub-issue shows its parent as a breadcrumb, and **Parent** in its properties moves or removes it. Deleting a parent keeps its sub-issues, without a parent.

### Relations

**Blocks / blocked by**, **related** and **duplicate of / duplicated by**, between tickets of one organization (`TicketRelation`, stored once each). The detail lists them by kind, each opening its ticket and removable, and adds one from the board's tickets. A ticket with an open (not Done or Cancelled) blocker is **Blocked**. When the last open blocker of a ticket assigned to an agent is moved to Done or Cancelled, that agent gets a durable platform `ticket` event ("HOME-14 … is no longer blocked"), saved in the same transaction like an assignment, with the closer's authority when that is the owner, and the same hourly cap for wake-ups agents cause. A ticket with another open blocker, a closed one, or one assigned to a person or nobody wakes nobody.

### Due dates

An optional calendar day (`YYYY-MM-DD`, `Ticket.dueDate`), in the organization owner's [time zone](users.md#time-zone) (the platform's without one): `Ticket.dueAt` is when that day starts there, computed when the date is set. The assigned agent gets **one** durable reminder (a platform `ticket` event, "HOME-14 … is due today", or "was due … (overdue)" when the platform was down then) when the day starts: the scheduler in `backend/src/tickets/store.ts` marks the ticket reminded and saves the event in one transaction, then delivers it, so it arrives at least once and again after a restart (marked) like a timer firing ([agent time](agent-time.md#durability)). It starts after the saved events were handed over at start-up and looks again at the next due ticket (at least every six hours). Not for Done or Cancelled tickets, nor for tickets assigned to a person or nobody (a ticket reopened or assigned later is reminded then); a new date re-arms it. Assigning an agent a ticket already due says so in the assignment instead of a second event. The reminder carries the owner's authority only when the ticket's text is the owner's. People see due dates in their own time zone's today: overdue once the day has passed.

### Search and filters

A search box (title, description, or an id: `HOME-14`, `#14`, `14`; on the server, `?q=`) and a **Filter** popover (Kibo popover-standard-13, the search Kibo input-group-icons-1; spanning the screen on a phone): status, assignee (me, any agent, an agent, unassigned), priority, label, due (overdue, due soon = within seven days, no due date). The List also sorts: manual (the board's order), last updated, priority, due date. All of it is kept in the address (`?q=…&status=todo,progress&assignee=me&priority=high&label=ops&due=overdue&sort=priority`, beside `org`), so a reload or a shared link keeps it, and going back from a ticket returns to it. The board stays manually ordered; a drag with filters on lands next to the cards shown.

### Keyboard

On the Tickets tab only, never while typing in a field, while a computer's desktop or terminal has focus, or with a dialog or menu open: **C** new ticket, **/** search (from a ticket: back to the board's search), **Esc** back from a ticket to the board, or clears the search, **?** lists these keys (also the keyboard button beside the filters). They do not clash with the app's other keys (Ctrl/⌘+F searches chats, Ctrl/⌘+K opens Portal).

### Comments and Markdown

Descriptions and comments render as Markdown through the chat's safe renderer (no HTML, no images fetched, only http(s)/mailto links). People edit their own comments (shown "edited") and delete their own; the organization's owner deletes anyone's. A deleted comment leaves a tombstone (`TicketEvent.deletedAt`, `deletedBy`): its text is gone, who deleted it and when stay, like a deleted chat file. Mentions in an edited comment do not wake anyone again. Agents do not edit or delete comments (no tool); `ticket_read` shows a deleted one as `[comment deleted by …]`.

### References

In a private chat or a group chat of an organization with tickets on, and in its tickets' descriptions and comments, an id with its prefix (`HOME-14`, not in code or links) shows as a chip: the ticket's status colour, id and title, opening it (`/tickets/HOME-14?org=…`). Ids are resolved in batches of up to 50 through `GET /api/organizations/:id/ticket-refs`, which answers only people who reach that organization (its owner, admin), only with that organization's tickets, and nothing while tickets are off; an id it does not resolve stays plain text. Chips refresh with `tickets_updated` events. A chat message's menu (private and group chats) has **Create ticket from message…**: the Tickets tab of the conversation's organization opens the New ticket dialog with the message's text (its first line as the title) and links the message (`linkMessage`, checked to be a message of that organization's chats; its label and conversation come from the message). The link opens that conversation scrolled to the message (the chat's jump to a message, as search results use).

### Copy link

**Copy link** in a ticket copies its address with its organization (`/tickets/HOME-14?org=<id>`), which opens it for anyone who reaches that organization.

### Dragging

Cards drag like Linear's, Jira's or Trello's (dnd-kit, as Kibo's kanban): to another column to change its status, or up and down a column to reorder. A held card lifts (a slight tilt and shadow) and follows the pointer; a dashed copy shows where it will land, the column it is over is outlined, and on release it settles into place (no motion with reduced motion). A click still opens the ticket (a drag starts after a few pixels). **Keyboard:** Enter opens; Space picks up, the arrows move it (up and down within a column, left and right to the top of the next column), Space drops and Escape cancels, each step announced to screen readers. **Phones:** press and hold a card briefly to pick it up, so swiping still scrolls the board sideways and the page up and down; the board scrolls along when a card is held near its edge.

A drop shows at once and is saved through the same update as the ticket's status buttons (`PATCH …/tickets/:number` with `status` and `place`), so its activity, audit entry, wake-ups and the In review push are exactly those of a status change there; a reorder alone adds no activity and keeps the ticket's updated time. If the save fails the card goes back with a message saying why. A person can drop anywhere the ticket's status buttons allow (Done included; Cancelled is set in the ticket). While a card is held, changes from other people and agents wait until the drop; with a filter on, a card lands next to the cards shown.

### Order

Each status keeps a manual order (`Ticket.position`, smallest first; migration `20261017020000_ticket_position` kept the order boards showed then, most recently updated first). **New tickets go on top of their column**, and so does a ticket whose status changes without a place (in the ticket, or by an agent's `ticket_update`). A drag sends `place: {after, before}`, the ticket numbers just above and below where it lands; the backend puts it right below `after`, else right above `before` (one that has meanwhile left that column is ignored), else on top, halfway between its neighbours (renumbering that column when there is no room left between them). The board and the list follow this order; agents' `ticket_list` stays most recently updated first, and agents do not reorder.

## Agents

**Agent settings → Tickets** grants the tools, none by default (`Agent.ticketTools`); they are offered only while the agent's organization has tickets on, and every call checks the grant, the organization and the option again:

| Tool | Class | Does |
| --- | --- | --- |
| `ticket_list` | r | The board's tickets, open ones by default; filter by status, assignee, words; due date, parent, sub-issue progress and blocked shown |
| `ticket_read` | r | One ticket with its links, sub-issues, relations, comments and activity (30 at a time, paging back) |
| `ticket_create` | w | File a ticket (when agents may create them), optionally assigned, optionally a sub-issue (`parent_id`) |
| `ticket_update` | w | Status, assignee, priority, labels, link a computer or file, unlink, `relate` / `unrelate` |
| `ticket_comment` | w | Comment on any ticket of its organization |

Enforced where the change is made (the store, for people and agents alike): only the agent's own organization; it changes only tickets **assigned to it** (or unassigned ones, with the pick-up option); it assigns only the owner, itself, another agent of the organization or nobody, never another person; it never sets **Done** or **Cancelled** and never changes the status of a closed ticket: agents stop at In review. Sub-issues and relations follow the same rule: an agent sets a parent only to a ticket it may change and relates only a ticket it may change (to any ticket of its organization). Agents do not set due dates or reorder.

**Waking.** Assigning an agent (by a person or another agent, with the option on) saves a platform `ticket` event for it in the same transaction as the change (a `PendingTimerEvent` row) and hands it over: idle, it starts a turn; busy, triage decides. A turn that finishes clears it; one the platform stopped before (a restart, a crash) is delivered again at the next start, marked; a paused agent gets it when resumed. The event names the ticket, who assigned it, its priority, status and description (labelled when untrusted) and what to do next; it carries the owner's authority only when the owner assigned it. An `@Name` in a comment wakes that agent the same way, to answer, not to take the ticket over. The same path carries the [unblocked](#relations) and [due](#due-dates) events. Waking on assignment follows the option; those two do not (they are about tickets already assigned). Wake-ups agents cause on one ticket (assigning each other, mentioning each other) are limited to 10 an hour; past that the change is saved and nobody is woken (the comment's result says so). People's are not limited.

The system prompt has a short "Tickets" section when any ticket tool is granted; Swarm Knowledge `concepts/tickets` has the details.

## Notifications

When someone other than the owner moves a ticket to In review and the option is on, the owner is pushed (Agent messages preference; with Show message text off, without the title) and a toast shows in an open dashboard that is not on that ticket ([notifications](notifications.md)). Never for the owner's own moves.

## Organizations and deleting

Tickets never leave their organization. Moving an agent to another organization unassigns the tickets it had in the old one (the move preview lists them). Deleting an agent unassigns its tickets; their activity keeps its name. Deleting an organization deletes its tickets. Exported agents carry their ticket grant, not tickets.

## Not in this version

Projects, cycles, estimates, roadmaps, saved views, templates, SLAs, bulk edit, syncing with Linear or other integrations, links to recordings (a recording lives on its computer: link the computer), ticket chips in agent DMs and Discord, and tickets in agent exports.
