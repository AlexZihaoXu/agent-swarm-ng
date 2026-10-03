# Organizations

Organizations are folders for agents, computers and group chats that are **kept apart** from each other. They are a light grouping for the person running the swarm (one owner across all of them), not user accounts or tenants.

## The boundary

Every agent, computer and group chat belongs to exactly one organization. Existing ones were placed in **Personal** when organizations were added. Links between them never cross an organization, and that is checked where each link is made:

- a computer is assigned only to agents of its organization (`ComputerUseService.assign`);
- DMs are allowed only between agents of one organization (`SwarmStore.updateSettings`);
- a group's members are all in its organization (`GroupStore.create`/`update`).

Everything an agent can reach follows from these links (its computers, DM contacts, groups, and through them files and history), so an agent never reaches or sees another organization. Its system prompt names its own organization so it can explain why something is out of reach.

Shared by every organization: the owner, model connections, Swarm Knowledge and Settings → Swarm limits (computer count, storage). An agent's own memory, scratchpad, Discord bot and private chat belong to the agent and move with it. Computer containers are isolated from each other regardless of organization (see [Computers](computers.md)).

## Moving

Agents, computers and groups move from their own settings (agent settings → Organization; a computer's Settings; the group editor). A move first **previews** the links that would cross and lists them in the confirmation; applying it drops them and then moves:

| Moving | Drops |
|---|---|
| an agent | its assignments to computers outside the new organization (releasing a claim it holds there), its DM permissions with agents outside it (both directions), its memberships of groups outside it |
| a computer | its assignments to agents outside the new organization (releasing their claims) |
| a group | its members outside the new organization |

API: `POST /api/organizations/:id/move` with `{kind: 'agent'|'computer'|'group', id, apply}` returns `{dropped: string[], moved}`.

## Managing

Settings → Organizations lists them with their counts; rename one, create one, or delete an empty one (never the last). `GET/POST /api/organizations`, `PATCH/DELETE /api/organizations/:id`. Creating an agent, computer or group takes an optional `organizationId` (default: the first organization); `GET /api/agents?organizationId=` lists one organization's agents.

## Dashboard

The switcher at the top left of the header (adapted from Kibo dropdown-menu-profile-4, Multi-Account Switcher; on a phone, with its name, in the slim top bar beside Portal) chooses which organization the dashboard shows, or **All organizations**. It scopes Agents, Chat, Computers, Portal and the organization charts of the [Dashboard](dashboard.md); the choice is kept per browser and never changes what agents can reach. New things go into the organization shown (while showing all, their create dialogs ask). Opening an agent of another organization switches to it; switching away from the agent being viewed returns to the list. Switching fades the page briefly (not with reduced motion).

## Not now

Per-organization limits or budgets, multiple human users or roles, per-organization Knowledge, and sharing a computer or agent across organizations.
