#!/bin/sh
# Root, after every apt/dpkg run (apt hook): record what this computer installed beyond its image, so it can be
# reinstalled after an image update or rebuild (computer-storage-replay.sh). Writes /keep/system/apt-packages.txt
# (manually installed packages not in the image) and apt-files/ (apt sources and keys the image does not have).
set -eu
# The baseline and the record compare sorted lists: one byte order for both.
export LC_ALL=C
baseline=/usr/lib/agent-swarm/baseline
system=/keep/system
mountpoint -q /keep 2>/dev/null || exit 0
[ -d "$baseline" ] || exit 0
mkdir -p "$system"

apt-mark showmanual | sort -u | comm -23 - "$baseline/manual-packages" >"$system/apt-packages.txt.tmp"
mv "$system/apt-packages.txt.tmp" "$system/apt-packages.txt"

rm -rf "$system/apt-files.tmp"
mkdir -p "$system/apt-files.tmp"
for directory in /etc/apt/sources.list.d /etc/apt/keyrings /etc/apt/trusted.gpg.d /usr/share/keyrings; do
    [ -d "$directory" ] || continue
    find "$directory" -maxdepth 1 -type f | sort | comm -23 - "$baseline/apt-files" | while read -r file; do
        install -D -m 0644 "$file" "$system/apt-files.tmp$file"
    done
done
rm -rf "$system/apt-files"
mv "$system/apt-files.tmp" "$system/apt-files"
