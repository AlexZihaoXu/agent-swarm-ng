#!/bin/sh
# Root, in the background after every start (the desktop does not wait): bring back what this computer installed
# with apt, then run its startup scripts. Progress goes to /keep/boot.log; /keep/boot-status says how it ended.
#
# /keep/system holds the record kept by computer-storage-record.sh: apt-packages.txt (packages added beyond the
# image) and apt-files/ (extra apt sources and keys, mirrored at their real paths). After an image update or a
# rebuild those are missing from the fresh system; downloads come from the Cache folder's apt archive when possible.
set -u
system=/keep/system
status=/keep/boot-status

say() { printf '%s computer-storage: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
finish() {
    printf '%s %s\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$status.tmp" && mv "$status.tmp" "$status"
    say "boot finished: $1"
    exit 0
}

mountpoint -q /keep || exit 0
printf 'running %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$status"
problems=''

# Extra apt sources and keys first (never replacing the image's own files), so their packages can install.
if [ -d "$system/apt-files" ]; then
    (cd "$system/apt-files" && find . -type f) | while read -r file; do
        target=${file#.}
        [ -e "$target" ] || install -D -m 0644 "$system/apt-files$target" "$target"
    done
fi

if [ -s "$system/apt-packages.txt" ]; then
    missing=$(grep -v '^[[:space:]]*$' "$system/apt-packages.txt" | while read -r package; do
        dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'ok installed' || printf '%s ' "$package"
    done)
    if [ -n "$missing" ]; then
        say "reinstalling: $missing"
        # shellcheck disable=SC2086 # a word list of package names
        if timeout 1200 apt-get update && DEBIAN_FRONTEND=noninteractive timeout 1200 apt-get install -y $missing; then
            say "reinstalled"
        else
            # One package that no longer exists (after an image update, say) must not stop the others.
            say "reinstalling together failed; trying one package at a time"
            for package in $missing; do
                DEBIAN_FRONTEND=noninteractive timeout 600 apt-get install -y "$package" >/dev/null 2>&1 \
                    || { problems="$problems apt:$package"; say "could not reinstall $package"; }
            done
        fi
    fi
fi

# Startup scripts: every executable file in /keep/startup, in name order, as root, each at most 5 minutes.
for script in /keep/startup/*; do
    [ -f "$script" ] && [ -x "$script" ] || continue
    say "running startup script $(basename "$script")"
    if ! timeout 300 "$script"; then
        problems="$problems $(basename "$script")"
        say "startup script $(basename "$script") failed or timed out"
    fi
done

if [ -n "$problems" ]; then finish "failed:$problems"; else finish ok; fi
