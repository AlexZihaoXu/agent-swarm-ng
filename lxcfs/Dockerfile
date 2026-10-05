# LXCFS for computers (docs/computers.md#lxcfs): Debian 13's lxcfs 6.0.4 (6.x reports swap under cgroup v2; 5.x does
# not), plus the small remount helper the computer controller runs here after an lxcfs restart.
FROM debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a AS remount
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
COPY remount.c /src/remount.c
RUN gcc -O2 -Wall -Werror -static -o /lxcfs-remount /src/remount.c

FROM debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a
# Pinned to 6.0.4; Debian security fixes of that version still apply.
RUN apt-get update && apt-get install -y --no-install-recommends 'lxcfs=6.0.4-*' fuse3 && rm -rf /var/lib/apt/lists/*
COPY --from=remount /lxcfs-remount /usr/local/bin/lxcfs-remount
COPY start.sh /start.sh
CMD ["/start.sh"]
