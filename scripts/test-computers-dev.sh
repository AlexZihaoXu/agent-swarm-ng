#!/bin/sh
# Destructive isolated-dev E2E only. Never mount the live .local database.
set -eu
[ "$(uname -s)" = Linux ] || { echo 'This sandboxed browser harness targets Linux Docker.' >&2; exit 1; }
project="sng-comp-test-$(date +%M%S)-$$"
export COMPUTER_NAMESPACE="$project" COMPUTER_TEST_NAMESPACE="$project"
root=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
cd "$root"
mkdir -p .scratch
bun_bin=$(command -v bun)
compose() { docker compose -p "$project" -f compose.yaml -f compose.dev.yaml "$@"; }
cleanup() {
    status=$?
    trap - EXIT INT TERM
    # Only the fresh test namespace can be matched. Remove its labelled
    # computers first, then this unique Compose project's data and networks.
    ids=$(docker ps -aq --filter "label=swarm.ng.namespace=$project")
    [ -z "$ids" ] || docker rm -f $ids >/dev/null 2>&1 || true
    volumes=$(docker volume ls -q --filter "label=swarm.ng.namespace=$project")
    [ -z "$volumes" ] || docker volume rm $volumes >/dev/null 2>&1 || true
    networks=$(docker network ls -q --filter "label=swarm.ng.namespace=$project")
    [ -z "$networks" ] || docker network rm $networks >/dev/null 2>&1 || true
    # A prior shared image may have stamped a disposable Compose project label
    # onto a *different* managed computer. Never let down remove that guest.
    foreign=0
    for candidate in $(docker ps -aq --filter "label=com.docker.compose.project=$project"); do
        owner=$(docker inspect "$candidate" --format '{{index .Config.Labels "swarm.ng.namespace"}}')
        if [ -n "$owner" ] && [ "$owner" != '<no value>' ] && [ "$owner" != "$project" ]; then foreign=1; fi
    done
    if [ "$foreign" -eq 0 ]; then compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    else echo 'Refusing Compose down: a foreign managed container inherited this test project label.' >&2; status=1; fi
    # Only images built and labelled for this unique Compose project are
    # disposable; retain the approved shared computer/egress/media templates.
    for service in backend frontend computer-controller; do
        image="$project-$service:latest"
        if [ "$(docker image inspect "$image" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)" = "$project" ]; then
            docker image rm "$image" >/dev/null 2>&1 || { echo "Could not remove test image: $image" >&2; status=1; }
        fi
    done
    if [ -n "$(docker ps -aq --filter "label=swarm.ng.namespace=$project")$(docker volume ls -q --filter "label=swarm.ng.namespace=$project")$(docker network ls -q --filter "label=swarm.ng.namespace=$project")$(docker ps -aq --filter "label=com.docker.compose.project=$project")$(docker volume ls -q --filter "label=com.docker.compose.project=$project")$(docker network ls -q --filter "label=com.docker.compose.project=$project")" ]; then
        echo 'Some test-labelled Docker resources could not be removed.' >&2
        status=1
    fi
    exit "$status"
}
if [ -n "$(docker ps -aq --filter "label=swarm.ng.namespace=$project")$(docker volume ls -q --filter "label=swarm.ng.namespace=$project")$(docker network ls -q --filter "label=swarm.ng.namespace=$project")$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ]; then
    echo 'Test namespace already exists; refusing to clean another run.' >&2; exit 1
fi
if python3 -c 'import socket; s=socket.socket(); s.settimeout(0.3); code=s.connect_ex(("127.0.0.1",5173)); s.close(); raise SystemExit(code != 0)' ; then
    echo 'Port 5173 is already in use; refusing to test another dashboard.' >&2; exit 1
fi
trap cleanup EXIT INT TERM
# The optional Tailnet probe uses the host's current address; never hardcode it
# in a tracked test. The web app remains accessible only via loopback:5173.
if command -v tailscale >/dev/null 2>&1; then export COMPUTER_TEST_TAILNET_IP="$(tailscale ip -4 2>/dev/null || true)"; fi
# Shared managed images must not inherit this disposable Compose project's
# com.docker.compose.* labels: the Docker API otherwise copies them onto live
# gateway/media containers, making test cleanup mistake live resources for its own.
docker build -t agent-swarm-default:stage2 templates/default
docker build -t agent-swarm-computer-egress:dev -f templates/default/egress.Dockerfile templates/default
docker build -t agent-swarm-computer-media:stage2 -f templates/default/media.Dockerfile templates/default
sh scripts/prepare-selkies-client.sh
compose build backend frontend computer-controller
compose up --no-build -d || { compose logs --tail=30 backend computer-controller frontend caddy-dev >&2 || true; exit 1; }
attempt=0
until curl -fsS --max-time 2 http://127.0.0.1:5173/api/computers >/dev/null 2>&1; do
    attempt=$((attempt+1)); [ "$attempt" -lt 180 ] || { compose ps; echo 'Dev dashboard did not become ready.' >&2; exit 1; }
    sleep 1
done
sh scripts/test-computers-api.sh
# This uses one dedicated Linux browser, one worker, zero retries. No Windows
# browser/profile is launched and no production Tailnet URL is opened.
browser() {
    docker run --rm --network host --user "$(id -u):$(id -g)" \
        --security-opt "seccomp=$root/templates/default/security/chromium-seccomp.json" \
        --security-opt no-new-privileges:true --cap-add SYS_CHROOT \
        -v "$root":/work -v "$bun_bin":/usr/local/bin/bun:ro -w /work \
        -e COMPUTER_E2E_ALLOW=1 -e COMPUTER_E2E_PERF="${COMPUTER_E2E_PERF:-}" \
        -e COMPUTER_E2E_ENCODER="$(if [ -n "${COMPUTER_RENDER_DEVICE:-}" ]; then echo vaapi; else echo software; fi)" \
        -e PLAYWRIGHT_BROWSERS_PATH=/work/.scratch/ms-playwright \
        mcr.microsoft.com/playwright/python:v1.62.0-noble \
        /usr/local/bin/bun run --cwd frontend "$@"
}
browser playwright install chromium-headless-shell
if ! browser test:e2e --config playwright.computers.config.ts --workers=1 --retries=0; then
    # Bounded, non-secret capture diagnostics from only this test namespace;
    # no guest credentials, provider logs or unrelated Docker containers.
    : > .scratch/computers-failed-stream-diagnostics.log
    for container in $(docker ps -q --filter "label=swarm.ng.namespace=$project" --filter 'label=swarm.ng.role=desktop'); do
        docker exec "$container" sh -c "grep -E '^\\[HostCapture\\]|^INFO:ws:Client|^WARNING:ws:Capture' /run/user/1000/selkies.log | tail -45" >> .scratch/computers-failed-stream-diagnostics.log 2>/dev/null || true
        docker exec -u ubuntu -e XDG_RUNTIME_DIR=/run/user/1000 "$container" sh -c 'pw-link -oI; pw-link -iI; pw-link -l' >> .scratch/computers-failed-stream-diagnostics.log 2>/dev/null || true
    done
    echo 'Browser E2E failed; scoped Selkies/PipeWire diagnostics saved in .scratch before cleanup.' >&2
    exit 1
fi
if [ "${COMPUTER_FULL_BROWSER:-}" = 1 ]; then
    browser test:e2e --config ../.scratch/playwright-computers-full.config.ts --workers=1 --retries=0
fi
printf 'Computers dev API and browser E2E passed; removing this test project.\n'
