#!/bin/sh
# Run only against the unique test namespace created by test-computers-dev.sh.
set -eu
namespace=${COMPUTER_TEST_NAMESPACE:?Set the isolated test namespace}
case "$namespace" in sng-comp-test-*) ;; *) echo 'Refusing a non-test namespace' >&2; exit 1;; esac
base=http://127.0.0.1:5173
ingress=$(docker ps -q --filter "label=com.docker.compose.project=$namespace" --filter 'label=com.docker.compose.service=caddy-dev')
controller=$(docker ps -q --filter "label=com.docker.compose.project=$namespace" --filter 'label=com.docker.compose.service=computer-controller')
if [ -z "$ingress" ] || [ -z "$controller" ] || [ "$(docker port "$ingress" 5173/tcp)" != '127.0.0.1:5173' ] || ! docker inspect "$controller" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -qx "COMPUTER_NAMESPACE=$namespace"; then
    echo 'Refusing: port 5173 is not this isolated computer test project.' >&2; exit 1
fi
name="API test $(python3 -c 'import uuid; print(uuid.uuid4().hex[:8])')"
key=$(python3 -c 'import uuid; print(uuid.uuid4())')
id=''
other_id=''
other_name="Second ${name}"
target="${namespace}-private-probe"
cleanup() {
    docker rm -f "$target" >/dev/null 2>&1 || true
    if [ -n "$other_id" ]; then
        body=$(python3 -c 'import json,sys; print(json.dumps({"confirmation":sys.argv[1]}))' "$other_name")
        curl -fsS -X DELETE "$base/api/computers/$other_id" -H 'Content-Type: application/json' --data "$body" >/dev/null 2>&1 || true
    fi
    if [ -n "$id" ]; then
        body=$(python3 -c 'import json,sys; print(json.dumps({"confirmation":sys.argv[1]}))' "$name")
        curl -fsS -X DELETE "$base/api/computers/$id" -H 'Content-Type: application/json' --data "$body" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT INT TERM
payload=$(python3 -c 'import json,sys; print(json.dumps({"name":sys.argv[1],"requestKey":sys.argv[2]}))' "$name" "$key")
curl -fsS --max-time 120 -X POST "$base/api/computers" -H 'Content-Type: application/json' --data "$payload" > .scratch/computer-api-e2e-create.json
id=$(python3 -c 'import json; print(json.load(open(".scratch/computer-api-e2e-create.json"))["id"])')
computer="${namespace}-computer-${id}"
gateway="${computer}-gateway"
if [ -n "${COMPUTER_RENDER_DEVICE:-}" ]; then
    docker exec -u agent "$computer" vainfo --display drm --device "$COMPUTER_RENDER_DEVICE" > .scratch/computer-api-e2e-vainfo.log 2>&1
    grep -q 'VAProfileH264High.*VAEntrypointEncSlice' .scratch/computer-api-e2e-vainfo.log
    echo 'Managed non-root computer can use the host H.264 VA-API render node.'
fi
python3 - "$computer" "${computer}-private" <<'PY'
import json,os,subprocess,sys
container=json.loads(subprocess.check_output(['docker','inspect',sys.argv[1]]))[0]
network=json.loads(subprocess.check_output(['docker','network','inspect',sys.argv[2]]))[0]
assert not container['HostConfig'].get('PortBindings'),container['HostConfig'].get('PortBindings')
assert container['HostConfig']['Runtime']=='sysbox-runc'
device=os.environ.get('COMPUTER_RENDER_DEVICE','')
assert (container['HostConfig'].get('Devices') or []) == ([{'PathOnHost':device,'PathInContainer':device,'CgroupPermissions':'rwm'}] if device else []),container['HostConfig'].get('Devices')
assert network['Internal'] and not network['EnableIPv6']
assert network['Options']['com.docker.network.bridge.gateway_mode_ipv4']=='isolated'
assert network['IPAM']['Config'][0].get('Gateway') in (None,'','invalid IP')
print('No computer host ports; user namespace and gateway-less private bridge selected; DRM render node:',device or 'none')
PY
python3 - "$id" "$name" <<'PY'
import json,sys
item=json.load(open('.scratch/computer-api-e2e-create.json'))
assert item['id']==sys.argv[1] and item['name']==sys.argv[2] and item['state']=='running',item
assert item['memoryBytes'] is not None and item['cpuPercent'] is not None,item
print('Created real computer with CPU/memory stats:', item['id'])
PY
curl -fsS --max-time 20 "$base/api/computers/$id/preview" -o .scratch/computer-api-e2e-preview.jpg
python3 - <<'PY'
from pathlib import Path
image=Path('.scratch/computer-api-e2e-preview.jpg').read_bytes()
assert len(image)>200 and image[:2]==b'\xff\xd8' and image[-2:]==b'\xff\xd9'
print('Real GNOME JPEG:',len(image),'bytes')
PY
curl -fsS --max-time 20 "$base/api/computers/$id/preview?full=1" -o .scratch/computer-api-e2e-full.jpg
python3 - <<'PY'
from pathlib import Path
from struct import unpack
image=Path('.scratch/computer-api-e2e-full.jpg').read_bytes()
assert len(image)>200 and len(image)<512*1024 and image[:2]==b'\xff\xd8' and image[-2:]==b'\xff\xd9'
sof=image.index(b'\xff\xc0')
height,width=unpack('>HH',image[sof+5:sof+9])
assert (width,height)==(1920,1080),(width,height)
print('Full-resolution consent JPEG:',len(image),'bytes')
PY
# An innocuous click on the desktop background exercises the execution-time
# UUID binding, ubuntu session D-Bus and bounded private Mutter input API.
response=$(curl -fsS --max-time 12 -X POST "$base/api/computers/$id/desktop/input" \
    -H 'Content-Type: application/json' --data '{"x":0.8,"y":0.8}')
test "$response" = '{"accepted":true}'
media="${computer}-media"
python3 - "$media" "${namespace}-computer-media" "${computer}-private" <<'PY'
import json,subprocess,sys
relay=json.loads(subprocess.check_output(['docker','inspect',sys.argv[1]]))[0]
assert relay['State']['Running'] and not relay['HostConfig'].get('PortBindings')
assert relay['HostConfig']['CapDrop']==['ALL'] and relay['HostConfig']['ReadonlyRootfs']
assert relay['Config']['User']=='65532:65532' and not relay['Mounts']
assert set(relay['NetworkSettings']['Networks'])==set(sys.argv[2:])
assert 'computer-'+relay['Config']['Labels']['swarm.ng.id'] in (relay['NetworkSettings']['Networks'][sys.argv[2]].get('DNSNames') or [])
print('No media relay host ports; only its own private and isolated dashboard bridges')
PY
test -n "$(docker exec "${namespace}-caddy-dev-1" getent hosts "computer-$id")"
media_ip=$(docker inspect "$media" --format "{{(index .NetworkSettings.Networks \"${namespace}-computer-media\").IPAddress}}")
relay_private_ip=$(docker inspect "$media" --format "{{(index .NetworkSettings.Networks \"${computer}-private\").IPAddress}}")
if docker exec -u agent "$computer" curl -kfsS --connect-timeout 2 --max-time 3 "https://$media_ip:8080/computers/$id/desktop/" >/dev/null 2>&1; then echo 'Computer reached the media bridge!' >&2; exit 1; fi
if docker exec -u agent "$computer" curl -kfsS --connect-timeout 2 --max-time 3 "https://$relay_private_ip:8080/computers/$id/desktop/" >/dev/null 2>&1; then
    docker exec "$media" ip -o -4 addr show >&2 || true
    docker inspect "$media" --format '{{json .NetworkSettings.Networks}}' >&2 || true
    echo 'Relay listened on the computer-facing bridge!' >&2; exit 1
fi
# The dev dashboard's *existing* 5173 listener must proxy the Selkies HTML;
# a Vite SPA fallback would not contain this title. No computer port is bound.
viewer="$base/computers/$id/desktop/"
attempt=0
until curl -fsS --max-time 6 "$viewer" -o .scratch/computer-api-e2e-viewer.html && grep -q "Object.defineProperty(window, 'localStorage'" .scratch/computer-api-e2e-viewer.html; do
    attempt=$((attempt+1))
    if [ "$attempt" -ge 30 ]; then
        docker logs "${namespace}-caddy-dev-1" --tail 25 >&2 || true
        docker logs "$media" --tail 20 >&2 || true
        docker exec "$media" ip -o -4 addr show >&2 || true
        docker inspect "$media" --format '{{json .NetworkSettings.Networks}}' >&2 || true
        docker exec "$computer" curl -kfsS --max-time 3 "https://127.0.0.1:8080/computers/$id/desktop/" -o /dev/null >&2 || true
        echo 'Same-port computer viewer did not proxy Selkies' >&2; exit 1
    fi
    sleep 1
done
asset="${viewer}assets/index-CPWh3fQ6.js"
curl -fsS --max-time 12 "$asset" -o .scratch/computer-api-e2e-client.js
cmp .scratch/computer-api-e2e-client.js .scratch/selkies-client-web/assets/index-CPWh3fQ6.js
core="${viewer}assets/selkies-core-BbKps5RD.js"
curl -fsS --max-time 12 "$core" -o .scratch/computer-api-e2e-core.js
cmp .scratch/computer-api-e2e-core.js .scratch/selkies-client-web/assets/selkies-core-BbKps5RD.js
echo '633f8909c4ef14c2a3c178292f4b6d47dbacbf71ccd55060ace4db623b000c52  .scratch/computer-api-e2e-core.js' | sha256sum -c -
# Sudo inside the *test* computer can replace its own copy, but that must not
# change the JavaScript the dashboard sends to a same-origin viewer.
docker exec -u agent "$computer" sudo -n sh -c 'printf "%s\n" "/* untrusted computer asset */" > /opt/selkies/lib/python3.12/site-packages/selkies/selkies_web/assets/index-CPWh3fQ6.js; printf "%s\n" "/* guest core override */" > /opt/selkies/lib/python3.12/site-packages/selkies/selkies_web/assets/selkies-core-BbKps5RD.js'
curl -fsS --max-time 12 "$asset" -o .scratch/computer-api-e2e-client-after.js
cmp .scratch/computer-api-e2e-client.js .scratch/computer-api-e2e-client-after.js
curl -fsS --max-time 12 "$core" -o .scratch/computer-api-e2e-core-after.js
cmp .scratch/computer-api-e2e-core.js .scratch/computer-api-e2e-core-after.js
for forbidden in api/files/ api/tokens api/sessions api/switch api/websockets; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 6 "${viewer}${forbidden}")
    test "$code" = 404 || { echo "Untrusted computer endpoint is reachable: $forbidden" >&2; exit 1; }
done
curl -fsS --max-time 6 -D .scratch/computer-api-e2e-json-headers.txt "${viewer}api/status" -o .scratch/computer-api-e2e-status.json
grep -qi '^Content-Type: application/json;' .scratch/computer-api-e2e-json-headers.txt
grep -qi '^X-Content-Type-Options: nosniff' .scratch/computer-api-e2e-json-headers.txt
grep -qi '^Content-Disposition: attachment' .scratch/computer-api-e2e-json-headers.txt
! grep -Eqi '^(Set-Cookie|Location|Refresh):' .scratch/computer-api-e2e-json-headers.txt
echo 'Only trusted assets execute; guest HTML, plain WebSocket GET, cookies and unused endpoints are blocked.'
curl -sS --max-time 3 --http1.1 -D .scratch/computer-api-e2e-ws-headers.txt -o /dev/null \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H "Origin: $base" \
    "${viewer}api/websockets" >/dev/null 2>&1 || true
if ! grep -q '^HTTP/1.1 101 ' .scratch/computer-api-e2e-ws-headers.txt; then
    docker logs "${namespace}-caddy-dev-1" --tail 15 >&2 || true
    echo 'Same-port WebSocket upgrade failed' >&2; exit 1
fi
echo 'Same-port browser WebSocket upgrade and reverse-only media isolation passed.'
docker exec -u agent "$computer" sudo -n sh -c 'test "$(id -u)" -eq 0 && test "$(awk "NR==1 {print \$2}" /proc/self/uid_map)" -ne 0'
docker exec -u agent "$computer" curl -fsS --max-time 8 http://example.com | grep -q 'Example Domain'
docker exec -u agent "$computer" sudo -n timeout 90s apt-get update -qq
echo 'Passwordless sudo is mapped to an unprivileged host UID; public HTTP and sudo apt work.'
# Use an actually reachable service on the public egress bridge to prove that
# rejection comes from the gateway firewall, not from a closed destination port.
docker run -d --name "$target" --network "${namespace}-computer-egress" --label "swarm.ng.test=$namespace" mcr.microsoft.com/playwright/python:v1.62.0-noble sh -c 'mkdir -p /tmp/www; echo probe-ok >/tmp/www/index.html; cd /tmp/www; exec python3 -m http.server 8080 --bind 0.0.0.0' >/dev/null
target_ip=$(docker inspect "$target" --format "{{(index .NetworkSettings.Networks \"${namespace}-computer-egress\").IPAddress}}")
attempt=0
until [ "$(docker exec "$gateway" wget -T 2 -qO- "http://$target_ip:8080" 2>/dev/null)" = probe-ok ]; do
    attempt=$((attempt+1)); [ "$attempt" -lt 15 ] || { echo 'Private test service not reachable from gateway'; exit 1; }; sleep 1
done
if docker exec -u agent "$computer" curl -fsS --max-time 3 "http://$target_ip:8080" >/dev/null 2>&1; then echo 'Private network escape!' >&2; exit 1; fi
if [ -n "${COMPUTER_TEST_TAILNET_IP:-}" ]; then
    python3 - "$COMPUTER_TEST_TAILNET_IP" <<'PY'
import ipaddress,sys
assert ipaddress.ip_address(sys.argv[1]) in ipaddress.ip_network('100.64.0.0/10')
PY
    if docker exec -u agent "$computer" curl -fsS --max-time 3 "http://${COMPUTER_TEST_TAILNET_IP}:${COMPUTER_TEST_TAILNET_PORT:-19090}/api/health" >/dev/null 2>&1; then echo 'Tailnet escape!' >&2; exit 1; fi
fi
echo 'Reachable private target blocked; optional Tailnet probe denied if configured.'
# A second real GNOME computer must have a distinct bridge and volume pair.
second_key=$(python3 -c 'import uuid; print(uuid.uuid4())')
second_payload=$(python3 -c 'import json,sys; print(json.dumps({"name":sys.argv[1],"requestKey":sys.argv[2]}))' "$other_name" "$second_key")
curl -fsS --max-time 120 -X POST "$base/api/computers" -H 'Content-Type: application/json' --data "$second_payload" > .scratch/computer-api-e2e-second.json
other_id=$(python3 -c 'import json; print(json.load(open(".scratch/computer-api-e2e-second.json"))["id"])')
other_container="${namespace}-computer-${other_id}"
other_private="${other_container}-private"
other_ip=$(docker inspect "$other_container" --format "{{(index .NetworkSettings.Networks \"$other_private\").IPAddress}}")
test "$other_private" != "${computer}-private"
docker exec -d -u agent "$other_container" python3 -m http.server 8808 --bind 0.0.0.0 >/dev/null
attempt=0
until docker exec -u agent "$other_container" curl -fsS --max-time 2 http://127.0.0.1:8808/ >/dev/null 2>&1; do
    attempt=$((attempt+1)); [ "$attempt" -lt 20 ] || { echo 'Second computer test service did not start'; exit 1; }; sleep 0.2
done
if docker exec -u agent "$computer" curl -fsS --max-time 3 "http://$other_ip:8808/" >/dev/null 2>&1; then echo 'Computer-to-computer escape!' >&2; exit 1; fi
python3 - "$base" "$id" "$other_id" <<'PY'
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlopen
import json,sys,time
base,first,second=sys.argv[1:]
rows=json.load(urlopen(base+'/api/computers',timeout=10))['computers']
assert {first,second}.issubset({r['id'] for r in rows})
start=time.monotonic()
def image(id):
    with urlopen(f'{base}/api/computers/{id}/preview',timeout=20) as reply: return reply.read()
with ThreadPoolExecutor(max_workers=2) as pool: frames=list(pool.map(image,(first,second)))
assert all(len(frame)>200 and frame[:2]==b'\xff\xd8' and frame[-2:]==b'\xff\xd9' for frame in frames)
print('Two independent real previews:',[len(frame) for frame in frames],'bytes in',round(time.monotonic()-start,2),'s')
PY
body=$(python3 -c 'import json,sys; print(json.dumps({"confirmation":sys.argv[1]}))' "$other_name")
curl -fsS --max-time 60 -X DELETE "$base/api/computers/$other_id" -H 'Content-Type: application/json' --data "$body" > .scratch/computer-api-e2e-second-delete.json
deleted_other=$other_id; other_id=''
test "$(docker ps -aq --filter "label=swarm.ng.id=$deleted_other" | wc -l)" -eq 0
test "$(docker volume ls -q --filter "label=swarm.ng.id=$deleted_other" | wc -l)" -eq 0
test "$(docker network ls -q --filter "label=swarm.ng.id=$deleted_other" | wc -l)" -eq 0
echo 'Two independent computers, simultaneous previews and lateral denial passed.'
# Check retry identity and exact-name deletion against the real backend.
test "$(curl -fsS -X POST "$base/api/computers" -H 'Content-Type: application/json' --data "$payload" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')" = "$id"
code=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$base/api/computers/$id" -H 'Content-Type: application/json' --data '{"confirmation":"wrong"}')
test "$code" = 400
body=$(python3 -c 'import json,sys; print(json.dumps({"confirmation":sys.argv[1]}))' "$name")
curl -fsS --max-time 60 -X DELETE "$base/api/computers/$id" -H 'Content-Type: application/json' --data "$body" > .scratch/computer-api-e2e-delete.json
deleted_id=$id; id=''
test "$(docker ps -aq --filter "label=swarm.ng.id=$deleted_id" | wc -l)" -eq 0
test "$(docker volume ls -q --filter "label=swarm.ng.id=$deleted_id" | wc -l)" -eq 0
test "$(docker network ls -q --filter "label=swarm.ng.id=$deleted_id" | wc -l)" -eq 0
echo 'Exact-name delete removed only this computer, both volumes and its private network.'
