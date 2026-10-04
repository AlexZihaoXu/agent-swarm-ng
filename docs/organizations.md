# Organizations

Organizations are folders for agents, computers and group chats that are **kept apart** from each other. Each has one **owner** ([users](users.md)): a user reaches only the organizations they own, admin all of them.

## The boundary

Every agent, computer and group chat belongs to exactly one organization. Existing ones were placed in **Personal** when organizations were added. Links between them never cross an organization, and that is checked where each link is made:

- a computer is assigned only to agents of its organization (`ComputerUseService.assign`);
- DMs are allowed only between agents of one organization (`SwarmStore.updateSettings`);
- a group's members are all in its organization (`GroupStore.create`/`update`).

Everything an agent can reach follows from these links (its computers, DM contacts, groups, and through them files and history), so an agent never reaches or sees another organization. Its system prompt names its own organization so it can explain why something is out of reach.

Shared by every organization: Swarm Knowledge, Settings → Swarm limits (computer count, storage), Settings → Security and the audit and access logs. Model connections and Discord owner accounts are the organization owner's ([users](users.md#model-connections)). An agent's own memory, scratchpad, Discord bot and private chat belong to the agent and move with it. Computer containers are isolated from each other regardless of organization (see [Computers](computers.md)).

## Moving

Agents, computers and groups move from their own settings (agent settings → Organization; a computer's Settings; the group editor). A move first **previews** the links that would cross and lists them in the confirmation; applying it drops them and then moves:

| Moving | Drops |
|---|---|
| an agent | its assignments to computers outside the new organization (releasing a claim it holds there), its DM permissions with agents outside it (both directions), its memberships of groups outside it |
| a computer | its assignments to agents outside the new organization (releasing their claims) |
| a group | its members outside the new organization |

Moving to another owner's organization also lists the agent's model endpoint (another owner's connections are not its; choose a model after moving) and is refused when a computer would take the new owner over their RAM cap ([users](users.md)).

API: `POST /api/organizations/:id/move` with `{kind: 'agent'|'computer'|'group', id, apply}` returns `{dropped: string[], moved}`.

## Managing

Settings → Organizations lists them with their counts (admin's list names other people's); rename one, create one (owned by you), or delete an empty one: its agents deleted and its computers and groups moved or deleted, and never its owner's last. `GET/POST /api/organizations`, `PATCH/DELETE /api/organizations/:id`. Creating an agent, computer or group takes an optional `organizationId` (one you reach; default: your first); `GET /api/agents?organizationId=` lists one organization's agents.

## Dashboard

The switcher at the top left of the header (adapted from Kibo dropdown-menu-profile-4, Multi-Account Switcher; on a phone, with its name, in the slim top bar beside Portal) chooses which organization the dashboard shows, or **All organizations** (a user's own; admin's lists everyone's, in sections: **Your organizations**, then **Sam's organizations** for each person). It scopes Agents, Chat, Computers, Portal and the organization charts of the [Dashboard](dashboard.md); the address names the choice (`?org=<id>`, none for all; it stays through in-app navigation, so a refresh, Back/Forward or a shared link shows the same organization; an address without one uses the browser's last choice) and it never changes what agents or people can reach (the server decides: [users](users.md#enforcement)). New things go into the organization shown (while showing all, their create dialogs ask). Opening an agent of another organization switches to it; switching away from the agent being viewed returns to the list. Switching fades the page briefly (not with reduced motion).

## Not now

Per-organization limits or budgets, several people sharing one organization, per-organization Knowledge, and sharing a computer or agent across organizations.
