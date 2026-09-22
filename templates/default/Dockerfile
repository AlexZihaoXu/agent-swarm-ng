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

# Docker initializes fresh named volumes from these image directories.
# Do not declare anonymous VOLUMEs or overwrite existing user files at startup.
RUN chown ubuntu:ubuntu /workspace
# This is intentionally the Linux editor, including when Docker runs on WSL2.
ENV HOME=/home/ubuntu DONT_PROMPT_WSL_INSTALL=1
USER ubuntu

# No desktop processes run until the session/streaming integration is implemented.
CMD ["sleep", "infinity"]
