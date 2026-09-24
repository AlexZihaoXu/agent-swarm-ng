#!/bin/sh
# Run only against the unique test namespace created by test-computers-dev.sh.
set -eu
namespace=${COMPUTER_TEST_NAMESPACE:?Set the isolated test namespace}
case "$namespace" in sng-comp-test-*) ;; *) echo 'Refusing a non-test namespace' >&2; exit 1;; esac
base=http://127.0.0.1:5173
name="API test $(python3 -c 'import uuid; print(uuid.uuid4().hex[:8])')"
key=$(python3 -c 'import uuid; print(uuid.uuid4())')
id=''
target="${namespace}-private-probe"
cleanup() {
    docker rm -f "$target" >/dev/null 2>&1 || true
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
python3 - "$computer" "${computer}-private" <<'PY'
import json,subprocess,sys
container=json.loads(subprocess.check_output(['docker','inspect',sys.argv[1]]))[0]
network=json.loads(subprocess.check_output(['docker','network','inspect',sys.argv[2]]))[0]
assert not container['HostConfig'].get('PortBindings'),container['HostConfig'].get('PortBindings')
assert container['HostConfig']['Runtime']=='sysbox-runc'
assert network['Internal'] and not network['EnableIPv6']
assert network['Options']['com.docker.network.bridge.gateway_mode_ipv4']=='isolated'
assert network['IPAM']['Config'][0].get('Gateway') in (None,'','invalid IP')
print('No computer host ports; user namespace and gateway-less private bridge selected')
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
docker exec -u ubuntu "$computer" sudo -n sh -c 'test "$(id -u)" -eq 0 && test "$(awk "NR==1 {print \$2}" /proc/self/uid_map)" -ne 0'
docker exec -u ubuntu "$computer" curl -fsS --max-time 8 http://example.com | grep -q 'Example Domain'
docker exec -u ubuntu "$computer" sudo -n timeout 90s apt-get update -qq
echo 'Passwordless sudo is mapped to an unprivileged host UID; public HTTP and sudo apt work.'
# Use an actually reachable service on the public egress bridge to prove that
# rejection comes from the gateway firewall, not from a closed destination port.
docker run -d --name "$target" --network "${namespace}-computer-egress" --label "swarm.ng.test=$namespace" mcr.microsoft.com/playwright/python:v1.62.0-noble sh -c 'mkdir -p /tmp/www; echo probe-ok >/tmp/www/index.html; cd /tmp/www; exec python3 -m http.server 8080 --bind 0.0.0.0' >/dev/null
target_ip=$(docker inspect "$target" --format "{{(index .NetworkSettings.Networks \"${namespace}-computer-egress\").IPAddress}}")
attempt=0
until [ "$(docker exec "$gateway" wget -T 2 -qO- "http://$target_ip:8080" 2>/dev/null)" = probe-ok ]; do
    attempt=$((attempt+1)); [ "$attempt" -lt 15 ] || { echo 'Private test service not reachable from gateway'; exit 1; }; sleep 1
done
if docker exec -u ubuntu "$computer" curl -fsS --max-time 3 "http://$target_ip:8080" >/dev/null 2>&1; then echo 'Private network escape!' >&2; exit 1; fi
if [ -n "${COMPUTER_TEST_TAILNET_IP:-}" ]; then
    python3 - "$COMPUTER_TEST_TAILNET_IP" <<'PY'
import ipaddress,sys
assert ipaddress.ip_address(sys.argv[1]) in ipaddress.ip_network('100.64.0.0/10')
PY
    if docker exec -u ubuntu "$computer" curl -fsS --max-time 3 "http://${COMPUTER_TEST_TAILNET_IP}:${COMPUTER_TEST_TAILNET_PORT:-19090}/api/health" >/dev/null 2>&1; then echo 'Tailnet escape!' >&2; exit 1; fi
fi
echo 'Reachable private target blocked; optional Tailnet probe denied if configured.'
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
