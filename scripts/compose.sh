#!/bin/sh
# One name per supported deployment, so nobody has to remember which Compose files combine in which order.
#   scripts/compose.sh <stack> <docker compose arguments...>      e.g. scripts/compose.sh tailnet-dual up -d
#   scripts/compose.sh --list
set -eu
root=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
cd "$root"
list() {
  cat <<'STACKS'
local            compose.yaml                                         loopback only
dev              compose.yaml + compose.dev.yaml                      hot reload; prepares the Selkies client if missing
lan-http         compose.yaml + compose.lan-http.yaml                 trusted private LAN over HTTP/JPEG (needs LAN_IP)
tailnet-jpeg     + compose.tailscale.yaml + compose.tailscale-http-jpeg.yaml
tailnet-x11      tailnet-jpeg + compose.tailscale-http-jpeg-x11.yaml
tailnet-xorg120  tailnet-x11 + compose.tailscale-http-jpeg-xorg120.yaml
tailnet-dual     tailnet-xorg120 + compose.tailscale-https-19091.yaml   HTTP 19090 and self-signed HTTPS 19091
tailnet-https    compose.yaml + compose.tailscale.yaml + compose.tailscale-https.yaml   trusted certificate on 19090
Tailnet stacks need TAILSCALE_IP (tailnet-https needs TAILSCALE_DNS_NAME).
STACKS
}
case "${1:-}" in ''|--list|-l|-h|--help) list; exit 0;; esac
stack=$1; shift
case "$stack" in
  local) files="-f compose.yaml";;
  dev) files="-f compose.yaml -f compose.dev.yaml"
    # Only commands that start or build containers need the extracted client; `config` and friends do not.
    case "${1:-}" in up|run|start|create|build) [ -d .scratch/selkies-client-web ] || sh scripts/prepare-selkies-client.sh;; esac;;
  lan-http) files="-f compose.yaml -f compose.lan-http.yaml";;
  tailnet-jpeg) files="-f compose.yaml -f compose.tailscale.yaml -f compose.tailscale-http-jpeg.yaml";;
  tailnet-x11) files="-f compose.yaml -f compose.tailscale.yaml -f compose.tailscale-http-jpeg.yaml -f compose.tailscale-http-jpeg-x11.yaml";;
  tailnet-xorg120) files="-f compose.yaml -f compose.tailscale.yaml -f compose.tailscale-http-jpeg.yaml -f compose.tailscale-http-jpeg-x11.yaml -f compose.tailscale-http-jpeg-xorg120.yaml";;
  tailnet-dual) files="-f compose.yaml -f compose.tailscale.yaml -f compose.tailscale-http-jpeg.yaml -f compose.tailscale-http-jpeg-x11.yaml -f compose.tailscale-http-jpeg-xorg120.yaml -f compose.tailscale-https-19091.yaml";;
  tailnet-https) files="-f compose.yaml -f compose.tailscale.yaml -f compose.tailscale-https.yaml";;
  *) echo "Unknown stack '$stack'." >&2; list >&2; exit 2;;
esac
# shellcheck disable=SC2086
exec docker compose $files "$@"
