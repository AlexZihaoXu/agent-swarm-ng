# Opt-in Xorg dummy 1920x1080@120 variant of the approved GNOME X11/JPEG
# desktop. Reuse the existing cached GPU/DPI browser layers and keep an
# independent image tag for a volume-preserving rollback to Xvfb.
FROM agent-swarm-default:http-jpeg-x11
USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xserver-xorg-core xserver-xorg-video-dummy && rm -rf /var/lib/apt/lists/*
COPY templates/default/runtime/desktop-session-xorg120.sh /opt/swarm/desktop-session.sh
COPY templates/default/runtime/xorg-dummy-120.conf /opt/swarm/xorg-dummy.conf
RUN chmod 0755 /opt/swarm/desktop-session.sh && chmod 0644 /opt/swarm/xorg-dummy.conf
USER ubuntu
