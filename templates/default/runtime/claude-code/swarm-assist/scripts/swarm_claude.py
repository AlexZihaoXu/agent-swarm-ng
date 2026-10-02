"""Swarm assist: shared pieces of the Claude Code plugin (hook, notify_supervisor) and the swarm's follower.

Claude Code events become one compact JSON line each in an events file inside the computer. The swarm agent's
listener follows that file (claude_follow.py, run by the platform); followers record which terminals they cover, so
notify_supervisor can tell Claude Code when nobody is listening. Everything stays inside the computer: it cannot reach
the platform over the network.
"""
import fcntl
import json
import os
import subprocess
import time
from pathlib import Path

SUMMARY_MAX = 300
ROTATE_BYTES = 2 * 1024 * 1024


def base() -> Path:
    runtime = Path(f'/run/user/{os.getuid()}')
    # SWARM_CLAUDE_DIR is for tests only.
    root = Path(os.environ['SWARM_CLAUDE_DIR']) if os.environ.get('SWARM_CLAUDE_DIR') else (
        runtime / 'swarm-claude' if runtime.is_dir() and os.access(runtime, os.W_OK) else Path(f'/tmp/swarm-claude-{os.getuid()}'))
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    (root / 'followers').mkdir(mode=0o700, exist_ok=True)
    return root


def events_file() -> Path:
    return base() / 'events.jsonl'


def terminal():
    """The swarm terminal this process runs in ({id, name}), from tmux; None outside a swarm terminal."""
    pane = os.environ.get('TMUX_PANE')
    if not pane or not os.environ.get('TMUX'):
        return None
    try:
        out = subprocess.run(['tmux', 'display-message', '-p', '-t', pane, '#{session_name}|#{@swarm_name}'],
                             capture_output=True, text=True, timeout=2).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    session, _, name = out.partition('|')
    if not session.startswith('sw-'):
        return None
    return {'id': session[3:], 'name': name or session[3:]}


def clip(text, size=SUMMARY_MAX) -> str:
    flat = ' '.join(str(text or '').split())
    return flat if len(flat) <= size else flat[:size - 1] + '…'


def append(event: str, text: str = '', session: str = '', cwd: str = '', where=None) -> dict:
    """Appends one event line (locked, so concurrent hooks never interleave); rotates a large file."""
    line = {'v': 1, 't': int(time.time() * 1000), 'event': event, 'terminal': where if where is not None else terminal(),
            'session': (session or '')[:36], 'cwd': (cwd or '')[:200], 'text': clip(text)}
    path = events_file()
    with open(path, 'a', encoding='utf-8') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        if handle.tell() > ROTATE_BYTES:
            os.replace(path, path.with_suffix('.jsonl.1'))
        handle.write(json.dumps(line, ensure_ascii=False) + '\n')
        handle.flush()
    return line


def listening(terminal_id: str, event: str) -> bool:
    """Whether a live follower covers this terminal and event."""
    for entry in (base() / 'followers').glob('*.json'):
        try:
            data = json.loads(entry.read_text())
            os.kill(int(data['pid']), 0)
        except (OSError, ValueError, KeyError):
            entry.unlink(missing_ok=True)
            continue
        if terminal_id in data.get('terminals', []) and event in data.get('events', []):
            return True
    return False
