#!/bin/sh
# The GNOME Chrome launcher uses the explicitly granted Radeon render node for
# WebGL/WebGL2. On computers without that operator grant, retain Chrome's
# default software-safe path. Never disable Chromium's sandbox or GPU blocklist.
set -eu
if [ "${COMPUTER_GPU_RENDER_DEVICE:-}" = /dev/dri/renderD128 ] &&
   [ -r /dev/dri/renderD128 ] && [ -r /usr/share/vulkan/icd.d/radeon_icd.json ]; then
    export VK_DRIVER_FILES=/usr/share/vulkan/icd.d/radeon_icd.json
    # GNOME/Xvfb itself needs software GL; that session setting must not force
    # guest Chrome's own hardware Vulkan WebGL context back to software.
    unset LIBGL_ALWAYS_SOFTWARE
    # Xvfb has no DRI3 presentation path. Keep GPU WebGL through ANGLE, but
    # compose browser windows in software for this virtual X11 framebuffer.
    exec /usr/bin/google-chrome-stable --use-angle=vulkan --disable-gpu-compositing "$@"
fi
exec /usr/bin/google-chrome-stable "$@"
