#!/bin/sh
# Provision a self-signed certificate for the opt-in HTTPS dashboard listener.
#
# This is NOT a trusted certificate: browsers show a warning the operator must
# click through once per origin. Its only purpose is to make the dashboard a
# browser *secure context*, which is what unlocks the WebCodecs H.264/H.265
# stream path. Tailscale already encrypts device-to-device transport; this adds
# no confidentiality, only the browser capability.
#
# Refuses to touch an existing certificate so an operator-provisioned trusted
# one (see compose.tailscale-https.yaml) is never clobbered. Secrets stay under
# the project-local .local/ tree with 0600 key material.
set -eu
cd "$(dirname "$0")/.."
certs=.local/certs
crt=$certs/dashboard-selfsigned.crt
key=$certs/dashboard-selfsigned.key
days=${CERT_DAYS:-1825}

mkdir -p "$certs"
chmod 0700 "$certs"
if [ -e "$crt" ] || [ -e "$key" ]; then
    echo "Refusing to overwrite an existing certificate: $crt" >&2
    echo "Remove it deliberately to rotate, or use the trusted-cert overlay." >&2
    exit 1
fi

ip=$(tailscale ip -4 2>/dev/null || true)
name=$(hostname)
[ -n "$ip" ] || { echo 'No Tailscale IPv4 address; this listener is Tailnet-only.' >&2; exit 1; }

subject_alt_names="DNS:localhost,IP:127.0.0.1,DNS:${name},IP:${ip}"
umask 077
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout "$key" -out "$crt" -days "$days" \
    -subj "/CN=${name}" \
    -addext "subjectAltName=${subject_alt_names}" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=serverAuth" \
    >/dev/null 2>&1 || { echo 'Certificate generation failed.' >&2; exit 1; }
chmod 0600 "$key" "$crt"

test -s "$crt" && test -s "$key"
openssl x509 -in "$crt" -noout -subject -ext subjectAltName -enddate | sed 's/^/  /'
echo "Self-signed dashboard certificate ready (SANs: ${subject_alt_names})."
echo "Browser warning expected: the origin is secure but untrusted by design."
