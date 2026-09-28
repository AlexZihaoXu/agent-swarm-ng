import { describe, expect, it } from 'vitest';
import { createWebTools } from './web-tools';
import { validateWebCall, webEnvironment, webToolNames } from './web-policy';

describe('explicit Pi Web Access grant', () => {
  it('does not forward developer credentials or Pi configuration', () => {
    process.env.WEB_TEST_SECRET = 'not-forwarded';
    try {
      const env = webEnvironment('/isolated');
      expect(env).not.toHaveProperty('WEB_TEST_SECRET');
      expect(env.PI_CODING_AGENT_DIR).toBe('/isolated');
      expect(env.HOME).toBe('/isolated');
    } finally {
      delete process.env.WEB_TEST_SECRET;
    }
  });
  it('rejects local files, provider/model changes, browser auth, and proxy overrides', () => {
    for (const args of [
      { url: '/etc/passwd' },
      { url: 'file:///etc/passwd' },
      { url: 'https://user:pass@example.com' },
      { url: 'https://example.com', mode: 'answer' },
      { url: 'https://example.com', auth: true },
      { url: 'https://example.com', proxy: 'http://localhost' },
    ]) {
      expect(() => validateWebCall('fetch_content', args)).toThrow();
    }
    expect(() => validateWebCall('web_search', { provider: 'openai' })).toThrow();
    expect(() => validateWebCall('web_search', { workflow: 'auto-summary' })).toThrow();
    expect(() => validateWebCall('bash', {})).toThrow();
    expect(() => validateWebCall('fetch_content', { url: 'https://example.com' })).not.toThrow();
  });
  it('loads the real extension, blocks private targets, and handles missing result IDs', async () => {
    const web = await createWebTools();
    try {
      expect(web.tools.map(tool => tool.name).sort()).toEqual([...webToolNames].sort());
      const fetchTool = web.tools.find(tool => tool.name === 'fetch_content')!;
      await expect(
        fetchTool.execute('bad', { url: 'file:///etc/passwd' }, undefined, undefined, undefined as never),
      ).rejects.toThrow();
      // Refused by our own policy before the extension is even asked (the extension's SSRF guard remains a second layer).
      await expect(
        fetchTool.execute('private', { url: 'http://127.0.0.1:1' }, undefined, undefined, undefined as never),
      ).rejects.toThrow(/public/);
      const retrieve = web.tools.find(tool => tool.name === 'get_search_content')!;
      const result = await retrieve.execute(
        'missing',
        { responseId: 'another-turn' },
        undefined,
        undefined,
        undefined as never,
      );
      expect(JSON.stringify(result)).toMatch(/not found|no .*found|unknown|could not find/i);
      const interrupted = retrieve.execute(
        'interrupted',
        { responseId: 'missing' },
        undefined,
        undefined,
        undefined as never,
      );
      const rejected = expect(interrupted).rejects.toThrow('Web tools stopped');
      await web.close();
      await rejected;
      await expect(
        retrieve.execute('closed', { responseId: 'missing' }, undefined, undefined, undefined as never),
      ).rejects.toThrow('cancelled');
    } finally {
      await web.close();
    }
  }, 45000);
});

it('refuses fetches of loopback, private, link-local, tailnet and internal-service addresses before any request', async () => {
  const { validateWebCall, isNonPublicHost } = await import('./web-policy');
  for (const url of [
    'http://localhost/',
    'http://LOCALHOST.:3000/',
    'http://api.localhost/',
    'http://127.0.0.1:3000/api/agents',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[fd7a:115c:a1e0::1]/',
    'http://[fe80::1]/',
    'http://169.254.169.254/latest/meta-data',
    'http://10.1.2.3/',
    'http://172.16.0.9/',
    'http://192.168.0.167/',
    'http://100.64.10.20:19090/',
    'http://computer-controller:3101/computers',
    'http://backend:3000/',
    'http://printer.local/',
    'http://nas.lan/',
  ])
    expect(() => validateWebCall('fetch_content', { url }), url).toThrow(/public/);
  for (const url of [
    'https://example.com/a?b=c',
    'http://93.184.216.34/',
    'https://sub.domain.example.org:8443/x',
    'http://[2606:2800:220:1:248:1893:25c8:1946]/',
  ])
    expect(() => validateWebCall('fetch_content', { url }), url).not.toThrow();
  expect(isNonPublicHost('172.32.0.1')).toBe(false); // just outside 172.16/12
  expect(isNonPublicHost('100.63.255.255')).toBe(false); // just outside 100.64/10
});
