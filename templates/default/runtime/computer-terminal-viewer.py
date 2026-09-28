"""Human-only fixed-size PTY attachment. Closing this bridge detaches, never kills a session.

stdin/stdout carry bounded JSON lines over a label-checked Docker exec. No caller commands,
resize API, host paths or guest listener. A lease also bounds orphaned transports.
"""
import base64
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import pty
import selectors
import signal
import struct
import sys
import termios
import time

COLS, ROWS = 120, 36
MAX_INPUT = 4096


def input_bytes(value):
    if not isinstance(value, dict): raise ValueError('Invalid terminal frame.')
    if value == {'type': 'ping'}: return b''
    if set(value) != {'type', 'data'} or value['type'] != 'input' or not isinstance(value['data'], str) or not 0 < len(value['data']) <= 5464:
        raise ValueError('Invalid terminal frame.')
    try: data = base64.b64decode(value['data'], validate=True)
    except Exception: raise ValueError('Invalid terminal input.')
    if not 0 < len(data) <= MAX_INPUT: raise ValueError('Terminal input too large.')
    return data


def send(value):
    data = (json.dumps(value, separators=(',', ':')) + '\n').encode()
    # Pipe backpressure cannot keep an orphan attachment alive forever.
    end = time.monotonic() + 2
    while data:
        try: written = os.write(1, data); data = data[written:]
        except BlockingIOError:
            if time.monotonic() > end: raise RuntimeError('Slow terminal observer.')
            time.sleep(.01)


def main(session):
    if os.getuid() != 1000: raise ValueError('Viewer requires guest uid1000.')
    spec = importlib.util.spec_from_file_location('terminal', Path(__file__).with_name('computer-terminal.py'))
    terminal = importlib.util.module_from_spec(spec); spec.loader.exec_module(terminal)
    terminal.validate({'operation': 'status', 'session': session})
    item = next((row for row in terminal.sessions() if row['id'] == session), None)
    if not item: raise ValueError('Terminal not found.')
    pane = item['pane']
    # Existing sessions get the same invariant as newly-created sessions. Never follow client size.
    terminal.tmux('set-window-option', '-t', pane, 'window-size', 'manual')
    if item['columns'] != COLS or item['rows'] != ROWS:
        terminal.tmux('resize-window', '-t', pane, '-x', str(COLS), '-y', str(ROWS))
    # This browser is a terminal, not a tmux command console. Ctrl+B and every other delivered
    # key go to the application, not tmux's prefix table. Applies only to this managed session.
    terminal.tmux('set-option', '-t', 'sw-' + session, 'prefix', 'None', ';', 'set-option', '-t', 'sw-' + session, 'prefix2', 'None')
    pid, master = pty.fork()
    if pid == 0:
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
        env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/home/agent', 'USER': 'agent', 'LOGNAME': 'agent', 'LANG': 'C.UTF-8', 'TERM': 'xterm-256color', 'SHELL': '/bin/bash'}
        os.execve('/usr/bin/tmux', ['tmux', '-u', '-S', str(terminal.ROOT / 'socket'), 'attach-session', '-f', 'ignore-size', '-t', 'sw-' + session], env)
    os.set_blocking(master, False); os.set_blocking(0, False); os.set_blocking(1, False)
    selector = selectors.DefaultSelector(); selector.register(0, selectors.EVENT_READ); selector.register(master, selectors.EVENT_READ)
    pending, incoming = bytearray(), bytearray()
    lease = time.monotonic() + 20
    stopping = False
    def stop(_sig, _frame):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, stop)
    try:
        send({'type': 'ready', 'columns': COLS, 'rows': ROWS})
        while not stopping and time.monotonic() < lease:
            for key, mask in selector.select(.25):
                if key.fd == 0:
                    raw = os.read(0, 16384)
                    if not raw: return
                    incoming.extend(raw)
                    if len(incoming) > 32768: raise ValueError('Input queue exceeded its bound.')
                    while b'\n' in incoming:
                        line, _, rest = incoming.partition(b'\n'); incoming = bytearray(rest)
                        pending.extend(input_bytes(json.loads(line)))
                        if len(pending) > 65536: raise ValueError('Slow terminal input.')
                        lease = time.monotonic() + 20
                    selector.modify(master, selectors.EVENT_READ | (selectors.EVENT_WRITE if pending else 0))
                else:
                    if mask & selectors.EVENT_READ:
                        try: raw = os.read(master, 8192)
                        except OSError: return  # PTY EOF when the tmux attachment exits
                        if not raw: return
                        send({'type': 'output', 'data': base64.b64encode(raw).decode('ascii')})
                    if mask & selectors.EVENT_WRITE and pending:
                        try: written = os.write(master, pending); del pending[:written]
                        except BlockingIOError: pass
                        if not pending: selector.modify(master, selectors.EVENT_READ)
    finally:
        selector.close(); os.close(master)
        # pid is our unreaped direct child, never an arbitrary guest process or tmux server.
        try: os.kill(pid, signal.SIGTERM)
        except ProcessLookupError: pass
        end = time.monotonic() + 2
        while time.monotonic() < end:
            if os.waitpid(pid, os.WNOHANG)[0]: break
            time.sleep(.02)
        else:
            os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)


if __name__ == '__main__':
    try: main(sys.argv[1])
    except Exception:
        try: send({'type': 'error', 'message': 'Terminal connection ended. Inspect before repeating input.'})
        except Exception: pass
