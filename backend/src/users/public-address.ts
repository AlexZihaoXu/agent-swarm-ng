import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isNonPublicHost } from '../web-policy';

/**
 * Whether a URL points at the public internet (docs/users.md#model-connections): a user's model endpoint must not
 * reach the platform's own services (the computer controller, the backend) or the host's networks. Admin's may.
 * The same policy as the web tools (web-policy.ts), checked when an endpoint is tested and saved.
 */
export async function isPublicUrl(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isNonPublicHost(host)) return false;
  if (isIP(host)) return true;
  const addresses = (await lookup(host, { all: true }).catch(() => [])).map(item => item.address);
  return addresses.length > 0 && addresses.every(address => !isNonPublicHost(address));
}
