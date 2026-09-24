#!/usr/bin/python3
"""A bounded, one-click GNOME portal bootstrap; the live stream uses Selkies.

Mutter's private RemoteDesktop API is tied to the pinned GNOME 46 image. This
helper never opens a computer network listener or grants an agent a tool.
"""
import math
import sys
import time
from gi.repository import Gio, GLib

if len(sys.argv) != 3:
    raise SystemExit('Normalized desktop coordinates required')
try:
    x, y = (float(value) for value in sys.argv[1:])
except ValueError as error:
    raise SystemExit('Invalid desktop coordinates') from error
if not all(math.isfinite(value) and 0 <= value <= 1 for value in (x, y)):
    raise SystemExit('Desktop coordinates must be between zero and one')

name = 'org.gnome.Mutter.RemoteDesktop'
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
root = '/org/gnome/Mutter/RemoteDesktop'


def call(path, interface, method, signature=None, args=()):
    return bus.call_sync(name, path, interface, method,
                         GLib.Variant(signature, args) if signature else None,
                         None, Gio.DBusCallFlags.NONE, 5000, None)


path = call(root, name, 'CreateSession').unpack()[0]
session = name + '.Session'
try:
    call(path, session, 'Start')
    # The template has one fixed 1920x1080 virtual monitor. Relative motion
    # clamped beyond both edges establishes a known origin without requiring
    # an unrelated screen-cast session to expose its monitor stream path.
    call(path, session, 'NotifyPointerMotionRelative', '(dd)', (-4096.0, -4096.0))
    time.sleep(0.05)
    call(path, session, 'NotifyPointerMotionRelative', '(dd)', (min(x * 1920, 1919.0), min(y * 1080, 1079.0)))
    time.sleep(0.05)
    call(path, session, 'NotifyPointerButton', '(ib)', (272, True))
    try:
        time.sleep(0.05)
    finally:
        call(path, session, 'NotifyPointerButton', '(ib)', (272, False))
finally:
    call(path, session, 'Stop')
