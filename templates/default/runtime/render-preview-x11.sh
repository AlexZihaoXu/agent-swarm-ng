#!/bin/sh
# X11 desktop preview: on-demand bounded screenshot, no portal session or
# permanent recording. Run only as the computer's ubuntu user.
set -eu
case "${1:-}" in
    '') size='video/x-raw,width=480,height=270';quality=72;;
    --full) size='video/x-raw,width=1920,height=1080';quality=80;;
    *) echo 'Invalid preview size' >&2; exit 1;;
esac
export DISPLAY=:1
runtime=${XDG_RUNTIME_DIR:?}
frame=$(mktemp "$runtime/preview-x11-XXXXXX.jpg")
trap 'rm -f "$frame"' EXIT INT TERM
timeout 12s gst-launch-1.0 -q ximagesrc display-name=:1 num-buffers=1 use-damage=false ! \
    videoconvert ! videoscale ! "$size" ! jpegenc quality="$quality" ! filesink location="$frame" >&2
[ "$(wc -c < "$frame")" -gt 200 ] || { echo 'The desktop frame was empty' >&2; exit 1; }
base64 -w 0 "$frame"
