# Agent models and fallbacks

Each agent has a ranked list of up to **five models** (Agents → agent → **Model**). It uses #1; when a model fails, it moves down the list, and it comes back up when the higher model works again. Only models the owner put in the list are ever used: there is no automatic fallback to anything else, paid API or not.

## The list

Each row is one model: an endpoint (one of the organization owner's model connections, or their ChatGPT login), a model on it, a thinking level, and three options:

- **Tries before moving on** (1–5, default 3). A failed call is tried again on the same model after 2, 4, 8 … seconds. An error that cannot succeed by trying again (a rejected login, no access, an unknown model, a bad request) moves on at once. A context overflow is not a failure: the agent compacts, as before.
- **If the chat is too big for it** (every model but #1): **Skip it** (default) or **Compact to fit, then use it**. A model fits when the conversation leaves its reply room free (a quarter of its window, at most 16,384 tokens). To compact, the smaller model summarizes the older part in passes, oldest first, each as much as it can read with the summary so far, and the final summary replaces the older part before the call. If a single message is bigger than it can read, or the summary fails, it is passed over like an unreachable model.
- **Come back to it after it fails** (every model but the last): after 1–60 minutes (default 5), or only when the owner presses **Use #1 again**.

Rows are collapsed to a line (`#2 · Endpoint · model · thinking`); one opens at a time to edit it, move it up or down, or remove it (the last one cannot be removed). Drag a row by its grip, or focus the grip and press ↑/↓. **Add model** adds a row at the end. Saving checks every newly added model like a new agent's; a model already in the list is not re-checked, so one waiting for its connection to come back can stay. A model may be listed once.

The list is stored with the agent: #1 in its own endpoint, model and thinking-level columns, and #1's options and the other rows in `Agent.modelChain` (JSON, `backend/src/model-chain.ts`). Moving an agent to an organization with another owner keeps only rows on the ChatGPT login (each person's own), as #1's endpoint is cleared; deleting a user does the same for their agents (docs/users.md#model-connections).

## How a run walks the list

A main run (a message, a heartbeat, a timer, a watch's wake-up, Discord) resolves every row's connection first; a row whose connection fails (ChatGPT signed out, an endpoint removed) is skipped at once and noted. It starts on the agent's current model, or on a higher one whose come-back time has passed (a model the conversation does not fit is not tried). Within the run, before each new input and between the model calls of one answer (never while one is streaming; a continuation the platform starts itself, such as a todo check's note, goes on with the model in use), a higher model that has come due gets **one** try: if it answers it becomes the current model again; if not, the run moves down the list from there, past models that failed recently, with no second try of it.

One Pi session runs the whole turn: the platform gives it one runtime that passes each call to the runtime of the row that made the model (`backend/src/model-fallback.ts`), and takes over Pi's retry step to try again, switch model (Pi's `setModel`, recorded in the session), or give up. Every successful response makes its model the agent's current one. Where the agent is on the list is kept in memory: a backend restart starts every agent on #1 again.

Side calls use the model the agent is on now: todo checks, interruption and reaction triage, decision forks, watch checks and sleep. Model usage is metered against the endpoint that answered (for a call that does not say, the one the agent is on when it is recorded).

## What people see

- **Activity**: `Model retry`, `Model fallback`, `Model skipped`, `Model come-back try`, `Model recovered` and `No model left` notes. A provider's failure shows as a category and HTTP status (`authentication, HTTP 401`), never its own error text; a model the platform could not use says why in the platform's own words (`cannot be used: Reconnect OpenAI Codex in Settings.`).
- **Model section**: while the agent is on a lower model, a note says so with **Use #1 again** (`POST /api/agents/:id/models/first`; its next run starts on #1, a run already going keeps its model), and that row is marked **In use**. A `model_choice` event keeps it live.
- **Push** (Agent problems): once when an agent drops off #1, "Aether switched to model #2", with the reason (a category, or the platform's own words such as "Reconnect OpenAI Codex in Settings."). Moving further down or back up does not notify.

## API

`GET /api/agents` and the agent views carry `models` (the ranked list) and `activeModel` (0 is #1). `PATCH /api/agents/:id` takes `models` (1–5 rows, the whole list) or, as before, `endpointId`, `model` and `thinkingLevel` for #1 alone; not both.
