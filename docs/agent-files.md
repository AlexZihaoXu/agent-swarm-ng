# Agent files: scratchpad, chat files and copying

Agents and the human share files in chats, agents draft artifacts in a private scratchpad, and agents copy files between the scratchpad, their assigned computers and chats. All limits are operator settings.

## Settings → Swarm

Operator-wide limits live in one `SwarmSettings` database row and are edited in **Settings → Swarm** (the last section), not in environment variables:

| Setting | Default | Range |
| --- | --- | --- |
| Computers (most that can exist at once) | 4 | 1–100 |
| Largest chat file | 100 MB | 1–1024 MB |
| Total file storage | 10 GB | 1–10000 GB |
| Largest scratch file | 1024 KB | 16–16384 KB |
| Scratch files per agent | 500 | 10–10000 |
| Scratch space per agent | 50 MB | 1–10240 MB |

`GET`/`PATCH /api/settings/swarm` read and change them (whole numbers within range; unknown keys refused). The former `COMPUTER_MAX_COUNT` environment variable is gone: the backend sends the computer limit with each create, and the controller still refuses a create past it or past its own ceiling of 100. Nothing is ever deleted automatically when a limit is lowered or reached; new files are refused instead.

## Scratchpad

Every agent has a private scratchpad of **text files and images kept in the platform database** (`ScratchFile` rows, one per path; an image keeps its PNG/JPEG/WebP/GIF bytes and type in `data`/`mime`), with or without a computer. It is for drafting, editing and presenting artifacts to the human, **not memory**, and other agents cannot see it.

- **Paths** are relative and `/`-separated, at most **3 folders deep** (`a/b/c/file.md`), with no empty, `.`, `..`, control-character or invisible-character parts (bidi controls and zero-width spaces, which could disguise a name or extension; chat file names have them stripped). Folders exist while they hold files; a file and a folder cannot share a name.
- **Tools** (every agent): `scratch_list`, `scratch_read` (paged like the computer `read`: 200 lines by default, up to 2000 lines / 50,000 bytes, `nextOffset`/`prevOffset`; an image comes back as an image through the shared image pool), `scratch_write`, `scratch_edit` (text only; 1–100 exact, unique, non-overlapping replacements, all checked first; a concurrent change is refused), `scratch_move` and `scratch_delete` (files or whole folders). Mistakes come back as tool errors for the agent to correct.
- **Limits** come from Settings → Swarm and are checked on every change (file size, file count, total bytes). Nothing is deleted automatically. Deleting an agent deletes its scratchpad.
- **Live status.** While an agent changes its scratchpad the backend broadcasts `scratch_activity` events; the chat status line (main chat and the floating chat) shows "*Agent* is writing *path* in its scratchpad…" with a short linger, below typing in priority.
- **Human view.** **Agents → agent → Scratchpad** is a read-only browser (breadcrumbs, folders and files with sizes, a paged text preview, usage against the limits), laid out like the computer File browser. It refreshes when the agent writes. Images show as pictures. `GET /api/agents/:id/scratch?folder=` (entries say `kind`: text or image), `/api/agents/:id/scratch/file?path=&offset=&limit=` and `/api/agents/:id/scratch/image?path=` back it; there is no write route: the human asks the agent.
- **Knowledge:** `concepts/scratchpad`; the system prompt carries a short Scratchpad section.
- **Presenting.** `present_scratch` posts a live preview of a text file (see below); `upload_file` from `scratch:<path>` posts a fixed copy, the way to share an image.
- **Screenshots.** `save_screenshot({to, x?, y?, size?})` saves a fresh screenshot of the computer the agent holds (whole desktop at full resolution, or a `look_at` region) as `.jpg` (as captured) or `.png`, to `scratch:<path>` or `computer:<name or ID>:<absolute path>`. It needs a current claim, grants no input allowance and puts nothing in the image pool; `upload_file` then shares it in a chat or Discord channel.

## Chat files

Private chats, groups and agent-to-agent DMs can carry files: at most **10 per message**, any type, up to the Settings → Swarm size limit.

- **Storage.** Bytes are content-addressed (SHA-256) under `.local/files/<ab>/<hash>`, written to a temporary file, synced and renamed, so identical uploads share one blob. `FileBlob` rows count toward the **total storage** budget; uploads are refused with 507 when it is full, and the Files dialog warns at 80%. The directory is part of `.local` and belongs in its backups.
- **Channels.** A `ChannelFile` row names its channel with a channel-agnostic key: `chat:<channelId>`, `dm:<agentA>:<agentB>` (sorted, the DM conversation ID) or `group:<groupId>`. Another app (for example Discord) can add its own key kind later. Access is checked on every request from the current grants: the owner agent in its private chat, DM participants (posting needs the DM connection; the human looks and deletes but never posts in agent DMs), and group members. The human sees and deletes everything.
- **Sending.** Uploading and sending are separate. `POST /api/files?channelKey=&name=` streams the raw request body (any content type, never buffered) and returns an unsent file; the message then carries `fileIds`. The send checks the IDs before saving the message (same channel, same uploader, not already sent, at most 10) and attaches them after. A message may be files only. Unsent uploads are pruned after a day (checked at startup and hourly), and startup removes temporary files of interrupted uploads before the server listens. Uploads register their bytes and blob cleanup runs one at a time, so identical concurrent uploads and deletions cannot lose each other's bytes; attaching is conditional, so two sends cannot claim the same file, and a retried send returns the saved message.
- **Deleting.** Only the uploader (an agent's own files) or the human deletes a file. The bytes go (the blob is collected once nothing refers to it); the row stays as a **tombstone** with its name, `Deleted`, who deleted it and when, and messages show it as such. A `file_deleted` event updates open views. Deleting a private chat's agent, a group or an agent deletes the files of its channels. There are no versions and no automatic expiry: to update a file, send it again.
- **Downloads.** `GET /api/files/:id/content` serves PNG, JPEG, GIF and WebP inline (the image grid), and MP4, QuickTime and WebM videos inline (played in the message with Video.js v10, `@videojs/react`, loaded only when a chat has a video; the card's name bar has a speed button that steps through the player's rates); it answers single `Range: bytes=` requests (206/416, `Accept-Ranges: bytes`, `If-Range` against the ETag) so players can seek. Videos are recognised by their container (ISO media video brands, WebM), not their name; files sent before that were reclassified by name. Everything else, and any request with `?download=1`, is an `application/octet-stream` attachment. Responses carry `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. HTML and SVG are text: previewed as source, never rendered. `GET /api/files/:id/text` pages the first MiB of a text file (`previewLimited` beyond it). `GET /api/files?channelKey=&query=&sort=&order=` lists a channel's sent files with the storage usage; `DELETE /api/files/:id` deletes one. Deleted files return 410. Content responses carry an ETag and `Cache-Control: private, no-cache`, so browsers revalidate and a deleted file is not served from their cache.
- **Agents see references.** Message envelopes and history tools list files by name, kind, size and fileId, never their contents. Agents open files themselves (below).

### Dashboard

- **Composer:** the paperclip (or drag and drop onto the box, or paste) attaches files. Each uploads immediately with progress (`XMLHttpRequest`, so progress is visible); × removes one; Send waits for uploads.
- **Messages** (Discord-style): images as a grid that opens full size; text files as a highlighted preview (lazy highlight.js) with a name and size bar, Expand, and a download link on the name; other files (and PDFs) as a card with an icon, the name as a download link and the size; deleted files as "Deleted by … · date".
- **Files dialog:** the folder icon in the header of a private chat, an agent-to-agent DM view and a group. It searches by name, sorts by name, type, size or sent date, downloads, and deletes one or several files after confirmation. The footer shows the channel's total and the swarm storage use.

## Agent file tools

Every agent has them; each call checks access when it runs.

| Tool | What it does |
| --- | --- |
| `list_files({channelId?\|peerId?, query?, limit?})` | Sent files in a chat the agent can see (private chat by default, `group:…`, `dm:…` or a peer ID). |
| `read_file({fileId, offset?, limit?, page?, view?})` | Text as pages (up to 16 MiB); images resized to at most 2048 px and 2 MiB (vision models only); PDFs as text of up to 20 pages from `page`, or `view:"image"` for one rendered page. Other types: copy to a computer. |
| `upload_file({from, channelId?\|peerId?, name?})` | An unsent copy in a chat from `scratch:<path>`, `computer:<name or ID>:<absolute path>` or `file:<fileId>`. Sent with `send_message`/`send_dm` `fileIds`. |
| `present_scratch({path, channelId?\|peerId?})` | A live preview of a scratch file (below), sent the same way. |
| `delete_file({fileId})` | Deletes one of the agent's own files. |
| `copy_file({from, to})` | Copies one file between the scratchpad and assigned computers in any direction, or from a chat file into either. |

`send_message` and `send_dm` accept `fileIds` (at most 10; text may then be empty). The private, group and agent-thread publication paths check the files before saving the message and attach them after, and the published events carry the files.

Images and PDFs are handled in the backend with `@napi-rs/canvas` (decoding and resizing) and `pdfjs-dist` (text extraction and page rendering; no eval, no XFA, no system or remote fonts). Image results are kept by reference in the capped screenshot pool, like computer screenshots, never as base64 in saved sessions.

### Live scratch previews

`present_scratch` creates a `ChannelFile` of kind `scratch` that points at the agent's scratch file (`scratchAgentId`, `scratchPath`) and has no bytes. The dashboard reads the file as it is now (`/text` and `/content` read the scratchpad), marks it **Live** and refreshes whenever the agent writes to its scratchpad. Anyone in that chat can read the file through the preview (`read_file`). If the file is later moved or deleted, the preview says it is no longer in the scratchpad. Deleting the preview works like any file.

## Copying files

`copy_file` and `upload_file` accept three kinds of location: `scratch:<path>`, `computer:<computer name or ID>:<absolute guest path>` and (source only) `file:<fileId>`.

- **Computers need only an assignment** to each computer involved, not control, and are never refused because another agent holds them. Copies do not touch the desktop or terminals. When a copy reads from or writes to a computer another agent currently holds, that holder receives a platform computer event naming the file.
- **Onto a computer:** any file, into an **existing** folder, owned by the guest user (1000:1000, mode 0644). It is written under a hidden temporary name and moved over the target only when complete, so a failed or cancelled copy never leaves a partial file (Docker writes archive files with raw host ids, which a user-namespaced guest cannot own, so the guest's root copies the finished file into one owned by the guest user); a file of the same name is replaced; a folder of that name is refused.
- **From a computer:** regular files only (no folders, links or devices), up to the Settings → Swarm file size limit. `/proc`, `/sys` and `/dev` are refused.
- **Into the scratchpad:** UTF-8 text or an image (PNG, JPEG, WebP, GIF), within the scratchpad limits. Scratch → scratch copies keep old versions side by side.

The controller streams each copy through Docker's archive API on the inspected guest container (`GET /computers/:id/export?path=&max=`, `PUT /computers/:id/import?path=&size=`): a one-file tar with a PAX name out, the first regular file of Docker's tar in, never buffered. That API runs as root inside the guest, which grants nothing new: agents already have passwordless sudo there. It never reaches the host. The `/proc`, `/sys` and `/dev` refusal checks the path text only (a guest symlink could point there), which is acceptable for the same reason. At most two copies per computer and six in all run at once.
