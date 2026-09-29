#!/bin/sh
set -eu
runtime=${XDG_RUNTIME_DIR:?}
pipewire > "$runtime/pipewire.log" 2>&1 &
pipewire_pid=$!
# WirePlumber and the PulseAudio bridge connect to PipeWire's socket; starting them in the
# same instant raced it. pipewire-pulse gives browsers (PulseAudio clients) an audio server.
until [ -S "$runtime/pipewire-0" ] || ! kill -0 "$pipewire_pid" 2>/dev/null; do sleep 0.05; done
wireplumber > "$runtime/wireplumber.log" 2>&1 &
wireplumber_pid=$!
pipewire-pulse > "$runtime/pipewire-pulse.log" 2>&1 &
pulse_pid=$!
gnome-shell --wayland --headless --no-x11 --virtual-monitor 1920x1080 --mode=ubuntu > "$runtime/gnome-shell.log" 2>&1 &
shell_pid=$!
cast_pid=''
stream_pid=''
link_pid=''
cleanup() {
    [ -z "$cast_pid" ] || kill "$cast_pid" 2>/dev/null || true
    [ -z "$link_pid" ] || kill "$link_pid" 2>/dev/null || true
    [ -z "$stream_pid" ] || kill "$stream_pid" 2>/dev/null || true
    kill "$shell_pid" "$pulse_pid" "$wireplumber_pid" "$pipewire_pid" 2>/dev/null || true
    wait "$shell_pid" "$pulse_pid" "$wireplumber_pid" "$pipewire_pid" 2>/dev/null || true
    [ -z "$stream_pid" ] || wait "$stream_pid" 2>/dev/null || true
    [ -z "$link_pid" ] || wait "$link_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
attempt=0
until [ -S "$runtime/pipewire-0" ] && gdbus call --session --timeout 2 \
    --dest org.gnome.Mutter.DisplayConfig --object-path /org/gnome/Mutter/DisplayConfig \
    --method org.gnome.Mutter.DisplayConfig.GetCurrentState 2>/dev/null | grep -q '1920, 1080'; do
    kill -0 "$shell_pid" 2>/dev/null || { echo 'GNOME exited before its monitor became ready' >&2; exit 1; }
    attempt=$((attempt + 1))
    [ "$attempt" -lt 60 ] || { echo 'GNOME monitor did not become ready' >&2; exit 1; }
    sleep 0.5
done
# D-Bus-activated GNOME applications must inherit the virtual Wayland display.
export WAYLAND_DISPLAY=wayland-0
dbus-update-activation-environment WAYLAND_DISPLAY XDG_RUNTIME_DIR XDG_CURRENT_DESKTOP >/dev/null
# This is a separate interactive stream, not one streamer per dashboard card.
# It runs only in a managed computer, not in the standalone workspace image.
if [ -n "${COMPUTER_ID:-}" ]; then
    /opt/swarm/start-selkies.sh > "$runtime/start-selkies.log" 2>&1 &
    stream_pid=$!
    /usr/bin/python3 /opt/swarm/link-selkies.py > "$runtime/link-selkies.log" 2>&1 &
    link_pid=$!
fi
while kill -0 "$shell_pid" 2>/dev/null; do
    /usr/bin/python3 /opt/swarm/screencast.py > "$runtime/screencast.log" 2>&1 &
    cast_pid=$!
    wait "$cast_pid" || true
    cast_pid=''
    rm -f "$runtime/screencast-node" "$runtime/desktop-ready"
    kill -0 "$shell_pid" 2>/dev/null || break
    sleep 1
done
wait "$shell_pid" || exit 1
