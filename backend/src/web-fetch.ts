import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { pipeline, Readable, type Transform } from 'node:stream';
import zlib from 'node:zlib';
import { isNonPublicHost } from './web-policy';

type Address = { address: string; family: number };
type Options = { resolve?: (hostname: string) => Promise<Address[]>; isPublic?: (address: string) => boolean };

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const decoders: Record<string, () => Transform> = {
  gzip: zlib.createGunzip,
  'x-gzip': zlib.createGunzip,
  deflate: zlib.createInflate,
  br: zlib.createBrotliDecompress,
};

/**
 * fetch() for the web worker that connects only to the addresses it just checked. Checking a name and then letting
 * global fetch resolve it again allows DNS rebinding onto internal services, so it connects to the checked address
 * itself. (A socket lookup hook did the same, but Bun 1.3.6 ignored what the hook returns.)
 */
export function createPublicFetch({
  resolve = hostname => dnsLookup(hostname, { all: true, verbatim: true }),
  isPublic = address => !isNonPublicHost(address),
}: Options = {}) {
  /** The address to connect to: every address of the name must be public (one could be swapped in later). */
  async function address(host: string) {
    const addresses = await resolve(host);
    if (!addresses.length || addresses.some(({ address }) => !isPublic(address)))
      throw new TypeError(`Blocked non-public address for ${host}`);
    // IPv4 first: a container often has no IPv6 route.
    return (addresses.find(({ family }) => family === 4) ?? addresses[0]!).address;
  }

  function send(url: URL, method: string, headers: Headers, body: Buffer | undefined, signal?: AbortSignal) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return Promise.reject(new TypeError('Only HTTP(S).'));
    // IP literals and internal names never reach the lookup, so check them here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) ? !isPublic(host) : isNonPublicHost(host))
      return Promise.reject(new TypeError(`Blocked non-public host ${host}`));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const secure = url.protocol === 'https:';
    return (isIP(host) ? Promise.resolve(host) : address(host)).then(
      connectTo =>
        new Promise<Response>((resolvePromise, reject) => {
          // The connection goes to the address just checked, never to a fresh lookup of the name (no DNS rebinding). The
          // name still goes in the Host header and TLS's server name, which the certificate is verified against.
          const request = (secure ? https : http).request(
            {
              protocol: url.protocol,
              hostname: connectTo,
              port: url.port || (secure ? 443 : 80),
              path: `${url.pathname}${url.search}`,
              method,
              headers: { ...Object.fromEntries(headers), host: url.host },
              ...(secure && !isIP(host) ? { servername: host } : {}),
            },
            response => {
              const status = response.statusCode!;
              const responseHeaders = new Headers();
              for (let i = 0; i < response.rawHeaders.length; i += 2)
                responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
              const empty = method === 'HEAD' || status === 204 || status === 304;
              const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
              const decoder = Object.hasOwn(decoders, encoding) ? decoders[encoding] : undefined;
              const stream: Readable = empty || !decoder ? response : pipeline(response, decoder(), () => {});
              stream.once('close', () => signal?.removeEventListener('abort', abort));
              if (empty) response.resume();
              const result = new Response(empty ? null : (Readable.toWeb(stream) as unknown as ReadableStream), {
                status,
                statusText: response.statusMessage,
                headers: responseHeaders,
              });
              Object.defineProperty(result, 'url', { value: url.href });
              resolvePromise(result);
            },
          );
          const abort = () => request.destroy(signal!.reason);
          signal?.addEventListener('abort', abort, { once: true });
          request.once('error', error => {
            signal?.removeEventListener('abort', abort);
            reject(error);
          });
          request.end(body);
        }),
    );
  }

  return async function publicFetch(input: string | URL | Request, init: RequestInit = {}) {
    const request = new Request(input, init);
    const signal = init.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined;
    const redirect = init.redirect ?? (input instanceof Request ? input.redirect : 'follow');
    const headers = new Headers(request.headers);
    if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate, br');
    let body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
    let method = request.method;
    let url = new URL(request.url);
    for (let hop = 0; ; hop++) {
      if (body) headers.set('content-length', String(body.length));
      const response = await send(url, method, headers, body, signal);
      const location = response.headers.get('location');
      if (redirect === 'manual' || !redirectStatuses.has(response.status) || !location) return response;
      await response.body?.cancel();
      if (redirect === 'error' || hop === 20) throw new TypeError(`Redirect refused from ${url.href}`);
      // Every followed hop goes through send() again, so it is checked at its own connection.
      const next = new URL(location, url);
      if (
        (response.status === 303 && method !== 'HEAD') ||
        ([301, 302].includes(response.status) && method === 'POST')
      ) {
        method = 'GET';
        body = undefined;
        for (const name of ['content-type', 'content-length']) headers.delete(name);
      }
      if (next.origin !== url.origin) for (const name of ['authorization', 'cookie']) headers.delete(name);
      url = next;
    }
  };
}
