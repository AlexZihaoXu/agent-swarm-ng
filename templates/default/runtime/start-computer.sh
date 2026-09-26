#!/bin/sh
# Root bootstrap for a managed computer. The standalone workspace keeps its own idle CMD.
set -eu
[ "$(id -u)" -eq 0 ]
gateway=${COMPUTER_GATEWAY:?A filtered egress gateway is required}
id=${COMPUTER_ID:?A managed computer ID is required}
python3 - "$gateway" <<'PY'
import ipaddress, sys
address = ipaddress.ip_address(sys.argv[1])
if address.version != 4 or not address.is_private:
    raise SystemExit('The computer gateway must be a private IPv4 address')
PY
# Only an isolated, gateway-less bridge is attached to the computer. There is
# no unfiltered default route; the gateway sidecar filters outside this namespace.
ip route replace default via "$gateway"
# The operator chooses the guest clock; it is never inherited from the host.
# Only a real zoneinfo entry is linked, and traversal or absolute paths keep the
# image default, so a bad setting cannot point /etc/localtime at host files.
case ${COMPUTER_TIMEZONE:-} in
    ''|*..*|/*) ;;
    *) if [ -f "/usr/share/zoneinfo/$COMPUTER_TIMEZONE" ]; then
           ln -snf "/usr/share/zoneinfo/$COMPUTER_TIMEZONE" /etc/localtime
           printf '%s\n' "$COMPUTER_TIMEZONE" > /etc/timezone
       fi ;;
esac
mkdir -p /run/dbus /run/user/1000
chown agent:agent /run/user/1000
chmod 0700 /run/user/1000
# Sysbox's mapped root cannot perform dbus-daemon's messagebus UID/capability
# drop. Preserve the distribution's system-bus policies and run the daemon as
# mapped container root instead; no host DBus socket is mounted.
sed '/<user>messagebus<\/user>/d' /usr/share/dbus-1/system.conf > /run/computer-system-bus.conf
dbus-daemon --config-file=/run/computer-system-bus.conf --fork --nosyslog
test -S /run/dbus/system_bus_socket
exec runuser -u agent -- env \
    HOME=/home/agent \
    COMPUTER_ID="$id" \
    XDG_RUNTIME_DIR=/run/user/1000 \
    XDG_CURRENT_DESKTOP=ubuntu:GNOME \
    XDG_SESSION_TYPE=wayland \
    XDG_DATA_DIRS=/usr/share/ubuntu:/usr/local/share:/usr/share \
    GNOME_SHELL_SESSION_MODE=ubuntu \
    LIBGL_ALWAYS_SOFTWARE=1 \
    dbus-run-session -- /opt/swarm/desktop-session.sh
