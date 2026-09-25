#!/bin/sh
# Opt-in destructive E2E against a uniquely named disposable X11 GNOME computer.
# Never mount project .local or the owner's browser profile.
set -eu
cd "$(dirname "$0")/.."
project="sng-x11-test-$(date +%M%S)-$$"
export COMPUTER_NAMESPACE="$project"
# Do not retag the image selected by the running live controller while a
# disposable test project builds or creates computers.
export TEST_X11_IMAGE=agent-swarm-default:http-jpeg-x11-120-quality50-candidate
compose() { docker compose -p "$project" -f compose.yaml -f compose.dev.yaml -f scripts/compose.test-x11.yaml "$@"; }
cleanup() {
    status=$?
    trap - EXIT INT TERM
    if [ "$status" -ne 0 ]; then
        candidate=$(docker ps -q --filter "label=swarm.ng.namespace=$project" --filter 'label=swarm.ng.role=desktop' | head -1)
        [ -z "$candidate" ] || docker exec "$candidate" sh -c 'tail -36 /run/user/1000/selkies.log' 2>/dev/null | cut -c1-230 || true
    fi
    ids=$(docker ps -aq --filter "label=swarm.ng.namespace=$project")
    [ -z "$ids" ] || docker rm -f $ids >/dev/null 2>&1 || true
    volumes=$(docker volume ls -q --filter "label=swarm.ng.namespace=$project")
    [ -z "$volumes" ] || docker volume rm $volumes >/dev/null 2>&1 || true
    networks=$(docker network ls -q --filter "label=swarm.ng.namespace=$project")
    [ -z "$networks" ] || docker network rm $networks >/dev/null 2>&1 || true
    # Compose image labels can be inherited by separately managed computers.
    # Refuse broad project cleanup if any other namespace is mislabeled as
    # ours, even though our own strict swarm.ng.namespace cleanup is safe.
    foreign=0
    for candidate in $(docker ps -aq --filter "label=com.docker.compose.project=$project"); do
        owner=$(docker inspect "$candidate" --format '{{index .Config.Labels "swarm.ng.namespace"}}')
        if [ -n "$owner" ] && [ "$owner" != '<no value>' ] && [ "$owner" != "$project" ]; then foreign=1; fi
    done
    if [ "$foreign" -eq 0 ]; then compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    else echo 'Refusing Compose down: a foreign managed container inherited this test project label.' >&2; status=1; fi
    for service in backend frontend computer-controller; do
        image="$project-$service:latest"
        if [ "$(docker image inspect "$image" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)" = "$project" ]; then docker image rm "$image" >/dev/null 2>&1 || status=1; fi
    done
    if [ -n "$(docker ps -aq --filter "label=swarm.ng.namespace=$project")$(docker volume ls -q --filter "label=swarm.ng.namespace=$project")$(docker network ls -q --filter "label=swarm.ng.namespace=$project")$(docker ps -aq --filter "label=com.docker.compose.project=$project")$(docker volume ls -q --filter "label=com.docker.compose.project=$project")" ]; then status=1; fi
    exit "$status"
}
[ -z "$(docker ps -aq --filter "label=swarm.ng.namespace=$project")" ] || exit 1
trap cleanup EXIT INT TERM
# Build shared managed images directly rather than via this disposable Compose
# project. Compose image labels would be inherited by live child containers,
# allowing a test project's cleanup to mistake those containers for its own.
docker build -t agent-swarm-default:stage2 templates/default
docker build -t agent-swarm-computer-egress:dev -f templates/default/egress.Dockerfile templates/default
docker build -t agent-swarm-computer-media:stage2 -f templates/default/media.Dockerfile templates/default
docker build -t agent-swarm-default:http-jpeg --build-arg COMPUTER_STREAM_ENCODER=jpeg templates/default
docker build -t "$TEST_X11_IMAGE" -f templates/default/x11.Dockerfile .
sh scripts/prepare-selkies-client.sh
test "$(sha256sum .scratch/selkies-client-web/assets/selkies-core-BbKps5RD.js | cut -d ' ' -f 1)" = 633f8909c4ef14c2a3c178292f4b6d47dbacbf71ccd55060ace4db623b000c52
compose build backend frontend computer-controller
compose up --no-build -d
for i in $(seq 1 40); do
    if curl -fsS --max-time 2 http://127.0.0.1:5173/api/health >/dev/null 2>&1; then break; fi
    sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:5173/api/health >/dev/null
# Create only one disposable labelled GNOME computer in this namespace.
id=$(curl -fsS --max-time 110 -X POST http://127.0.0.1:5173/api/computers \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"Portal-free disposable probe\",\"requestKey\":\"$(cat /proc/sys/kernel/random/uuid)\"}" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
container="$project-computer-$id"
[ "$(docker inspect "$container" --format '{{index .Config.Labels "swarm.ng.namespace"}}')" = "$project" ]
[ "$(docker inspect "$container" --format '{{index .Config.Labels "swarm.ng.id"}}')" = "$id" ]
[ "$(docker inspect "$container" --format '{{.State.Running}}')" = true ]
echo 'Created disposable X11 GNOME desktop; waiting for its JPEG preview.'
ready=0
for attempt in $(seq 1 35); do
    if curl -fsS --max-time 12 "http://127.0.0.1:5173/api/computers/$id/preview?full=1" -o .scratch/x11-gnome-preview.jpg 2>/dev/null; then ready=1; break; fi
    sleep 2
done
if [ "$ready" -ne 1 ]; then
    docker exec "$container" sh -c 'tail -32 /run/user/1000/gnome-shell.log; tail -20 /run/user/1000/xvfb.log; tail -15 /run/user/1000/start-selkies.log' >&2 || true
    exit 1
fi
file .scratch/x11-gnome-preview.jpg
python3 - "$container" "$project" "$id" <<'PY'
import json,subprocess,sys
computer,namespace,id=sys.argv[1:]
c=json.loads(subprocess.check_output(['docker','inspect',computer]))[0]
assert c['Config']['Labels']['swarm.ng.namespace']==namespace and c['Config']['Labels']['swarm.ng.id']==id
assert c['HostConfig']['Runtime']=='sysbox-runc' and c['HostConfig']['CapDrop']==['ALL']
assert not c['HostConfig'].get('PortBindings') and not c['HostConfig'].get('Devices')
assert {m['Destination']:m['Name'] for m in c['Mounts'] if m['Type']=='volume'}=={
    '/home/ubuntu':computer+'-home','/workspace':computer+'-workspace'}
network=json.loads(subprocess.check_output(['docker','network','inspect',computer+'-private']))[0]
assert network['Internal'] and not network['EnableIPv6']
assert network['Options']['com.docker.network.bridge.gateway_mode_ipv4']=='isolated'
relay=json.loads(subprocess.check_output(['docker','inspect',computer+'-media']))[0]
assert relay['State']['Running'] and not relay['HostConfig'].get('PortBindings')
assert relay['HostConfig']['ReadonlyRootfs'] and relay['HostConfig']['CapDrop']==['ALL'] and not relay['Mounts']
print('X11 desktop retains Sysbox, same two owned volumes, gateway-less bridge and bounded unprivileged media relay.')
PY
docker exec "$container" sh -c 'ps -eo args | grep "[X]vfb :1" | grep -q -- "-nolisten tcp"; ps -eo args | grep "[X]vfb :1" | grep -q -- "-fakescreenfps 120"'
for attempt in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:5173/computers/$id/desktop/api/health" >/dev/null 2>&1; then break; fi
    sleep 1
done
curl -fsS --max-time 3 "http://127.0.0.1:5173/computers/$id/desktop/api/health" >/dev/null
docker exec "$container" sh -c 'ps -eww -o args | grep "[s]elkies --wayland=false" | grep -q -- "--framerate=120"'
docker exec "$container" sh -c 'ps -eww -o args | grep "[s]elkies --wayland=false" | grep -q -- "--jpeg-quality=50"'
docker exec -u ubuntu -e DISPLAY=:1 "$container" xrandr --current | grep -E '^Screen|current|[0-9]+\.[0-9]+\*' | head -5
media_ip=$(docker inspect "${container}-media" --format "{{(index .NetworkSettings.Networks \"${project}-computer-media\").IPAddress}}")
[ -n "$media_ip" ]
if docker exec -u ubuntu "$container" curl -kfsS --connect-timeout 2 --max-time 3 "https://$media_ip:8080/computers/$id/desktop/" >/dev/null 2>&1; then
    echo 'X11 desktop reached forbidden dashboard media bridge!' >&2; exit 1
fi
echo 'Xvfb TCP disabled; guest cannot reach its dashboard media relay.'
mkdir -p .scratch/x11-e2e-results
bun_bin=$(command -v bun)
docker run --rm --network "${project}_default" --user "$(id -u):$(id -g)" \
    --security-opt "seccomp=$PWD/templates/default/security/chromium-seccomp.json" \
    --security-opt no-new-privileges:true --cap-add SYS_CHROOT \
    -v "$PWD/frontend/node_modules":/work/frontend/node_modules:ro \
    -v "$PWD/node_modules":/work/node_modules:ro \
    -v "$PWD/scripts/test-computers-x11-browser.mjs":/work/scripts/test-computers-x11-browser.mjs:ro \
    -v "$PWD/.scratch/x11-e2e-results":/work/.scratch:rw \
    -v "$PWD/.scratch/ms-playwright":/browser:ro -v "$bun_bin":/usr/local/bin/bun:ro \
    -w /work -e TEST_COMPUTER_ID="$id" -e PLAYWRIGHT_BROWSERS_PATH=/browser \
    mcr.microsoft.com/playwright/python:v1.62.0-noble /usr/local/bin/bun scripts/test-computers-x11-browser.mjs
# Also check the independent mocked portal-free UI at desktop/phone widths.
docker run --rm --network host --user "$(id -u):$(id -g)" \
    --security-opt "seccomp=$PWD/templates/default/security/chromium-seccomp.json" \
    --security-opt no-new-privileges:true --cap-add SYS_CHROOT \
    -v "$PWD/frontend/tests":/work/frontend/tests:ro \
    -v "$PWD/frontend/node_modules":/work/frontend/node_modules:ro \
    -v "$PWD/node_modules":/work/node_modules:ro \
    -v "$PWD/frontend/playwright.config.ts":/work/frontend/playwright.config.ts:ro \
    -v "$PWD/frontend/playwright.portal-free.config.ts":/work/frontend/playwright.portal-free.config.ts:ro \
    -v "$PWD/.scratch/x11-e2e-results":/work/.scratch:rw \
    -v "$PWD/.scratch/ms-playwright":/browser:ro -v "$(command -v node)":/usr/local/bin/node:ro \
    -w /work/frontend -e PLAYWRIGHT_BROWSERS_PATH=/browser \
    mcr.microsoft.com/playwright/python:v1.62.0-noble /usr/local/bin/node \
    node_modules/@playwright/test/cli.js test --config=playwright.portal-free.config.ts --workers=1 --retries=0
