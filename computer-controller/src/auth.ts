import { timingSafeEqual } from 'node:crypto';

/** Every request except the container health check must carry the token; without one configured, only the health
 * check is answered (the controller holds the Docker socket: it never runs open). */
export function authorized(
  request: Request,
  token = process.env.COMPUTER_CONTROLLER_TOKEN,
  pathname = new URL(request.url).pathname,
) {
  if (pathname === '/health' && request.method === 'GET') return true;
  if (!token) return false;
  const given = Buffer.from(request.headers.get('x-controller-token') ?? '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
