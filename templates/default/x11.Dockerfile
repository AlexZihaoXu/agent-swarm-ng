# Opt-in portal-free GNOME/X11 variant for the trusted Tailnet viewer.
# Build the approved encoder-selected base image first. The default base pins
# CPU JPEG for insecure origins; pass COMPUTER_STREAM_BASE=agent-swarm-default:stage2
# to build the WebCodecs (H.264-default) variant for the HTTPS listener.
# A separate tag keeps Wayland rollback possible and preserves cached
# desktop/tool layers.
ARG COMPUTER_STREAM_BASE=agent-swarm-default:http-jpeg
FROM ${COMPUTER_STREAM_BASE}
LABEL swarm.ng.display-server="x11"
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
