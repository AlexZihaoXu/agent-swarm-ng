import { isIP } from 'node:net';

function privateIPv4(value: string) {
  const [a, b] = value.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}
/** Loopback, private, link-local, metadata, tailnet and single-label (internal service) hosts are never "public". */
export function isNonPublicHost(hostname: string) {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (isIP(host) === 4) return privateIPv4(host);
  if (isIP(host) === 6) {
    const groups = host.includes('::')
      ? (() => {
          const [head, tail] = host.split('::');
          const h = head ? head.split(':') : [],
            t = tail ? tail.split(':') : [];
          return [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
        })()
      : host.split(':');
    const words = groups.map(group => parseInt(group || '0', 16));
    if (words.slice(0, 5).every(word => word === 0) && (words[5] === 0xffff || words[5] === 0)) {
      if (words[6] === 0 && words[7] <= 1) return true; // :: and ::1
      return privateIPv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`); // IPv4-mapped/compatible
    }
    return (words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80 || (words[0] & 0xff00) === 0xff00;
  }
  return (
    !host.includes('.') ||
    ['localhost', 'local', 'internal', 'lan', 'home.arpa', 'localdomain'].some(
      suffix => host === suffix || host.endsWith(`.${suffix}`),
    )
  );
}

export const webToolNames = ['web_search', 'source_check', 'fetch_content', 'get_search_content'] as const;
export type WebToolName = (typeof webToolNames)[number];

// Deliberate backend grant, not discovery of the developer's Pi configuration.
export const webConfig = {
  provider: 'exa',
  webSearch: { allowedProviders: ['exa'] },
  workflow: 'none',
  allowBrowserCookies: false,
  autoOpenBrowser: false,
  commands: Object.fromEntries(
    ['websearch', 'curator', 'search', 'google-account'].map(name => [name, { enabled: false }]),
  ),
  fetch: { allowedModes: ['readable', 'raw'], defaultMode: 'readable', timeout: 20 },
  fetchRouting: { allowRemoteHostedProviders: false },
  image: { enabled: false },
  githubClone: { enabled: false },
  githubPrIssue: { enabled: false },
  youtube: { enabled: false },
  video: { enabled: false },
  pdf: { enabled: false },
};

const forbidden = ['proxy', 'auth', 'answerModel', 'model', 'timestamp', 'frames', 'forceClone'];
export function validateWebCall(name: string, value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid web arguments.');
  const args = value as Record<string, unknown>;
  if (!webToolNames.includes(name as WebToolName)) throw new Error('Web tool not granted.');
  if (forbidden.some(key => args[key] !== undefined)) throw new Error('This web option is not granted.');
  if (args.workflow !== undefined && args.workflow !== 'none')
    throw new Error('Interactive/model web workflows are not granted.');
  if (args.provider !== undefined && args.provider !== 'exa' && args.provider !== 'auto')
    throw new Error('Only Exa search is granted.');
  if (name === 'fetch_content') {
    if (args.mode !== undefined && args.mode !== 'readable' && args.mode !== 'raw')
      throw new Error('Only readable/raw fetching is granted.');
    const urls = args.urls ?? (args.url === undefined ? [] : [args.url]);
    if (!Array.isArray(urls) || urls.length < 1 || urls.length > 5)
      throw new Error('Provide one to five public HTTP(S) URLs.');
    for (const value of urls) {
      if (typeof value !== 'string') throw new Error('Invalid URL.');
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isNonPublicHost(url.hostname))
        throw new Error('Only public HTTP(S) URLs are granted.');
    }
  }
}

export function webEnvironment(directory: string) {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR']) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return {
    ...env,
    HOME: directory,
    USERPROFILE: directory,
    XDG_CONFIG_HOME: directory,
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
    PI_CODING_AGENT_DIR: directory,
  };
}
