"""Harness assist event writer: turns a harness's hook payload into one compact line for the swarm agent's listener.

    harness_event.py claude-code   Claude Code hook JSON on stdin (Stop, StopFailure, PermissionRequest,
                                   Notification, SessionStart, SessionEnd)
    harness_event.py codex         Codex hook JSON on stdin (Stop, PermissionRequest, SessionStart, SessionEnd)
    harness_event.py emit          {"harness", "event", "text", "session", "cwd"} on stdin (the OpenCode plugin and the
                                   Pi extension, which map their own events)

It never prints anything: a hook's stdout can be read as a decision (Codex, Claude Code), and an empty stdout means
"no decision", so the harness behaves as without it. Permission requests are observed, never answered.
"""
import json
import sys

from swarm_harness import HARNESSES, append, clip

CLAUDE_NOTIFICATIONS = {'idle_prompt': 'idle', 'elicitation_dialog': 'question', 'elicitation_url_dialog': 'question',
                        'agent_needs_input': 'question'}


def describe_tool(name, data) -> str:
    data = data if isinstance(data, dict) else {}
    detail = data.get('command') or data.get('cmd') or data.get('file_path') or data.get('path') or data.get('url') or ''
    if isinstance(detail, list):
        detail = ' '.join(map(str, detail))
    return f'{name}: {detail}' if detail else str(name or 'a tool')


def from_hook(harness: str, data: dict):
    """(event, text) for a Claude Code or Codex hook payload, or None to ignore it."""
    kind = data.get('hook_event_name')
    if kind == 'Stop':
        return 'finished', data.get('last_assistant_message') or ''
    if kind == 'StopFailure':
        return 'failure', data.get('error') or data.get('error_type') or data.get('reason') or 'API error'
    if kind == 'PermissionRequest':
        return 'permission', describe_tool(data.get('tool_name'), data.get('tool_input'))
    if kind == 'Notification' and harness == 'claude-code':
        event = CLAUDE_NOTIFICATIONS.get(data.get('notification_type'))
        return (event, data.get('message') or '') if event else None
    if kind == 'SessionStart':
        return 'session_start', data.get('source') or ''
    if kind == 'SessionEnd':
        return 'session_end', data.get('reason') or ''
    return None


def main(argv):
    mode = argv[1] if len(argv) > 1 else ''
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    if mode == 'emit':
        if data.get('harness') in HARNESSES:
            append(data['harness'], data.get('event', ''), clip(data.get('text')), data.get('session', ''),
                   data.get('cwd', ''))
        return
    if mode not in ('claude-code', 'codex'):
        return
    mapped = from_hook(mode, data)
    if mapped:
        append(mode, mapped[0], clip(mapped[1]), data.get('session_id', ''), data.get('cwd', ''))


if __name__ == '__main__':
    try:
        main(sys.argv)
    except Exception:
        # A hook must never disturb its harness.
        pass
