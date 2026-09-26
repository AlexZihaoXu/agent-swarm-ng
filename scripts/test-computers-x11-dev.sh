#!/bin/sh
# Opt-in destructive E2E against a uniquely named disposable X11 GNOME computer.
# Never mount project .local or the owner's browser profile.
set -eu
cd "$(dirname "$0")/.."
project="sng-x11-test-$(date +%M%S)-$$"
export COMPUTER_NAMESPACE="$project"
# GPU proof is opt-in and grants only the single existing render node to the
# disposable computer. The default no-device gate remains unchanged.
case "${TEST_RENDER_DEVICE:-}" in ''|/dev/dri/renderD128) ;; *) echo 'Invalid disposable render device' >&2; exit 1;; esac
case "${TEST_DISPLAY_SERVER:-xvfb}" in xvfb|xorg120) ;; *) echo 'Invalid disposable display server' >&2; exit 1;; esac
export COMPUTER_RENDER_DEVICE="${TEST_RENDER_DEVICE:-}"
if [ "${TEST_DISPLAY_SERVER:-xvfb}" = xorg120 ]; then
    export COMPUTER_CPU_LIMIT=4
    export TEST_X11_IMAGE=agent-swarm-default:xorg120-120-candidate
    export TEST_X11_BASE=agent-swarm-default:xorg120-120-gate-base
else
    export COMPUTER_CPU_LIMIT=2
    # Do not retag the image selected by the running live controller while a
    # disposable test project builds or creates computers.
    export TEST_X11_IMAGE=agent-swarm-default:http-jpeg-x11-120-quality50-candidate
fi
compose() { docker compose -p "$project" -f compose.yaml -f compose.dev.yaml -f scripts/compose.test-x11.yaml "$@"; }
cleanup() {
    status=$?
    trap - EXIT INT TERM
    if [ "$status" -ne 0 ]; then
        candidate=$(docker ps -q --filter "label=swarm.ng.namespace=$project" --filter 'label=swarm.ng.role=desktop' | head -1)
        if [ -n "$candidate" ]; then
            docker exec "$candidate" sh -c 'echo "GUI Chrome diagnostics:"; tail -25 /tmp/swarm-webgl-gui.log 2>/dev/null || true; echo "Selkies diagnostics:"; tail -36 /run/user/1000/selkies.log' 2>/dev/null | cut -c1-230 || true
        fi
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
if [ "${TEST_DISPLAY_SERVER:-xvfb}" = xorg120 ]; then
    # Build this gate's own X11 base from the freshly compiled JPEG image so a
    # stale cached base cannot disagree with the controller, and never retag the
    # http-jpeg-x11 creation image the documented rollback overlay selects.
    docker build -t "$TEST_X11_BASE" -f templates/default/x11.Dockerfile .
    docker build -t "$TEST_X11_IMAGE" -f templates/default/xorg120.Dockerfile --build-arg COMPUTER_X11_BASE="$TEST_X11_BASE" .
else
    docker build -t "$TEST_X11_IMAGE" -f templates/default/x11.Dockerfile .
fi
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
python3 - "$container" "$project" "$id" "$COMPUTER_RENDER_DEVICE" "$COMPUTER_CPU_LIMIT" <<'PY'
import json,subprocess,sys
computer,namespace,id,device,cpus=sys.argv[1:]
c=json.loads(subprocess.check_output(['docker','inspect',computer]))[0]
assert c['Config']['Labels']['swarm.ng.namespace']==namespace and c['Config']['Labels']['swarm.ng.id']==id
assert c['HostConfig']['Runtime']=='sysbox-runc' and c['HostConfig']['CapDrop']==['ALL']
assert c['HostConfig']['NanoCpus']==int(cpus)*1_000_000_000
assert not c['HostConfig'].get('PortBindings')
assert c['HostConfig'].get('Devices') in (None,[]) if not device else c['HostConfig'].get('Devices')==[{
    'PathOnHost':device,'PathInContainer':device,'CgroupPermissions':'rwm'}]
assert ('COMPUTER_GPU_RENDER_DEVICE='+device in c['Config']['Env']) == bool(device)
# A stale desktop image would still carry the old guest account, and the
# controller's readiness exec would fail with no explanation.
assert 'HOME=/home/agent' in c['Config']['Env'], 'the desktop image must run as the agent user'
assert {m['Destination']:m['Name'] for m in c['Mounts'] if m['Type']=='volume'}=={
    '/home/agent':computer+'-home','/workspace':computer+'-workspace'}
network=json.loads(subprocess.check_output(['docker','network','inspect',computer+'-private']))[0]
assert network['Internal'] and not network['EnableIPv6']
assert network['Options']['com.docker.network.bridge.gateway_mode_ipv4']=='isolated'
relay=json.loads(subprocess.check_output(['docker','inspect',computer+'-media']))[0]
assert relay['State']['Running'] and not relay['HostConfig'].get('PortBindings')
assert relay['HostConfig']['ReadonlyRootfs'] and relay['HostConfig']['CapDrop']==['ALL'] and not relay['Mounts']
print('X11 desktop retains Sysbox, same two owned volumes, gateway-less bridge and bounded unprivileged media relay.')
PY
if [ "${TEST_DISPLAY_SERVER:-xvfb}" = xorg120 ]; then
    docker exec "$container" sh -c 'ps -eo args | grep "[X]org :1" | grep -q -- "-nolisten tcp"; ps -eo args | grep "[X]org :1" | grep -q -- "/opt/swarm/xorg-dummy.conf"'
else
    docker exec "$container" sh -c 'ps -eo args | grep "[X]vfb :1" | grep -q -- "-nolisten tcp"; ps -eo args | grep "[X]vfb :1" | grep -q -- "-fakescreenfps 120"'
fi
for attempt in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:5173/computers/$id/desktop/api/health" >/dev/null 2>&1; then break; fi
    sleep 1
done
curl -fsS --max-time 3 "http://127.0.0.1:5173/computers/$id/desktop/api/health" >/dev/null
docker exec "$container" sh -c 'ps -eww -o args | grep "[s]elkies --wayland=false" | grep -q -- "--framerate=120"'
docker exec "$container" sh -c 'ps -eww -o args | grep "[s]elkies --wayland=false" | grep -q -- "--jpeg-quality=50"'
docker exec "$container" sh -c 'ps -eww -o args | grep "[s]elkies --wayland=false" | grep -q -- "--scaling-dpi=96"'
if [ "${TEST_DISPLAY_SERVER:-xvfb}" = xorg120 ]; then
    randr=$(docker exec -u agent -e DISPLAY=:1 "$container" xrandr --current)
    printf '%s\n' "$randr" | head -4
    [ "$(printf '%s\n' "$randr" | awk '$1 ~ /^[0-9]+x[0-9]+/ {print $1, $2}')" = '1920x1080_120 120.00*+' ] || { echo 'Xorg did not expose only the fixed 120-Hz mode' >&2; exit 1; }
    state=$(docker exec -u agent -e DISPLAY=:1 "$container" sh -c 'p=$(pgrep -u agent -x gnome-shell | head -1); export DBUS_SESSION_BUS_ADDRESS=$(tr "\0" "\n" < "/proc/$p/environ" | grep "^DBUS_SESSION_BUS_ADDRESS=" | cut -d = -f 2-); gdbus call --session --dest org.gnome.Mutter.DisplayConfig --object-path /org/gnome/Mutter/DisplayConfig --method org.gnome.Mutter.DisplayConfig.GetCurrentState')
    printf '%s' "$state" | python3 -c 'import re,sys;s=sys.stdin.read();m=re.search(r"1920, 1080, ([0-9.]+), 1\.0",s);assert m and 119.9<float(m.group(1))<120.1;print("GNOME logical1x virtual mode:",m.group(1),"Hz")'
    [ "$(docker exec -u agent "$container" gsettings get org.gnome.desktop.interface text-scaling-factor)" = 1.0 ]
else
    docker exec -u agent -e DISPLAY=:1 "$container" xrandr --current | grep -E '^Screen|current|[0-9]+\.[0-9]+\*' | head -5
fi
media_ip=$(docker inspect "${container}-media" --format "{{(index .NetworkSettings.Networks \"${project}-computer-media\").IPAddress}}")
[ -n "$media_ip" ]
if docker exec -u agent "$container" curl -kfsS --connect-timeout 2 --max-time 3 "https://$media_ip:8080/computers/$id/desktop/" >/dev/null 2>&1; then
    echo 'X11 desktop reached forbidden dashboard media bridge!' >&2; exit 1
fi
echo 'Guest X11 TCP disabled; guest cannot reach its dashboard media relay.'
if [ -n "$COMPUTER_RENDER_DEVICE" ]; then
    docker exec -u agent "$container" sh -c 'test -r /dev/dri/renderD128 && test ! -e /dev/dri/card0 && vainfo --display drm --device /dev/dri/renderD128 2>&1 | grep -q "VAProfileHEVCMain.*EncSlice"'
    docker exec "$container" sh -c 'grep -q "Exec=/opt/swarm/launch-chrome.sh" /usr/local/share/applications/google-chrome.desktop'
    docker cp scripts/test-computers-webgl.html "$container:/tmp/swarm-webgl-probe.html" >/dev/null
    # A real, sandboxed guest Chrome must draw WebGL pixels and disclose a
    # non-software GPU renderer. VAAPI encode alone does not establish WebGL.
    docker exec -u agent -e DISPLAY=:1 "$container" sh -c 'timeout 40 /opt/swarm/launch-chrome.sh --headless --disable-dev-shm-usage --no-first-run --no-default-browser-check --user-data-dir=/tmp/swarm-webgl-headless --virtual-time-budget=4500 --dump-dom file:///tmp/swarm-webgl-probe.html 2>/tmp/swarm-webgl-chrome.log' > .scratch/x11-webgl-result.html
    python3 - <<'PY'
from pathlib import Path
from html.parser import HTMLParser
class Result(HTMLParser):
 def __init__(self): super().__init__();self.inside=False;self.text=''
 def handle_starttag(self,tag,attrs): self.inside=tag=='output' and ('id','result') in attrs
 def handle_data(self,data):
  if self.inside:self.text+=data
result=Result();result.feed(Path('.scratch/x11-webgl-result.html').read_text());print('GUEST_WEBGL_RESULT',result.text[:1200])
assert '"ok":true' in result.text, 'WebGL did not draw expected pixels'
assert all(x not in result.text.lower() for x in ('swiftshader','llvmpipe','software rasterizer')), 'WebGL fell back to software rendering'
PY
fi
xft_dpi() { docker exec -u agent -e DISPLAY=:1 "$container" xrdb -query 2>/dev/null | awk '$1 == "Xft.dpi:" { print $2 }'; }
# Xft resources may be unset until the first viewer; they must never take a
# browser's 2x DPR. A connected viewer must settle at operator-owned 96.
initial_dpi=$(xft_dpi)
case "$initial_dpi" in ''|96) ;; *) echo "Unexpected pre-view Xft DPI: $initial_dpi" >&2; exit 1;; esac
echo "Pre-view Xft DPI: ${initial_dpi:-unset}"
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
if [ -n "$COMPUTER_RENDER_DEVICE" ]; then
    # The GNOME-launched browser uses the opt-in Radeon path; its shader must
    # be visible over JPEG, and trusted controls must target guest tabs only.
    docker exec -u agent -e DISPLAY=:1 "$container" sh -c '/opt/swarm/launch-chrome.sh --no-first-run --no-default-browser-check --new-window --window-size=920,730 --user-data-dir=/tmp/swarm-webgl-gui file:///tmp/swarm-webgl-probe.html > /tmp/swarm-webgl-gui.log 2>&1 < /dev/null &'
    sleep 3
    docker exec -u agent -e DISPLAY=:1 "$container" sh -c 'ps -eww -o args | grep -q "[c]hrome --no-first-run"; xprop -root _NET_ACTIVE_WINDOW 2>/dev/null | head -1'
    docker run --rm --network "${project}_default" --user "$(id -u):$(id -g)" \
        --security-opt "seccomp=$PWD/templates/default/security/chromium-seccomp.json" \
        --security-opt no-new-privileges:true --cap-add SYS_CHROOT \
        -v "$PWD/frontend/node_modules":/work/frontend/node_modules:ro \
        -v "$PWD/node_modules":/work/node_modules:ro \
        -v "$PWD/scripts/test-computers-x11-gpu-browser.mjs":/work/scripts/test-computers-x11-gpu-browser.mjs:ro \
        -v "$PWD/.scratch/x11-e2e-results":/work/.scratch:rw \
        -v "$PWD/.scratch/ms-playwright":/browser:ro -v "$bun_bin":/usr/local/bin/bun:ro \
        -w /work -e TEST_COMPUTER_ID="$id" -e PLAYWRIGHT_BROWSERS_PATH=/browser \
        mcr.microsoft.com/playwright/python:v1.62.0-noble /usr/local/bin/bun scripts/test-computers-x11-gpu-browser.mjs
fi
test "$(xft_dpi)" = "$initial_dpi"
docker exec "$container" sh -c 'grep scaling_dpi /run/user/1000/selkies.log' | grep -Fq "allowed list ['96']"
if docker exec "$container" sh -c 'grep -q "DPI changed from" /run/user/1000/selkies.log'; then echo 'Browser changed guest DPI!' >&2; exit 1; fi
echo "Disposable X11 Xft DPI unchanged (${initial_dpi:-unset}) after a 2x-DPR primary browser session; guest remained at 1920x1080."
curl -fsS --max-time 120 -X DELETE "http://127.0.0.1:5173/api/computers/$id" -H 'Content-Type: application/json' \
    -d '{"confirmation":"Portal-free disposable probe"}' | python3 -c 'import json,sys;assert json.load(sys.stdin)["deleted"];print("Owned disposable X11 computer deleted: true")'
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
