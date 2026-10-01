"""Fixed Docker-exec entry point, never a network service. See controller computer-use.ts for protocol.

A generation fence closes cancel-before-delayed-exec races. The operation flock is held through
cleanup. Cancel rotates the generation first, joins that flock, and repairs any crash ledger before
acknowledging settlement. HTTP disconnect alone is NOT cancellation. All calls have finite deadlines.
"""
import base64
import contextlib
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import uuid

from computer_use_protocol import BUTTONS, SCROLL, bezier_points, capture_geometry, rounded, validate_combo
from computer_use_x11 import X11
from recording import journal

ROOT = Path('/run/user/1000/swarm-computer-use')


class Cancelled(Exception):
    pass


def atomic(path, data):
    fd, temporary = tempfile.mkstemp(dir=ROOT)
    try:
        with os.fdopen(fd, 'w') as file:
            file.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextlib.contextmanager
def lock(name, wait=True):
    with open(ROOT / name, 'a') as file:
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if not wait:
                raise ValueError('Another computer operation is active.')
            while True:
                time.sleep(.01)
                try:
                    fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    pass
        try:
            yield
        finally:
            fcntl.flock(file, fcntl.LOCK_UN)


def generation(rotate=False):
    with lock('generation.lock'):
        path = ROOT / 'generation'
        if rotate or not path.exists():
            atomic(path, str(uuid.uuid4()))
        return path.read_text()


def cleanup(x11, ledger):
    # Persist until all releases and keymap restoration are confirmed by XSync.
    for device in ('keys', 'buttons'):
        for code in ledger[device]:
            x11.transition(device, code, False)
    if ledger['mapping']:
        x11.mapping(ledger['mapping']['code'], ledger['mapping']['symbols'])
    atomic(ROOT / 'held.json', json.dumps({'keys': [], 'buttons': [], 'mapping': None}))


def repair(x11):
    path = ROOT / 'held.json'
    if path.exists():
        cleanup(x11, json.loads(path.read_text()))


def prepare(value, x11):
    state = x11.state()
    plan = validate_combo(value, state)
    codes = {a['key']: x11.keycode(a['key']) for a in value['actions'] if a['type'] in ('keyboard.down', 'keyboard.up')}
    held = set()
    for a in value['actions']:
        if a['type'] == 'keyboard.down':
            if codes[a['key']] in held:
                raise ValueError('Two key names map to the same held physical key.')
            held.add(codes[a['key']])
        elif a['type'] == 'keyboard.up':
            held.remove(codes[a['key']])
    mapping = x11.spare_mapping() if any(a['type'] == 'keyboard.type' and a['text'] for a in value['actions']) else None
    return state, plan, codes, mapping


def execute(value, x11):
    result = {'started': False, 'completed': 0, 'error': None}
    ledger = {'keys': [], 'buttons': [], 'mapping': None}
    token = value.get('validationToken')
    def check():
        if token != (ROOT / 'generation').read_text():
            raise Cancelled('Computer actions cancelled; look and validate again.')
    def sleep(seconds):
        until = time.monotonic() + seconds
        while True:
            check()
            remaining = until - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(.01, remaining))
    def save():
        atomic(ROOT / 'held.json', json.dumps(ledger))
    def transition(device, code, down):
        check()
        if down:
            ledger[device].append(code)
            save()  # Before the effect, so a killed worker leaves a repairable ledger.
        x11.transition(device, code, down)
        if not down:
            ledger[device].remove(code)
            save()
    def click(code):
        transition('buttons', code, True)
        sleep(.02)
        transition('buttons', code, False)
    try:
        check()
        state, plan, codes, mapping = prepare(value, x11)
        prior = ROOT / 'held.json'
        if prior.exists():
            residue = json.loads(prior.read_text())
            if residue['keys'] or residue['buttons'] or residue['mapping']:
                raise ValueError('Previous input needs cancel-and-settle before another combo.')
        w, h, x, y = state
        # Compute all trajectories before the first input, with the freshly sampled actual pointer.
        paths = []
        for a, duration in zip(value['actions'], plan['durations']):
            path = None
            if a['type'] == 'mouse.move_to':
                end = (rounded(a['x']/999*(w-1)), rounded(a['y']/999*(h-1)))
                path = bezier_points((x, y), end, duration, w, h)
                x, y = end
            paths.append(path)
        check()
        # Execution itself cannot continue sending input past the ten-second
        # wall budget, even if X11/ledger writes run slower than the estimate.
        signal.setitimer(signal.ITIMER_REAL, 10)
        result['started'] = True
        for index, a in enumerate(value['actions']):
            check()
            kind = a['type']
            began = time.time()
            if paths[index] is not None:
                start = time.monotonic()
                for at, x, y in paths[index]:
                    sleep(max(0, start + at - time.monotonic()))
                    x11.move(x, y)
            elif kind in ('mouse.left_click', 'mouse.right_click'):
                click(1 if kind == 'mouse.left_click' else 3)
            elif kind in ('mouse.down', 'mouse.up'):
                transition('buttons', BUTTONS[a['button']], kind.endswith('.down'))
            elif kind == 'mouse.scroll':
                for _ in range(int(a['amount'])):
                    click(SCROLL[a['direction']])
            elif kind in ('keyboard.down', 'keyboard.up'):
                transition('keys', codes[a['key']], kind.endswith('.down'))
            elif kind == 'keyboard.type':
                period = 60 / a.get('cpm', 800)
                for char in a['text']:
                    check()
                    start = time.monotonic()
                    ledger['mapping'] = mapping
                    save()
                    symbol = 0xff0d if char == '\n' else 0xff09 if char == '\t' else ord(char) if ord(char) < 256 else 0x01000000 | ord(char)
                    x11.mapping(mapping['code'], [symbol] * len(mapping['symbols']))
                    transition('keys', mapping['code'], True)
                    # Let X11 clients handle MappingNotify/KeyPress before restoring the spare map.
                    sleep(min(.01, period / 2))
                    transition('keys', mapping['code'], False)
                    sleep(max(0, start + period - time.monotonic()))
                    x11.mapping(mapping['code'], mapping['symbols'])
                    ledger['mapping'] = None
                    save()
            result['completed'] = index + 1
            # Agent recordings (desktop source) clip around these: exact start and end of each action.
            journal('desktop', dict({key: a[key] for key in ('x', 'y', 'key', 'text', 'direction', 'amount', 'button') if key in a},
                                    type=kind, t0=began, t1=time.time()))
            if index < len(value['actions']) - 1:
                sleep(value.get('per_action_pause', .2))
    except (ValueError, Cancelled) as error:
        result['error'] = str(error)
    except Exception:
        result['error'] = 'Guest input failed; partial effects may remain. Do not retry automatically.'
    finally:
        # A short independent cleanup deadline; hard timeout is the last resort. Cancel repairs ledger.
        if result['started']:
            signal.setitimer(signal.ITIMER_REAL, 2)
            cleanup(x11, ledger)
    return result


def capture(value, x11):
    w, h, _, _ = x11.state()
    geometry = capture_geometry(value, w, h)
    l, t, r, b = geometry.pop('pixels')
    # Unnamed/unlinked file: SIGKILL cannot leave a JPEG behind in the guest.
    # GStreamer inherits this descriptor and opens it via its own /proc view.
    with tempfile.TemporaryFile(dir=ROOT) as output:
        fd = output.fileno()
        subprocess.run(['gst-launch-1.0', '-q', 'ximagesrc', 'display-name=:1', 'num-buffers=1', 'use-damage=false', '!',
                        'videoconvert', '!', 'videocrop', f'left={l}', f'top={t}', f'right={w-r}', f'bottom={h-b}', '!',
                        'videoscale', '!', f'video/x-raw,width={geometry["width"]},height={geometry["height"]}', '!',
                        'jpegenc', 'quality=85', '!', 'filesink', f'location=/proc/self/fd/{fd}'],
                       check=True, timeout=12, pass_fds=(fd,), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.fstat(fd).st_size > 2*1024*1024:
            raise ValueError('Captured JPEG exceeds 2 MiB; use a smaller crop.')
        output.seek(0)
        data = output.read()
        if not data.startswith(b'\xff\xd8') or not data.endswith(b'\xff\xd9'):
            raise RuntimeError('Guest capture did not produce JPEG.')
        return {**geometry, 'sourceWidth': w, 'sourceHeight': h, 'mimeType': 'image/jpeg', 'data': base64.b64encode(data).decode('ascii')}


def main():
    if os.getuid() != 1000:
        raise RuntimeError('Computer use requires the guest agent account.')
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    def timeout(_sig, _frame):
        raise Cancelled('Guest operation deadline exceeded; partial effects may remain.')
    signal.signal(signal.SIGALRM, timeout)
    signal.signal(signal.SIGTERM, timeout)
    signal.setitimer(signal.ITIMER_REAL, 15)
    mode = sys.argv[1]
    raw = sys.argv[2] if len(sys.argv) == 3 else '{}'
    if len(raw.encode()) > 65536:
        raise ValueError('Request exceeds 64 KiB.')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('Expected object.')
    token = generation(mode == 'cancel')
    with lock('operation.lock', wait=mode == 'cancel'):
        x11 = X11()
        if mode == 'cancel':
            repair(x11)
        if mode == 'cancel':
            return {'settled': True}
        if mode == 'capture':
            return capture(value, x11)
        if mode in ('state', 'validate'):
            state = x11.state()
            if mode == 'validate':
                state, plan, _, _ = prepare(value, x11)
            result = {'sourceWidth': state[0], 'sourceHeight': state[1], 'pointer': {'x': state[2], 'y': state[3]}}
            if mode == 'validate':
                result.update(valid=True, validationToken=token, actionSeconds=plan['actionSeconds'], totalSeconds=plan['totalSeconds'])
            return result
        if mode == 'execute':
            return execute(value, x11)
        raise ValueError('Unknown operation.')


if __name__ == '__main__':
    try:
        print(json.dumps(main(), separators=(',', ':')))
    except ValueError as error:
        print(json.dumps({'error': str(error), 'rejected': True}))
    except Exception:
        # No arbitrary X11/subprocess details or input text in controller logs.
        print(json.dumps({'error': 'Guest operation failed or did not settle.', 'rejected': False}))
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
