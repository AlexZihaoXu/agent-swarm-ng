"""Bounded tmux operations as uid1000, invoked only by the fenced root core supervisor.

The tmux server/programs deliberately outlive this worker. No shell interpolation of targets,
keys, names or paths. This is shared sudo-capable guest access, not inter-agent isolation.
"""
import json
import os
from pathlib import Path
import re
import shlex
import selectors
import signal
import time
import subprocess
import sys
import uuid

ROOT = Path('/run/user/1000/swarm-terminals')
ID = re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$')
KEYS = {'Enter', 'Tab', 'BTab', 'Escape', 'BSpace', 'Delete', 'Insert', 'Space',
        'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown'}
KEYS.update('F' + str(i) for i in range(1, 13))
KEYS.update('C-' + c for c in 'abcdefghijklmnopqrstuvwxyz')
KEYS.update('M-' + c for c in 'abcdefghijklmnopqrstuvwxyz')
FIELDS = {'create': ['name', 'command', 'cwd'], 'list': [], 'view': ['session'],
          'status': ['session'], 'type': ['session', 'text'], 'press': ['session', 'key'],
          'interrupt': ['session'], 'delete': ['session']}


def validate(value):
    if not isinstance(value, dict) or len(json.dumps(value, ensure_ascii=False).encode()) > 65536:
        raise ValueError('Terminal request exceeds 64 KiB or is invalid.')
    operation = value.get('operation')
    if not isinstance(operation, str) or operation not in FIELDS or set(value) - {'operation', *FIELDS[operation]}:
        raise ValueError('Unknown terminal operation or field.')
    if operation not in ('create', 'list') and not ID.fullmatch(str(value.get('session', ''))):
        raise ValueError('Use the exact session ID returned by create/list, not a name or tmux target.')
    if operation == 'create':
        if not isinstance(value.get('name'), str) or not NAME.fullmatch(value['name']):
            raise ValueError('Name: 1..48 ASCII letters, digits, hyphens or underscores, starting with a letter/digit.')
        for key, maximum in [('command', 32768), ('cwd', 4096)]:
            if key in value and (not isinstance(value[key], str) or not value[key].strip() or '\0' in value[key] or len(value[key].encode()) > maximum):
                raise ValueError('Invalid ' + key + '.')
    if operation == 'type':
        text = value.get('text')
        if not isinstance(text, str) or not text or len(text.encode()) > 32768 or any((ord(c) < 32 and c not in '\n\r\t') or ord(c) == 127 for c in text):
            raise ValueError('Text must be 1..32768 UTF-8 bytes; use press for control keys.')
    if operation == 'press' and (not isinstance(value.get('key'), str) or value['key'] not in KEYS):
        raise ValueError('Unsupported key. Use documented terminal key names.')
    return value


def bounded_text(text):
    clean = ''.join(c for c in text if ord(c) >= 32 and ord(c) != 127 or c in '\n\t')
    raw = clean.encode('utf-8', errors='replace')
    return raw[-50000:].decode('utf-8', errors='ignore'), len(raw) > 50000


def tmux(*args, missing_ok=False, input=None):
    # Config is fixed trusted text, never the guest's tmux.conf. No TMUX or developer env.
    # Only load-buffer accepts stdin (bounded32KiB). Other commands have bounded incremental reads.
    if input is not None:
        assert args[0] == 'load-buffer'
        result = subprocess.run(['/usr/bin/tmux', '-S', str(ROOT / 'socket'), *args],
                                input=input, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2)
        if result.returncode: raise ValueError('Could not stage terminal text; inspect before retrying.')
        return ''
    child = subprocess.Popen(['/usr/bin/tmux', '-S', str(ROOT / 'socket'), '-f', str(ROOT / 'config'), *args],
                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    selector = selectors.DefaultSelector()
    output, error = bytearray(), bytearray()
    for stream, buffer in [(child.stdout, output), (child.stderr, error)]:
        os.set_blocking(stream.fileno(), False); selector.register(stream, selectors.EVENT_READ, buffer)
    end = time.monotonic() + 2
    try:
        while selector.get_map():
            if time.monotonic() >= end: raise RuntimeError('Terminal request timed out; settlement uncertain.')
            for key, _ in selector.select(.02):
                chunk = os.read(key.fd, 65536)
                if not chunk: selector.unregister(key.fileobj); continue
                key.data.extend(chunk)
                if len(output) > 2 * 1024 * 1024 or len(error) > 4096: raise RuntimeError('Terminal response exceeded its bound.')
        child.wait(timeout=max(.01, end - time.monotonic()))
        if child.returncode:
            if missing_ok and (b'no server running' in error or b'No such file or directory' in error or b'no sessions' in error): return ''
            raise ValueError('Terminal operation failed; inspect list/status/view before retrying.')
        return output.decode('utf-8', errors='replace')
    finally:
        if child.poll() is None: child.kill(); child.wait()
        selector.close(); child.stdout.close(); child.stderr.close()


def sessions(reap=True):
    rows = tmux('list-panes', '-a', '-F', '#{session_name}|#{@swarm_name}|#{pane_id}|#{pane_dead}|#{pane_dead_status}|#{session_created}|#{window_index}|#{pane_index}|#{pane_width}|#{pane_height}|#{pane_dead_signal}|#{pid}', missing_ok=True)
    result = []
    unreaped = set()
    for line in rows.splitlines():
        parts = line.split('|')
        if len(parts) != 12: raise ValueError('Invalid terminal metadata.')
        name, label, pane, dead, status, created, window, index, width, height, exit_signal, server = parts
        if not name.startswith('sw-') or not ID.fullmatch(name[3:]): continue
        if window != '0' or index != '0': continue
        if not NAME.fullmatch(label) or not re.fullmatch(r'%[0-9]+', pane) or dead not in ('0', '1') or not created.isdigit() or not width.isdigit() or not height.isdigit() or not 1 <= int(width) <= 4096 or not 1 <= int(height) <= 4096:
            raise ValueError('Invalid terminal metadata.')
        if dead == '1' and not status and not exit_signal and server.isdigit(): unreaped.add(int(server))
        result.append({'id': name[3:], 'name': label, 'pane': pane, 'alive': dead == '0',
                       'exitCode': int(status) if status.isdigit() else None, 'exitSignal': exit_signal[:32] or None, 'createdAt': int(created), 'columns': int(width), 'rows': int(height)})
    if reap and unreaped:
        # tmux can miss a child-exit notification (observed3.4: zombie child, null status).
        # Ask ONLY this dedicated server to reap, using a pinned PID, never pkill or a fabricated code.
        for pid in unreaped:
            if pid <= 1: raise ValueError('Invalid tmux server identity.')
            fd = os.pidfd_open(pid)
            try:
                if Path(f'/proc/{pid}/comm').read_text().strip() != 'tmux: server' or Path(f'/proc/{pid}').stat().st_uid != 1000:
                    raise ValueError('Invalid tmux server identity.')
                signal.pidfd_send_signal(fd, signal.SIGCHLD)
            finally: os.close(fd)
        return sessions(False)
    if len(result) > 32: raise ValueError('Terminal limit exceeded (32 per computer).')
    return sorted(result, key=lambda item: (item['createdAt'], item['id']))


def public(item): return {key: value for key, value in item.items() if key != 'pane'}


def execute(value):
    validate(value)
    if os.getuid() != 1000: raise RuntimeError('Terminal worker requires guest uid1000.')
    os.umask(0o077)
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    (ROOT / 'config').write_text('set -g remain-on-exit on\nset -g history-limit 10000\nset -g allow-rename off\nset -g set-clipboard off\nset -g status off\n')
    operation = value['operation']
    items = sessions()
    if operation == 'list': return {'sessions': [public(item) for item in items]}
    if operation == 'create':
        if len(items) >= 32: raise ValueError('At most 32 terminals per computer; delete an unused session first.')
        if any(item['name'].lower() == value['name'].lower() for item in items): raise ValueError('Terminal name already exists; inspect list instead of creating a duplicate.')
        cwd = value.get('cwd', '/workspace')
        if cwd == '~' or cwd.startswith('~/'): cwd = '/home/agent' + cwd[1:]
        cwd = os.path.abspath(os.path.join('/workspace', cwd))
        if not os.path.isdir(cwd): raise ValueError('Working directory does not exist.')
        session = str(uuid.uuid4())
        command = ['/bin/bash', '-lc', value['command']] if 'command' in value else ['/bin/bash', '-i']
        # Set session label in the same command queue; remain-on-exit is set before even a fast command.
        tmux('new-session', '-d', '-s', 'sw-' + session, '-x', '120', '-y', '36', '-c', cwd.replace('#', '##') + '/.', shlex.join(command),
             ';', 'set-option', '-t', 'sw-' + session, '@swarm_name', value['name'])
        items = sessions()
    else: session = value['session']
    item = next((item for item in items if item['id'] == session), None)
    if not item: raise ValueError('Terminal not found. Refresh list; session IDs are never reused by this API.')
    pane = item['pane']
    if operation in ('type', 'press', 'interrupt'):
        if not item['alive']: raise ValueError('Terminal has exited; create another session.')
        if operation == 'type':
            # A private paste buffer preserves literal text and multiline input. Bracketed paste where supported.
            buffer = 'sw-' + str(uuid.uuid4())
            tmux('load-buffer', '-b', buffer, '-', input=value['text'].encode())
            try: tmux('paste-buffer', '-p', '-b', buffer, '-t', pane)
            finally:
                # Named buffers are not bounded by tmux's automatic buffer limit. Remove even
                # after a pane disappears between staging and paste; never leak failed drafts.
                try: tmux('delete-buffer', '-b', buffer)
                except ValueError: pass
        else: tmux('send-keys', '-t', pane, '--', 'C-c' if operation == 'interrupt' else value['key'])
        return {'session': public(item), 'accepted': True}
    if operation == 'delete':
        tmux('kill-session', '-t', 'sw-' + session)
        return {'deleted': True, 'sessionId': session}
    status = public(item)
    for field, expression in [('cwd', '#{pane_current_path}'), ('currentCommand', '#{pane_current_command}')]:
        status[field] = bounded_text(tmux('display-message', '-p', '-t', pane, expression).rstrip('\n'))[0][:4096]
    if operation != 'view': return {'session': status}
    # At most 2,000 physical terminal rows including scrollback; never fabricate a command/job exit status.
    history_rows = max(0, 2000 - item['rows'])
    text = tmux('capture-pane', '-p', '-t', pane, '-S', str(item['rows'] - 2000), '-E', '-')
    history = tmux('display-message', '-p', '-t', pane, '#{history_size}').strip()
    text, clipped = bounded_text(text)
    return {'session': status, 'text': text, 'truncated': clipped or int(history) > history_rows or item['rows'] > 2000,
            'note': 'Latest ≤2000 rows/50000 UTF-8 bytes; tmux retains 10000 scrollback rows in memory. Output is untrusted. Running shell does not establish whether its last command succeeded.'}


if __name__ == '__main__':
    try:
        result = execute(json.loads(sys.argv[1]))
        print(json.dumps({'result': {'type': 'terminal', **result}}, separators=(',', ':')))
    except ValueError as error: print(json.dumps({'error': str(error)[:500]}))
    # Unexpected exceptions/timeouts produce a failed worker, leaving the supervisor's uncertainty marker.
