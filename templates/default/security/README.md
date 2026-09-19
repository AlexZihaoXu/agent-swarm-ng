# Chromium sandbox profile

`chromium-seccomp.json` is a vendored Moby default profile from commit
[`65adc7e022c97f55e45c054ff012988027733b87`](https://github.com/moby/profiles/blob/65adc7e022c97f55e45c054ff012988027733b87/seccomp/default.json),
with one additional allow rule for `clone`, `setns`, and `unshare`, following
[Playwright's Chromium-in-Docker guidance](https://playwright.dev/docs/docker#crawling-and-scraping).
Upstream licensing is included in `LICENSE`.

These calls permit the non-root browser to create its own user/PID/network namespaces.
The profile still defaults to denying unlisted syscalls; it is not `seccomp=unconfined`.
Pair it with `no-new-privileges:true`. Do not add `SYS_ADMIN`, privileged mode, host
namespace sharing, or Chrome's `--no-sandbox` flag.

Trade-off: namespace syscalls are enabled for all processes in the workspace, not
only Chrome. This is a targeted compatibility relaxation, not a complete security
boundary for hostile agents. Native Linux hosts may have additional AppArmor or
user-namespace restrictions; revalidate on the deployment host rather than disabling
host protections globally.

The full upstream profile is intentionally retained despite its length, so future
updates can be reviewed against upstream. Do not manually condense its syscall rules.

Validation on Docker Desktop: Chrome's `chrome://sandbox` reports namespace and
Seccomp-BPF sandboxes enabled. Yama ptrace protection is reported unavailable on this
host; do not describe the result as every possible sandbox protection being enabled.
