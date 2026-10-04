# Users

The dashboard has one **admin** and any number of **users**. Admin creates users and sees and acts everywhere; a user sees and acts only inside their own organizations. Signing in is unchanged ([login](login.md)); this page is who may do what once signed in.

## Accounts

- **Admin** is the account the migration created (`User.role = 'admin'`); its first sign-in sets its password. There is one admin.
- **Users** are created by admin in Settings → Users with a name and a password admin chooses. Creating a user also creates their organization, **"<name>'s Organization"**. A user can change their own password (Settings → Account); admin can set a new one for them, which signs them out everywhere.
- A host reset (`reset-password.ts <name>`) of a user signs them out and clears their password; admin sets a new one. Only the admin account can be set from the first-visit page.
- Admin can **disable** a user (they are signed out everywhere and refused at sign-in; their agents keep running) or **delete** one. Deleting hands their organizations to admin (nothing in them is lost) and removes their API endpoints, ChatGPT login and Discord accounts; their agents' endpoints are cleared, so each needs a model chosen from admin's.
- Admin can cap a user's **RAM**: the total RAM of the computers in their organizations (`User.memoryLimitGiB`; empty: no cap). It is checked wherever a computer's RAM is set or a computer enters one of their organizations (create, settings, rebuild, move), including when admin does it.

## Organizations are the boundary

Every organization has one **owner** (`Organization.ownerId`). A user reaches only organizations they own: their agents, computers, group chats, every channel, message, file, activity entry, screenshot, terminal and desktop in them. Admin reaches all of them. This is enforced on the server for every request ([enforcement](#enforcement)); the switcher only chooses what the dashboard shows.

- **Switcher:** a user's lists their organizations. Admin's lists every organization in sections: **Your organizations**, then one section per user (**Sam's organizations**). Choosing one opens it; admin then acts there as in their own.
- **New organization** is owned by whoever creates it.
- **Deleting** an organization needs it empty (no agents, computers or group chats; delete the agents first) and its owner keeps at least one organization.
- **Moving** something between organizations needs access to both; a user moves only between their own. A move to another owner's organization clears the agent's model endpoint (the old owner's: it chooses one of the new owner's; the preview says so; a ChatGPT choice stays, now the new owner's login), counts the computer's RAM against the new owner's cap, and makes Discord accounts and bots follow the new owner.

## What each one can open

| | Admin | User |
|---|---|---|
| Agents, Chat, Computers, Portal | every organization | their organizations |
| Dashboard | every organization, host stats | their organizations, host stats |
| Settings → Account (password), API endpoints, ChatGPT, Discord accounts | their own | their own |
| Settings → Swarm Knowledge | yes | yes |
| Settings → Organizations | all | their own |
| Settings → Users, Swarm, Security, Computer storage; audit and access logs; critical-event banners | yes | no |

## Model connections

API endpoints (and their keys), the ChatGPT login and the Discord accounts that carry human authority belong to a **person**. An agent uses its **organization owner's**: the endpoint list when choosing its model, the ChatGPT login for subscription models, the owner's Discord accounts as its owner on Discord, and only its own organization's agent bots as fellow agents (everyone else, other people's accounts and bots included, is a person). A Discord account is one person's; admin can take one back from a user who claimed it. That holds for every turn, including heartbeats, timers, watches, Discord and sleep, which run without anyone signed in. Admin editing an agent in Sam's organization chooses among Sam's endpoints (the model picker passes the organization). Nobody sees another person's keys; endpoint ids are unique per person (`endpoints.json` rows carry `ownerId`), and each person's ChatGPT login has its own files beside the database (admin's keep the original names).

A user's endpoint must be a **public** address, by the same policy as the agents' web tools (`web-policy.ts`): loopback, private, link-local, tailnet, multicast and single-label or internal names (the platform's own Docker services) are refused, checked when it is tested and saved (a name that later resolves elsewhere is not rechecked at run time). Admin's endpoints may point anywhere, such as a model server on the LAN.

## In chats

A human message records who wrote it. Each agent's system prompt names its owner, and history shows a human message's writer ("Human (Admin)"); a message written live by someone other than the owner says so ("Human: Admin, the platform administrator, not your owner"), so an agent never mistakes one person for another. Chats show the writer's name above messages that are not yours. Older messages, written before there were users, are the owner's.

## Enforcement

- One table maps every route (method and path) to its rule: public, any signed-in person, admin only, or a resource check (the agent, computer, group, channel, file or organization the request names, resolved to its organization). A route missing from the table is refused for users, and a test fails when a registered route has no entry.
- Lists (agents, computers, groups, organizations, files search, computer control, dashboard) return only what the person may open.
- The event stream sends a user only the events of their organizations (agents, groups, computers, files, scratchpads).
- Desktops: Caddy's sign-in check passes the requested path, and the backend allows it only for a computer the person may open. Terminal WebSockets check the computer the same way.
- Refusals for things a person cannot open are 404, so ids from other organizations reveal nothing.

## Limits

Computer names are unique across everyone, so a user can learn that a name is taken. A user's endpoint address is checked when it is tested and saved, not on every model call. Several people sharing one organization, and per-user limits besides RAM (CPU, computer count, storage), are not implemented.

## Audit

Users created, edited (field names: password, disabled, RAM cap), disabled and deleted are audited like other changes ([audit log](audit-log.md)); passwords never.
