#!/bin/sh
# Run as ubuntu in its desktop runtime; write no persistent screenshot files.
set -eu
runtime=${XDG_RUNTIME_DIR:?}
case "${1:-}" in
    '') size='video/x-raw,width=480,height=270'; quality=72;;
    --full) size='video/x-raw,width=1920,height=1080'; quality=80;;
    *) echo 'Invalid preview size' >&2; exit 1;;
esac
node=$(cat "$runtime/screencast-node")
case "$node" in ''|*[!0-9]*) echo 'Screen capture is not ready' >&2; exit 1;; esac
frame=$(mktemp "$runtime/preview-XXXXXX.jpg")
trap 'rm -f "$frame"' EXIT INT TERM
# Mutter's GNOME 46 monitor offers fixed 1920x1080 BGRA with variable 0/1
# frame rate. A different source caps filter can hang indefinitely at PAUSED.
timeout 12s gst-launch-1.0 -q \
    pipewiresrc target-object="$node" num-buffers=1 ! \
    'video/x-raw,format=BGRA,width=1920,height=1080,framerate=0/1' ! \
    videoconvert ! videoscale ! "$size" ! \
    jpegenc quality="$quality" ! filesink location="$frame" >&2 &
gst_pid=$!
trap 'kill "$gst_pid" 2>/dev/null || true; rm -f "$frame"' EXIT INT TERM
# Headless GNOME has no session manager auto-linking private monitor capture
# ports. Link the known, local Shell output to this short-lived GStreamer input.
attempt=0
until pw-link 'gnome-shell:output_1' 'gst-launch-1.0:input_1' >/dev/null 2>&1; do
    kill -0 "$gst_pid" 2>/dev/null || { wait "$gst_pid"; exit 1; }
    attempt=$((attempt + 1))
    [ "$attempt" -lt 80 ] || { echo 'The preview PipeWire input did not appear' >&2; exit 1; }
    sleep 0.1
done
wait "$gst_pid"
[ "$(wc -c < "$frame")" -gt 200 ] || { echo 'The desktop frame was empty' >&2; exit 1; }
base64 -w 0 "$frame"
