# Agent activity inspector

The Activity panel is an **operator-only runtime archive**, not a channel transcript or agent memory. Direct model output and provider-exposed thinking never become chat messages through this archive. Channel publication still requires an explicitly granted channel tool.

## Captured evidence

| Source | Recorded information |
| --- | --- |
| Admission and work lifecycle | Initiating client message ID, delivery source, queued status, work timing and ended/stopped/failed/interrupted outcomes |
| Session configuration | System prompt, selected provider/API/model, context/output limits, input/reasoning capabilities, thinking setting, image auto-resize setting, active tool descriptions and parameter schemas |
| Model messages | New model-facing input/reminders, provider-exposed thinking text or summaries, direct output and tool arguments; final messages reconcile partial streams |
| Model outcomes | Returned model/response IDs, stop reasons, usage/cost fields supplied by the SDK, timestamps and elapsed time; safe failure classification and structured error codes when available |
| Provider requests | Whitelisted generation settings, input role/content-type counts and tool count, without copying the entire retained transcript or raw request body |
| Provider HTTP responses | Status and selected request-ID, retry-delay and rate-limit headers when the SDK exposes them; never authorization/cookie headers |
| Tools | Call/result correlation, arguments, handler start/end and elapsed time, each progress update, final text, structured details, usage, termination flags, added tool names and ordered content-block descriptors |
| Runtime maintenance | Compaction summaries/outcomes, SDK retry/queue/generation events, session entry IDs/types, session information and thinking-setting changes |
| Interruption triage | Separate numbered branches containing fork inputs, model requests/responses, failed decision attempts, correction feedback and the resulting advice |
| Reaction triage | Separate reaction run IDs, queue/source information, fork traces, decisions, discarded/skipped outcomes and the scheduled ordinary run ID when applicable |

A completed tool handler is not proof that the user's goal was achieved. Tool results retain their own delivery/start/truncation/error receipts. Returned `isError` flags are bridged into the native SDK result so failed tools are not presented to the model or inspector as successful calls.

Tool IDs are scoped to each assistant response and triage branch: providers that reuse an ID on later responses must not overwrite earlier calls. Main-session context usage remains separate from temporary fork usage. Run outcomes follow observed response events, not just working context: SDK recovery can remove truncated/error responses from that context. SDK usage zeros can mean usage was not reported; estimated costs are not billing receipts.

## Persistence and presentation

- Text has no age/count expiry. SQLite writes precede live activity notifications. Streaming updates are coalesced for approximately 100 ms and explicitly flushed when work settles.
- History uses indexed 30-entry pages and at most 6,000 UTF-8 bytes per text fragment. The panel shows loaded entry counts and partial byte counts; **Load older activity** and **Load more text** retrieve additional saved evidence.
- Stable IDs and revisions prevent stale writes/fragments from replacing newer content. A reconnect refreshes the bounded latest window rather than silently merging across a missed-history gap; expanded text is retained for unchanged entries that overlap that window.
- Metadata and system prompts start collapsed. Disclosure arrows expose their contents. Entry state distinguishes pending/running/streaming, complete, partial, failed, rejected and interrupted records when the producer provides it. Legacy records may have no state.
- Empty text is not shown as an indefinite thinking indicator after an entry has settled. A provider-redacted thinking block is explicitly described as having no readable text.
- Long labels, names, IDs and JSON remain within the panel at narrow widths. The scroll area's content uses the same constrained block layout as chat and Knowledge, rather than Radix's intrinsic-width table layout.
- On backend restart, unfinished records retain their captured text and are marked interrupted. Restart does not resume inference or replay activity into channels.

## Images and limits

Images use the existing shared bounded image pool; activity stores references and safe descriptors, **not another base64 copy**. Metadata survives image expiry. When SDK-added dimension notes prevent parsing the primary tool text as an image reference, a separate reference entry keeps the original image inspectable. The SDK may normalize model-bound images; returned notes and the configuration's auto-resize setting are recorded.

The inspector cannot reconstruct data the runtime never exposed or previously discarded:

- Hidden reasoning, encrypted/redacted reasoning blocks and continuation signatures are not readable thinking. Reasoning-token counts may include work for which the provider supplies only a short summary or no text.
- Credentials, authentication headers/cookies, opaque provider state and raw provider error bodies are intentionally withheld. Safe status/category/code/type/parameter information is recorded where available. Credential-like structured fields and known connection keys are redacted, including incomplete streaming prefixes.
- Diagnostic payloads are not dumped wholesale; their available field names and safe error classification are shown. Retained context is not duplicated on every request, and SDK state already present before observation cannot be retroactively inferred from event logs.
- Tool-imposed limits (for example the synchronous shell's bounded output tails) apply **before** activity capture. Expanding an activity entry reveals all saved result text, not bytes the tool discarded. These differ from the inspector's reversible preview truncation.
- A hard process failure can lose the final uncheckpointed streaming interval. Entries without a final event remain visibly unfinished/interrupted rather than claiming completion.
- Existing historical omissions are not backfilled with invented content. Richer capture applies to new work after deployment.

Authorized tool text can still contain sensitive guest-file or command-output data; field/key redaction is not a universal secret detector. Keep this inspector within the trusted operator boundary.

Older backend versions have a closed activity-kind API enum. A rollback over an archive containing `metadata` entries needs a reader that accepts that kind; otherwise archive requests can fail serialization. Preserve the data and use a compatibility-patched rollback image rather than deleting new records or restoring an obsolete database over newer messages.

No computer access, background execution, model fallback, autonomous scheduling or additional product-agent tools are granted by activity inspection.
