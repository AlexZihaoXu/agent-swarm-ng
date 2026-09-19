# Package foundation only: desktop session startup and streaming are not wired yet.
# Not built or launched by platform Compose.
FROM ubuntu:24.04
WORKDIR /workspace

# Explicit essentials instead of ubuntu-desktop and its recommended applications.
# Keep package installation ahead of future session scripts for build-cache reuse.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ubuntu-session \
        gnome-control-center \
        gnome-terminal \
        nautilus \
        gnome-shell-extension-ubuntu-dock \
        gnome-shell-extension-appindicator \
        yaru-theme-gtk \
        yaru-theme-icon \
        fonts-ubuntu \
        dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

# No desktop processes run until the session/streaming integration is implemented.
CMD ["sleep", "infinity"]
