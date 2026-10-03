import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('platform health contract', () => {
  it('returns the documented health response', async () => {
    const app = await buildApp({ requireLogin: false });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
      expect(app.swagger().paths).toHaveProperty('/api/health');
    } finally {
      await app.close();
    }
  });
});
