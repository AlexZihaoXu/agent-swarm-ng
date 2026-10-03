# Feature consistency review

Review baseline: `a846572` (Chat/groups/reactions and Codex model refresh merged into main). Fix branch: `fix/feature-consistency`. This is a scoped implementation/configuration/test review, not a claim that every deployment condition is verified.

Note (2026-10-03): this records the review at that baseline. Since then the dashboard sign-in ([login](login.md)), long-term memory, Discord, computer assignment/control and the Tailnet desktop deployment were implemented, so the loopback-only and "unimplemented" boundaries below are historical.

## Rules applied

Reread `AGENTS.md`, `docs/vision.md`, the Kibo entry guide, development/security guidance, and the relevant feature notes. Preserve explicit capability grants, runtime authorization, internal-output separation, project-local credentials, backend-owned work, and the agent/channel/computer separation. No speculative implementation of the vision's open questions; no upstream reference scripts executed. Conventional commits and fast-forward merges; no push.

## Coverage

| Feature set | Review/checks | Disposition |
| --- | --- | --- |
| Identity, creation, deletion, persistence | Platform-store/API tests; exact-name deletion; FK cascades; shared providers retained; no production fixtures | Retained. Shared group author snapshots intentionally survive agent deletion. |
| Avatars and appearance editor | Shape/color/eyes, stable identity, motion/reduced motion, scroll/keyboard/mobile browser coverage | Retained. No redesign of the selected composition. |
| Private human chat and Markdown | Explicit persisted publication; no raw-output fallback; safe rendering; draft/dedup and paging tests | Restored the width constraint lost when reaction wrappers were added, so long mobile code/table content scrolls inside the bubble. The existing browser regression test exposed this. Reaction-loading failure is now visible and retryable. |
| Operator activity/context usage | Separate ephemeral event path; provider errors sanitized before recording; context-usage tests | Retained. Activity is not durable chat or long-term memory. |
| Backend execution/Stop/reconnect | Queue, inbox, interruption-fork, run-stream and notification tests | Retained. Browser disconnects do not own execution; restart does not replay inference. |
| History/search | Channel/member checks, indexed cursors, bounded fragments, literal match snippets | Corrected model-facing envelopes to identify the actual originating group/DM channel instead of the receiving agent's private channel. Added regression coverage. |
| Agent DMs | Mutual grants, live checks, shared budgets, recipient context isolation and browser transcript/typing tests | Retained; groups do not grant DMs. |
| Group chats and discovery | Membership edits, transactional publication/fan-out, audience guidance and shared normal inbox | HTTP-confirmed sends now refresh the chat-list preview even without a live event. Added desktop/mobile regression assertions. |
| Reactions | Bound identity, membership/own-channel checks, idempotence, cascades. A new human reaction is triaged by one small model call and may start a normal agent turn (later change; see [Chat and groups](chat-and-groups.md)) | Added a visible read-failure/retry state. Reaction feedback is distinguished from text answers in the prompt. |
| Settings/API endpoints | Saved/tested connections, URL restrictions, generic errors, secret omission in responses; endpoint tests | Retained. Loopback-only trusted-admin deployment remains required. |
| ChatGPT subscription/models | Native OAuth/Responses, isolated auth/cache, scoped refresh, dynamic thinking metadata and failure retention | Verified model metadata separately from inference; no paid-API fallback or developer inference used. |
| Navigation/accessibility | Main tabs, creation/member selection, keyboard/mobile layout | Updated stale two-tab/direct-child bubble assertions without weakening their animation/layout checks; disabled member labels no longer advertise clickability. |
| Notifications | Gesture unlock, bounded playback, deduplication, offline catch-up without replay | Retained. Reactions do not trigger message sounds. |
| Docker/workspace | Build configuration, Ubuntu defaults, package/tool tests, browser sandbox | Added Noto Color Emoji after the visual review exposed missing reaction glyphs. The new layer preserves cached desktop/tool layers. |
| API/schema/PWA/reference | Generated-contract drift check; migrations; static-only PWA cache configuration; Kibo adaptation boundaries | Corrected vision wording that still described implemented communication grants/queues as unimplemented. No new application packages or reference-mirror changes. |

## Evidence

- generated API drift check, backend/frontend typechecks, **126 unit/integration tests across 30 files**, production build and whitespace checks passed.
- updated Ubuntu workspace build, package/default-theme/font checks, tool versions, writable workspace/home and tmux checks passed. Production and development Compose configurations also validate.
- nonroot production-backend Docker smoke passed group publication, normal-inbox context isolation, reactions, persistence and restart cancellation without replay.
- Windows browser launches remain paused. Browser checks use a dedicated nonroot Linux container, the repository's Chromium seccomp profile, `no-new-privileges`, Chromium sandbox enabled, one worker, zero retries and first-failure stop. Namespace/PID/network and Seccomp-BPF protections were observed; Yama protection was unavailable.
- **all 72 application browser tests passed** in the sandboxed nonroot Linux container, including the original long-code/table mobile regression, reaction retry, group preview without live events, animations, typing, notifications and keyboard workflows. Desktop/mobile group screenshots were inspected and emoji rendering confirmed after installing the font.
- Final frontend typecheck/build passed again with the mobile-width fix. Whitespace and generated-contract checks are clean.

## Boundaries still requiring separate care

- Platform authentication is not implemented: do not expose this trusted local-admin API publicly.
- Real subscription inference/account entitlement is not established by catalog visibility. No real inference was performed for this review.
- PWA installation/offline/update behavior still needs its dedicated production-browser acceptance checks; static cache configuration alone is not that proof.
- The existing production bundle-size warning remains. No speculative bundler/refactoring work was added to silence it.
- Long-term memory, external channels, durable autonomous replay, resource permissions/computer assignment/control and production desktop streaming remain separate, unimplemented scope—not defects to fill in without product agreement.
