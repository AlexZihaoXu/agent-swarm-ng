import { isIP } from 'node:net';

/**
 * The dashboard has no login, so a web page the operator visits must not be able to reach it by pointing its own
 * DNS name at this address (DNS rebinding). Browsers always send the attacker's hostname in `Host`, so accept only
 * IP literals, localhost, and names the operator lists in ALLOWED_HOSTS (comma-separated hostnames, ports ignored).
 */
export function hostname(header: string | undefined) {
  if (!header) return null;
  try {
    return new URL(`http://${header}`).hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
  } catch {
    return null;
  }
}

export function allowedHosts(configured = process.env.ALLOWED_HOSTS ?? '') {
  const extra = new Set(
    configured
      .split(',')
      .map(entry => hostname(entry.trim()))
      .filter((entry): entry is string => Boolean(entry)),
  );
  return (header: string | undefined) => {
    const name = hostname(header);
    if (!name) return false;
    return isIP(name) !== 0 || name === 'localhost' || name.endsWith('.localhost') || extra.has(name);
  };
}
