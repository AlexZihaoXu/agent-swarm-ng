#!/bin/sh
# Image build, last step of every computer Dockerfile: note what the image itself installed, so a computer records
# (and later reinstalls) only what it added (computer-storage-record.sh).
set -eu
baseline=/usr/lib/agent-swarm/baseline
mkdir -p "$baseline"
apt-mark showmanual | sort -u >"$baseline/manual-packages"
for directory in /etc/apt/sources.list.d /etc/apt/keyrings /etc/apt/trusted.gpg.d /usr/share/keyrings; do
    [ -d "$directory" ] && find "$directory" -maxdepth 1 -type f
done | sort -u >"$baseline/apt-files"
