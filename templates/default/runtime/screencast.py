#!/usr/bin/python3
"""Keep a GNOME monitor's PipeWire node alive for bounded, on-demand previews.

Mutter's ScreenCast D-Bus interface is private and tied to this connection; the
Ubuntu 24.04/GNOME 46 image is version-pinned by the computer template. Nothing
is exposed on a computer network port or published to a chat channel.
"""
import os
from pathlib import Path
from gi.repository import Gio, GLib

BUS = 'org.gnome.Mutter.ScreenCast'
ROOT = '/org/gnome/Mutter/ScreenCast'
node_file = Path(os.environ['XDG_RUNTIME_DIR']) / 'screencast-node'
ready_file = Path(os.environ['XDG_RUNTIME_DIR']) / 'desktop-ready'
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
path = bus.call_sync(BUS, ROOT, BUS, 'CreateSession', GLib.Variant('(a{sv})', ({},)), GLib.VariantType.new('(o)'), Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
stream = bus.call_sync(BUS, path, BUS + '.Session', 'RecordMonitor', GLib.Variant('(sa{sv})', ('Meta-0', {})), GLib.VariantType.new('(o)'), Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
loop = GLib.MainLoop()

def on_node(connection, sender, object_path, interface, signal_name, parameters):
    node = parameters.unpack()[0]
    staged = node_file.with_suffix('.pending')
    staged.write_text(str(node))
    os.replace(staged, node_file)
    ready_file.write_text('ready\n')
    print('Computer preview PipeWire node ready', flush=True)

def on_close(connection, sender, object_path, interface, signal_name, parameters):
    loop.quit()

bus.signal_subscribe(BUS, BUS + '.Stream', 'PipeWireStreamAdded', stream, None, Gio.DBusSignalFlags.NONE, on_node)
bus.signal_subscribe(BUS, BUS + '.Session', 'Closed', path, None, Gio.DBusSignalFlags.NONE, on_close)
bus.call_sync(BUS, path, BUS + '.Session', 'Start', None, None, Gio.DBusCallFlags.NONE, 5000, None)
try:
    loop.run()
finally:
    ready_file.unlink(missing_ok=True)
    node_file.unlink(missing_ok=True)
