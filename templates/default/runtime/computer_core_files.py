"""File operations run as the guest account, never against controller/host paths."""
import base64
import hashlib
import json
import os
from pathlib import Path
import resource
import stat
import subprocess
import tempfile

MAX_TEXT = 50000
DEFAULT_LINES = 200  # one page; agents ask for more (<=2000) or page with offset/prevOffset/nextOffset
MAX_FILE = 16 * 1024 * 1024
MAX_IMAGE = 2 * 1024 * 1024


# Relative paths and bash start in the agent's persistent home; /tmp is the disposable place (wiped at each start).
HOME = '/home/agent'


def guest_path(value, cwd=HOME):
    if not isinstance(value, str) or not value or len(value) > 4096 or '\0' in value:
        raise ValueError('Use a nonempty guest path of at most 4096 characters.')
    path = Path(value.replace('~/', '/home/agent/', 1) if value.startswith('~/') else value)
    return (path if path.is_absolute() else Path(cwd) / path).resolve()


def image(path, head):
    mime = 'image/png' if head.startswith(b'\x89PNG\r\n\x1a\n') else 'image/jpeg' if head.startswith(b'\xff\xd8') else None
    recognized = mime or head.startswith((b'GIF87a', b'GIF89a')) or (head.startswith(b'BM') and head[6:10] == b'\0' * 4) or (head.startswith(b'RIFF') and head[8:12] == b'WEBP')
    if not recognized:
        return None
    if path.stat().st_size > MAX_FILE:
        raise ValueError('Image source exceeds 16 MiB; resize it inside the guest first.')
    format = 'png_pipe' if mime == 'image/png' else 'jpeg_pipe' if mime == 'image/jpeg' else 'gif' if head.startswith(b'GIF') else 'bmp_pipe' if head.startswith(b'BM') else 'webp_pipe'
    probe = subprocess.run(['ffprobe', '-v', 'error', '-f', format, '-protocol_whitelist', 'file,pipe', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', '-i', str(path)], capture_output=True, timeout=7, check=True)
    info = json.loads(probe.stdout)['streams'][0]
    width, height = info['width'], info['height']
    if not (0 < width <= 4096 and 0 < height <= 4096 and width * height <= 16000000):
        raise ValueError('Image exceeds 4096 pixels per axis or 16 million pixels; resize it first.')
    if mime:
        with path.open('rb') as file:
            data = file.read(MAX_IMAGE + 1)
    else:
        # First frame only. Unlinked output cannot leave an orphan after a killed operation.
        with tempfile.TemporaryFile() as output:
            def bound(): resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_IMAGE, MAX_IMAGE))
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', format, '-protocol_whitelist', 'file,pipe', '-i', str(path), '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], stdout=output, stderr=subprocess.DEVNULL, timeout=7, check=True, preexec_fn=bound)
            output.seek(0); data = output.read(MAX_IMAGE + 1)
        mime = 'image/png'
    if len(data) > MAX_IMAGE:
        raise ValueError('Image exceeds 2 MiB; resize or convert it inside the guest first.')
    return {'type': 'image', 'path': str(path), 'mimeType': mime, 'data': base64.b64encode(data).decode(), 'width': width, 'height': height, 'firstFrameOnly': True}


def read(path, value):
    offset, limit = value.get('offset', 1), value.get('limit', DEFAULT_LINES)
    if type(offset) is not int or offset < 1 or type(limit) is not int or not 1 <= limit <= 2000:
        raise ValueError('offset is a positive line number; limit must be 1..2000.')
    if not stat.S_ISREG(path.stat().st_mode):
        raise ValueError('read accepts regular files, not directories or devices.')
    with path.open('rb') as file:
        head = file.read(12); file.seek(0)
        result = image(path, head)
        if result:
            if offset != 1: raise ValueError('Images do not have line offsets.')
            return result
        scanned, line = 0, 1
        while line < offset:
            chunk = file.readline(MAX_TEXT + 1)
            if not chunk: break
            scanned += len(chunk)
            if scanned > 32 * 1024 * 1024: raise ValueError('Line offset requires scanning over 32 MiB; use a bounded bash extraction.')
            if chunk.endswith(b'\n'): line += 1
        output, count, partial = bytearray(), 0, False
        while line >= offset and count < limit and len(output) < MAX_TEXT:
            chunk = file.readline(MAX_TEXT - len(output) + 1)
            if not chunk: break
            count += 1
            room = MAX_TEXT - len(output)
            if len(chunk) > room:
                output.extend(chunk[:room]); partial = True; break
            output.extend(chunk)
        more = partial or bool(file.read(1))
    if b'\0' in output: raise ValueError('Binary file is not a supported image or UTF-8 text.')
    encoded = output.decode('utf-8', errors='replace').encode('utf-8')
    if len(encoded) > MAX_TEXT: partial = more = True
    return {'type': 'text', 'path': str(path), 'text': encoded[:MAX_TEXT].decode('utf-8', errors='ignore'), 'offset': offset, 'lines': count, 'truncated': more, 'partialLine': partial, 'nextOffset': offset + count if more and not partial else None, 'prevOffset': max(1, offset - limit) if offset > 1 else None, 'note': 'A partial long line requires bounded bash extraction; UTF-8 decoding replaces invalid bytes.' if partial else ''}


def snapshot(path):
    with path.open('rb') as file: return file.read(MAX_FILE + 1)


def file_operation(value, cwd=HOME):
    path = guest_path(value['path'], cwd)
    if value['kind'] == 'read': return read(path, value)
    original = None
    if path.exists():
        before = path.stat()
        if not stat.S_ISREG(before.st_mode): raise ValueError('Target must be a regular file.')
    else: before = None
    if value['kind'] == 'write':
        if not isinstance(value.get('content'), str): raise ValueError('content must be text.')
        content = value['content']
    elif value['kind'] == 'edit':
        if before is None: raise ValueError('Edit target does not exist.')
        if before.st_size > MAX_FILE: raise ValueError('Edit target exceeds 16 MiB.')
        original = snapshot(path)
        if len(original) > MAX_FILE: raise ValueError('Edit target exceeds 16 MiB.')
        text = original.decode('utf-8')
        edits = value.get('edits')
        if not isinstance(edits, list) or not 1 <= len(edits) <= 100: raise ValueError('Use 1..100 disjoint exact replacements.')
        regions = []
        for edit in edits:
            old, new = edit.get('oldText'), edit.get('newText')
            if not isinstance(old, str) or not old or not isinstance(new, str): raise ValueError('Each edit needs nonempty oldText and string newText.')
            start = text.find(old)
            if start < 0 or text.find(old, start + 1) >= 0: raise ValueError('oldText must match exactly once; read the file and provide a unique match.')
            regions.append((start, start + len(old), new))
        regions.sort()
        if any(a[1] > b[0] for a, b in zip(regions, regions[1:])): raise ValueError('Edits overlap; merge them into one replacement.')
        content, end = '', 0
        for start, stop, new in regions: content += text[end:start] + new; end = stop
        content += text[end:]
    else: raise ValueError('Unsupported file operation.')
    data = content.encode('utf-8')
    if len(data) > MAX_FILE: raise ValueError('Result exceeds 16 MiB.')
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.swarm-edit-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as file:
            file.write(data); file.flush(); os.fsync(file.fileno())
            if before: os.fchmod(file.fileno(), stat.S_IMODE(before.st_mode))
        current = path.stat() if original is not None else None
        if original is not None and ((current.st_ino, current.st_size, current.st_mtime_ns, current.st_ctime_ns) != (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) or snapshot(path) != original):
            raise ValueError('File changed during editing; read it again before retrying.')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    return {'type': 'text', 'path': str(path), 'text': f'{value["kind"]} completed: {len(data)} bytes.', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
