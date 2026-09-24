#!/bin/sh
# Two Docker bridges may receive eth0/eth1 in either order after attachment.
# Bind only the address in the controller-validated media subnet, never the
# computer-facing address. Do not trust interface numbering or accept defaults.
set -eu
target=${COMPUTER_PRIVATE_IP:?A fixed managed-computer address is required}
case "$target" in
    *[!0-9.]*|'') echo 'Invalid computer address' >&2; exit 1;;
esac
[ "$(printf '%s' "$target" | tr -cd '.' | wc -c)" -eq 3 ] || exit 1
subnet=${COMPUTER_MEDIA_SUBNET:?An isolated media subnet is required}
network=${subnet%/*}
prefix=${subnet#*/}
case "$prefix" in ''|*[!0-9]*) echo 'Invalid media subnet' >&2; exit 1;; esac
[ "$prefix" -ge 8 ] && [ "$prefix" -le 30 ] || exit 1
media=''
for cidr in $(ip -o -4 addr show scope global | awk '{print $4}'); do
    address=${cidr%/*}
    candidate=$(ipcalc -n "$address/$prefix" 2>/dev/null | cut -d= -f2)
    if [ "$candidate" = "$network" ]; then
        [ -z "$media" ] || { echo 'Ambiguous media bridge' >&2; exit 1; }
        media=$address
    fi
done
[ -n "$media" ] || { echo 'Media bridge has no matching IPv4 address' >&2; exit 1; }
# TLS stays end-to-end between dashboard Caddy and Selkies; this process
# merely copies encrypted TCP bytes and cannot be an HTTP forward proxy.
exec socat "TCP4-LISTEN:8080,bind=$media,reuseaddr,fork" "TCP4:$target:8080"
