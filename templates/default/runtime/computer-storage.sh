#!/bin/sh
# Root, at every computer start, before the desktop: put the computer's kept and cached folders in place.
#
# The controller mounts two folders: /keep (this computer's Keep folder: code, settings, what it installs) and
# /cache (its Cache folder: anything that can be fetched again). Each holds root/, a "fake root" mirroring real
# paths; every kept path is bind-mounted from there onto the real path. Keep paths come from COMPUTER_KEPT_PATHS
# (colon-separated, set by the controller); the cache paths are fixed. A path kept for the first time is seeded
# with what is already there, so nothing is hidden. /tmp is emptied at every start.
set -eu

CACHE_PATHS='/home/agent/.cache:/var/cache/apt/archives:/tmp'

say() { printf '%s computer-storage: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

empty_tmp() {
    # Disposable: logs, monitor files and intermediate output. Before the desktop creates its sockets.
    find /tmp -mindepth 1 -delete
    chmod 1777 /tmp
}

if ! mountpoint -q /keep || ! mountpoint -q /cache; then
    # A computer without Keep/Cache mounts (an older or standalone container): only empty /tmp.
    empty_tmp
    exit 0
fi

# Never bind over the system itself, the runtime, the two mounts or kernel filesystems; no relative or odd paths.
allowed() {
    case "$1" in
        /*) ;;
        *) return 1 ;;
    esac
    case "$1" in
        *//* | */./* | */../* | */. | */.. | *' '*) return 1 ;;
        / | /bin | /bin/* | /sbin | /sbin/* | /lib | /lib/* | /lib64 | /lib64/* | /boot | /boot/* | /usr | /etc | /var | /opt) return 1 ;;
        /proc | /proc/* | /sys | /sys/* | /dev | /dev/* | /run | /run/* | /keep | /keep/* | /cache | /cache/*) return 1 ;;
        /opt/swarm | /opt/swarm/* | /usr/lib/agent-swarm | /usr/lib/agent-swarm/*) return 1 ;;
    esac
    return 0
}

bind() {
    class=$1 path=$2
    source=/$class/root$path
    if [ ! -e "$source" ] && [ ! -L "$source" ]; then
        mkdir -p "$(dirname "$source")"
        if [ -d "$path" ]; then
            # First time kept: seed with what is there, ownership and modes included.
            mkdir -p "$source"
            [ "$path" = /tmp ] || cp -a "$path/." "$source/"
            say "seeded $class$path"
        elif [ -f "$path" ]; then
            cp -a "$path" "$source"
            say "seeded $class$path (file)"
        else
            # Nothing there yet (~/.cache on a fresh computer): owned like its nearest existing parent, so the agent
            # can write in its home and a new /var/lib/<service> belongs to root.
            mkdir -p "$source"
            parent=$(dirname "$path")
            while [ ! -e "$parent" ]; do parent=$(dirname "$parent"); done
            chown "$(stat -c %u:%g "$parent")" "$source"
        fi
    fi
    if [ -d "$source" ]; then
        # The mount point (inside an already kept folder, such as ~/.cache in the kept home) is owned like what is
        # mounted on it, so a later seed from it never makes the folder root's.
        [ -d "$path" ] || { mkdir -p "$path" && chown "$(stat -c %u:%g "$source")" "$path"; }
    elif [ ! -e "$path" ]; then
        mkdir -p "$(dirname "$path")"
        : >"$path"
    fi
    mount --bind "$source" "$path"
}

mkdir -p /keep/root /keep/system /keep/startup /cache/root
# Parents before children (/home/agent before /home/agent/.cache), each path once.
list=$(
    {
        printf '%s\n' "${COMPUTER_KEPT_PATHS:-/home/agent:/usr/local}" | tr ':' '\n' | sed 's/^/keep /'
        printf '%s\n' "$CACHE_PATHS" | tr ':' '\n' | sed 's/^/cache /'
    } | awk 'NF == 2 && !seen[$2]++ { print length($2), $1, $2 }' | sort -n | cut -d' ' -f2-
)
printf '%s\n' "$list" | while read -r class path; do
    [ -n "$path" ] || continue
    if allowed "$path"; then
        bind "$class" "$path" || say "could not keep $path (left as it is in the image)"
    else
        say "refused to keep $path: not a path that can be kept"
    fi
done
empty_tmp
say "kept and cached folders in place"
