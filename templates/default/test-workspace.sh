#!/bin/sh
# Run inside the image as its default user.
set -eu

test "$(id -un)" = ubuntu
test "$HOME" = /home/ubuntu
test -w "$HOME"
test -w /workspace

for command in google-chrome code git curl make gcc g++ node npm bun python3 uv tmux; do
    command -v "$command" >/dev/null
done

google-chrome --version
code --version
node --version
npm --version
bun --version
python3 --version
uv --version

# Validate that tmux can retain a session across separate client connections.
socket="workspace-test-$$"
trap 'tmux -L "$socket" kill-server 2>/dev/null || true' EXIT
tmux -L "$socket" new-session -d -s smoke 'sleep 60'
tmux -L "$socket" has-session -t smoke
printf 'Workspace tools and tmux checks passed. GUI launch needs a desktop session.\n'
