# Opt-in portal-free GNOME/X11 variant for the trusted Tailnet HTTP/JPEG mode.
# Build the pinned JPEG base image first. A separate tag keeps Wayland rollback
# possible and preserves cached desktop/tool layers.
FROM agent-swarm-default:http-jpeg
USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb xauth x11-utils x11-xserver-utils mesa-vulkan-drivers && rm -rf /var/lib/apt/lists/*
COPY templates/default/runtime/desktop-session-x11.sh /opt/swarm/desktop-session.sh
COPY templates/default/runtime/start-selkies-x11.sh /opt/swarm/start-selkies.sh
COPY templates/default/runtime/render-preview-x11.sh /opt/swarm/render-preview.sh
COPY templates/default/runtime/launch-chrome-x11.sh /opt/swarm/launch-chrome.sh
# Prefer the system-wide GNOME desktop entry without editing the upstream one.
# Non-GPU computers still use the unmodified Chrome launch behavior.
RUN chmod 0755 /opt/swarm/desktop-session.sh /opt/swarm/start-selkies.sh /opt/swarm/render-preview.sh /opt/swarm/launch-chrome.sh \
    && mkdir -p /usr/local/share/applications \
    && sed 's#Exec=/usr/bin/google-chrome-stable#Exec=/opt/swarm/launch-chrome.sh#g' \
       /usr/share/applications/google-chrome.desktop > /usr/local/share/applications/google-chrome.desktop
USER agent
