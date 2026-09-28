#!/usr/bin/env bash
# Opt-in Linux + Sysbox check. No owner desktop, host input, credentials or persistent volumes.
set -euo pipefail
cd "$(dirname "$0")/.."
name="swarm-core-test-$(date +%s)-$$"
cleanup() {
  if [ "$(docker inspect --format '{{ index .Config.Labels "swarm.ng.test" }}' "$name" 2>/dev/null || true)" = core-tools ]; then
    docker stop --timeout 2 "$name" >/dev/null
  fi
}
trap cleanup EXIT
# Same process-security settings as managed desktops; no extra host capability is added.
docker run --rm -d --name "$name" --label swarm.ng.test=core-tools --runtime=sysbox-runc --network none --user root --cap-drop ALL \
  --security-opt "seccomp=$PWD/templates/default/security/chromium-seccomp.json" --init --tmpfs /run:rw,nosuid,size=64m \
  --pids-limit 1024 --memory 512m --entrypoint sleep "${CORE_TEST_IMAGE:-agent-swarm-default:h265-xorg120}" 600 >/dev/null
tar -cf - -C templates/default/runtime computer-core.py computer-core-worker.py computer_core_files.py computer-terminal.py | docker exec -i --user root "$name" tar -xf - -C /opt/swarm --no-same-owner
docker exec --user root "$name" sh -c 'mkdir -p /run/user/1000; chown agent:agent /run/user/1000; chmod 700 /run/user/1000'
python3 scripts/test-computer-terminals.py "$name"
python3 scripts/test-computer-core.py "$name"
