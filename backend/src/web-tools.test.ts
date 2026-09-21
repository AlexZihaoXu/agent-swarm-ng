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
    } finally { delete process.env.WEB_TEST_SECRET; }
  });
  it('rejects local files, provider/model changes, browser auth, and proxy overrides', () => {
    for (const args of [{ url: '/etc/passwd' }, { url: 'file:///etc/passwd' }, { url: 'https://user:pass@example.com' }, { url: 'https://example.com', mode: 'answer' }, { url: 'https://example.com', auth: true }, { url: 'https://example.com', proxy: 'http://localhost' }]) {
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
      await expect(fetchTool.execute('bad', { url: 'file:///etc/passwd' }, undefined, undefined, undefined as never)).rejects.toThrow();
      const blocked = await fetchTool.execute('private', { url: 'http://127.0.0.1:1' }, undefined, undefined, undefined as never);
      expect(JSON.stringify(blocked)).toMatch(/blocked|private|not allowed|reserved/i);
      const retrieve = web.tools.find(tool => tool.name === 'get_search_content')!;
      const result = await retrieve.execute('missing', { responseId: 'another-turn' }, undefined, undefined, undefined as never);
      expect(JSON.stringify(result)).toMatch(/not found|no .*found|unknown|could not find/i);
      const interrupted = retrieve.execute('interrupted', { responseId: 'missing' }, undefined, undefined, undefined as never);
      const rejected = expect(interrupted).rejects.toThrow('Web tools stopped');
      await web.close();
      await rejected;
      await expect(retrieve.execute('closed', { responseId: 'missing' }, undefined, undefined, undefined as never)).rejects.toThrow('cancelled');
    } finally { await web.close(); }
  }, 45000);
});
