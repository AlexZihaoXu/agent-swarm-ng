export const webToolNames = ['web_search', 'source_check', 'fetch_content', 'get_search_content'] as const;
export type WebToolName = typeof webToolNames[number];

// Deliberate backend grant, not discovery of the developer's Pi configuration.
export const webConfig = {
  provider: 'exa', webSearch: { allowedProviders: ['exa'] }, workflow: 'none',
  allowBrowserCookies: false, autoOpenBrowser: false,
  commands: Object.fromEntries(['websearch', 'curator', 'search', 'google-account'].map(name => [name, { enabled: false }])),
  fetch: { allowedModes: ['readable', 'raw'], defaultMode: 'readable', timeout: 20 },
  fetchRouting: { allowRemoteHostedProviders: false },
  image: { enabled: false }, githubClone: { enabled: false }, githubPrIssue: { enabled: false },
  youtube: { enabled: false }, video: { enabled: false }, pdf: { enabled: false },
};

const forbidden = ['proxy', 'auth', 'answerModel', 'model', 'timestamp', 'frames', 'forceClone'];
export function validateWebCall(name: string, value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid web arguments.');
  const args = value as Record<string, unknown>;
  if (!webToolNames.includes(name as WebToolName)) throw new Error('Web tool not granted.');
  if (forbidden.some(key => args[key] !== undefined)) throw new Error('This web option is not granted.');
  if (args.workflow !== undefined && args.workflow !== 'none') throw new Error('Interactive/model web workflows are not granted.');
  if (args.provider !== undefined && args.provider !== 'exa' && args.provider !== 'auto') throw new Error('Only Exa search is granted.');
  if (name === 'fetch_content') {
    if (args.mode !== undefined && args.mode !== 'readable' && args.mode !== 'raw') throw new Error('Only readable/raw fetching is granted.');
    const urls = args.urls ?? (args.url === undefined ? [] : [args.url]);
    if (!Array.isArray(urls) || urls.length < 1 || urls.length > 5) throw new Error('Provide one to five public HTTP(S) URLs.');
    for (const value of urls) {
      if (typeof value !== 'string') throw new Error('Invalid URL.');
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public HTTP(S) URLs are granted.');
    }
  }
}

export function webEnvironment(directory: string) {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR']) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return { ...env, HOME: directory, USERPROFILE: directory, XDG_CONFIG_HOME: directory,
    TMPDIR: directory, TMP: directory, TEMP: directory, PI_CODING_AGENT_DIR: directory };
}
