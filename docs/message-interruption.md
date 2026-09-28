# New-message triage

## Agreed behavior

- Wait for a **1.5-second quiet period** before starting inference; restart that debounce when another message arrives. Persist each message immediately and keep its identity/order.
- While the main agent is working, evaluate new messages in a **temporary fork of its full current conversation context**, not a condensed triage context. The main branch keeps working during triage.
- The fork has only a structured decision tool: `interrupt`, `queue`, or `uncertain`, plus a short justification. It cannot publish or execute the main branch's tools.
- Use the same configured model, with low reasoning when supported. Triage is a private corrective conversation capped at **10 model turns**: missing/malformed decisions receive feedback and can be corrected. Provider failures are not blindly retried. An explicit uncertain decision, exhausted budget, cancellation/timeout, or provider failure means queue.
- At most one triage inference per agent. New messages invalidate older decisions; cancel/join the old triage before evaluating the latest batch.
- If the main branch finishes first, cancel the fork and process pending messages normally. If triage wins with `interrupt`, abort/join the main generation before continuing the original session with the actual messages and decision justification.
- Cancellation cannot undo committed publications or external side effects. Preserve completed work; do not automatically retry side-effecting tools. Mark unfinished operations as unfinished, never as successful.
- Backend ownership: admission, pending messages, revision checks, cancellation, and continuation. The triage module only advises.
- Explicit Stop stops the whole current run including debounce, triage, and queued continuations. Already accepted messages remain saved; they are not automatically resumed after Stop or a backend restart.

## Implementation notes

- This is an in-memory conversational fork, not a Git branch and not Pi's session-replacement operation (which would tear down the working main session).
- Clone the main conversation and system context. In-flight tool calls require explicit pending placeholders in the fork so its provider transcript is valid; these placeholders must never be written back into the main branch.
- Fork reasoning stays internal. Only its bounded decision justification is used for control/continuation; normal assistant publications still require `send_message`.
- Forking duplicates context and incurs additional inference cost; this first version deliberately favors testing fork behavior over context minimization.
- Completed private Pi session checkpoints can be restored on the next run after restart; this scope does not provide automatic recovery or durable requeueing of an interrupted job.

## Implementation and limits

- `backend/src/interruption-triage.ts` defines the decision tool and a native Pi extension adapter. The backend explicitly grants that same tool to each fork; it does not enable plugin auto-discovery.
- `MessageInbox` owns debounce, pending messages, and revision checks. A run retains its original `clientMessageId` for Stop even when it accepts more messages. Stop epochs also invalidate in-flight admissions, preventing a saved follow-up from silently restarting a just-stopped run.
- The fork deep-copies current messages, including internal tool context, plus an explicitly unfinished streaming draft when present. Its modifications never merge back; only an accepted interruption justification is appended to the original session.
- Both interruption and reaction triage use a 4,096-token per-turn output ceiling (or the model's lower maximum), at most 10 model turns, and a 120-second cooperative overall cancellation deadline. `triage-turns.ts` stops the SDK after each provider turn, including tool-error turns, so internal auto-continuation cannot bypass the budget. Missing decisions, malformed arguments, forbidden tools, and token-truncated calls receive corrective feedback in the same private fork; prior tool errors remain available. The first valid decision ends triage, including on turn 10. Provider failures fail closed without raw-error disclosure; there are no automatic transport retries. No research, filesystem, or publication tools are granted. Main completion, Stop, and superseding messages still cancel triage promptly; provider cancellation depends on SDK/transport cooperation.
- Each accepted message remains a separate database record. The model receives a batch with per-message IDs/timestamps. A short per-agent save lock remains; concurrent saves can return 409, and the dashboard retains the unsent draft.
- Queued messages remain visible in channel history. Triage controls execution scheduling, not a history-visibility fence.
- Full-context forks and extended in-run conversations can reach provider context limits. There is no automatic compaction or claim of unlimited conversation length. Fork errors default to queue; main-provider failures remain normal run errors.
- This is an advisory model decision, not a guarantee of correct interruption classification. Future side-effecting integrations still need their own execution-time authorization and idempotency.

## Validation

- Unit checks cover precise debounce/reset timing, ordered batching, stale decisions, serialized forks (including arrivals during promise settlement), main-first cancellation, queue/uncertain/error fallback, Stop, and cloned-context isolation.
- Mock-provider checks cover corrective turns, retained error feedback, exact ten-turn bounds (including repeated tool errors), success on turn ten, cancellation, provider-error redaction, and decision-only grants for interruption and reaction forks.
- Mock-provider integration verifies rapid-message coalescing and the full fork → decision → main cancellation → same-session continuation flow, with only `triage_decision` granted to the fork.
- All 75 unit/integration tests and 53 browser tests passed, including follow-up submission by click/Enter and Stop still targeting the original run.
- Typechecks/build and the nonroot Docker smoke test passed: full-context fork, decision-only grant, main abort, same-run continuation, and durable publication without a dashboard. The final regression pass also passed with the additional settlement-race fix.
- No live-provider classification-quality claim is made.
