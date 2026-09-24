#!/bin/sh
# Only managed computers start this server. Docker does not publish its port;
# a per-computer, unprivileged media relay is the sole ingress from Caddy.
set -eu
id=${COMPUTER_ID:?Managed computer ID is required}
case "$id" in
  ????????-????-????-????-????????????) ;; *) echo 'Invalid managed computer ID' >&2; exit 1;;
esac
case "$id" in *[!0-9a-f-]*) echo 'Invalid managed computer ID' >&2; exit 1;; esac
runtime=${XDG_RUNTIME_DIR:?}
child=''
cleanup() {
    [ -z "$child" ] || { kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; }
}
trap 'cleanup; exit 0' INT TERM
while :; do
    selkies --wayland=true --wayland-host-display=wayland-0 \
        --addr=0.0.0.0 --port=8080 --subfolder="/computers/$id/desktop" \
        --enable-https=true --enable-basic-auth=false --enable-resize=false \
        --audio-enabled=false --gamepad-enabled=false --webcam-enabled=false \
        --enable-clipboard=false --encoder=h264enc --framerate=30 \
        >> "$runtime/selkies.log" 2>&1 &
    child=$!
    wait "$child" || true
    child=''
    # An interrupted streamer must not kill GNOME or discard its workspace.
    sleep 3
done
