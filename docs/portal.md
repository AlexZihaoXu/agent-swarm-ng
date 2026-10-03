# Portal

Portal is the dashboard's search-and-open palette: **Ctrl+K** (**⌘K** on macOS) or the **Portal** button in the header (on a phone, the search button at the right of the slim top bar). It is a Kibo `command-dialog-2` composition (cmdk) in frosted glass.

## What it finds

Agents, chats (private chats under `#`, groups), computers and their terminals, pages (tabs including the [Dashboard](dashboard.md), creation pages, Settings with its Knowledge and [Audit log](audit-log.md) pages, each agent's settings), files and Knowledge entries, and commands. Agents come from the list the dashboard already holds; groups and computers load when Portal opens; terminals from each running computer's session list (at most 20 computers); Knowledge from `/api/knowledge` (or its search for typed text); files from `GET /api/files/find?q=`, which matches sent chat files and agents' scratchpad paths by name (10 of each, newest first, never unsent or deleted files). Ranking (`frontend/src/lib/portal-search.ts`) prefers a whole title, then a title start, a word start, text inside the title, the subtitle or keywords, then letters in order; server matches always stay listed. Without text, commands and files wait to be asked for.

## Prefixes and keys

| Prefix | Narrows to |
| --- | --- |
| `@` | agents |
| `#` | chats |
| `:` | computers and terminals |
| `/` | pages |
| `>` | commands: new agent, new group, new computer, stop a working agent |
| `?` | Knowledge |

A prefix typed first becomes a chip in the search box (Backspace on an empty search removes it); the empty Portal shows all six as chips to click. **Enter** pulls an agent chat, a terminal or a computer's desktop out as a floating window (on a phone, below 768 px, it opens the page), runs a command, or goes to anything else; **Shift+Enter** always goes to the page; **Esc** closes. The footer names what Enter does for the highlighted row.

The shortcut is ignored while a computer has the keyboard: an xterm terminal stops its key events and the desktop is an iframe, so Ctrl+K reaches the computer (Ctrl+K deletes to the end of a shell line). Anything marked `data-keys-to-computer` is treated the same way.

## Floating windows

Portal windows (`frontend/src/lib/portal-windows.ts`, `components/portal-windows.tsx`) reuse the computer viewer's floating chat and terminal windows and add a floating desktop (`components/floating-computer.tsx`): 16:9 below its title bar, the stream connected at its first size and scaled afterwards, input locked until its lock button is pressed. Every window has a red light (close) and a yellow one (minimize into the dock at the bottom of the page; its button brings the window back). Windows stay open across in-app navigation; their positions are remembered per browser in `localStorage` (the open windows themselves are not restored after a reload). A terminal deleted elsewhere, or a computer that no longer exists, closes its window.

## Motion and transparency

The palette fades and scales in from the top centre over a lightly blurred scrim; windows grow out of the row they were chosen from (or their dock button) and shrink into the dock; reduced motion keeps only fades. The glass (`.portal-glass`, `.portal-scrim` in `styles.css`) falls back to solid backgrounds when `backdrop-filter` is unsupported or the system asks for reduced transparency. Window contents (chat, terminal, desktop) stay opaque.
