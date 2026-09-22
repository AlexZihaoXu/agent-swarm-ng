# Agent avatars

## Appearance and editing

Create an agent with the **Avatar** controls, or right-click an existing agent and choose **Edit agent → Avatar**. The same editor shows a large preview and an actual sidebar-size sample. Both samples use the real `AvatarFace` mask/cutout and `PresenceIndicator`, including the green idle dot, same-size aqua working pulse, and typing pill. The large sample is a proportional enlargement of the sidebar composition. During creation, the Avatar disclosure animates its height/opacity and chevron; collapsed controls are inert and hidden from assistive technology. The Edit agent modal uses a fixed Avatar tab without a redundant disclosure; its Settings tab configures [agent communication](agent-communication.md). Editor dialogs use the existing slim ScrollArea with inset spacing from the rounded modal edge, rather than a native scrollbar flush against it.

- Eight original SVG silhouettes: pebble, squircle, gumdrop, rounded triangle, bean, pear, capsule, and soft diamond.
- Six named palette colors, plus display support for a saved custom hex color.
- Two eye shapes: rounded pills and larger circles (8 SVG units across).
- **Randomize** chooses a new silhouette/color/eye style and motion seed. It keeps the selected preview state. Rerendering or typing an agent name never reshuffles an identity. Appearance changes morph from the currently displayed outline over 320ms, including rapid retargets; aligned perimeter samples avoid twisting. Eye shape, head tilt, and perspective bounds blend with the silhouette, while color uses a short fill transition.
- Shape, color, eye style, and seed are saved at creation or with **Save avatar**. Cancel discards edits. Model settings, channel IDs, messages, and active work are unaffected by an appearance edit.
- Agents created before this feature receive a stable appearance derived from their ID until a choice is explicitly saved. No agent/history records are recreated.

## Motion and runtime state

Only **Idle**, **Working**, and **Typing** are modeled; there are no happy/sad/error expressions. State preview and **Look preview** are local demonstration controls and are never persisted as agent state or appearance. Look preview defaults to Natural and can hold Forward or a directional pose for inspection. Changing the target preserves the current gaze and eases toward the new pose over roughly half a second, rather than snapping. Reduced motion applies the selected direction immediately. Actual avatars use backend busy/typing signals, with typing taking priority.

All eight silhouettes have subtle, independently seeded contour drift and small squash/stretch movement while remaining recognizable. The eight base outlines are sampled and cached, then rendered as smooth closed curves. Appearance transitions start on the first animation frame so layout work cannot consume the morph duration. Both eyes move together for occasional glances, rest near the center, and blink at irregular intervals with occasional double blinks. A lightweight curved-surface projection tilts diagonal looks, compresses eye spacing, and makes the far eye smaller, creating a rounded-head impression without lighting effects, WebGL, or a 3D dependency. Narrow silhouettes use smaller excursions. This outer viewing transform is independent of the inner eyelid transform, so a turned eye still blinks along its own axis. Both eye styles close by compressing their local vertical axis around a fixed center: there is no diagonal morph, rotation, or narrowing of eye width. Working runs the outline cycle at 8× idle speed, typing at 12×; blink/glance timing is not accelerated.

The sidebar, chat header, and editor samples share a clock/seed so matching identities have consistent motion. Rendering targets roughly 30fps; offscreen avatars and hidden tabs stop animation work. Reduced motion produces a static, open-eyed pose. Collapsed editor previews stop motion. Unmounting cleans up frame requests and observers. Shape-selection thumbnails have no idle animation loop, but briefly transition when appearance changes; selected previews and live avatars animate continuously while visible. Reduced motion makes disclosure and appearance changes immediate. Text editing, validation feedback, and focus remain immediate rather than receiving decorative delays.

The separate status badge stays unambiguous: idle is green; working is an **aqua opacity pulse with exactly the same dot dimensions** (no growth or morph). Typing keeps its existing three-dot pill. Reduced motion disables the pulse.

## Storage and API

An additive nullable `Agent.avatar` TEXT column holds validated appearance JSON. Existing rows remain null. `POST /api/agents` accepts optional `avatar`; `PATCH /api/agents/:id/avatar` updates only that appearance. The schema constrains shape and eye-style enums, six-digit hex color, and a nonnegative 31-bit integer seed. Fastify strips additional properties; they do not mutate other fields. Colors are normalized to lowercase. The dashboard updates only appearance after saving, preserving newer message previews that may arrive concurrently.

## References

Reviewed pinned Kibo source and rendered previews for Simple Select, Button with Text, the existing dialog/context-menu compositions, and avatar badge placement. Those patterns provide controls/framing, not expressive artwork; the SVG family is original, following the custom illustration approach discussed with the owner.

Implementation lives in `frontend/src/lib/agent-avatar.ts`, `avatar-motion.ts`, `avatar-perspective.ts`, `components/agent-avatar-art.tsx`, `agent-avatar-preview.tsx`, and `edit-agent-form.tsx`; backend validation lives in `backend/src/agent-avatar.ts`.

## Validation

Unit tests cover stable identity, bounded contours, blinking/glances, interpolation, and input validation. API tests cover creation, appearance-only edits, persistence after reopening storage, and missing-agent errors. Browser checks cover all silhouettes, randomization, keyboard selection, motion preferences, save/reload/cancel/failure, creation payloads, mobile overflow, and unchanged-size working badges. These tests use fixtures rather than modifying real agents. Validation passed: the full unit/integration suite, targeted eyelid-axis/speed regressions, typechecks/build, all 61 browser tests on the final UI, and a nonroot Docker migration/edit/persistence smoke test. Local backend/proxy health and migrated avatar responses were also verified without changing real agent records.
