import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A browser's side of a push subscription: its key pair and auth secret (what the browser keeps private). */
export function subscriber() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: auth.toString('base64url'),
    /** Decrypts an aes128gcm push message body (RFC 8188 + RFC 8291) as the browser would. */
    decrypt(body: Buffer) {
      const salt = body.subarray(0, 16);
      const idLength = body[20]!;
      const serverKey = body.subarray(21, 21 + idLength);
      const content = body.subarray(21 + idLength);
      const secret = ecdh.computeSecret(serverKey);
      const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverKey]);
      const ikm = Buffer.from(hkdfSync('sha256', secret, auth, info, 32));
      const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const decipher = createDecipheriv('aes-128-gcm', key, nonce);
      decipher.setAuthTag(content.subarray(content.length - 16));
      const plain = Buffer.concat([decipher.update(content.subarray(0, content.length - 16)), decipher.final()]);
      // The last record ends with the 0x02 delimiter and zero padding.
      let end = plain.length;
      while (end > 0 && plain[end - 1] === 0) end--;
      return plain.subarray(0, end - 1).toString('utf8');
    },
  };
}

/** Checks a VAPID Authorization header (RFC 8292): an ES256 JWT signed by `publicKey`, and returns its claims. */
export function verifyVapid(header: string, publicKey: string) {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  if (!match || match[2] !== publicKey) throw new Error('Not a VAPID header for this key.');
  const [head, claims, signature] = match[1]!.split('.') as [string, string, string];
  const point = Buffer.from(publicKey, 'base64url');
  const key = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
    format: 'jwk',
  });
  const valid = verify(
    'sha256',
    Buffer.from(`${head}.${claims}`),
    { key, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature, 'base64url'),
  );
  if (!valid) throw new Error('Bad VAPID signature.');
  return JSON.parse(Buffer.from(claims, 'base64url').toString()) as { aud: string; exp: number; sub: string };
}

export type Received = { path: string; headers: IncomingMessage['headers']; body: Buffer };

/** A local stand-in for a push service: records each POST and answers `status(path)` (201 by default). */
export async function fakePushService(status: (path: string) => number = () => 201, delayMs = 0) {
  const received: Received[] = [];
  /** The most requests it had in flight at once. */
  const load = { now: 0, max: 0 };
  const server = createServer((request, response) => {
    load.max = Math.max(load.max, ++load.now);
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      received.push({ path: request.url ?? '', headers: request.headers, body: Buffer.concat(chunks) });
      setTimeout(() => {
        load.now--;
        response.statusCode = status(request.url ?? '');
        response.end();
      }, delayMs);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, received, load, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
