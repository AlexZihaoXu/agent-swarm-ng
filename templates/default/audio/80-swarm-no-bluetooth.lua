-- Containers have no Bluetooth adapter or systemd-logind. The Bluetooth monitor loads the
-- logind plugin, whose failure disconnects WirePlumber and leaves audio without a session manager.
bluez_monitor.enabled = false
