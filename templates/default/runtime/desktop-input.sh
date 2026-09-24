#!/bin/sh
# Only the controller can call this in the selected owned computer, as ubuntu.
# The GNOME session bus is private to this container, never a host mount.
set -eu
[ "$(id -u)" -eq 1000 ] || exit 1
pid=$(pgrep -u ubuntu -x gnome-shell | head -1)
[ -n "$pid" ] || exit 1
address=$(tr '\000' '\n' < "/proc/$pid/environ" | grep '^DBUS_SESSION_BUS_ADDRESS=' | cut -d= -f2-)
[ -n "$address" ] || exit 1
export DBUS_SESSION_BUS_ADDRESS="$address"
exec /usr/bin/python3 /opt/swarm/desktop-input.py "$@"
