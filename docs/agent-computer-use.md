# Agent computer use

Status: deployed to the trusted dashboard from `6cfb464` on 2026-09-27. This capability is separate from human desktop viewing, agent identity and channels. No account/login system is added. Computer assignments start empty and are set explicitly by the human.

## Assignment and control

In an agent's settings, **Computers** selects its allowed desktops. Assignments save separately from appearance/Channels and survive restarts. Multiple agents can be assigned the same computer, but only one agent holds it at a time; one agent selects one current computer. `list_computers` lists assigned resources and holders. `use_computer({computer: idOrName})` acquires control, and `{computer:null}` releases it. Names resolve to a stable ID; a busy destination leaves the old selection intact. Checks run at execution, not just when a tool is displayed.

A blocked agent asks the current holder to release via an already-permitted conversation, or asks the human for **Force release** in the viewer. No new messaging grant is implied. Force release cancels and settles input before releasing/transferring the claim, while preserving assignments. Unknown cancellation settlement fails closed. Agents release when finished unless the human explicitly asks to retain a dedicated computer. The human can interact concurrently; those cursor/focus races are deliberately accepted.

A Swarm backend restart cancels/settles persisted claims, releases them, clears screenshot allowances and leaves an agent-facing notice for each affected agent's **next normal turn**. It does not automatically wake inference or replay interrupted work. Browser refresh merely reattaches observation and does not release claims. Revoking an assignment releases active control; deleting an agent cascades its assignments/claim and archive.

The human viewer starts **Input locked** each time it opens/reconnects. The actual guest cursor is composed into the shared video stream, so locked observers can see agent/remote pointer motion. All trusted viewers use that same cursor mode, with the duplicate local CSS/canvas cursor suppressed; unlocking or detaching one viewer does not turn off another viewer's cursor. The toggle only enables/disables human pointer/keyboard/touch/shortcut input; it does not stop video, release an agent or revoke assignments. This adapts the v2 idea, not its overlay-only implementation: the trusted iframe also gates input events and shortcut messages after focus.

## Observe, act, verify

- `glance({quality?: "low"|"medium"|"high"})`: fresh full-desktop JPEG at 33% (default), 50% or 75% dimensions.
- `look_at({x,y,size})`: native-resolution crop with center and radius in **[0,999]** coordinates. Each axis shifts into the screen while preserving its span, or becomes the full [0,999] axis if oversized. Return actual pixel-rounded normalized bounds plus output dimensions, not just the requested rectangle.
- `run_actions({actions,per_action_pause?})`: a validated ordered combo, at most 16 actions. Action entries use `{name,params?}`. Pause defaults to 0.1 seconds, **only between** actions. Every key/button down must pair with an up in the same combo, without duplicate downs or unmatched ups.

Each successful `glance`/`look_at` resets **two combos for 30 real seconds**, per agent and claimed computer. Failed screenshots do not reset it. Invalid/preflight-rejected combos consume no use, but time still elapses; started partial failures consume a use. Release/switch/restart invalidates the allowance. An expired/exhausted allowance errors before input and tells the agent to look again. This bounds blind operation; it cannot freeze a desktop or remove human races.

Actions: `mouse.move_to` (x,y,speed), `mouse.left_click`, `mouse.right_click`, `mouse.down/up` (button left/middle/right), `mouse.scroll` (direction and whole detents), `keyboard.down/up` (documented X11 key name), and `keyboard.type` (text,cpm). Movement uses physical endpoint distance at 8000 px/s by default, maximum 24000; a bounded Bézier trajectory is computed for that duration. Typing defaults to 800 CPM, maximum 3200, counting Unicode scalar codepoints, not bytes/graphemes. There is no additional product text-length cap: calculated duration limits it. Ordinary bounded transport bodies still apply. Type rejects unsupported control characters and combo-held keys. Click/scroll-detent dwell is 0.02 seconds.

Reject the **whole combo before any input** if invalid or above 5 seconds of action time / 10 seconds including pauses. The controller and guest repeat validation. Runtime power loss, app behavior and transport failure can cause partial effects; return partial progress and do not retry blindly. Guest cancellation uses a generation fence plus operation lock/cleanup, not just HTTP abort, so a delayed old request cannot act after Force release. Only labelled owned computers are targets; no host input/shell is exposed.

## Images and private sessions

Tools return real model image-content blocks plus text metadata. Known vision models retain their input capability; unknown/text-only models are rejected for screenshots, not fed base64 as text. Fresh images are captured/cropped inside the guest, not enlarged from a card thumbnail. JPEG quality is 85 with a 2 MiB compressed-image bound and source dimensions up to 4096 per axis / 16 million pixels.

Screenshot copies share an app-local **50,000,000-byte disk pool** at `.local/computer-screenshots/`. When the threshold is reached, evict at least **10,000,000 oldest bytes** (more if needed for the incoming image). Text activity/reference metadata remains; expired copies show unavailable rather than inventing a reconstruction. Private Pi checkpoints store references without duplicate base64, and rehydrate available images on the next run; missing images remain metadata with a fresh-look reminder. No historical screenshot renews action allowance. Exclude this cache from backups if oldest-first eviction must remove older copies; external model providers have their own retention policies.

## Swarm Knowledge and model guidance

The system prompt directs agents to read `swarm/computers/use`, `swarm/computers/actions`, and, before browser work, `swarm/computers/browser` when not already read in retained context. Entries include examples, coordinates, limits, ownership, human help and recovery. Content is reference, not a grant or higher-priority instruction. Hard execution rules do not rely on model compliance.

Browser guidance requested by the owner:
- Report a blocking CAPTCHA through an authorized channel **before** one default attempt. Immediately report its outcome; further attempts require human approval. No reload/solver/identity rotation to disguise retries. This is guidance, not a deterministic visual CAPTCHA detector.
- On observing the human's Google account signed into Chrome, warn about possible automation-related account/IP restrictions; wait for informed human permission before Google services. Use a non-Google route such as DuckDuckGo meanwhile. Do not assert a guaranteed ban or silently change/logout the account.
- That Google-specific gate does not automatically apply to GitHub/other accounts: assess task/account risk, warn as appropriate and proceed reasonably within existing instructions/grants.

## Rollout boundary

Controller, backend and guest runtime scripts all change. Existing desktops do not gain the guest scripts through a backend/frontend deployment alone. Build/test with disposable images first, retain live IDs/volumes and do not silently restart the owner's desktop. See [Computers](computers.md) and [development](development.md) for isolation and deployment gates. Durable operator activity is separate from chat and private session context; its own migration/API is integrated alongside this feature.

The rollout passed 307 TypeScript tests, 11 guest Python tests, 25 focused browser checks, typechecks/build, feature CI, and isolated production migrations/API and real X11/GTK screenshot/Unicode/cancellation checks. After an idle-run preflight and protected app-data backup, the three guest helpers were installed in-place through `docker exec`/tar (Docker cp cannot see this Sysbox guest's `/opt/swarm` mount view). Only backend/frontend/controller containers were recreated; the owner's desktop container, image ID, start time, volumes and running session were unchanged. Future computers use the tested helper-overlay image under the existing H.265 tag. Live read-only capture returned 634×356 from 1920×1080 with no input sent; HTTP19090 and certificate-validated HTTPS19091 remained loopback/Tailnet TCP-only. Existing agent/message/computer/private-session counts were preserved. No real-model desktop action or live desktop input was performed for validation.
