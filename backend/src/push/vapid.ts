import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import webpush from 'web-push';

export type VapidKeys = { publicKey: string; privateKey: string };

const base64url = /^[A-Za-z0-9_-]+$/;
const valid = (keys: unknown): keys is VapidKeys =>
  Boolean(keys) &&
  typeof (keys as VapidKeys).publicKey === 'string' &&
  typeof (keys as VapidKeys).privateKey === 'string' &&
  base64url.test((keys as VapidKeys).publicKey) &&
  base64url.test((keys as VapidKeys).privateKey) &&
  Buffer.from((keys as VapidKeys).publicKey, 'base64url').length === 65 &&
  Buffer.from((keys as VapidKeys).privateKey, 'base64url').length === 32;

/**
 * The platform's VAPID key pair (docs/notifications.md): made on first start in `<data>/push/vapid.json` (folder 0700,
 * file 0600) and kept, since every device's subscription is bound to the public key. The private key never leaves
 * this process: not in responses, logs or the database.
 */
export async function loadVapidKeys(dataDirectory: string): Promise<VapidKeys> {
  const folder = join(dataDirectory, 'push');
  const file = join(folder, 'vapid.json');
  // Never the file's text or path in an error: they reach logs (and a corrupted file could hold key material).
  const unreadable = () =>
    new Error('The push key file is unreadable; move .local/push/vapid.json away to make new keys.');
  const read = async () => {
    let keys: unknown;
    try {
      keys = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
      throw unreadable();
    }
    if (!valid(keys)) throw unreadable();
    await private_(folder, 0o700);
    await private_(file, 0o600);
    return { publicKey: keys.publicKey, privateKey: keys.privateKey };
  };
  try {
    return await read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await private_(folder, 0o700);
  const keys = webpush.generateVAPIDKeys();
  try {
    // 'wx': another process that made it first wins, and its keys are read back.
    await writeFile(file, JSON.stringify(keys), { mode: 0o600, flag: 'wx' });
    return keys;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return read();
    throw unreadable();
  }
}

/** Puts back private permissions (an existing folder or file may have been created or copied with wider ones). */
async function private_(path: string, mode: number) {
  if (((await stat(path)).mode & 0o777) !== mode) await chmod(path, mode);
}

/** Shown to push services as who sends (an https address, never a personal email): PUSH_SUBJECT, else the project. */
export const DEFAULT_SUBJECT = 'https://github.com/AlexZihaoXu/agent-swarm-ng';
export function vapidSubject(env: Record<string, string | undefined> = process.env) {
  const configured = env.PUSH_SUBJECT?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' && url.hostname !== 'localhost') return url.href;
    } catch {
      // Not a URL: the default below.
    }
  }
  return DEFAULT_SUBJECT;
}
