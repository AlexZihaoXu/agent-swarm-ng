"""Read-only guest operator operations. Passed as trusted python -I -c source, never installed."""
import codecs
import ctypes
import errno
import json
import os
import signal
import stat
import sys

PAGE = 200
SCAN = 20000
PREVIEW = 64 * 1024
DOWNLOAD = 64 * 1024 * 1024


class Failure(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def checked_path(path):
    if not isinstance(path, str) or not path.startswith('/') or len(path.encode('utf-8')) > 4096 or '\0' in path:
        raise Failure(400, 'Use an absolute guest path of at most 4096 bytes.')
    path = os.path.normpath('/' + path.lstrip('/'))
    if any(path == root or path.startswith(root + '/') for root in ('/proc', '/sys', '/dev')):
        raise Failure(403, 'Virtual filesystems are not available.')
    return path


def check_fd(fd):
    checked_path(os.readlink('/proc/self/fd/' + str(fd)))
    # fstatfs detects virtual filesystem bind mounts even outside /proc, /sys, /dev.
    # Linux struct statfs is smaller than this aligned storage on supported guests.
    data = (ctypes.c_long * 32)()
    if ctypes.CDLL(None, use_errno=True).fstatfs(fd, ctypes.byref(data)) != 0:
        raise Failure(403, 'Cannot verify this filesystem.')
    if data[0] & 0xffffffff in (0x9fa0, 0x62656572, 0x1cd1, 0x27e0eb, 0x63677270,
                              0x64626720, 0x74726163, 0x73636673, 0xcafe4a11, 0x6e736673,
                              0x19800202, 0x42494e4d, 0x65735546):
        raise Failure(403, 'Virtual filesystems are not available.')
    device = os.fstat(fd).st_dev
    for root in ('/dev', '/dev/shm'):
        if device == os.stat(root).st_dev:
            raise Failure(403, 'Device filesystems are not available.')


def safe_open(path, directory):
    # Walk pinned directory descriptors; O_NOFOLLOW on every component prevents
    # symlink replacement races and proc magic-link traversal before any read.
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        parts = [p for p in path.split('/') if p]
        for index, part in enumerate(parts):
            flags = os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
            if index < len(parts) - 1 or directory:
                flags |= os.O_RDONLY | os.O_DIRECTORY
            else:
                # Inspect an inode without opening a device or waiting on a FIFO.
                flags |= os.O_PATH
            next_fd = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            check_fd(fd)
        check_fd(fd)
        info = os.fstat(fd)
        if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
            raise Failure(400, 'Choose a directory.' if directory else 'Only regular files are available.')
        if not directory:
            # This kernel-owned fd path reopens the pinned regular inode, not
            # the user path (which may have been replaced since inspection).
            readable = os.open('/proc/self/fd/' + str(fd), os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)
            os.close(fd)
            fd = readable
            check_fd(fd)
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise Failure(400, 'Only regular files are available.')
        return fd, info
    except BaseException:
        os.close(fd)
        raise


def listing(fd, path, offset, query):
    entries = []
    truncated = False
    with os.scandir(fd) as iterator:
        for index, entry in enumerate(iterator):
            if index >= SCAN:
                truncated = True
                break
            # Undecodable filenames cannot be round-tripped through the JSON API.
            if any(0xd800 <= ord(c) <= 0xdfff for c in entry.name):
                truncated = True
                continue
            if query.casefold() not in entry.name.casefold():
                continue
            try:
                info = entry.stat(follow_symlinks=False)
            except OSError:
                truncated = True
                continue
            kind = 'directory' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) else 'other'
            entries.append(dict(name=entry.name, path=os.path.join(path, entry.name), type=kind,
                                size=info.st_size if kind == 'file' else None,
                                modifiedAt=info.st_mtime * 1000, isSymlink=stat.S_ISLNK(info.st_mode)))
    entries.sort(key=lambda e: (e['type'] != 'directory', e['name']))
    return dict(path=path, parent=os.path.dirname(path) if path != '/' else None,
                entries=entries[offset:offset + PAGE],
                nextOffset=offset + PAGE if offset + PAGE < len(entries) else None, truncated=truncated)


def run(mode, request):
    path = checked_path(request.get('path'))
    if mode not in ('files', 'file-preview', 'download'):
        raise Failure(400, 'Unsupported file operation.')
    offset, query = request.get('offset', 0), request.get('filter', '')
    if type(offset) is not int or not 0 <= offset <= SCAN or not isinstance(query, str) or len(query) > 256:
        raise Failure(400, 'Invalid directory page or filter.')
    fd, info = safe_open(path, mode == 'files')
    try:
        if mode == 'files':
            return listing(fd, path, offset, query), None
        maximum = DOWNLOAD if mode == 'download' else PREVIEW
        if mode == 'download' and info.st_size > maximum:
            raise Failure(413, 'Downloads are limited to 64 MiB.')
        with os.fdopen(os.dup(fd), 'rb') as source:
            data = source.read(maximum + 1)
        if mode == 'download':
            if len(data) > maximum:
                raise Failure(413, 'Downloads are limited to 64 MiB.')
            return dict(name=os.path.basename(path)), data
        truncated = len(data) > maximum
        data = data[:maximum]
        try:
            text = codecs.getincrementaldecoder('utf-8')('strict').decode(data, final=not truncated)
            binary = any(ord(c) < 32 and c not in '\t\n\r\f' for c in text)
        except UnicodeDecodeError:
            text, binary = None, True
        return dict(path=path, name=os.path.basename(path), size=info.st_size,
                    text=None if binary else text, truncated=truncated, binary=binary), None
    finally:
        os.close(fd)


def main():
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(Failure(504, 'File operation timed out.')))
    signal.alarm(15)
    try:
        result, data = run(sys.argv[1], json.loads(sys.argv[2]))
        header = dict(status=200, result=result)
    except Failure as error:
        header, data = dict(status=error.status, message=error.message), None
    except OSError as error:
        status = 404 if error.errno == errno.ENOENT else 403 if error.errno in (errno.EACCES, errno.EPERM, errno.ELOOP) else 400
        header, data = dict(status=status, message={404: 'Path not found.', 403: 'Path access denied.'}.get(status, 'Path is not available.')), None
    except Exception:
        header, data = dict(status=400, message='Invalid file request.'), None
    sys.stdout.buffer.write(json.dumps(header, ensure_ascii=True).encode() + b'\n')
    if data is not None:
        sys.stdout.buffer.write(data)


if __name__ == '__main__':
    main()
