"""The swarm agent's listener inside the computer (run by the platform's monitor stream, not by Claude Code).

Follows the Swarm assist events file from now on and prints the lines for the terminals and events it was asked
for, one per line (the platform renders them for the agent). While it runs, it records what it covers, so
notify_supervisor knows a listener exists.

    claude_follow.py --terminals ID[,ID…] --events finished,permission,… [--since MS]

--since replays lines newer than that time (epoch ms) first, so a restarted follower misses nothing.
"""
import argparse
import json
import os
import signal
import sys
import time

from swarm_claude import base, events_file

POLL_S = 0.2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--terminals', required=True)
    parser.add_argument('--events', required=True)
    parser.add_argument('--since', type=int, default=0)
    args = parser.parse_args()
    terminals = [item for item in args.terminals.split(',') if item]
    events = [item for item in args.events.split(',') if item]
    presence = base() / 'followers' / f'{os.getpid()}.json'
    presence.write_text(json.dumps({'pid': os.getpid(), 'terminals': terminals, 'events': events}))

    def stop(*_):
        presence.unlink(missing_ok=True)
        sys.exit(0)

    for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(sig, stop)
    path = events_file()
    path.touch(exist_ok=True)
    handle = open(path, encoding='utf-8')
    if not args.since:
        handle.seek(0, os.SEEK_END)
    inode = os.fstat(handle.fileno()).st_ino
    pending = ''
    try:
        while True:
            chunk = handle.read()
            if chunk:
                pending += chunk
                *lines, pending = pending.split('\n')
                for raw in lines:
                    try:
                        line = json.loads(raw)
                    except ValueError:
                        continue
                    where = line.get('terminal') or {}
                    if line.get('t', 0) <= args.since:
                        continue
                    if where.get('id') in terminals and line.get('event') in events:
                        sys.stdout.write(json.dumps(line, ensure_ascii=False) + '\n')
                        sys.stdout.flush()
                continue
            # Rotated: reopen the new file from its start.
            try:
                if os.stat(path).st_ino != inode:
                    handle.close()
                    handle = open(path, encoding='utf-8')
                    inode = os.fstat(handle.fileno()).st_ino
                    continue
            except FileNotFoundError:
                path.touch(exist_ok=True)
            time.sleep(POLL_S)
    finally:
        presence.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
