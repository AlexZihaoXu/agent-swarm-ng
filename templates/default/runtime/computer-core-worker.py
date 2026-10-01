"""Unprivileged, synchronous worker. The root supervisor owns cancellation and descendant cleanup."""
import json
import os
import selectors
import subprocess
import sys
import time
sys.path.insert(0, '/opt/swarm')
from computer_core_files import HOME, file_operation, guest_path


def bash(value):
    cwd = guest_path(value.get('cwd', HOME))
    process = subprocess.Popen(['/bin/bash', '--noprofile', '--norc', '-c', value['command']], cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    sizes = {'stdout': 0, 'stderr': 0}
    selector = selectors.DefaultSelector()
    for name in buffers:
        file = getattr(process, name); os.set_blocking(file.fileno(), False); selector.register(file, selectors.EVENT_READ, name)
    finished = None
    try:
        while selector.get_map():
            if process.poll() is not None:
                finished = finished or time.monotonic()
                if time.monotonic() - finished > .1: break
            for key, _ in selector.select(.05):
                chunk = os.read(key.fd, 8192)
                if not chunk: selector.unregister(key.fileobj); continue
                name = key.data; sizes[name] += len(chunk); buffers[name].extend(chunk)
                if len(buffers[name]) > 25000: del buffers[name][:-25000]
        code = process.wait()
    finally:
        selector.close(); process.stdout.close(); process.stderr.close()
    texts, truncated = {}, {}
    for name, data in buffers.items():
        lines = data.decode('utf-8', errors='replace').splitlines(keepends=True)
        encoded = ''.join(lines[-1000:]).encode('utf-8')
        texts[name] = encoded[-25000:].decode('utf-8', errors='ignore')
        truncated[name] = sizes[name] > 25000 or len(lines) > 1000 or len(encoded) > 25000
    return {'type': 'text', 'cwd': str(cwd), 'exitCode': code, **texts, 'truncated': truncated, 'note': 'Only the last 25,000 bytes / 1,000 lines per stream are returned. No background execution or output-file continuation.'}


if __name__ == '__main__':
    if os.getuid() != 1000: raise RuntimeError('Worker must use guest agent account.')
    os.umask(0o077)
    try:
        value = json.loads(sys.argv[1])
        result = bash(value) if value['kind'] == 'bash' else file_operation(value)
        print(json.dumps({'result': result}, separators=(',', ':')))
    except (ValueError, OSError, UnicodeError) as error:
        print(json.dumps({'error': str(error)[:500]}, separators=(',', ':')))
    except Exception:
        print(json.dumps({'error': 'Guest file/command operation failed. Effects may remain; inspect before retrying.'}))
