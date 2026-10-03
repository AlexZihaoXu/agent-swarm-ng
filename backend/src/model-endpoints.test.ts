import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';

async function testEndpoint(fetcher: typeof fetch, body: Record<string, unknown>) {
  const app = await buildApp({ requireLogin: false, fetcher });
  try {
    return await app.inject({ method: 'POST', url: '/api/model-endpoints/test', payload: body });
  } finally {
    await app.close();
  }
}

const body = { baseUrl: 'https://models.example/v1/', apiKey: 'test-secret' };

describe('OpenAI-compatible endpoint connection test', () => {
  it('lists models with a server-side GET and optional bearer key', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'model-a' }, { id: 'model-b' }] }));
    const response = await testEndpoint(fetcher as unknown as typeof fetch, body);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ models: ['model-a', 'model-b'] });
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://models.example/v1/models');
    expect(options).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: 'Bearer test-secret' },
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain('test-secret');
  });

  it('supports a local endpoint without a key and an empty model list', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [] }));
    const response = await testEndpoint(fetcher as unknown as typeof fetch, { baseUrl: 'http://127.0.0.1:11434/v1' });
    expect(response.json()).toEqual({ models: [] });
    expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it.each([
    'file:///etc/passwd',
    'ftp://example.com',
    'https://user:password@example.com/v1',
    'https://example.com/v1?key=secret',
    'not a URL',
  ])('rejects invalid base URL %s without fetching', async baseUrl => {
    const fetcher = vi.fn();
    const response = await testEndpoint(fetcher as unknown as typeof fetch, { baseUrl });
    expect(response.statusCode).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports authentication failure without forwarding the provider body', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('private provider error: test-secret', { status: 401 }));
    const response = await testEndpoint(fetcher as unknown as typeof fetch, body);
    expect(response.statusCode).toBe(502);
    expect(response.json().message).toContain('401');
    expect(response.body).not.toContain('test-secret');
  });

  it.each([{ choices: [] }, { data: [{ name: 'missing id' }] }, { data: 'invalid' }])(
    'rejects malformed model list %j',
    async data => {
      const fetcher = vi.fn().mockResolvedValue(Response.json(data));
      expect((await testEndpoint(fetcher as unknown as typeof fetch, body)).statusCode).toBe(502);
    },
  );

  it('bounds the response body', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('x'.repeat(1_048_577)));
    expect((await testEndpoint(fetcher as unknown as typeof fetch, body)).statusCode).toBe(502);
  });

  it('reports timeout without leaking errors', async () => {
    const fetcher = vi.fn().mockRejectedValue(new DOMException('test-secret', 'TimeoutError'));
    const response = await testEndpoint(fetcher as unknown as typeof fetch, body);
    expect(response.statusCode).toBe(504);
    expect(response.body).not.toContain('test-secret');
  });

  it('handles network or redirect failures without returning internal details', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('private details test-secret'));
    const response = await testEndpoint(fetcher as unknown as typeof fetch, body);
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('test-secret');
  });
});
