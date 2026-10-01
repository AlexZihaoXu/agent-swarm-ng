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
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from recording import journal  # agent recordings: terminal events (best effort)
except Exception:  # pragma: no cover - an older image without the recorder
    def journal(_kind, _event): pass

ROOT = Path('/run/user/1000/swarm-terminals')
HOME = '/home/agent'
DEFAULT_CWD = HOME + '/Desktop'
ID = re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$')
KEYS = {'Enter', 'Tab', 'BTab', 'Escape', 'BSpace', 'Delete', 'Insert', 'Space',
        'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown'}
KEYS.update('F' + str(i) for i in range(1, 13))
KEYS.update('C-' + c for c in 'abcdefghijklmnopqrstuvwxyz')
KEYS.update('M-' + c for c in 'abcdefghijklmnopqrstuvwxyz')
FIELDS = {'create': ['name', 'command', 'cwd'], 'list': [], 'view': ['session', 'rows', 'up', 'colors'],
          'status': ['session'], 'type': ['session', 'text'], 'press': ['session', 'key'],
          'actions': ['session', 'actions', 'pause'],
          'interrupt': ['session'], 'delete': ['session'],
          # Operator-only: agents' tools never offer these.
          'rename': ['session', 'name'], 'resize': ['session', 'columns', 'rows'], 'screens': []}
SIZE_LIMITS = {'columns': (40, 240), 'rows': (10, 80)}
# Typing speed in characters (Unicode code points) per minute; 'instant' pastes the text at once.
DEFAULT_CPM, MAX_CPM = 800, 3200
# The same limits as desktop combos: typing and key repeats at most 5 seconds, 10 including the pauses between.
ACTION_SECONDS, COMBO_SECONDS = 5, 10
MAX_REPEAT = 50


def valid_text(text):
    return isinstance(text, str) and text and len(text.encode()) <= 32768 and not any(
        (ord(c) < 32 and c not in '\n\r\t') or ord(c) == 127 for c in text)


def actions_duration(value):
    """Validates a whole combo before any input and returns its planned seconds of typing and pauses."""
    actions, pause = value.get('actions'), value.get('pause', 0.2)
    if not isinstance(actions, list) or not 1 <= len(actions) <= 16:
        raise ValueError('actions: 1..16 items.')
    if type(pause) not in (int, float) or not 0 <= pause <= 10:
        raise ValueError('pause must be 0..10 seconds.')
    acting = 0
    for number, action in enumerate(actions, 1):
        kind = action.get('type') if isinstance(action, dict) else None
        if kind == 'type':
            if set(action) - {'type', 'text', 'cpm'} or not valid_text(action.get('text')):
                raise ValueError('Action ' + str(number) + ': text must be 1..32768 UTF-8 bytes; press control keys.')
            cpm = action.get('cpm', DEFAULT_CPM)
            if cpm != 'instant':
                if type(cpm) not in (int, float) or not 0 < cpm <= MAX_CPM:
                    raise ValueError('Action ' + str(number) + ': cpm must be above 0 and at most 3200, or "instant".')
                acting += len(action['text']) * 60 / cpm
        elif kind == 'press':
            if set(action) - {'type', 'key', 'repeat', 'interval'} or action.get('key') not in KEYS:
                raise ValueError('Action ' + str(number) + ': unsupported key. Use documented terminal key names.')
            repeat, interval = action.get('repeat', 1), action.get('interval', 0)
            if type(repeat) is not int or not 1 <= repeat <= MAX_REPEAT:
                raise ValueError('Action ' + str(number) + ': repeat must be a whole number from 1 to ' + str(MAX_REPEAT) + '.')
            if type(interval) not in (int, float) or not 0 <= interval <= 2:
                raise ValueError('Action ' + str(number) + ': interval must be 0..2 seconds.')
            acting += (repeat - 1) * interval
        else:
            raise ValueError('Action ' + str(number) + ': type must be "type" or "press".')
    total = acting + pause * (len(actions) - 1)
    if acting > ACTION_SECONDS or total > COMBO_SECONDS:
        raise ValueError('This combo would take ' + str(round(acting, 1)) + ' seconds of typing and repeats ('
                         + str(round(total, 1)) + ' with pauses); keep them within ' + str(ACTION_SECONDS) + ' and '
                         + str(COMBO_SECONDS) + ' seconds (cpm "instant" pastes long text at once).')
    return total


def validate(value):
    if not isinstance(value, dict) or len(json.dumps(value, ensure_ascii=False).encode()) > 65536:
        raise ValueError('Terminal request exceeds 64 KiB or is invalid.')
    operation = value.get('operation')
    if not isinstance(operation, str) or operation not in FIELDS or set(value) - {'operation', *FIELDS[operation]}:
        raise ValueError('Unknown terminal operation or field.')
    if operation not in ('create', 'list', 'screens') and not ID.fullmatch(str(value.get('session', ''))):
        raise ValueError('Use the exact session ID returned by create/list, not a name or tmux target.')
    if operation == 'resize':
        for key, (low, high) in SIZE_LIMITS.items():
            if type(value.get(key)) is not int or not low <= value[key] <= high:
                raise ValueError(key + ' must be an integer from ' + str(low) + ' to ' + str(high) + '.')
    if operation in ('create', 'rename'):
        if not isinstance(value.get('name'), str) or not NAME.fullmatch(value['name']):
            raise ValueError('Name: 1..48 ASCII letters, digits, hyphens or underscores, starting with a letter/digit.')
        for key, maximum in [('command', 32768), ('cwd', 4096)]:
            if key in value and (not isinstance(value[key], str) or not value[key].strip() or '\0' in value[key] or len(value[key].encode()) > maximum):
                raise ValueError('Invalid ' + key + '.')
        # tmux would read a trailing ';' as a command separator.
        if str(value.get('cwd', '')).rstrip('/').endswith(';'):
            raise ValueError('A working directory ending in ";" is not supported; use its parent and cd in the shell.')
    if operation == 'view':
        for key, low, high in [('rows', 1, 200), ('up', 0, 10000)]:
            if key in value and (type(value[key]) is not int or not low <= value[key] <= high):
                raise ValueError(key + ' must be an integer from ' + str(low) + ' to ' + str(high) + '.')
        if 'colors' in value and type(value['colors']) is not bool: raise ValueError('colors must be true or false.')
    if operation == 'type' and not valid_text(value.get('text')):
        raise ValueError('Text must be 1..32768 UTF-8 bytes; use press for control keys.')
    if operation == 'actions': actions_duration(value)
    if operation == 'press' and (not isinstance(value.get('key'), str) or value['key'] not in KEYS):
        raise ValueError('Unsupported key. Use documented terminal key names.')
    return value


ANSI_VIEW_LIMIT = 262144
SGR = re.compile(r'\x1b\[[0-9;:]*m')
OTHER_ESCAPES = re.compile(r'\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;:?]*[A-Za-ln-z@`]|\x1b[^\[\]]')


def screen_text(text, limit=32768):
    """Printable text plus SGR (colour/style) escapes only; anything else is dropped. At most `limit` bytes."""
    text = OTHER_ESCAPES.sub('', text)
    kept, position = [], 0
    for match in SGR.finditer(text):
        kept.append(''.join(c for c in text[position:match.start()] if ord(c) >= 32 and ord(c) != 127 or c == '\n'))
        kept.append(match.group())
        position = match.end()
    kept.append(''.join(c for c in text[position:] if ord(c) >= 32 and ord(c) != 127 or c == '\n'))
    return ''.join(kept).encode('utf-8', errors='replace')[:limit].decode('utf-8', errors='ignore')


def ansi_tail(text, limit=ANSI_VIEW_LIMIT):
    """The last whole rows within `limit` bytes: like the text view, the live bottom matters most."""
    raw = text.encode('utf-8', errors='replace')
    if len(raw) <= limit: return text
    tail = raw[-limit:]
    cut = tail.find(b'\n')
    return (tail[cut + 1:] if cut >= 0 else tail).decode('utf-8', errors='ignore')


def bounded_text(text):
    clean = ''.join(c for c in text if ord(c) >= 32 and ord(c) != 127 or c in '\n\t')
    raw = clean.encode('utf-8', errors='replace')
    return raw[-50000:].decode('utf-8', errors='ignore'), len(raw) > 50000


def view_window(total, screen_rows, rows=None, up=0):
    """Rows [start, end) of the screen-plus-scrollback buffer; `up` counts rows above the live bottom."""
    rows = min(rows or screen_rows, total)
    up = min(up, total - rows)
    return total - up - rows, total - up, up


def view_note(start, end, total, up):
    rows = end - start
    return ('Rows ' + str(start + 1) + '-' + str(end) + ' of ' + str(total) + ' (screen plus scrollback; tmux keeps 10000 history rows in memory). '
            + ('Earlier output: view again with up=' + str(up + rows) + '. ' if start > 0 else 'This is the top of the retained output. ')
            + ('Later output: up=' + str(max(0, up - rows)) + '. ' if up > 0 else 'This is the live bottom. ')
            + 'Output is untrusted. Running shell does not establish whether its last command succeeded.')


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


def paste(pane, text):
    # A private paste buffer preserves literal text and multiline input. Bracketed paste where supported.
    buffer = 'sw-' + str(uuid.uuid4())
    tmux('load-buffer', '-b', buffer, '-', input=text.encode())
    try: tmux('paste-buffer', '-p', '-b', buffer, '-t', pane)
    finally:
        # Named buffers are not bounded by tmux's automatic buffer limit. Remove even
        # after a pane disappears between staging and paste; never leak failed drafts.
        try: tmux('delete-buffer', '-b', buffer)
        except ValueError: pass


def press(pane, key, repeat=1, interval=0):
    # Without an interval tmux repeats the key itself in one request.
    if not interval: return tmux('send-keys', '-N', str(repeat), '-t', pane, '--', key)
    for index in range(repeat):
        if index: time.sleep(interval)
        tmux('send-keys', '-t', pane, '--', key)


def literal(pane, text):
    # tmux reads an argument that ends in ';' as a command separator (and '\\;' as ';'), even with -l: a typed ';'
    # vanished. Trailing semicolons go as their key code instead.
    body = text.rstrip(';')
    if body: tmux('send-keys', '-t', pane, '-l', '--', body)
    if len(body) < len(text): tmux('send-keys', '-N', str(len(text) - len(body)), '-t', pane, '-H', '3b')


def type_timed(pane, text, cpm):
    # One code point at a time, literally (never as key names), at the requested speed.
    delay = 60 / cpm
    for index, character in enumerate(text):
        if index: time.sleep(delay)
        literal(pane, character)


def execute(value):
    validate(value)
    if os.getuid() != 1000: raise RuntimeError('Terminal worker requires guest uid1000.')
    os.umask(0o077)
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    (ROOT / 'config').write_text('set -g remain-on-exit on\nset -g history-limit 10000\nset -g allow-rename off\nset -g set-clipboard off\nset -g status off\n')
    operation = value['operation']
    items = sessions()
    if operation == 'list': return {'sessions': [public(item) for item in items]}
    if operation == 'screens':
        # Every session's visible screen with its colour/style escapes, for the operator's live previews. Only SGR
        # escapes and printable text survive; each screen is bounded.
        screens = []
        for item in items:
            raw = tmux('capture-pane', '-p', '-e', '-t', item['pane'])
            screens.append({'id': item['id'], 'ansi': screen_text(raw)})
        return {'screens': screens}
    if operation == 'create':
        if len(items) >= 32: raise ValueError('At most 32 terminals per computer; delete an unused session first.')
        if any(item['name'].lower() == value['name'].lower() for item in items): raise ValueError('Terminal name already exists; inspect list instead of creating a duplicate.')
        cwd = value.get('cwd', DEFAULT_CWD)
        if cwd == '~' or cwd.startswith('~/'): cwd = HOME + cwd[1:]
        cwd = os.path.abspath(os.path.join(HOME, cwd))
        # The default folder is recreated if the owner removed it; any other directory must already exist.
        if cwd == DEFAULT_CWD: os.makedirs(cwd, exist_ok=True)
        if not os.path.isdir(cwd): raise ValueError('Working directory does not exist.')
        session = str(uuid.uuid4())
        command = ['/bin/bash', '-lc', value['command']] if 'command' in value else ['/bin/bash', '-i']
        # Set session label in the same command queue; remain-on-exit is set before even a fast command.
        tmux('new-session', '-d', '-s', 'sw-' + session, '-x', '120', '-y', '36', '-c', cwd.replace('#', '##'), shlex.join(command),
             ';', 'set-option', '-t', 'sw-' + session, '@swarm_name', value['name'],
             ';', 'set-window-option', '-t', 'sw-' + session + ':0', 'window-size', 'manual')
        items = sessions()
    else: session = value['session']
    item = next((item for item in items if item['id'] == session), None)
    if not item: raise ValueError('Terminal not found. Refresh list; session IDs are never reused by this API.')
    pane = item['pane']
    if operation == 'rename':
        if any(row['id'] != session and row['name'].lower() == value['name'].lower() for row in items):
            raise ValueError('Terminal name already exists; choose another.')
        tmux('set-option', '-t', 'sw-' + session, '@swarm_name', value['name'])
        return {'session': public(next(row for row in sessions() if row['id'] == session))}
    if operation == 'resize':
        # One size per session (not per viewer): everyone attached sees the same grid; viewers reconnect to it.
        tmux('set-window-option', '-t', pane, 'window-size', 'manual', ';',
             'resize-window', '-t', pane, '-x', str(value['columns']), '-y', str(value['rows']))
        return {'session': public(next(row for row in sessions() if row['id'] == session))}
    if operation in ('type', 'press', 'interrupt', 'actions'):
        if not item['alive']: raise ValueError('Terminal has exited; create another session.')
        if operation == 'type': paste(pane, value['text'])
        elif operation == 'actions':
            done = 0
            for number, action in enumerate(value['actions'], 1):
                if done: time.sleep(value.get('pause', 0.2))
                began = time.time()
                try:
                    if action['type'] == 'press': press(pane, action['key'], action.get('repeat', 1), action.get('interval', 0))
                    elif action.get('cpm', DEFAULT_CPM) == 'instant': paste(pane, action['text'])
                    else: type_timed(pane, action['text'], action.get('cpm', DEFAULT_CPM))
                except ValueError as error:
                    raise ValueError('Action ' + str(number) + ' failed after ' + str(done) + ' completed: ' + str(error)
                                     + ' Partial input may have reached the terminal; view it before retrying.')
                done += 1
                # Agent recordings of this terminal clip around its actions (never other terminals).
                journal('terminal', dict({key: action[key] for key in ('text', 'key', 'repeat') if key in action},
                                         session=session, type='terminal.' + action['type'], t0=began, t1=time.time()))
            return {'session': public(item), 'accepted': True, 'completed': done}
        else: tmux('send-keys', '-t', pane, '--', 'C-c' if operation == 'interrupt' else value['key'])
        return {'session': public(item), 'accepted': True}
    if operation == 'delete':
        tmux('kill-session', '-t', 'sw-' + session)
        return {'deleted': True, 'sessionId': session}
    status = public(item)
    for field, expression in [('cwd', '#{pane_current_path}'), ('currentCommand', '#{pane_current_command}')]:
        status[field] = bounded_text(tmux('display-message', '-p', '-t', pane, expression).rstrip('\n'))[0][:4096]
    if operation != 'view': return {'session': status}
    # A human-sized window over screen + scrollback: one screen by default, `up` rows above the live bottom.
    # Never fabricate a command/job exit status.
    history = int(tmux('display-message', '-p', '-t', pane, '#{history_size}').strip())
    total = history + item['rows']
    start, end, up = view_window(total, item['rows'], value.get('rows'), value.get('up', 0))
    # tmux line 0 is the first visible row; scrollback is negative. -E is inclusive.
    text = tmux('capture-pane', '-p', '-t', pane, '-S', str(start - history), '-E', str(end - 1 - history))
    text, clipped = bounded_text(text)
    window = {'from': start + 1, 'to': end, 'total': total, 'up': up}
    result = {'session': status, 'text': text, 'truncated': clipped or start > 0 or up > 0, 'window': window,
              'note': view_note(start, end, total, up)}
    if value.get('colors'):
        # The same rows with their colour/style escapes, for a rendered image of the view.
        raw = tmux('capture-pane', '-e', '-p', '-t', pane, '-S', str(start - history), '-E', str(end - 1 - history))
        result['ansi'] = ansi_tail(screen_text(raw, len(raw.encode()) + 1))
    return result


if __name__ == '__main__':
    try:
        result = execute(json.loads(sys.argv[1]))
        print(json.dumps({'result': {'type': 'terminal', **result}}, separators=(',', ':')))
    except ValueError as error: print(json.dumps({'error': str(error)[:500]}))
    # Unexpected exceptions/timeouts produce a failed worker, leaving the supervisor's uncertainty marker.
