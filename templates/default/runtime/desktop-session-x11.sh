#!/bin/sh
# Portal-free desktop, scoped to a managed Sysbox computer. Xvfb only listens
# on this container's local Unix socket; browser access stays behind Caddy's
# UUID-scoped media relay on the one dashboard port.
set -eu
runtime=${XDG_RUNTIME_DIR:?}
export DISPLAY=:1 XDG_SESSION_TYPE=x11
pipewire > "$runtime/pipewire.log" 2>&1 &
pipewire_pid=$!
wireplumber > "$runtime/wireplumber.log" 2>&1 &
wireplumber_pid=$!
# Present a 120 Hz virtual screen to GNOME; this is a target, not a promise
# that every app or remote JPEG frame can be encoded/delivered at 120 fps.
Xvfb :1 -screen 0 1920x1080x24 -fakescreenfps 120 -nolisten tcp +extension GLX +extension RANDR -dpi 96 > "$runtime/xvfb.log" 2>&1 &
xvfb_pid=$!
shell_pid=''
stream_pid=''
cleanup() {
    [ -z "$stream_pid" ] || kill "$stream_pid" 2>/dev/null || true
    [ -z "$shell_pid" ] || kill "$shell_pid" 2>/dev/null || true
    kill "$xvfb_pid" "$wireplumber_pid" "$pipewire_pid" 2>/dev/null || true
    [ -z "$stream_pid" ] || wait "$stream_pid" 2>/dev/null || true
    [ -z "$shell_pid" ] || wait "$shell_pid" 2>/dev/null || true
    wait "$xvfb_pid" "$wireplumber_pid" "$pipewire_pid" 2>/dev/null || true
    rm -f "$runtime/desktop-ready"
}
trap cleanup EXIT INT TERM
attempt=0
until xdpyinfo -display :1 >/dev/null 2>&1; do
    kill -0 "$xvfb_pid" 2>/dev/null || { echo 'Xvfb exited during startup' >&2; exit 1; }
    attempt=$((attempt+1)); [ "$attempt" -lt 50 ] || { echo 'Xvfb display not ready' >&2; exit 1; }
    sleep .2
done
dbus-update-activation-environment DISPLAY XDG_RUNTIME_DIR XDG_SESSION_TYPE XDG_CURRENT_DESKTOP >/dev/null
gnome-shell --x11 --mode=ubuntu > "$runtime/gnome-shell.log" 2>&1 &
shell_pid=$!
attempt=0
until gdbus call --session --timeout 2 --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.freedesktop.DBus.Peer.Ping >/dev/null 2>&1; do
    kill -0 "$shell_pid" 2>/dev/null || { echo 'GNOME X11 Shell exited during startup' >&2; tail -20 "$runtime/gnome-shell.log" >&2; exit 1; }
    attempt=$((attempt+1)); [ "$attempt" -lt 80 ] || { echo 'GNOME X11 Shell not ready' >&2; exit 1; }
    sleep .25
done
# Preview capture uses X11/XShm rather than a GNOME ScreenCast portal session.
# Controller readiness is the GNOME Shell itself, not a fabricated PipeWire ID.
printf 'ready\n' > "$runtime/desktop-ready"
/opt/swarm/start-selkies.sh > "$runtime/start-selkies.log" 2>&1 &
stream_pid=$!
wait "$shell_pid"
