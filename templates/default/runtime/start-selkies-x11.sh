#!/bin/sh
# Opt-in GNOME/X11 managed computer. Selkies uses X11 capture and XTEST
# input on this container-local display: no GNOME portal, host input or TCP port.
# The unprivileged owned media relay is the only ingress from Caddy.
set -eu
id=${COMPUTER_ID:?Managed computer ID is required}
case "$id" in
  ????????-????-????-????-????????????) ;; *) echo 'Invalid managed computer ID' >&2; exit 1;;
esac
case "$id" in *[!0-9a-f-]*) echo 'Invalid managed computer ID' >&2; exit 1;; esac
runtime=${XDG_RUNTIME_DIR:?}
encoder=${COMPUTER_STREAM_ENCODER:-h264enc}
case "$encoder" in h264enc|h265enc|jpeg) ;; *) echo 'Invalid computer encoder' >&2; exit 1;; esac
# Selkies parses ANY enum override as the complete published menu, so
# `--encoder=jpeg` alone advertises a one-item list and every client request to
# switch is refused. Keep the operator's encoder as the default and first stop,
# then the rest of the upstream menu, so a secure (HTTPS) viewer can negotiate a
# hardware H.264 stream while an insecure origin stays on the JPEG fallback its
# browser can actually decode.
encoder_menu="$encoder"
for encoder_candidate in h264enc h265enc vp8enc vp9enc av1enc h264enc-striped jpeg; do
    [ "$encoder_candidate" = "$encoder" ] || encoder_menu="$encoder_menu,$encoder_candidate"
done
child=''
cleanup() {
    [ -z "$child" ] || { kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; }
}
trap 'cleanup; exit 0' INT TERM
while :; do
    # The dashboard deliberately proxies no file browser, share/token or
    # upload endpoints. Hide and disable those upstream features rather than
    # advertising controls that cannot work (or bypassing the media allowlist).
    DISPLAY=:1 selkies --wayland=false \
        --addr=0.0.0.0 --port=8080 --subfolder="/computers/$id/desktop" \
        --enable-https=true --enable-basic-auth=false --enable-dual-mode=false --enable-resize=false --scaling-dpi=96 \
        --audio-enabled=true --audio-on-start=false --microphone-enabled=false --audio-device-name=swarm-output.monitor --gamepad-enabled=false --webcam-enabled=false \
        --enable-clipboard=false --file-transfers=none --printing-enabled=false \
        --ui-sidebar-show-audio-settings=false --ui-sidebar-show-gamepads=false \
        --ui-sidebar-show-webcam=false --ui-sidebar-show-clipboard=false \
        --ui-sidebar-show-files=false --ui-sidebar-show-apps=false \
        --ui-sidebar-show-sharing=false --encoder="$encoder_menu" --framerate=90 --jpeg-quality=50 \
        --enable-rate-control=true --rate-control-mode=crf --video-crf=25 \
        --use-paint-over-quality=true --video-paintover-crf=10 --video-paintover-burst-frames=2 \
        --video-streaming-mode=true --video-fullcolor=false --use-cpu=false \
        --force-aligned-resolution=false \
        >> "$runtime/selkies.log" 2>&1 &
    child=$!
    wait "$child" || true
    child=''
    # An interrupted streamer must not kill GNOME or discard its workspace.
    sleep 3
done
