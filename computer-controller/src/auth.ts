import { timingSafeEqual } from 'node:crypto';

/** With a token configured, every request except the container health check must carry it. */
export function authorized(
  request: Request,
  token = process.env.COMPUTER_CONTROLLER_TOKEN,
  pathname = new URL(request.url).pathname,
) {
  if (!token || (pathname === '/health' && request.method === 'GET')) return true;
  const given = Buffer.from(request.headers.get('x-controller-token') ?? '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
