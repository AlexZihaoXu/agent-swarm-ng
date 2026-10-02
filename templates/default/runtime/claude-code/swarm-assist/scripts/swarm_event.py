"""Swarm assist hook: turns a Claude Code hook event into one compact line for the swarm agent's listener.

Runs in the background (async) for Stop, StopFailure, PermissionRequest (observed only, never answered), a few
Notification types, SessionStart and SessionEnd. It never prints a decision, so Claude Code behaves as without it.
"""
import json
import sys

from swarm_claude import append, clip

NOTIFICATIONS = {'idle_prompt': 'idle', 'elicitation_dialog': 'question', 'elicitation_url_dialog': 'question',
                 'agent_needs_input': 'question'}


def describe_tool(name, data) -> str:
    data = data if isinstance(data, dict) else {}
    detail = data.get('command') or data.get('file_path') or data.get('url') or data.get('pattern') or ''
    return f'{name}: {detail}' if detail else str(name or 'a tool')


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    kind = data.get('hook_event_name')
    if kind == 'Stop':
        event, text = 'finished', data.get('last_assistant_message') or ''
    elif kind == 'StopFailure':
        event, text = 'failure', data.get('error') or data.get('error_type') or data.get('reason') or 'API error'
    elif kind == 'PermissionRequest':
        event, text = 'permission', describe_tool(data.get('tool_name'), data.get('tool_input'))
    elif kind == 'Notification':
        event = NOTIFICATIONS.get(data.get('notification_type'))
        text = data.get('message') or ''
        if not event:
            return
    elif kind == 'SessionStart':
        event, text = 'session_start', data.get('source') or ''
    elif kind == 'SessionEnd':
        event, text = 'session_end', data.get('reason') or ''
    else:
        return
    append(event, clip(text), data.get('session_id', ''), data.get('cwd', ''))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # A hook must never disturb Claude Code.
        pass
