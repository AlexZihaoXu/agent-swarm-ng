#!/bin/sh
# Run inside the built image: docker run --rm -i IMAGE sh < templates/default/test-packages.sh
set -eu

for package in ubuntu-session gnome-shell gnome-control-center gnome-terminal nautilus \
    gnome-shell-extension-ubuntu-dock gnome-shell-extension-appindicator \
    yaru-theme-gtk yaru-theme-icon fonts-ubuntu dbus-x11; do
    test "$(dpkg-query -W -f='${Status}' "$package")" = 'install ok installed'
done

# Check installed packages, not merely residual package configuration.
unwanted=$(dpkg-query -W -f='${Package} ${Status}\n' | \
    awk '$2 == "install" && $4 == "installed" { print $1 }' | \
    grep -E '^(ubuntu-desktop(-minimal)?|libreoffice.*|thunderbird.*|evolution|gnome-games|aisleriot|gnome-mahjongg|gnome-mines|gnome-sudoku|totem|rhythmbox|shotwell)$' || true)
if [ -n "$unwanted" ]; then
    printf 'Unexpected bundled applications:\n%s\n' "$unwanted" >&2
    exit 1
fi

gnome-shell --version
printf 'Ubuntu GNOME package checks passed. Desktop session startup is a separate check.\n'
