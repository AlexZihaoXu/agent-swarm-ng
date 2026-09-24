#!/bin/sh
# Extract the immutable Selkies 2.0.0 browser client from the approved image
# for isolated dev Caddy. Never execute or proxy JS from a sudo computer.
set -eu
root=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
cd "$root"
image=agent-swarm-default:stage2
image_id=$(docker image inspect "$image" --format '{{.Id}}')
dest="$root/.scratch/selkies-client-web"
if [ -f "$dest/.source-image" ] && [ "$(cat "$dest/.source-image")" = "$image_id" ] && [ -f "$dest/assets/index-CPWh3fQ6.js" ]; then exit 0; fi
if [ -e "$dest" ] && { [ -L "$dest" ] || [ ! -f "$dest/.source-image" ]; }; then
    echo 'Refusing to overwrite an unowned Selkies scratch directory.' >&2; exit 1
fi
tmp="$root/.scratch/selkies-client-web-next-$$"
old="$root/.scratch/selkies-client-web-old-$$"
container=''
cleanup() {
    [ -z "$container" ] || docker rm -f "$container" >/dev/null 2>&1 || true
    [ ! -d "$tmp" ] || rm -r "$tmp"
    [ ! -d "$old" ] || rm -r "$old"
}
trap cleanup EXIT INT TERM
mkdir -m 700 "$tmp"
container=$(docker create --entrypoint /bin/true "$image")
docker cp "$container:/opt/selkies/lib/python3.12/site-packages/selkies/selkies_web/." "$tmp/"
test -f "$tmp/assets/index-CPWh3fQ6.js" && test -f "$tmp/assets/index-D97fjY6g.css"
printf '%s\n' "$image_id" > "$tmp/.source-image"
if [ -d "$dest" ]; then mv "$dest" "$old"; fi
mv "$tmp" "$dest"
