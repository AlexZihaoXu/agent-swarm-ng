#!/bin/sh
set -eu
subnet=${COMPUTER_SUBNET:?A private computer subnet is required}
# The controller supplies Docker's actual IPAM subnet, never a browser value.
case "$subnet" in *[!0-9./]*|''|*.*.*.*.*) echo 'Invalid computer subnet' >&2; exit 1;; esac
[ "$(cat /proc/sys/net/ipv4/ip_forward)" -eq 1 ] || { echo 'Egress forwarding disabled' >&2; exit 1; }
iptables -P FORWARD DROP
# In particular, deny Docker/host interfaces, Tailnet and cloud metadata even
# when a computer root changes its own routes or DNS. The computer network has
# no bridge gateway IP, so this sidecar is its only path out.
for cidr in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 \
            172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
    iptables -A FORWARD -s "$subnet" -d "$cidr" -j REJECT
done
iptables -A FORWARD -s "$subnet" -j ACCEPT
iptables -A FORWARD -d "$subnet" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -t nat -A POSTROUTING -s "$subnet" -j MASQUERADE
# The controller connects the isolated bridge only after this marker appears.
touch /tmp/ready
exec sleep infinity
