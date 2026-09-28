import { expect, it } from 'vitest';
import { authorized } from './auth';

const request = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`http://controller${path}`, { method, headers });
it('requires the shared secret on everything but the container health check when one is configured', () => {
  expect(authorized(request('/computers'), 'secret')).toBe(false);
  expect(authorized(request('/computers', { 'x-controller-token': 'wrong!' }), 'secret')).toBe(false);
  expect(authorized(request('/computers', { 'x-controller-token': 'secret' }), 'secret')).toBe(true);
  expect(authorized(request('/computers/x/core/execute', {}, 'POST'), 'secret')).toBe(false);
  expect(authorized(request('/health'), 'secret')).toBe(true);
  expect(authorized(request('/health', {}, 'POST'), 'secret')).toBe(false);
  expect(authorized(request('/computers'), '')).toBe(true); // no token configured: unchanged behavior
});
