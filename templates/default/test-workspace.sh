#!/bin/sh
# Run inside the image as its default user.
set -eu

test "$(id -un)" = agent
test "$HOME" = /home/agent
test -w "$HOME"
test -w /workspace

for command in google-chrome code git curl make gcc g++ ffmpeg node npm bun python3 uv pi tmux; do
    command -v "$command" >/dev/null
done

google-chrome --version
code --version
node --version
npm --version
bun --version
python3 --version
uv --version
pi --version
ffmpeg -version | head -1
# nvm is a sourced shell function, not an executable. Sourcing it must leave
# the pinned system Node/npm in place until the guest explicitly selects one.
SYSTEM_NODE="$(node --version)"; export SYSTEM_NODE
bash -ic 'command -v nvm >/dev/null && test "$(nvm --version)" = 0.40.5 && test "$(node --version)" = "$SYSTEM_NODE"' 2>/dev/null
bash -lc 'command -v nvm >/dev/null && test "$(nvm --version)" = 0.40.5 && test "$(node --version)" = "$SYSTEM_NODE"' 2>/dev/null
test ! -e "$HOME/.pi/agent/auth.json"

# Validate that tmux can retain a session across separate client connections.
socket="workspace-test-$$"
trap 'tmux -L "$socket" kill-server 2>/dev/null || true' EXIT
tmux -L "$socket" new-session -d -s smoke 'sleep 60'
tmux -L "$socket" has-session -t smoke
printf 'Workspace tools and tmux checks passed. GUI launch needs a desktop session.\n'
