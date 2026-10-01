import { posix } from 'node:path';
import { ResourceError, validateId } from './resources';

/**
 * Computer storage: every computer gets two mounts, /keep (its Keep folder: code, settings and what it installs)
 * and /cache (its Cache folder: anything that can be fetched again). Each is either the computer's own Docker
 * volume (the default) or `<folder>/computers/<id>` under a host folder the operator chose in Settings. Inside, a
 * fake root mirrors real paths; the guest's start script binds the kept paths onto the real ones
 * (templates/default/runtime/computer-storage.sh, whose path rules `keptPathAllowed` mirrors).
 */
export type StorageClass = 'keep' | 'cache';
export const STORAGE_CLASSES: StorageClass[] = ['keep', 'cache'];
export type ComputerStorage = { keepFolder: string | null; cacheFolder: string | null; keptPaths: string[] };

/** Kept unless the operator says otherwise: the home folder (always) and /usr/local. */
export const DEFAULT_KEPT_PATHS = ['/home/agent', '/usr/local'];
const MAX_KEPT_PATHS = 32;
/** A host folder is only used once someone with shell access on the host created this file in it. */
export const MARKER: Record<StorageClass, string> = {
  keep: '.agent-swarm-keep-root',
  cache: '.agent-swarm-cache-root',
};
export const storageLabel: Record<StorageClass, string> = { keep: 'Keep', cache: 'Cache' };

/** Never the system itself, kernel filesystems, the two mounts, the runtime or the Cache paths (/tmp is emptied). */
const REFUSED = [
  /^\/$/,
  /^\/(bin|sbin|lib|lib64|boot|proc|sys|dev|run|keep|cache|tmp)(\/|$)/,
  /^\/var\/(run|lock)(\/|$)/,
  /^\/var\/cache\/apt\/archives(\/|$)/,
  /^\/(usr|etc|var|opt)$/,
  /^\/opt\/swarm(\/|$)/,
  /^\/usr\/lib\/agent-swarm(\/|$)/,
];
export function keptPathAllowed(path: string) {
  return (
    typeof path === 'string' &&
    path.length <= 255 &&
    /^\/[A-Za-z0-9._@+/-]*$/.test(path) &&
    posix.normalize(path) === path &&
    !path.endsWith('/') &&
    !REFUSED.some(pattern => pattern.test(path))
  );
}
export function validateKeptPaths(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > MAX_KEPT_PATHS)
    throw new ResourceError(400, `Keep at most ${MAX_KEPT_PATHS} paths.`);
  const paths = [...new Set(input)];
  for (const path of paths)
    if (!keptPathAllowed(path))
      throw new ResourceError(
        400,
        `"${String(path)}" cannot be kept: use an absolute folder or file outside the system folders.`,
      );
  if (!paths.includes('/home/agent')) paths.unshift('/home/agent');
  // No kept path inside another (keeping /var/lib after /var/lib/postgresql would cover the system's own files).
  for (const outer of paths as string[])
    for (const inner of paths as string[])
      if (inner !== outer && inner.startsWith(`${outer}/`))
        throw new ResourceError(400, `"${inner}" is inside "${outer}": keep one or the other.`);
  return paths as string[];
}

/** An absolute, normalized host folder; never "/", and nothing Docker's bind syntax could misread. */
export function validateFolder(input: unknown, kind: StorageClass): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (
    typeof input !== 'string' ||
    input.length > 1024 ||
    !input.startsWith('/') ||
    input === '/' ||
    posix.normalize(input) !== input ||
    input.endsWith('/') ||
    !/^\/[A-Za-z0-9._@+/-]+$/.test(input) ||
    // Never inside a computer's own storage (where a guest could plant a marker or symlinks).
    /\/computers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/i.test(input)
  )
    throw new ResourceError(
      400,
      `The ${storageLabel[kind]} folder must be an absolute host path such as /srv/agent-swarm (letters, digits, . _ @ + - only), outside any computer's storage.`,
    );
  return input;
}

export function validateStorage(input: unknown): ComputerStorage {
  if (input === undefined) return { keepFolder: null, cacheFolder: null, keptPaths: [...DEFAULT_KEPT_PATHS] };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ResourceError(400, 'Invalid storage.');
  const value = input as Record<string, unknown>;
  return {
    keepFolder: validateFolder(value.keepFolder, 'keep'),
    cacheFolder: validateFolder(value.cacheFolder, 'cache'),
    keptPaths: validateKeptPaths(value.keptPaths ?? DEFAULT_KEPT_PATHS),
  };
}

export const computerFolder = (folder: string, id: string) => `${folder}/computers/${validateId(id)}`;

export type StorageMount = { Type: 'bind' | 'volume'; Source: string; Target: string };
/** The two mounts of one computer. */
export function storageMounts(
  id: string,
  storage: Pick<ComputerStorage, 'keepFolder' | 'cacheFolder'>,
  volume: (kind: StorageClass) => string,
): StorageMount[] {
  return STORAGE_CLASSES.map(kind => {
    const folder = kind === 'keep' ? storage.keepFolder : storage.cacheFolder;
    return folder
      ? { Type: 'bind', Source: computerFolder(folder, id), Target: `/${kind}` }
      : { Type: 'volume', Source: volume(kind), Target: `/${kind}` };
  });
}

/** Where an existing computer's storage lives, read back from its container (so it never moves silently). */
export function mountedStorage(
  id: string,
  mounts: { Type?: string; Source?: string; Name?: string; Destination?: string }[] | undefined,
): Record<StorageClass, { kind: 'bind'; folder: string } | { kind: 'volume'; name: string } | null> {
  const result: Record<StorageClass, { kind: 'bind'; folder: string } | { kind: 'volume'; name: string } | null> = {
    keep: null,
    cache: null,
  };
  const suffix = `/computers/${validateId(id)}`;
  for (const mount of mounts ?? []) {
    const kind = mount.Destination === '/keep' ? 'keep' : mount.Destination === '/cache' ? 'cache' : null;
    if (!kind) continue;
    if (mount.Type === 'bind' && mount.Source?.endsWith(suffix))
      result[kind] = { kind: 'bind', folder: mount.Source.slice(0, -suffix.length) };
    else if (mount.Type === 'volume' && mount.Name) result[kind] = { kind: 'volume', name: mount.Name };
  }
  return result;
}

export const keptPathsEnvironment = (paths: string[]) => `COMPUTER_KEPT_PATHS=${paths.join(':')}`;
export function keptPathsOf(env: string[] | undefined) {
  const value = env?.find(item => item.startsWith('COMPUTER_KEPT_PATHS='));
  return value ? value.slice('COMPUTER_KEPT_PATHS='.length).split(':').filter(Boolean) : [...DEFAULT_KEPT_PATHS];
}
