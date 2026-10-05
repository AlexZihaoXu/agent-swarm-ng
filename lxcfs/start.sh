#!/bin/sh
# Clears a mount left behind by an earlier lxcfs (a dead FUSE connection), then runs lxcfs in the foreground.
# /host/lxcfs is the shared host folder; computers bind files from its mnt/ (docs/computers.md#lxcfs).
set -e
M=/host/lxcfs/mnt
fusermount3 -u "$M" 2>/dev/null || umount -l "$M" 2>/dev/null || true
mkdir -p "$M"
exec lxcfs --enable-cfs --enable-loadavg "$@" "$M"
