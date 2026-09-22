#!/bin/sh
# Run inside the built image: docker run --rm -i IMAGE sh < templates/default/test-packages.sh
set -eu

for package in ubuntu-session gnome-shell gnome-control-center gnome-terminal nautilus \
    gnome-shell-extension-ubuntu-dock gnome-shell-extension-appindicator \
    yaru-theme-gtk yaru-theme-icon fonts-ubuntu fonts-noto-color-emoji dbus-x11 ubuntu-settings \
    ubuntu-wallpapers-noble librsvg2-common gir1.2-dbusmenu-gtk3-0.4; do
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

# Check Ubuntu's effective visual defaults, not just package presence.
export XDG_CURRENT_DESKTOP=ubuntu:GNOME GSETTINGS_BACKEND=memory
test "$(gsettings get org.gnome.desktop.interface icon-theme)" = "'Yaru'"
for key in picture-uri picture-uri-dark; do
    uri=$(gsettings get org.gnome.desktop.background "$key" | tr -d "'")
    case "$uri" in
        file://*) test -r "${uri#file://}" ;;
        *) echo "Expected a local Ubuntu wallpaper for $key, got $uri" >&2; exit 1 ;;
    esac
done

# GNOME Terminal refuses to start under the plain C/ASCII locale.
test "$(locale charmap)" = 'UTF-8'

fc-match -f '%{family}' emoji | grep -q 'Noto Color Emoji'
gnome-shell --version
printf 'Ubuntu GNOME package checks passed. Desktop session startup is a separate check.\n'
