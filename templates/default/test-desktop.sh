#!/bin/sh
# GNOME compositor smoke test, not a complete session or streaming test.
# Run with --user root --init --tmpfs /run --shm-size=256m.
# The disposable container starts as root; the desktop itself runs as agent.
set -eu
mkdir -p /run/dbus
dbus-daemon --system --fork
install -d -m 700 -o agent -g agent /tmp/gnome-runtime

runuser -u agent -- env \
    XDG_RUNTIME_DIR=/tmp/gnome-runtime \
    XDG_SESSION_TYPE=wayland \
    XDG_CURRENT_DESKTOP=ubuntu:GNOME \
    XDG_DATA_DIRS=/usr/share/ubuntu:/usr/local/share:/usr/share \
    GNOME_SHELL_SESSION_MODE=ubuntu \
    LIBGL_ALWAYS_SOFTWARE=1 \
    dbus-run-session -- sh <<'SESSION'
set -eu
log="$XDG_RUNTIME_DIR/gnome-shell.log"
gnome-shell --wayland --headless --no-x11 --virtual-monitor 1920x1080 --mode=ubuntu >"$log" 2>&1 &
shell_pid=$!
trap 'kill "$shell_pid" 2>/dev/null || true; wait "$shell_pid" 2>/dev/null || true; cat "$log"' EXIT

# Wait for the compositor to expose a real display through D-Bus, not just a live PID.
attempt=0
while [ "$attempt" -lt 30 ]; do
    if ! kill -0 "$shell_pid" 2>/dev/null; then
        echo 'GNOME Shell exited before becoming ready.' >&2
        exit 1
    fi
    if gdbus call --session --timeout 2 \
        --dest org.gnome.Mutter.DisplayConfig \
        --object-path /org/gnome/Mutter/DisplayConfig \
        --method org.gnome.Mutter.DisplayConfig.GetCurrentState \
        >"$XDG_RUNTIME_DIR/display-state" 2>/dev/null \
        && grep -q '1920, 1080' "$XDG_RUNTIME_DIR/display-state" \
        && gdbus call --session --timeout 2 \
            --dest org.gnome.Shell --object-path /org/gnome/Shell \
            --method org.freedesktop.DBus.Properties.Get org.gnome.Shell ShellVersion \
            >"$XDG_RUNTIME_DIR/shell-version" 2>/dev/null; then
        cat "$XDG_RUNTIME_DIR/display-state"
        echo 'GNOME headless compositor check passed (software rendering, 1920x1080).'
        exit 0
    fi
    attempt=$((attempt + 1))
    sleep 1
done
echo 'GNOME compositor readiness timed out.' >&2
exit 1
SESSION
