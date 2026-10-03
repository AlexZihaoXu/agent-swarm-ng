# Opt-in Xorg dummy 1920x1080@120 variant of the approved GNOME X11/JPEG
# desktop. Reuse the existing cached GPU/DPI browser layers and keep an
# independent image tag for a volume-preserving rollback to Xvfb.
# The default base is the live X11 tag; disposable gates pass their own
# freshly built base so they never retag a creation image in use.
ARG COMPUTER_X11_BASE=agent-swarm-default:http-jpeg-x11
FROM ${COMPUTER_X11_BASE}
USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xserver-xorg-core xserver-xorg-video-dummy && rm -rf /var/lib/apt/lists/*
COPY templates/default/runtime/desktop-session-xorg120.sh /opt/swarm/desktop-session.sh
COPY templates/default/runtime/xorg-dummy-120.conf /opt/swarm/xorg-dummy.conf
# Agent recordings (recording.py) and the input scripts that log their events for it. A late layer, so the
# cached desktop layers stay; python3-pil draws terminal screens. Before the storage baseline, so it counts as
# part of the image.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3-pil && rm -rf /var/lib/apt/lists/*
COPY templates/default/runtime/recording.py templates/default/runtime/computer-use.py templates/default/runtime/computer-terminal.py /opt/swarm/
# Harness assist: adapters for Claude Code, Codex, OpenCode and Pi that agents install with the human's consent, and the
# follower their harness listeners run (docs/agent-computer-use.md#harness-listeners). Read-only for the agent user.
COPY templates/default/runtime/harness-assist /opt/swarm/harness-assist
RUN chmod 0755 /opt/swarm/desktop-session.sh && chmod 0644 /opt/swarm/xorg-dummy.conf /opt/swarm/*.py \
    && chmod -R u=rwX,go=rX /opt/swarm/harness-assist && chmod 0755 /opt/swarm/harness-assist/install \
    && rm -rf /opt/swarm/harness-assist/__pycache__ \
    && /opt/swarm/computer-storage-baseline.sh
USER agent
