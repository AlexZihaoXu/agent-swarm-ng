import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { buildApp, hideServerErrors } from './app';

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

it('answers an unexpected failure with a fixed message, keeping request errors as they were', async () => {
  const bare = Fastify();
  hideServerErrors(bare);
  bare.get('/boom', async () => {
    throw new Error('SQLITE_ERROR at /srv/data/platform.db');
  });
  const failed = await bare.inject({ method: 'GET', url: '/boom' });
  expect(failed.statusCode).toBe(500);
  expect(failed.json()).toEqual({ message: 'Something went wrong on the server. Try again.' });
  await bare.close();
  const app = await buildApp({ requireLogin: false });
  try {
    const invalid = await app.inject({ method: 'PATCH', url: '/api/agents/x', payload: { timeNoteMinutes: 7 } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().message).toMatch(/timeNoteMinutes must/);
  } finally {
    await app.close();
  }
});
