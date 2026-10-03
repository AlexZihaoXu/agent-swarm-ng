import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
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
 * global fetch resolve it again allows DNS rebinding onto internal services, so the check lives in the socket lookup.
 */
export function createPublicFetch({
  resolve = hostname => dnsLookup(hostname, { all: true, verbatim: true }),
  isPublic = address => !isNonPublicHost(address),
}: Options = {}) {
  const lookup: LookupFunction = (hostname, options, callback) => {
    resolve(hostname)
      .then(addresses => {
        if (!addresses.length || addresses.some(({ address }) => !isPublic(address)))
          throw new Error(`Blocked non-public address for ${hostname}`);
        // A copy: Bun consumes the array it is given.
        if (options.all)
          callback(
            null,
            addresses.map(({ address, family }) => ({ address, family })),
          );
        else callback(null, addresses[0].address, addresses[0].family);
      })
      .catch(error => callback(error, ''));
  };

  function send(url: URL, method: string, headers: Headers, body: Buffer | undefined, signal?: AbortSignal) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return Promise.reject(new TypeError('Only HTTP(S).'));
    // IP literals and internal names never reach the lookup, so check them here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) ? !isPublic(host) : isNonPublicHost(host))
      return Promise.reject(new TypeError(`Blocked non-public host ${host}`));
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<Response>((resolvePromise, reject) => {
      const request = (url.protocol === 'https:' ? https : http).request(
        url,
        { method, headers: Object.fromEntries(headers), lookup },
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
    });
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
