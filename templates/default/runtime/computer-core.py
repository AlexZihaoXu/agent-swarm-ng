"""Root supervision only; file/shell work drops to uid1000. No socket/listener or host mounts.

A root-owned generation fences delayed requests. A durable active marker makes supervisor loss
fail closed until computer restart. A private PID/mount namespace kills detached descendants when
its unprivileged worker (PID1) exits; the supervisor also drains its adopted children.
External services and deliberately privileged guest tampering are not rolled back or sandboxed.
"""
import ctypes
import fcntl
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path('/run/swarm-core-tools')
stop = False
ENVIRONMENT = {'PATH': '/home/agent/.local/bin:/usr/local/bin:/usr/bin:/bin', 'HOME': '/home/agent', 'USER': 'agent', 'LOGNAME': 'agent', 'SHELL': '/bin/bash', 'LANG': 'C.UTF-8', 'DISPLAY': ':1', 'XDG_RUNTIME_DIR': '/run/user/1000', 'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/run/user/1000/bus'}


def atomic(name, data):
    temporary = ROOT / (name + '.' + str(uuid.uuid4()))
    try:
        temporary.write_text(data); os.replace(temporary, ROOT / name)
    finally:
        temporary.unlink(missing_ok=True)


def locked(name, seconds=0):
    file = open(ROOT / name, 'a')
    end = time.monotonic() + seconds
    while True:
        try: fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB); return file
        except BlockingIOError:
            if time.monotonic() >= end:
                file.close(); raise ValueError('Another computer operation is active or has not settled.')
            time.sleep(.02)


def generation(rotate=False):
    with locked('generation.lock', 5):
        if rotate or not (ROOT / 'generation').exists(): atomic('generation', str(uuid.uuid4()))
        return (ROOT / 'generation').read_text()


def start_time(pid):
    return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]


def descendants(pid):
    rows = []
    try: children = Path(f'/proc/{pid}/task/{pid}/children').read_text().split()
    except FileNotFoundError: return rows
    for child in children:
        child = int(child)
        try: stamp = start_time(child)
        except FileNotFoundError: continue
        rows.append((child, stamp)); rows.extend(descendants(child))
    return rows


def settle(child):
    end = time.monotonic() + 5
    while time.monotonic() < end:
        child.poll()
        rows = descendants(os.getpid())
        for pid, stamp in reversed(rows):
            try:
                fd = os.pidfd_open(pid)
                try:
                    if start_time(pid) == stamp: signal.pidfd_send_signal(fd, signal.SIGKILL)
                finally: os.close(fd)
            except ProcessLookupError: pass
            except FileNotFoundError: pass
        child.poll()
        # Reap adopted double-fork/setsid descendants; never reap Popen's direct child first.
        for pid, _ in rows:
            if pid == child.pid: continue
            try: os.waitpid(pid, os.WNOHANG)
            except ChildProcessError: pass
        if not descendants(os.getpid()) and child.poll() is not None: return True
        time.sleep(.02)
    return False


def execute(value, token):
    if ctypes.CDLL(None).prctl(36, 1, 0, 0, 0) != 0: raise RuntimeError('Cannot supervise descendants.')
    with locked('operation.lock'):
        if (ROOT / 'active').exists(): raise RuntimeError('Previous supervisor settlement is unknown; restart the computer before transfer.')
        if token != generation(): return {'started': False, 'settled': True, 'error': 'Stale command authorization; claim and retry only after inspecting effects.'}
        atomic('active', json.dumps({'pid': os.getpid(), 'start': start_time(os.getpid())}))
        child = None
        try:
            child = subprocess.Popen(['/usr/bin/unshare', '--mount', '--pid', '--fork', '--mount-proc', '--kill-child=KILL', '/usr/bin/setpriv', '--reuid=1000', '--regid=1000', '--init-groups', '/usr/bin/python3', '-I', '/opt/swarm/computer-core-worker.py', json.dumps(value, ensure_ascii=False)], cwd='/workspace', env=ENVIRONMENT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            os.set_blocking(child.stdout.fileno(), False)
            selector = selectors.DefaultSelector(); selector.register(child.stdout, selectors.EVENT_READ)
            output = bytearray(); error = None
            end = time.monotonic() + (value.get('timeout', 30) if value['kind'] == 'bash' else 20)
            try:
                while True:
                    if stop or token != (ROOT / 'generation').read_text(): error = 'Operation cancelled; partial effects may remain.'; break
                    if time.monotonic() >= end: error = 'Operation timed out; partial effects may remain.'; break
                    events = selector.select(.05)
                    for key, _ in events:
                        chunk = os.read(key.fd, 65536)
                        if not chunk: selector.unregister(child.stdout); break
                        output.extend(chunk)
                        if len(output) > 3 * 1024 * 1024: error = 'Worker response exceeded its bound.'; break
                    if error or (child.poll() is not None and not selector.get_map()): break
                if not settle(child): raise RuntimeError('Command descendants did not settle; computer remains held.')
                result = {'error': error} if error else json.loads(output)
                if not isinstance(result, dict) or not ('result' in result or 'error' in result): raise RuntimeError('Invalid worker response.')
                (ROOT / 'active').unlink()
                return {'started': True, 'settled': True, **result}
            finally: selector.close(); child.stdout.close()
        except BaseException:
            # Keep the marker on any uncertainty, even if this best-effort cleanup succeeds.
            if child: settle(child)
            raise


def execute_terminal(value, token):
    # Same fence/admission as synchronous core operations, deliberately different lifetime:
    # only this short tmux request must settle. Existing terminal programs are NOT cancelled.
    with locked('operation.lock'):
        if (ROOT / 'active').exists(): raise RuntimeError('Previous operation settlement is unknown.')
        if token != generation(): return {'started': False, 'settled': True, 'error': 'Stale terminal authorization. Inspect before retrying.'}
        atomic('active', json.dumps({'pid': os.getpid(), 'start': start_time(os.getpid())}))
        # No private PID namespace or subreaper: the explicitly authorized tmux server outlives us.
        # Cancel rotates the generation then joins this lock; a request already started may finish.
        value.pop('kind', None)
        child = subprocess.run(['/usr/bin/setpriv', '--reuid=1000', '--regid=1000', '--init-groups',
                                '/usr/bin/python3', '-I', '/opt/swarm/computer-terminal.py', json.dumps(value)],
                               cwd='/workspace', env={**ENVIRONMENT, 'TERM': 'xterm-256color'}, stdin=subprocess.DEVNULL,
                               # A combo may type for up to 30 seconds (validated by the helper before any input).
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               timeout=45 if value.get('operation') == 'actions' else 8)
        if child.returncode or len(child.stdout) > 2 * 1024 * 1024: raise RuntimeError('Terminal request settlement uncertain.')
        result = json.loads(child.stdout)
        if not isinstance(result, dict) or not ('result' in result or 'error' in result): raise RuntimeError('Invalid terminal receipt.')
        (ROOT / 'active').unlink()
        return {'started': True, 'settled': True, **result}


def main():
    if os.getuid() != 0: raise RuntimeError('Supervisor requires the guest root account.')
    os.umask(0o077); ROOT.mkdir(mode=0o700, exist_ok=True)
    with locked('boot.lock', 5):
        boot = start_time(1)
        if not (ROOT / 'boot').exists() or (ROOT / 'boot').read_text() != boot:
            generation(True); (ROOT / 'active').unlink(missing_ok=True); atomic('boot', boot)
    mode, raw = sys.argv[1:3]
    if len(raw.encode()) > 65536: raise ValueError('Request exceeds 64 KiB.')
    value = json.loads(raw)
    if mode == 'cancel':
        generation(True)
        with locked('operation.lock', 10):
            if (ROOT / 'active').exists(): raise RuntimeError('Previous supervisor settlement is unknown; restart the computer before transfer.')
        return {'settled': True}
    if mode == 'prepare':
        with locked('operation.lock'):
            if (ROOT / 'active').exists(): raise RuntimeError('Previous supervisor settlement is unknown.')
            return {'validationToken': generation()}
    if mode != 'execute' or not isinstance(value, dict): raise ValueError('Invalid core operation.')
    token = value.pop('validationToken', None)
    if value.get('kind') == 'terminal': return execute_terminal(value, token)
    if value.get('kind') not in ('read', 'edit', 'write', 'bash'): raise ValueError('Unknown core tool.')
    if value['kind'] == 'bash':
        if not isinstance(value.get('command'), str) or not value['command'].strip(): raise ValueError('command must be nonempty.')
        timeout = value.get('timeout', 30)
        if type(timeout) not in (int, float) or not 0 < timeout <= 120: raise ValueError('timeout must be within (0,120] seconds.')
    return execute(value, token)


if __name__ == '__main__':
    def cancelled(_sig, _frame):
        global stop
        stop = True
    signal.signal(signal.SIGTERM, cancelled)
    try: print(json.dumps(main(), separators=(',', ':')))
    except ValueError as error: print(json.dumps({'started': False, 'settled': not (ROOT / 'active').exists(), 'error': str(error)[:500]}))
    except Exception: print(json.dumps({'started': False, 'settled': False, 'error': 'Guest operation settlement is uncertain. Do not transfer control; inspect or restart the computer.'}))
