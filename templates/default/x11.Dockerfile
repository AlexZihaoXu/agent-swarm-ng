# Opt-in portal-free GNOME/X11 variant for the trusted Tailnet HTTP/JPEG mode.
# Build the pinned JPEG base image first. A separate tag keeps Wayland rollback
# possible and preserves cached desktop/tool layers.
FROM agent-swarm-default:http-jpeg
USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb xauth x11-utils x11-xserver-utils && rm -rf /var/lib/apt/lists/*
COPY templates/default/runtime/desktop-session-x11.sh /opt/swarm/desktop-session.sh
COPY templates/default/runtime/start-selkies-x11.sh /opt/swarm/start-selkies.sh
COPY templates/default/runtime/render-preview-x11.sh /opt/swarm/render-preview.sh
RUN chmod 0755 /opt/swarm/desktop-session.sh /opt/swarm/start-selkies.sh /opt/swarm/render-preview.sh
USER ubuntu
