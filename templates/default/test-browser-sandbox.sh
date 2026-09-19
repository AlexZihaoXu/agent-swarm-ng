#!/bin/sh
# Run as the workspace user with the Compose security profile applied.
set -eu
test "$(id -u)" -ne 0
grep -Eq '^NoNewPrivs:[[:space:]]+1$' /proc/self/status
grep -Eq '^Seccomp:[[:space:]]+2$' /proc/self/status
unshare --user --map-root-user true

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
if ! timeout 60s google-chrome --headless --disable-gpu --no-first-run \
    --disable-background-networking --user-data-dir="$scratch/profile" \
    --allow-chrome-scheme-url --dump-dom chrome://sandbox \
    >"$scratch/status.html" 2>"$scratch/chrome.log"; then
    cat "$scratch/chrome.log" >&2
    exit 1
fi

python3 - "$scratch/status.html" <<'PY'
import re
import sys
from pathlib import Path

html = Path(sys.argv[1]).read_text()
for label in ("PID namespaces", "Network namespaces", "Seccomp-BPF sandbox"):
    pattern = rf'<td[^>]*>{re.escape(label)}</td>\s*<td[^>]*>Yes</td>'
    if not re.search(pattern, html):
        raise SystemExit(f"Chrome sandbox check failed: {label}\n{html}")
if "You are adequately sandboxed." not in html:
    raise SystemExit(f"Chrome did not report an adequate sandbox:\n{html}")
print("Chrome namespace and Seccomp-BPF sandbox checks passed.")
PY
