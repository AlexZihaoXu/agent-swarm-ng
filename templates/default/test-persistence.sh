#!/bin/sh
# Host-side integration test; only removes the unique test project's resources.
set -eu
export MSYS_NO_PATHCONV=1
project="agent-swarm-persistence-test-$(date +%s)-$$"
directory=$(dirname -- "$0")
compose() { docker compose -p "$project" -f "$directory/compose.yaml" "$@"; }
trap 'compose down --volumes' EXIT

compose run --rm -T --no-deps workspace sh -eu -c '
    test "$(id -un)" = agent
    printf home-survives > "$HOME/persistence-check"
    printf workspace-survives > /workspace/persistence-check
'
# The first container has been removed. A new one must see the same files.
compose run --rm -T --no-deps workspace sh -eu -c '
    test "$(cat "$HOME/persistence-check")" = home-survives
    test "$(cat /workspace/persistence-check)" = workspace-survives
'
printf 'Home and workspace data survived container replacement.\n'
