"""Guest operator file operations (list, preview, streamed download/upload, new folder).

Passed as trusted python -I -c source and run as the guest user (uid 1000), never installed."""
import codecs
import ctypes
import email.utils
import errno
import json
import os
import signal
import stat
import sys
import time

PAGE = 200
SCAN = 20000
PREVIEW = 64 * 1024
CHUNK = 1024 * 1024
RENAME_NOREPLACE = 1
NAME_ATTEMPTS = 1000
STREAMING = False


class Failure(Exception):
    def __init__(self, status, message, **extra):
        self.status, self.message, self.extra = status, message, extra


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


def checked_name(name):
    if (not isinstance(name, str) or not name or name in ('.', '..') or '/' in name or '\0' in name
            or len(name.encode('utf-8', 'surrogatepass')) > 255):
        raise Failure(400, 'Use a file name without slashes, of at most 255 bytes.')
    return name


def write_all(fd, data):
    view = memoryview(data)
    while view:
        view = view[os.write(fd, view):]


def stat_at(directory, name):
    try:
        return os.stat(name, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return None


def download(fd, path, info, request):
    """Writes the header line, then exactly the bytes from `start` to `end` (inclusive; at most to the file's end).

    The backend asks in bounded pieces (its runtime cannot slow a reader down), with `match` the validator the first
    piece reported: a file changed in between is refused (412) rather than stitched together."""
    size = info.st_size
    etag = '"%x-%x"' % (size, info.st_mtime_ns)
    modified = email.utils.formatdate(info.st_mtime, usegmt=True)
    start, end, match = request.get('start', 0), request.get('end'), request.get('match')
    if type(start) is not int or start < 0 or (end is not None and (type(end) is not int or end < start)):
        raise Failure(400, 'Invalid byte range.')
    if match is not None and match != etag:
        raise Failure(412, 'The file changed while it was downloaded.')
    if size and start >= size:
        raise Failure(416, 'The requested range is not available.', size=size)
    length = 0 if not size else (size if end is None else min(end + 1, size)) - start
    global STREAMING
    write_all(1, json.dumps(dict(status=200, result=dict(
        name=os.path.basename(path), size=size, start=start, length=length, etag=etag, modified=modified)),
        ensure_ascii=True).encode() + b'\n')
    # From here on the stream is file bytes: a failure only ends it early (the reader sees a short body).
    STREAMING = True
    signal.alarm(0)
    offset, left = start, length
    while left > 0:
        try:
            sent = os.sendfile(1, fd, offset, min(left, CHUNK))
        except OSError as error:
            if error.errno not in (errno.EINVAL, errno.ENOSYS):
                raise
            sent = os.write(1, os.pread(fd, min(left, CHUNK), offset))
        if sent <= 0:
            # The file shrank while it was read: the stream ends short and the reader notices.
            break
        offset += sent
        left -= sent
    return None


def place(directory, temporary, name, mode):
    """Moves the finished temporary file to its name; returns the name used. Never replaces unless asked."""
    libc = ctypes.CDLL(None, use_errno=True)
    stem, extension = os.path.splitext(name)
    for attempt in range(NAME_ATTEMPTS if mode == 'rename' else 1):
        target = name if attempt == 0 else '%s (%d)%s' % (stem, attempt, extension)
        if len(target.encode('utf-8', 'surrogatepass')) > 255:
            raise Failure(400, 'The file name is too long.')
        if mode == 'overwrite':
            existing = stat_at(directory, target)
            if existing is not None and stat.S_ISLNK(existing.st_mode):
                raise Failure(403, 'A symbolic link has that name; it is not replaced.')
            if existing is not None and stat.S_ISDIR(existing.st_mode):
                raise Failure(409, 'A folder has that name.')
            # rename() replaces the directory entry itself: it never writes through a link swapped in meanwhile.
            os.rename(temporary, target, src_dir_fd=directory, dst_dir_fd=directory)
            return target
        if libc.renameat2(directory, temporary.encode('utf-8', 'surrogateescape'), directory,
                          target.encode('utf-8', 'surrogateescape'), RENAME_NOREPLACE) == 0:
            return target
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            continue
        if code not in (errno.EINVAL, errno.ENOSYS, errno.ENOTSUP):
            raise OSError(code, os.strerror(code))
        # No RENAME_NOREPLACE on this filesystem: a hard link is the same atomic no-clobber step.
        try:
            os.link(temporary, target, src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
        except FileExistsError:
            continue
        os.unlink(temporary, dir_fd=directory)
        return target
    raise Failure(409, 'A file with that name already exists.')


def temporary_name(name, upload):
    if not isinstance(upload, str) or len(upload) != 32 or any(c not in '0123456789abcdef' for c in upload):
        raise Failure(400, 'Invalid upload.')
    return '.%s.%s.swarm-upload' % (name[:64], upload)


def sweep(directory):
    """Removes this user's upload leftovers older than a day (a browser closed mid-upload) from this folder."""
    cutoff = time.time() - 86400
    try:
        with os.scandir(directory) as entries:
            for entry in entries:
                if not entry.name.endswith('.swarm-upload') or not entry.name.startswith('.'):
                    continue
                info = entry.stat(follow_symlinks=False)
                if stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_mtime < cutoff:
                    os.unlink(entry.name, dir_fd=directory)
    except OSError:
        pass


def upload(directory, request):
    """One part of an upload: `length` bytes from stdin written at `offset` of a hidden file beside the target.

    The first part creates it; the last one (offset + length == size) renames it into place. Parts come one at a
    time and in order. Any failure removes the hidden file: the upload then starts again from the beginning."""
    name = checked_name(request.get('name'))
    size, offset, length = request.get('size'), request.get('offset', 0), request.get('length')
    mode = request.get('mode', 'refuse')
    if (any(type(value) is not int or value < 0 for value in (size, offset, length)) or offset + length > size):
        raise Failure(400, 'Invalid upload part.')
    if mode not in ('refuse', 'overwrite', 'rename'):
        raise Failure(400, 'Invalid conflict mode.')
    temporary = temporary_name(name, request.get('upload'))
    if offset == 0:
        sweep(directory)
        existing = stat_at(directory, name)
        if existing is not None:
            if mode == 'refuse':
                raise Failure(409, 'A file with that name already exists.')
            if mode == 'overwrite' and stat.S_ISLNK(existing.st_mode):
                raise Failure(403, 'A symbolic link has that name; it is not replaced.')
            if mode == 'overwrite' and stat.S_ISDIR(existing.st_mode):
                raise Failure(409, 'A folder has that name.')
    # Never through a link; never waiting on a FIFO (it fails instead). The first part creates the file, or finds
    # the empty one the browser's opening part (no data) created.
    flags = os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC | (os.O_CREAT if offset == 0 else 0)
    space = os.fstatvfs(directory)
    if size - offset > space.f_bavail * space.f_frsize:
        try:
            os.unlink(temporary, dir_fd=directory)
        except OSError:
            pass
        raise Failure(507, 'There is not enough free space on this computer.')
    try:
        out = os.open(temporary, flags, 0o644, dir_fd=directory)
    except FileNotFoundError:
        raise Failure(409, 'The upload was interrupted; start it again.')
    keep = False
    try:
        info = os.fstat(out)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_size != offset:
            raise Failure(409, 'The upload was interrupted; start it again.')
        os.lseek(out, offset, os.SEEK_SET)
        signal.alarm(0)
        buffer = bytearray(CHUNK)
        view = memoryview(buffer)
        received = 0
        source = sys.stdin.buffer.raw
        # Exactly the part's length is read: the controller cannot signal the end of input (its sockets do not
        # half-close), and more input than announced is never written.
        while received < length:
            count = source.readinto(view[:min(CHUNK, length - received)])
            if not count:
                # The sender went away (cancelled, disconnected): nothing is kept.
                raise Failure(400, 'The upload did not finish.')
            received += count
            write_all(out, view[:count])
        if offset + length < size:
            keep = True  # for the next part
            return dict(received=offset + length)
        os.fsync(out)
        target = place(directory, temporary, name, mode)
        keep = True
        return dict(name=target, size=size)
    finally:
        os.close(out)
        if not keep:
            try:
                os.unlink(temporary, dir_fd=directory)
            except OSError:
                pass


def cancel_upload(directory, request):
    """Removes an unfinished upload's hidden file (the person cancelled it)."""
    name = checked_name(request.get('name'))
    try:
        info = os.stat(temporary_name(name, request.get('upload')), dir_fd=directory, follow_symlinks=False)
        if stat.S_ISREG(info.st_mode):
            os.unlink(temporary_name(name, request.get('upload')), dir_fd=directory)
    except FileNotFoundError:
        pass
    return dict(cancelled=True)


def new_folder(directory, path, request):
    name = checked_name(request.get('name'))
    try:
        os.mkdir(name, 0o755, dir_fd=directory)
        created = True
    except FileExistsError:
        existing = stat_at(directory, name)
        if existing is None or not stat.S_ISDIR(existing.st_mode):
            raise Failure(409, 'A file with that name already exists.')
        created = False
    return dict(path=os.path.join(path, name), created=created)


def run(mode, request):
    path = checked_path(request.get('path'))
    if mode not in ('files', 'file-preview', 'download', 'upload', 'cancel', 'folder'):
        raise Failure(400, 'Unsupported file operation.')
    fd, info = safe_open(path, mode in ('files', 'upload', 'cancel', 'folder'))
    try:
        if mode == 'files':
            offset, query = request.get('offset', 0), request.get('filter', '')
            if type(offset) is not int or not 0 <= offset <= SCAN or not isinstance(query, str) or len(query) > 256:
                raise Failure(400, 'Invalid directory page or filter.')
            return listing(fd, path, offset, query)
        if mode == 'upload':
            return upload(fd, request)
        if mode == 'cancel':
            return cancel_upload(fd, request)
        if mode == 'folder':
            return new_folder(fd, path, request)
        if mode == 'download':
            return download(fd, path, info, request)
        with os.fdopen(os.dup(fd), 'rb') as source:
            data = source.read(PREVIEW + 1)
        truncated = len(data) > PREVIEW
        data = data[:PREVIEW]
        try:
            text = codecs.getincrementaldecoder('utf-8')('strict').decode(data, final=not truncated)
            binary = any(ord(c) < 32 and c not in '\t\n\r\f' for c in text)
        except UnicodeDecodeError:
            text, binary = None, True
        return dict(path=path, name=os.path.basename(path), size=info.st_size,
                    text=None if binary else text, truncated=truncated, binary=binary)
    finally:
        os.close(fd)


def stop_transfer():
    raise Failure(503, 'File operation stopped.')


def main():
    def stop(*_):
        raise Failure(504, 'File operation timed out.')
    signal.signal(signal.SIGALRM, stop)
    # Stopping the command leaves through the cleanup paths (a partial upload is removed). Python already turns a
    # closed pipe (a cancelled transfer) into BrokenPipeError rather than dying mid-write.
    signal.signal(signal.SIGTERM, lambda *_: stop_transfer())
    signal.signal(signal.SIGHUP, lambda *_: stop_transfer())
    signal.alarm(15)
    mode = sys.argv[1]
    try:
        result = run(mode, json.loads(sys.argv[2]))
        if mode == 'download':
            return
        header = dict(status=200, result=result)
    except Failure as error:
        if STREAMING:
            return
        header = dict(status=error.status, message=error.message, **error.extra)
    except OSError as error:
        if STREAMING:
            return
        status = (404 if error.errno == errno.ENOENT else
                  403 if error.errno in (errno.EACCES, errno.EPERM, errno.ELOOP, errno.EROFS) else
                  507 if error.errno in (errno.ENOSPC, errno.EDQUOT) else
                  503 if error.errno == errno.EPIPE else 400)
        header = dict(status=status, message={404: 'Path not found.', 403: 'Path access denied.',
                                              507: 'There is not enough free space on this computer.'}
                      .get(status, 'Path is not available.'))
    except Exception:
        if STREAMING:
            return
        header = dict(status=400, message='Invalid file request.')
    try:
        write_all(1, json.dumps(header, ensure_ascii=True).encode() + b'\n')
    except OSError:
        pass


if __name__ == '__main__':
    main()
