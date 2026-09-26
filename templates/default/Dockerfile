# Ubuntu desktop foundation for both standalone workspaces and managed computers.
# Only the managed controller starts the desktop; Compose builds this image on demand.
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

# Ubuntu's visual defaults are essentials, not application bloat.
# Add atop the existing package layer to preserve its build cache.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ubuntu-settings \
        ubuntu-wallpapers-noble \
        librsvg2-common \
        gir1.2-dbusmenu-gtk3-0.4 \
    && rm -rf /var/lib/apt/lists/*

# C.UTF-8 is provided by Ubuntu's libc; no language-pack bundle is needed.
ENV LANG=C.UTF-8

# Workspace tools: retain the desktop layers above when these packages change.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg git build-essential python3 python3-venv tmux \
    && rm -rf /var/lib/apt/lists/*

# Native vendor packages, not Snap; keep browser/editor sandboxes enabled.
RUN install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub -o /tmp/google.asc \
    && gpg --batch --dearmor -o /etc/apt/keyrings/google.gpg /tmp/google.asc \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc -o /tmp/microsoft.asc \
    && gpg --batch --dearmor -o /etc/apt/keyrings/microsoft.gpg /tmp/microsoft.asc \
    && chmod 0644 /etc/apt/keyrings/*.gpg \
    && echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/google.gpg] https://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list \
    && echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/code stable main' > /etc/apt/sources.list.d/vscode.list \
    && echo 'code code/add-microsoft-repo boolean false' | debconf-set-selections \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends google-chrome-stable code \
    && rm -rf /var/lib/apt/lists/* /tmp/google.asc /tmp/microsoft.asc

COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=oven/bun:1.3.6 /usr/local/bin/bun /usr/local/bin/bun
COPY --from=ghcr.io/astral-sh/uv:0.9.18 /uv /uvx /usr/local/bin/

# Required for message reactions and Ubuntu's emoji rendering. Preserve cached desktop/tool layers.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Managed computers add GNOME/PipeWire capture and a sudo-capable workspace.
# Keep this after the desktop/tool layers for incremental rebuilds.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        sudo iproute2 gstreamer1.0-tools gstreamer1.0-pipewire gstreamer1.0-plugins-good \
    && printf 'ubuntu ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu \
    && rm -rf /var/lib/apt/lists/*
# Selkies 2.0.0 provides proven H.264/WebCodecs over WebSocket plus browser
# input. Keep its download, hash and apt dependencies in one incremental layer;
# source and matching amd64/arm64 release assets are under MPL-2.0.
RUN set -eu; arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) digest=bbaa4d71012b9374a753b7dfddc1da07e31f34b04277fe4fb3d045f18fd88391;; \
      arm64) digest=3900f3ba805898c495829629092553cc1cf4d5a864ffc4056f57d21646ad45e4;; \
      *) echo "Unsupported Selkies architecture: $arch" >&2; exit 1;; \
    esac; \
    curl -fLsS --retry 3 --max-time 150 "https://github.com/selkies-project/selkies/releases/download/2.0.0/selkies-2.0.0-ubuntu24.04-${arch}.deb" -o /tmp/selkies.deb; \
    echo "$digest  /tmp/selkies.deb" | sha256sum -c -; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends /tmp/selkies.deb mesa-va-drivers vainfo; \
    rm -rf /var/lib/apt/lists/* /tmp/selkies.deb
# Name the interactive guest account `agent`. uid/gid stay 1000 so a home volume
# created by an older image remains readable at its new mount point. Ubuntu's
# session identifiers (`--mode=ubuntu`, `XDG_CURRENT_DESKTOP=ubuntu:GNOME`,
# `/usr/share/ubuntu`) are distro names, not the account, and stay unchanged.
RUN set -eu \
    && usermod -l agent ubuntu \
    && groupmod -n agent ubuntu \
    && usermod -d /home/agent -m agent \
    && mv /etc/sudoers.d/ubuntu /etc/sudoers.d/agent \
    && sed -i 's/^ubuntu /agent /' /etc/sudoers.d/agent \
    && getent passwd agent | grep -q '^agent:x:1000:1000:' \
    && test -z "$(getent passwd ubuntu || true)"
COPY runtime/ /opt/swarm/
RUN chmod 0755 /opt/swarm/*.sh && chmod 0644 /opt/swarm/*.py
# Incremental guest toolchain additions stay after the existing desktop and
# browser layers but before the codec build argument: the H.264/H.265/JPEG
# variants share these cached layers. build-essential and uv already exist.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
# Pin the official npm release. --ignore-scripts avoids dependency lifecycle
# hooks; the package carries npm-shrinkwrap for its transitive dependencies.
# Install only the CLI, never host Pi settings, sessions, tokens or API keys.
RUN npm install -g --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent@0.87.1 \
    && pi --version
# Audited nvm-sh/nvm v0.40.5 (commit 1889911f0841e669de0be5bd02c737a3f1fd20fa).
# Vendor only nvm.sh, completion and MIT license. Source with --no-use so a
# fresh shell keeps the preinstalled system Node/npm until the user chooses.
COPY vendor/nvm/ /opt/swarm/vendor/nvm/
RUN install -d -m 0755 /home/agent/.nvm \
    && cp /opt/swarm/vendor/nvm/nvm.sh /opt/swarm/vendor/nvm/bash_completion /home/agent/.nvm/ \
    && chown -R agent:agent /home/agent/.nvm \
    && printf '%s\n' '' '# nvm (available without replacing the system Node by default)' \
       'export NVM_DIR="$HOME/.nvm"' \
       '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --no-use' \
       '[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"' >> /home/agent/.bashrc \
    && printf '%s\n' '# Source nvm in agent Bash login shells, without changing system Node by default.' \
       'if [ -n "${BASH_VERSION:-}" ] && [ "$(id -un)" = agent ] && [ -s /home/agent/.nvm/nvm.sh ]; then' \
       '  export NVM_DIR=/home/agent/.nvm' \
       '  . "$NVM_DIR/nvm.sh" --no-use' \
       'fi' > /etc/profile.d/nvm-agent.sh

# GNOME Task View-style desktops are workspaces inside each Computer. Keep
# one fixed workspace; pin Files, Chrome and the already-installed VS Code in
# Ubuntu Dock without changing its separate Trash icon. Schema defaults leave
# existing home-volume customizations alone; no owner desktop is restarted.
COPY gnome-workspace.gschema.override /usr/share/glib-2.0/schemas/90_swarm-computer.gschema.override
RUN glib-compile-schemas /usr/share/glib-2.0/schemas

# Operator-built HTTP/LAN variant uses JPEG/createImageBitmap instead of
# browser-secure-context WebCodecs; H.264/H.265 builds retain JPEG as a
# negotiated HTTP fallback rather than enabling software codecs implicitly.
ARG COMPUTER_STREAM_ENCODER=h264enc
RUN case "$COMPUTER_STREAM_ENCODER" in h264enc|h265enc|jpeg) ;; *) echo 'Unsupported computer encoder' >&2; exit 1;; esac
ENV COMPUTER_STREAM_ENCODER=$COMPUTER_STREAM_ENCODER

# Docker initializes fresh named volumes from these image directories.
# Do not declare anonymous VOLUMEs or overwrite existing user files at startup.
RUN chown agent:agent /workspace
# This is intentionally the Linux editor, including when Docker runs on WSL2.
ENV HOME=/home/agent DONT_PROMPT_WSL_INSTALL=1
USER agent

# The standalone image remains idle until the managed controller starts it.
CMD ["sleep", "infinity"]
