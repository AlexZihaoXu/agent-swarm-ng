import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { DockerApi, DockerApiError } from './docker-api';
import { validateRecording, type RecordingOp } from './recording';
import { MAX_TRANSFER, regularFile, tarOneFile, transferPath, untarFirstFile } from './file-transfer';
import {
  decodeFileResult,
  downloadResult,
  headerResult,
  operatorFilesScript,
  readStatusLine,
  validateDownloadQuery,
  validateFileQuery,
  validateUploadQuery,
  validName,
  validUpload,
  type DownloadQuery,
  type FileOperation,
  type FileQuery,
  type UploadQuery,
} from './operator-files';
import {
  diskScript,
  parseDiskOutput,
  validateRequestedPaths,
  validDiskPath,
  type DiskPath,
  type MeasuredDisk,
  type ZfsDataset,
} from './disks';

type DiskUsage = { disks: MeasuredDisk[]; zfs: ZfsDataset[] };
/** How long a host path found unavailable is skipped before the dashboard's disk sampling tries it again. */
const DISK_RETRY_MS = 3_600_000;
import { ComputerNames, ResourceError, validateId, validateName, type ResourceRole } from './resources';
import {
  MARKER,
  STORAGE_CLASSES,
  computerFolder,
  keptPathsEnvironment,
  archivePath,
  keptPathsOf,
  mountedStorage,
  storageLabel,
  storageMounts,
  validateFolder,
  validateKeptPaths,
  validateStorage,
  type ComputerStorage,
  type StorageClass,
  type StorageMount,
} from './storage';
import {
  deriveComputerLimits,
  validateComputerConfiguration,
  type ComputerConfiguration,
  type ComputerLimits,
} from './computer-configuration';
import type { LxcfsBinder } from './lxcfs';

type Container = {
  Id: string;
  Image?: string;
  Config: { Labels?: Record<string, string>; Env?: string[] };
  State: { Running: boolean; Status: string };
  Mounts?: { Type?: string; Source?: string; Name?: string; Destination?: string }[];
  HostConfig?: {
    Devices?: { PathOnHost: string; PathInContainer: string; CgroupPermissions: string }[] | null;
    NanoCpus?: number;
    Memory?: number;
    Sysctls?: Record<string, string> | null;
  };
  NetworkSettings: { Networks: Record<string, { IPAddress: string; Aliases?: string[] | null; DNSNames?: string[] }> };
};
type ListedContainer = { Id: string; State: string; Image?: string; Labels: Record<string, string> };
export type DisplayServer = 'x11' | 'wayland';
/** Images built from x11.Dockerfile carry a label; older images are recognized by the tags this project gave them. */
export function displayServerOf(row: Pick<ListedContainer, 'Image' | 'Labels'>): DisplayServer {
  const labelled = row.Labels?.['swarm.ng.display-server'];
  if (labelled === 'x11' || labelled === 'wayland') return labelled;
  return /(^|[-:_])(x11|xorg\d*)([-_]|$)/i.test(row.Image ?? '') ? 'x11' : 'wayland';
}
/** Selkies' in-computer port on images from before `swarm.ng.stream-port`; such computers keep it until rebuilt. */
export const LEGACY_STREAM_PORT = 8080;
const STREAM_PORT_ENV = 'COMPUTER_STREAM_PORT=';
/** The desktop stream port a computer image declares (`swarm.ng.stream-port`), strictly an unprivileged port. */
export function streamPortOf(labels: Record<string, string> | null | undefined): number {
  const value = labels?.['swarm.ng.stream-port'];
  if (value === undefined) return LEGACY_STREAM_PORT;
  const port = /^[1-9]\d{3,4}$/.test(value) ? Number(value) : NaN;
  if (!(port >= 1024 && port <= 65535)) throw new ResourceError(503, 'Computer image declares an invalid stream port.');
  return port;
}
/** The port a relay forwards to: its env value, or the legacy port for relays made before the env existed. */
export function relayStreamPortOf(env: string[] | undefined): number | null {
  const values = (env ?? []).filter(entry => entry.startsWith(STREAM_PORT_ENV));
  if (values.length === 0) return LEGACY_STREAM_PORT;
  const value = values.length === 1 ? values[0].slice(STREAM_PORT_ENV.length) : '';
  return /^[1-9]\d{3,4}$/.test(value) && Number(value) <= 65535 ? Number(value) : null;
}
type Network = {
  Id: string;
  Driver: string;
  Internal: boolean;
  EnableIPv6: boolean;
  Labels?: Record<string, string>;
  Options?: Record<string, string>;
  IPAM: { Config: { Subnet?: string; Gateway?: string }[] };
};
type Volume = { Name: string; Labels?: Record<string, string> };
type Statistics = {
  cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: { inactive_file?: number } };
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const PRIVATE_MODE = 'com.docker.network.bridge.gateway_mode_ipv4';
const DEFAULT_IMAGE = 'agent-swarm-default:stage2';
const DEFAULT_GATEWAY_IMAGE = 'agent-swarm-computer-egress:dev';
const DEFAULT_MEDIA_IMAGE = 'agent-swarm-computer-media:stage2';
/** The most computers the controller will ever keep, whatever the operator's setting. */
export const MAX_COMPUTERS = 100;

/** Owns only its labelled Docker computers; other projects and agent containers are untouchable. */
/** Guest hostname from the operator-visible computer name, so the desktop
 * prompt reads agent@workspace-ngclzr rather than a Docker container ID.
 * RFC 1123 shape only: lowercase alphanumerics and internal hyphens, at most
 * 63 characters, never empty. Anything unusable falls back to a stable
 * ID-derived name. */
export function computerHostname(name: string, id: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  return slug || `computer-${validateId(id).slice(0, 8)}`;
}

/** Desktop container environment: only operator-supplied grants, never
 * browser input. The guest clock is operator-chosen rather than inherited from
 * the host, so `timezone` publishes both TZ (for processes started before the
 * bootstrap) and COMPUTER_TIMEZONE (which the root bootstrap links into
 * /etc/localtime for the whole desktop session). */
export function desktopEnvironment(id: string, gateway: string, renderDevice: string, timezone: string) {
  return [
    `COMPUTER_GATEWAY=${gateway}`,
    `COMPUTER_ID=${id}`,
    ...(renderDevice ? [`COMPUTER_GPU_RENDER_DEVICE=${renderDevice}`] : []),
    ...(timezone ? [`TZ=${timezone}`, `COMPUTER_TIMEZONE=${timezone}`] : []),
  ];
}

/** Desktop container create body: one place so the operator-supplied fields
 * (hostname, grants, mounts) are directly testable without Docker seeding. */
export function desktopCreateBody(input: {
  image: string;
  labels: Record<string, string>;
  env: string[];
  hostname: string;
  privateNetwork: string;
  seccomp: string;
  renderDevice: string;
  cpuLimit: number;
  memoryGiB: number;
  /** Its Keep and Cache mounts (storage.ts). */
  mounts: StorageMount[];
}) {
  return {
    // Hostname is a top-level Config field, NOT part of HostConfig: Docker
    // silently ignores it there and falls back to the container's short ID.
    Image: input.image,
    User: 'root',
    Cmd: ['/opt/swarm/start-computer.sh'],
    Labels: input.labels,
    Env: input.env,
    Hostname: input.hostname,
    Domainname: '',
    HostConfig: {
      Runtime: 'sysbox-runc',
      NetworkMode: input.privateNetwork,
      Dns: ['1.1.1.1'],
      CapDrop: ['ALL'],
      SecurityOpt: [`seccomp=${input.seccomp}`],
      Init: true,
      ...(input.renderDevice
        ? {
            Devices: [
              { PathOnHost: input.renderDevice, PathInContainer: input.renderDevice, CgroupPermissions: 'rwm' },
            ],
          }
        : {}),
      Tmpfs: { '/run': 'rw,nosuid,size=64m' },
      ShmSize: 256 * 1024 * 1024,
      // Match the tested policy explicitly: RAM plus an equal host-swap
      // allowance. Docker's implicit default can differ across hosts.
      NanoCpus: input.cpuLimit * 1_000_000_000,
      Memory: input.memoryGiB * 1024 ** 3,
      MemorySwap: input.memoryGiB * 2 * 1024 ** 3,
      PidsLimit: 1024,
      RestartPolicy: { Name: 'no' },
      // Only /keep and /cache: the guest binds the kept paths from them at every start (computer-storage.sh).
      Mounts: input.mounts,
    },
  };
}

export class ComputerManager {
  readonly names: ComputerNames;
  private queue: Promise<void> = Promise.resolve();
  private previewCache = new Map<string, { at: number; image: Buffer }>();
  private previewPending = new Map<string, Promise<Buffer | null>>();
  private detectedLimits: ComputerLimits | null = null;
  private fileOperations = new Set<string>();
  private transfers = new Map<string, number>();
  /** Operator uploads/downloads in flight: their own pool, so a long transfer never blocks listings or previews. */
  private operatorTransfers = new Map<string, number>();
  constructor(
    private readonly docker: DockerApi,
    namespace: string,
    private readonly seccomp: string = readFileSync(
      new URL('../../templates/default/security/chromium-seccomp.json', import.meta.url),
      'utf8',
    ),
    private readonly image = DEFAULT_IMAGE,
    private readonly gatewayImage = DEFAULT_GATEWAY_IMAGE,
    private readonly mediaImage = DEFAULT_MEDIA_IMAGE,
    private readonly renderDevice = '',
    private readonly cpuLimit = 2,
    private readonly timezone = '',
    /** LXCFS binds (lxcfs.ts); null leaves computers showing the host's memory and CPUs. */
    private readonly lxcfs: LxcfsBinder | null = null,
  ) {
    this.names = new ComputerNames(namespace);
    // Only an operator-selected DRM render node, never a card/modeset device
    // or arbitrary host path, may be shared with sudo-capable computers.
    if (renderDevice && !/^\/dev\/dri\/renderD\d{3}$/.test(renderDevice))
      throw new Error('Invalid computer render device.');
    if (!Number.isInteger(cpuLimit) || cpuLimit < 1 || cpuLimit > 8) throw new Error('Invalid computer CPU limit.');
    // An IANA zone name is interpolated into container env and a guest symlink
    // target, so only plain path segments are accepted: no traversal, no
    // absolute path, no shell metacharacters. Empty leaves the image default.
    if (timezone && (timezone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(timezone))) {
      throw new Error('Invalid computer timezone.');
    }
  }

  /** Docker reports logical CPUs and installed memory; policy further bounds
   * the choices so a single guest cannot claim the whole host by default. */
  async limits() {
    if (this.detectedLimits) return this.detectedLimits;
    const info = await this.docker.json<{ NCPU?: number; MemTotal?: number }>('GET', '/info', undefined, 256 * 1024);
    this.detectedLimits = deriveComputerLimits(info, this.cpuLimit, this.timezone);
    return this.detectedLimits;
  }

  private async waitDesktopReady(name: string) {
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        await this.docker.exec(name, ['test', '-f', '/run/user/1000/desktop-ready'], 'agent', 4000);
        return;
      } catch {
        await delay(500);
      }
    }
    throw new ResourceError(503, 'Computer desktop did not become ready.');
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let done!: () => void;
    this.queue = new Promise<void>(resolve => {
      done = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      done();
    }
  }
  private path(kind: string, name: string) {
    return `/${kind}/${encodeURIComponent(name)}`;
  }
  private renderDeviceMatches(computer: Container) {
    const devices = computer.HostConfig?.Devices ?? [];
    if (!this.renderDevice) return devices.length === 0;
    return (
      devices.length === 1 &&
      devices[0].PathOnHost === this.renderDevice &&
      devices[0].PathInContainer === this.renderDevice &&
      devices[0].CgroupPermissions === 'rwm'
    );
  }
  private async container(name: string, id: string, role: ResourceRole, displayName?: string) {
    const value = await this.docker.optional<Container>(`${this.path('containers', name)}/json`);
    if (value) this.names.assertOwned(value.Config.Labels, id, role, displayName);
    return value;
  }
  private async network(name: string, id: string | null, role: 'private-network' | 'egress-network') {
    const value = await this.docker.optional<Network>(this.path('networks', name));
    if (value) this.names.assertOwned(value.Labels, id, role);
    return value;
  }
  private async volume(name: string, id: string, role: 'keep' | 'cache' | 'home' | 'workspace') {
    const value = await this.docker.optional<Volume>(this.path('volumes', name));
    if (value) this.names.assertOwned(value.Labels, id, role);
    return value;
  }
  private async ensureNetwork(name: string, id: string | null, role: 'private-network' | 'egress-network') {
    let result = await this.network(name, id, role);
    if (!result) {
      await this.docker.request('POST', '/networks/create', {
        Name: name,
        CheckDuplicate: true,
        Driver: 'bridge',
        Internal: role === 'private-network',
        EnableIPv6: false,
        Labels: this.names.labels(id, role),
        Options: role === 'private-network' ? { [PRIVATE_MODE]: 'isolated' } : {},
      });
      result = await this.network(name, id, role);
    }
    if (
      !result ||
      result.Driver !== 'bridge' ||
      result.Internal !== (role === 'private-network') ||
      result.EnableIPv6 ||
      (role === 'private-network' &&
        (result.Options?.[PRIVATE_MODE] !== 'isolated' ||
          Boolean(result.IPAM.Config[0]?.Gateway && result.IPAM.Config[0]?.Gateway !== 'invalid IP')))
    )
      throw new ResourceError(409, 'Computer network has unsafe settings.');
    return result;
  }
  private async mediaNetwork() {
    // This shared bridge is created by Compose for Caddy, not by computers.
    // Never attach a media relay to an arbitrary operator-supplied network.
    const network = await this.docker.optional<Network>(this.path('networks', this.names.mediaNetwork));
    if (
      !network ||
      network.Driver !== 'bridge' ||
      !network.Internal ||
      network.EnableIPv6 ||
      network.Options?.[PRIVATE_MODE] !== 'isolated' ||
      Boolean(network.IPAM.Config[0]?.Gateway && network.IPAM.Config[0].Gateway !== 'invalid IP') ||
      network.Labels?.['com.docker.compose.project'] !== this.names.namespace
    ) {
      throw new ResourceError(503, 'Isolated dashboard media network is unavailable.');
    }
    return network;
  }
  private async approvedImage(image: string) {
    const inspected = await this.docker.optional<{ Config?: { Labels?: Record<string, string> | null } }>(
      `${this.path('images', image)}/json`,
    );
    if (!inspected) throw new ResourceError(503, 'Build the approved computer images before creating computers.');
    // Docker merges image labels into new container labels. A shared image
    // built under a disposable Compose project would falsely mark a live
    // gateway/media/desktop as that test project's resource.
    if (Object.keys(inspected.Config?.Labels ?? {}).some(label => label.startsWith('com.docker.compose.')))
      throw new ResourceError(503, 'Build approved computer images directly without Compose project labels.');
  }
  private async ensureVolume(id: string, role: 'keep' | 'cache') {
    const name = this.names.volume(id, role);
    if (await this.volume(name, id, role)) return;
    await this.docker.request('POST', '/volumes/create', { Name: name, Labels: this.names.labels(id, role) });
    if (!(await this.volume(name, id, role))) throw new ResourceError(503, 'Computer volume was not created.');
  }
  /**
   * Runs a short shell script in a throwaway helper container (the computer image, no network, root with only
   * the capabilities file housekeeping needs) with a computer's storage mounted at /keep and /cache, or a base
   * folder at /base. Storage housekeeping happens here because files there can belong to root or a service
   * account. Returns stdout; a non-zero exit becomes a ResourceError with the script's last stderr line.
   */
  private async helper(
    mounts: (StorageMount & { ReadOnly?: boolean; BindOptions?: { NonRecursive?: boolean } })[],
    script: string,
    timeoutMs = 120_000,
    /** Runs after a successful script, before the helper is removed (it can still receive files). */
    afterExit?: (helperId: string, stdout: string) => Promise<void>,
    /** Capabilities instead of the file-housekeeping ones (disk usage needs only to look). */
    capAdd = ['CHOWN', 'DAC_OVERRIDE', 'DAC_READ_SEARCH', 'FOWNER'],
  ) {
    const created = await this.docker.json<{ Id: string }>('POST', '/containers/create', {
      Image: this.image,
      User: 'root',
      Entrypoint: ['/bin/sh', '-c', script],
      Cmd: [],
      Labels: this.names.labels(null, 'storage-helper'),
      HostConfig: {
        NetworkMode: 'none',
        CapDrop: ['ALL'],
        CapAdd: capAdd,
        SecurityOpt: ['no-new-privileges'],
        Mounts: mounts,
      },
    });
    try {
      await this.docker.request('POST', `${this.path('containers', created.Id)}/start`);
      const waited = await this.docker.request(
        'POST',
        `${this.path('containers', created.Id)}/wait`,
        undefined,
        4096,
        timeoutMs,
      );
      const exit = (JSON.parse(waited.toString()) as { StatusCode?: number }).StatusCode ?? 1;
      const raw = await this.docker.request(
        'GET',
        `${this.path('containers', created.Id)}/logs?stdout=1&stderr=1`,
        undefined,
        1024 * 1024,
      );
      const streams: Record<number, Buffer[]> = { 1: [], 2: [] };
      for (let offset = 0; offset + 8 <= raw.length;) {
        const length = raw.readUInt32BE(offset + 4);
        streams[raw[offset]]?.push(raw.subarray(offset + 8, offset + 8 + length));
        offset += 8 + length;
      }
      if (exit !== 0) {
        const message = Buffer.concat(streams[2]).toString().trim().split('\n').pop();
        throw new ResourceError(exit === 3 ? 409 : 503, message || 'Computer storage housekeeping failed.');
      }
      const stdout = Buffer.concat(streams[1]).toString();
      await afterExit?.(created.Id, stdout);
      return stdout;
    } finally {
      await this.docker.request('DELETE', `${this.path('containers', created.Id)}?force=true&v=false`).catch(() => {});
    }
  }
  private dockerRoot?: string;
  private async dockerRootDir() {
    return (this.dockerRoot ??=
      (await this.docker.json<{ DockerRootDir?: string }>('GET', '/info', undefined, 256 * 1024)).DockerRootDir ??
      '/var/lib/docker');
  }
  private diskRun?: Promise<DiskUsage>;
  /** Host paths found unavailable, with when to try them again: a missing path is not mounted every five minutes. */
  private readonly unavailableDisks = new Map<string, number>();
  /**
   * Dashboard disk usage (disks.ts) of Docker's data root, the operator's listed paths and the backend's requested
   * Keep/Cache folders: one read-only helper without capabilities runs `df`. Docker's root and "/" are mounted
   * without their submounts (every container's filesystem); other paths keep them, so ZFS datasets beneath a pool's
   * folder are counted. A requested folder must pass the Keep/Cache folder rules (validateFolder, outside Docker's
   * storage) and carry its marker; otherwise it is reported unavailable. A path that does not exist on the host is
   * reported unavailable, not an error, and skipped for an hour. One measurement at a time: a request during one
   * gets its result.
   */
  async diskUsage(requested: string[], listed: string[]) {
    const paths = validateRequestedPaths(requested);
    return (this.diskRun ??= this.measureDisks(paths, listed).finally(() => (this.diskRun = undefined)));
  }
  private async measureDisks(requested: string[], listed: string[]): Promise<DiskUsage> {
    const docker = await this.dockerRootDir();
    const insideDocker = (path: string) => path === docker || path.startsWith(`${docker}/`);
    const keepOrCacheFolder = (path: string) => {
      try {
        return validateFolder(path, 'keep') === path && !insideDocker(path);
      } catch {
        return false;
      }
    };
    const paths: DiskPath[] = [{ path: docker, use: 'docker' }];
    for (const path of listed) if (validDiskPath(path)) paths.push({ path, use: 'listed' });
    for (const path of requested) paths.push({ path, use: 'requested' });
    const now = Date.now();
    for (const [path, until] of this.unavailableDisks) if (until <= now) this.unavailableDisks.delete(path);
    const skipped = (entry: DiskPath) =>
      (entry.use === 'requested' && !keepOrCacheFolder(entry.path)) ||
      (entry.use !== 'docker' && this.unavailableDisks.has(entry.path));
    const measured = paths.filter(entry => !skipped(entry));
    await this.approvedImage(this.image);
    const measure = async (entries: DiskPath[]) =>
      parseDiskOutput(
        await this.helper(
          entries.map(({ path }, index) => ({
            Type: 'bind' as const,
            Source: path,
            Target: `/m/${index}`,
            ReadOnly: true,
            ...(path === docker || path === '/' ? { BindOptions: { NonRecursive: true } } : {}),
          })),
          diskScript(entries),
          // A hung df is stopped (the helper is removed) well before the backend's next sample.
          30_000,
          undefined,
          [],
        ),
        entries,
      );
    let results: DiskUsage[];
    // Paths that failed for a passing reason (Docker trouble, the deadline): reported unavailable, but tried again next
    // time rather than skipped for an hour. Only a missing folder (or a missing marker, from the script) is remembered.
    const transient = new Set<string>();
    try {
      results = [await measure(measured)];
    } catch (error) {
      // Docker refuses the whole helper when one path is missing: measure each alone so the rest still count.
      if (!(error instanceof DockerApiError)) throw error;
      // One after another, within one deadline below the backend's 90 s request limit: never a burst of containers.
      const deadline = Date.now() + 75_000;
      results = [];
      for (const entry of measured) {
        const unavailable = { disks: [{ ...entry, error: 'unavailable' as const }], zfs: [] };
        if (Date.now() > deadline) {
          transient.add(entry.path);
          results.push(unavailable);
          continue;
        }
        results.push(
          await measure([entry]).catch(failure => {
            // Docker answers 400 for a bind source that does not exist; anything else may pass.
            const missing = failure instanceof DockerApiError && failure.status === 400;
            if (!missing) transient.add(entry.path);
            return unavailable;
          }),
        );
      }
    }
    const found = new Map(results.flatMap(result => result.disks).map(disk => [`${disk.use}\n${disk.path}`, disk]));
    const disks = paths.map(
      entry => found.get(`${entry.use}\n${entry.path}`) ?? { ...entry, error: 'unavailable' as const },
    );
    for (const disk of disks) {
      if (disk.use === 'docker') continue;
      if (!('error' in disk)) this.unavailableDisks.delete(disk.path);
      else if (!transient.has(disk.path) && !this.unavailableDisks.has(disk.path))
        this.unavailableDisks.set(disk.path, now + DISK_RETRY_MS);
    }
    const zfs = new Map(results.flatMap(result => result.zfs).map(item => [item.dataset, item]));
    return { disks, zfs: [...zfs.values()] };
  }
  /**
   * A host Keep/Cache folder is used only when: it is outside Docker's own storage, it exists, it carries its marker
   * (the host owner chose it, and its disk is really mounted) and, for a computer, its `computers` and
   * `computers/<id>` folders are real folders rather than symlinks a guest could have planted. `create` makes the
   * computer's folder. Messages stay short: the backend shows at most 200 characters.
   */
  private async checkBase(kind: StorageClass, folder: string, id?: string, create = false) {
    await this.dockerRootDir();
    const label = storageLabel[kind];
    if (folder === this.dockerRoot || folder.startsWith(`${this.dockerRoot}/`))
      throw new ResourceError(409, `The ${label} folder cannot be inside Docker's own storage.`);
    const own = id ? `/base/computers/${validateId(id)}` : null;
    const script = [
      `test -f /base/${MARKER[kind]} || { echo "The ${label} folder is not ready: its disk may not be mounted, or ${folder} has no ${MARKER[kind]} file." >&2; exit 3; }`,
      ...(own
        ? [
            `for p in /base/computers ${own}; do if [ -L "$p" ]; then echo "The ${label} folder has a symlink where a computer folder belongs; refusing it." >&2; exit 3; fi; done`,
          ]
        : []),
      ...(own && create ? [`mkdir -p ${own}`] : []),
    ].join('\n');
    try {
      await this.helper([this.baseMount(folder)], script, 30_000);
    } catch (error) {
      if (error instanceof DockerApiError)
        throw new ResourceError(
          409,
          `The ${label} folder ${folder} does not exist on the host: mount its disk, or recreate it with its marker.`,
        );
      throw error;
    }
  }
  private baseMount(folder: string): StorageMount {
    return { Type: 'bind', Source: folder, Target: '/base' };
  }
  /** Settings check: is this host folder usable as the Keep or Cache folder? */
  async checkFolder(kind: StorageClass, raw: string) {
    const folder = validateFolder(raw, kind);
    if (!folder) return;
    await this.approvedImage(this.image);
    await this.checkBase(kind, folder);
  }
  /** Before a computer is created: its own volumes, or its folders under the chosen host folders. */
  private async prepareStorage(id: string, storage: ComputerStorage) {
    for (const kind of STORAGE_CLASSES) {
      const folder = kind === 'keep' ? storage.keepFolder : storage.cacheFolder;
      if (folder) await this.checkBase(kind, folder, id, true);
      else await this.ensureVolume(id, kind);
    }
  }
  /** Where a computer's storage is, from its container: refuses to go on if a host folder is not usable. */
  private async checkMountedStorage(id: string, computer: Container) {
    const mounted = mountedStorage(id, computer.Mounts);
    for (const kind of STORAGE_CLASSES) {
      const place = mounted[kind];
      if (place?.kind === 'bind') await this.checkBase(kind, place.folder, id);
    }
    return mounted;
  }
  /**
   * A path kept for the first time on a rebuild may already hold live data in the old container (a database whose
   * folder the operator just added): carry it into the Keep folder. A copy the Keep folder still has from an earlier
   * time the path was kept is older than that, so it is moved aside to /keep/replaced/<time>/, never deleted. When
   * the old container has nothing there, the Keep folder's copy (if any) is used as it is.
   */
  private async carryOver(oldId: string, path: string, mounts: StorageMount[]) {
    if (!(await this.docker.archiveExists(oldId, path))) return;
    const keep = mounts.find(mount => mount.Target === '/keep')!;
    const parent = posix.dirname(path);
    const aside = `/keep/replaced/${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await this.helper(
      [keep],
      `mkdir -p '/keep/root${parent}' && if [ -e '/keep/root${path}' ] || [ -L '/keep/root${path}' ]; then mkdir -p '${aside}${parent}' && mv '/keep/root${path}' '${aside}${path}'; fi`,
      60_000,
      async helperId => {
        await this.docker.copyArchive(oldId, path, helperId, `/keep/root${parent}`);
      },
    );
  }
  private storageMountsOf(id: string, computer: Container): StorageMount[] {
    const mounted = mountedStorage(id, computer.Mounts);
    return STORAGE_CLASSES.map(kind => {
      const place = mounted[kind];
      if (!place) throw new ResourceError(409, 'This computer predates Keep/Cache storage; delete and recreate it.');
      return place.kind === 'bind'
        ? { Type: 'bind' as const, Source: computerFolder(place.folder, id), Target: `/${kind}` }
        : { Type: 'volume' as const, Source: place.name, Target: `/${kind}` };
    });
  }

  private async ensureGateway(id: string, name: string, subnet: string, network: Network) {
    const gatewayName = this.names.gateway(id);
    let gateway = await this.container(gatewayName, id, 'egress', name);
    if (!gateway) {
      await this.approvedImage(this.gatewayImage);
      await this.docker.request('POST', `/containers/create?name=${encodeURIComponent(gatewayName)}`, {
        Image: this.gatewayImage,
        Labels: this.names.labels(id, 'egress', name),
        Env: [`COMPUTER_SUBNET=${subnet}`],
        HostConfig: {
          NetworkMode: this.names.egressNetwork,
          CapDrop: ['ALL'],
          CapAdd: ['NET_ADMIN'],
          SecurityOpt: ['no-new-privileges:true'],
          Tmpfs: { '/tmp': 'rw,nosuid,size=16m' },
          Memory: 128 * 1024 * 1024,
          PidsLimit: 128,
          RestartPolicy: { Name: 'no' },
        },
      });
      gateway = await this.container(gatewayName, id, 'egress', name);
    }
    if (!gateway) throw new ResourceError(503, 'Computer egress was not created.');
    if (!gateway.State.Running) await this.docker.request('POST', `${this.path('containers', gatewayName)}/start`);
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        await this.docker.exec(gatewayName, ['test', '-f', '/tmp/ready'], 'root', 4000);
        ready = true;
        break;
      } catch {
        await delay(250);
      }
    }
    if (!ready) throw new ResourceError(503, 'Computer egress did not become ready.');
    if (!gateway.NetworkSettings.Networks[this.names.privateNetwork(id)]) {
      await this.docker.request('POST', `${this.path('networks', network.Id)}/connect`, { Container: gatewayName });
    }
    gateway = await this.container(gatewayName, id, 'egress', name);
    const address = gateway?.NetworkSettings.Networks[this.names.privateNetwork(id)]?.IPAddress;
    if (!address || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address))
      throw new ResourceError(503, 'Computer egress address is unavailable.');
    return address;
  }

  private async ensureMedia(id: string, name: string, computer: Container) {
    const mediaNetwork = await this.mediaNetwork();
    const privateNetwork = this.names.privateNetwork(id);
    const target = computer.NetworkSettings.Networks[privateNetwork]?.IPAddress;
    const subnet = mediaNetwork.IPAM.Config[0]?.Subnet;
    if (!target || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(target))
      throw new ResourceError(503, 'Computer private address is unavailable.');
    if (!subnet || !/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(subnet))
      throw new ResourceError(503, 'Media bridge subnet is unavailable.');
    const mediaName = this.names.media(id);
    const streamPort = await this.streamPort(computer);
    let relay = await this.container(mediaName, id, 'media', name);
    // A relay made before forwarding was turned off in it: replaced while stopped (it holds no state).
    if (relay && !relay.State.Running && relay.HostConfig?.Sysctls?.['net.ipv4.ip_forward'] !== '0') {
      await this.docker.request('DELETE', `${this.path('containers', relay.Id)}?v=false`);
      relay = null;
    }
    // A relay aimed at another port of this same computer (e.g. made before its image moved off 8080) can only
    // fail to connect; it holds no state, so it is replaced, running or not.
    if (relay && relayStreamPortOf(relay.Config.Env) !== streamPort) {
      await this.docker.request('DELETE', `${this.path('containers', relay.Id)}?force=true&v=false`);
      relay = null;
    }
    if (!relay) {
      await this.approvedImage(this.mediaImage);
      await this.docker.request('POST', `/containers/create?name=${encodeURIComponent(mediaName)}`, {
        Image: this.mediaImage,
        Labels: this.names.labels(id, 'media', name),
        Env: [`COMPUTER_PRIVATE_IP=${target}`, `COMPUTER_MEDIA_SUBNET=${subnet}`, `${STREAM_PORT_ENV}${streamPort}`],
        HostConfig: {
          NetworkMode: this.names.mediaNetwork,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges:true'],
          ReadonlyRootfs: true,
          Memory: 64 * 1024 * 1024,
          PidsLimit: 64,
          RestartPolicy: { Name: 'no' },
          // It copies bytes in user space and joins two networks: it must never route packets between them.
          Sysctls: { 'net.ipv4.ip_forward': '0' },
        },
        NetworkingConfig: {
          EndpointsConfig: {
            [this.names.mediaNetwork]: { Aliases: [this.names.mediaAlias(id)] },
          },
        },
      });
      relay = await this.container(mediaName, id, 'media', name);
    }
    const mediaEndpoint = relay?.NetworkSettings.Networks[this.names.mediaNetwork];
    if (
      !relay ||
      !mediaEndpoint ||
      !mediaNetwork.Id ||
      ![...(mediaEndpoint.Aliases ?? []), ...(mediaEndpoint.DNSNames ?? [])].includes(this.names.mediaAlias(id))
    ) {
      throw new ResourceError(503, 'Computer media relay lacks its approved dashboard alias.');
    }
    if (
      ![`COMPUTER_PRIVATE_IP=${target}`, `COMPUTER_MEDIA_SUBNET=${subnet}`].every(value =>
        relay.Config.Env?.includes(value),
      ) ||
      Object.keys(relay.NetworkSettings.Networks).some(
        network => network !== this.names.mediaNetwork && network !== privateNetwork,
      )
    ) {
      // A stale target can forward another computer's screen after Docker
      // reassigns addresses. Never reuse or start an altered relay.
      throw new ResourceError(409, 'Computer media relay has an unsafe target or network.');
    }
    if (!relay.NetworkSettings.Networks[privateNetwork]) {
      const privateOwned = await this.network(privateNetwork, id, 'private-network');
      if (!privateOwned) throw new ResourceError(503, 'Computer private bridge is unavailable.');
      await this.docker.request('POST', `${this.path('networks', privateOwned.Id)}/connect`, { Container: mediaName });
    }
    if (!relay.State.Running) await this.docker.request('POST', `${this.path('containers', mediaName)}/start`);
  }

  /** Read from the image this computer actually runs, so computers on older images keep their port until rebuilt. */
  private async streamPort(computer: Container) {
    if (!computer.Image) return LEGACY_STREAM_PORT;
    const image = await this.docker.optional<{ Config?: { Labels?: Record<string, string> | null } }>(
      `${this.path('images', computer.Image)}/json`,
    );
    if (!image) throw new ResourceError(503, 'Computer image is unavailable.');
    return streamPortOf(image.Config?.Labels);
  }

  private async createOwned(
    id: string,
    name: string,
    requested: ComputerConfiguration | undefined,
    limit: number,
    storage: ComputerStorage,
  ) {
    const settings = requested ?? {
      cpuCores: this.cpuLimit,
      memoryGiB: 4,
      timezone: this.timezone || 'America/Toronto',
    };
    const computerName = this.names.desktop(id);
    const existing = await this.container(computerName, id, 'desktop', name);
    if (existing) {
      if (!this.renderDeviceMatches(existing))
        throw new ResourceError(409, 'Computer render-device grant differs from the current operator setting.');
      if (
        requested &&
        (existing.HostConfig?.NanoCpus !== settings.cpuCores * 1_000_000_000 ||
          existing.HostConfig?.Memory !== settings.memoryGiB * 1024 ** 3 ||
          !existing.Config.Env?.includes(`TZ=${settings.timezone}`))
      ) {
        throw new ResourceError(409, 'Existing computer settings differ from the saved create request.');
      }
      if (!existing.State.Running)
        throw new ResourceError(409, 'Computer is stopped; automatic restart is not enabled.');
      const gateway = await this.container(this.names.gateway(id), id, 'egress', name);
      const network = await this.network(this.names.privateNetwork(id), id, 'private-network');
      if (!gateway?.State.Running || !network) throw new ResourceError(503, 'Computer resources are incomplete.');
      await this.ensureMedia(id, name, existing);
      return;
    }
    const count = await this.listIds();
    if (count.length >= limit) throw new ResourceError(409, 'Computer limit reached.');
    // These images are operator-built, never supplied by the browser.
    for (const image of [this.image, this.gatewayImage, this.mediaImage]) await this.approvedImage(image);
    const egress = await this.ensureNetwork(this.names.egressNetwork, null, 'egress-network');
    const privateNetwork = await this.ensureNetwork(this.names.privateNetwork(id), id, 'private-network');
    const subnet = privateNetwork.IPAM.Config[0]?.Subnet;
    if (!subnet || !/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(subnet))
      throw new ResourceError(503, 'Computer subnet is unavailable.');
    if (!egress.Id) throw new ResourceError(503, 'Public egress network is unavailable.');
    const gateway = await this.ensureGateway(id, name, subnet, privateNetwork);
    await this.prepareStorage(id, storage);
    await this.docker.request(
      'POST',
      `/containers/create?name=${encodeURIComponent(computerName)}`,
      desktopCreateBody({
        image: this.image,
        labels: this.names.labels(id, 'desktop', name),
        env: [
          ...desktopEnvironment(id, gateway, this.renderDevice, settings.timezone),
          keptPathsEnvironment(storage.keptPaths),
        ],
        hostname: computerHostname(name, id),
        privateNetwork: this.names.privateNetwork(id),
        seccomp: this.seccomp,
        renderDevice: this.renderDevice,
        cpuLimit: settings.cpuCores,
        memoryGiB: settings.memoryGiB,
        mounts: storageMounts(id, storage, kind => this.names.volume(id, kind)),
      }),
    );
    await this.docker.request('POST', `${this.path('containers', computerName)}/start`);
    await this.lxcfs?.attach(computerName);
    await this.waitDesktopReady(computerName);
    const computer = await this.container(computerName, id, 'desktop', name);
    if (!computer) throw new ResourceError(503, 'Computer container is unavailable.');
    await this.ensureMedia(id, name, computer);
  }

  /**
   * `maxComputers` is the operator's limit from Settings → Swarm (sent by the backend with each create); the
   * controller never goes past it, nor past its own ceiling of MAX_COMPUTERS.
   */
  async create(
    idRaw: string,
    nameRaw: string,
    requested?: ComputerConfiguration,
    maxComputers = MAX_COMPUTERS,
    storageInput?: unknown,
  ) {
    const id = validateId(idRaw),
      name = validateName(nameRaw);
    const settings = requested ? validateComputerConfiguration(requested, await this.limits()) : undefined;
    const storage = validateStorage(storageInput);
    // Never erase a computer or its persistent volumes on a failed/retried
    // create. A partial resource remains visible through its failed DB record;
    // only exact-name confirmed DELETE may remove it.
    const limit = Math.min(Math.max(1, Math.floor(maxComputers)), MAX_COMPUTERS);
    return this.exclusive(() => this.createOwned(id, name, settings, limit, storage));
  }

  /** Docker can change resource caps on a running Sysbox computer without a
   * desktop restart. Recheck ownership and host capacity at execution time;
   * this never changes guest environment, volumes, devices or networks. */
  async updateResources(
    idRaw: string,
    nameRaw: string,
    requested: Pick<ComputerConfiguration, 'cpuCores' | 'memoryGiB'>,
  ) {
    const id = validateId(idRaw),
      name = validateName(nameRaw);
    const limits = await this.limits();
    const settings = validateComputerConfiguration({ ...requested, timezone: limits.timezoneDefault }, limits);
    return this.exclusive(async () => {
      const desktop = await this.container(this.names.desktop(id), id, 'desktop', name);
      if (!desktop) throw new ResourceError(404, 'Computer not found.');
      await this.docker.request('POST', `${this.path('containers', desktop.Id)}/update`, {
        NanoCpus: settings.cpuCores * 1_000_000_000,
        Memory: settings.memoryGiB * 1024 ** 3,
        MemorySwap: settings.memoryGiB * 2 * 1024 ** 3,
      });
      this.quotas.delete(desktop.Id);
    });
  }

  /** Replace only a powered-off owned desktop: to change its immutable TZ env or kept paths, or to move it to the
   * current approved image (`image: 'current'`). Its Keep/Cache mounts are read from the old container and reused,
   * so its storage never moves. Keep the old stopped container until the replacement is created, renamed and
   * checked. A stale relay must be removed before the next start binds it to the new private IP. */
  async replaceStopped(
    idRaw: string,
    nameRaw: string,
    requested: ComputerConfiguration,
    options: { image?: 'current' | 'same'; keptPaths?: unknown } = {},
  ) {
    const id = validateId(idRaw),
      name = validateName(nameRaw);
    const settings = validateComputerConfiguration(requested, await this.limits());
    const requestedPaths = options.keptPaths === undefined ? undefined : validateKeptPaths(options.keptPaths);
    return this.exclusive(async () => {
      const canonical = this.names.desktop(id);
      const old = await this.container(canonical, id, 'desktop', name);
      if (!old) throw new ResourceError(404, 'Computer not found.');
      if (old.State.Running) throw new ResourceError(409, 'Power off this computer before changing these settings.');
      if (!old.Image || !this.renderDeviceMatches(old))
        throw new ResourceError(409, 'Computer image or render grant is unavailable for replacement.');
      const gateway = await this.container(this.names.gateway(id), id, 'egress', name);
      const network = await this.network(this.names.privateNetwork(id), id, 'private-network');
      if (!gateway?.State.Running || !network) throw new ResourceError(503, 'Computer resources are incomplete.');
      const mounts = this.storageMountsOf(id, old);
      const keptPaths = requestedPaths ?? keptPathsOf(old.Config.Env);
      const previouslyKept = keptPathsOf(old.Config.Env);
      const image = options.image === 'current' ? this.image : old.Image;
      const privateAddress = gateway.NetworkSettings.Networks[this.names.privateNetwork(id)]?.IPAddress;
      if (!privateAddress) throw new ResourceError(503, 'Computer egress address is unavailable.');
      const relay = await this.container(this.names.media(id), id, 'media', name);
      if (relay?.State.Running) throw new ResourceError(409, 'Computer media relay must be stopped first.');
      await this.approvedImage(image);
      const nextName = `${canonical}-settings-next`,
        previousName = `${canonical}-settings-previous`;
      if (
        (await this.container(nextName, id, 'desktop', name)) ||
        (await this.container(previousName, id, 'desktop', name))
      ) {
        throw new ResourceError(409, 'An incomplete computer settings replacement needs operator recovery.');
      }
      // Newly kept paths take what the old computer had there with them (the old one is untouched).
      for (const path of keptPaths.filter(path => !previouslyKept.includes(path)))
        await this.carryOver(old.Id, path, mounts);
      let createdId: string | null = null,
        oldRenamed = false;
      try {
        const created = await this.docker.json<{ Id: string }>(
          'POST',
          `/containers/create?name=${encodeURIComponent(nextName)}`,
          desktopCreateBody({
            image,
            labels: this.names.labels(id, 'desktop', name),
            env: [
              ...desktopEnvironment(id, privateAddress, this.renderDevice, settings.timezone),
              keptPathsEnvironment(keptPaths),
            ],
            hostname: computerHostname(name, id),
            privateNetwork: this.names.privateNetwork(id),
            seccomp: this.seccomp,
            renderDevice: this.renderDevice,
            cpuLimit: settings.cpuCores,
            memoryGiB: settings.memoryGiB,
            mounts,
          }),
        );
        createdId = created.Id;
        if (!createdId) throw new ResourceError(503, 'Replacement container ID is unavailable.');
        await this.docker.request(
          'POST',
          `${this.path('containers', old.Id)}/rename?name=${encodeURIComponent(previousName)}`,
        );
        oldRenamed = true;
        await this.docker.request(
          'POST',
          `${this.path('containers', createdId)}/rename?name=${encodeURIComponent(canonical)}`,
        );
        const replacement = await this.container(canonical, id, 'desktop', name);
        if (
          !replacement ||
          replacement.State.Running ||
          replacement.HostConfig?.NanoCpus !== settings.cpuCores * 1_000_000_000 ||
          replacement.HostConfig?.Memory !== settings.memoryGiB * 1024 ** 3 ||
          !replacement.Config.Env?.includes(`TZ=${settings.timezone}`) ||
          !replacement.Config.Env?.includes(keptPathsEnvironment(keptPaths))
        )
          throw new ResourceError(503, 'Replacement computer settings could not be verified.');
        if (relay) await this.docker.request('DELETE', `${this.path('containers', relay.Id)}?v=false`);
        try {
          await this.docker.request('DELETE', `${this.path('containers', old.Id)}?v=false`);
        } catch (error) {
          // An Engine timeout may mean DELETE succeeded but its response was
          // lost. Never roll back by deleting the new computer if the old one
          // is already gone; its named volumes remain mounted by the new one.
          let oldStillPresent: Container | null;
          try {
            oldStillPresent = await this.container(previousName, id, 'desktop', name);
          } catch {
            // Unknown delete outcome: keep both labelled containers and let
            // an operator inspect them instead of risking the only good copy.
            createdId = null;
            oldRenamed = false;
            throw new ResourceError(
              503,
              'Computer replacement needs operator recovery after an uncertain Docker deletion.',
            );
          }
          if (oldStillPresent) throw error;
        }
        createdId = null;
        oldRenamed = false;
        this.quotas.delete(old.Id);
        this.previewCache.delete(`${id}:thumb`);
        this.previewCache.delete(`${id}:full`);
      } catch (error) {
        // Best-effort rollback never deletes either named data volume.
        if (createdId)
          await this.docker
            .request('DELETE', `${this.path('containers', createdId)}?force=true&v=false`)
            .catch(() => {});
        if (oldRenamed)
          await this.docker
            .request('POST', `${this.path('containers', old.Id)}/rename?name=${encodeURIComponent(canonical)}`)
            .catch(() => {});
        throw error;
      }
    });
  }

  private async removeOwned(id: string, name: string, storageInput?: unknown) {
    const computer = await this.container(this.names.desktop(id), id, 'desktop', name);
    const gateway = await this.container(this.names.gateway(id), id, 'egress', name);
    const media = await this.container(this.names.media(id), id, 'media', name);
    const network = await this.network(this.names.privateNetwork(id), id, 'private-network');
    const volumes = [];
    for (const role of ['keep', 'cache', 'home', 'workspace'] as const) {
      const volume = await this.volume(this.names.volume(id, role), id, role);
      if (volume) volumes.push(volume);
    }
    // Host folders: from the container when it exists, else from what the backend saved at create. Their disks
    // must be mounted (marker present) before anything is deleted, so no files are left behind unseen.
    const fromContainer = computer ? mountedStorage(id, computer.Mounts) : null;
    const saved = storageInput === undefined ? null : validateStorage(storageInput);
    const folders = STORAGE_CLASSES.flatMap(kind => {
      const place = fromContainer?.[kind];
      const folder = place?.kind === 'bind' ? place.folder : kind === 'keep' ? saved?.keepFolder : saved?.cacheFolder;
      return folder ? [{ kind, folder }] : [];
    });
    for (const { kind, folder } of folders) await this.checkBase(kind, folder, id);
    // All present resources have passed ownership/name checks before any deletion.
    if (media) await this.docker.request('DELETE', `${this.path('containers', media.Id)}?force=true&v=false`);
    if (computer) await this.docker.request('DELETE', `${this.path('containers', computer.Id)}?force=true&v=false`);
    if (gateway) await this.docker.request('DELETE', `${this.path('containers', gateway.Id)}?force=true&v=false`);
    for (const volume of volumes) await this.docker.request('DELETE', this.path('volumes', volume.Name));
    if (network) await this.docker.request('DELETE', this.path('networks', network.Id));
    this.previewCache.delete(`${id}:thumb`);
    this.previewCache.delete(`${id}:full`);
    return folders;
  }
  async remove(idRaw: string, nameRaw: string, storage?: unknown) {
    const id = validateId(idRaw),
      name = validateName(nameRaw);
    const folders = await this.exclusive(() => this.removeOwned(id, name, storage));
    // Its host folders go last, outside the lock: a large folder must not hold up every other computer. A retry
    // (the backend keeps the record until this succeeds) finds them through the saved storage.
    for (const { folder } of folders)
      await this.helper([this.baseMount(folder)], `rm -rf /base/computers/${id}`, 600_000);
  }

  /** Empties a powered-off computer's Cache folder (everything there can be fetched again). */
  async clearCache(idRaw: string, nameRaw: string) {
    const id = validateId(idRaw),
      name = validateName(nameRaw);
    const cache = await this.exclusive(async () => {
      const desktop = await this.container(this.names.desktop(id), id, 'desktop', name);
      if (!desktop) throw new ResourceError(404, 'Computer not found.');
      if (desktop.State.Running) throw new ResourceError(409, 'Power off this computer before clearing its cache.');
      await this.checkMountedStorage(id, desktop);
      return this.storageMountsOf(id, desktop).find(mount => mount.Target === '/cache')!;
    });
    // Outside the lock: emptying a large cache must not hold up other computers (a start meanwhile only finds less
    // cached, which is what a cache is for).
    await this.helper([cache], 'rm -rf /cache/root', 600_000);
  }

  /** How much a computer's Keep and Cache folders hold, in bytes. */
  async storageUsage(idRaw: string, nameRaw: string) {
    const id = validateId(idRaw),
      name = validateName(nameRaw);
    const desktop = await this.container(this.names.desktop(id), id, 'desktop', name);
    if (!desktop) throw new ResourceError(404, 'Computer not found.');
    await this.checkMountedStorage(id, desktop);
    // Files can vanish mid-count on a running computer (its /tmp): du then exits 1 but still reports the totals.
    // The last start's outcome (/keep/boot-status: ok, running, or failed with what went wrong) comes along.
    const output = await this.helper(
      this.storageMountsOf(id, desktop),
      'du -sb /keep /cache 2>/dev/null; printf "status %s\\n" "$(head -c 500 /keep/boot-status 2>/dev/null)"; true',
      300_000,
    );
    const lines = output.trim().split('\n');
    const status =
      lines
        .find(line => line.startsWith('status '))
        ?.slice('status '.length)
        .trim() || null;
    const sizes = Object.fromEntries(
      lines
        .filter(line => !line.startsWith('status '))
        .map(line => line.split(/\s+/))
        .map(([bytes, path]) => [path?.slice(1), Number(bytes)]),
    );
    const mounted = mountedStorage(id, desktop.Mounts);
    return {
      lastStart: status,
      storage: STORAGE_CLASSES.map(kind => ({
        kind,
        bytes: sizes[kind] ?? 0,
        folder: mounted[kind]?.kind === 'bind' ? (mounted[kind] as { folder: string }).folder : null,
      })),
    };
  }

  /** Operator power control. Both paths re-check ownership labels first, so a
   * foreign or renamed container is never touched, and neither one deletes
   * anything: volumes, network and the platform record always survive. */
  private async powerOwned(id: string, name: string, action: 'start' | 'stop') {
    const desktop = await this.container(this.names.desktop(id), id, 'desktop', name);
    if (!desktop) throw new ResourceError(404, 'Computer has no desktop container to power.');
    const media = await this.container(this.names.media(id), id, 'media', name);
    if (action === 'stop') {
      // The relay fronts the desktop, so it goes first; the filtered gateway
      // stays up so the bridge keeps its isolated settings.
      if (media?.State.Running) await this.docker.request('POST', `${this.path('containers', media.Id)}/stop?t=5`);
      if (desktop.State.Running) await this.docker.request('POST', `${this.path('containers', desktop.Id)}/stop?t=5`);
      this.previewCache.delete(`${id}:thumb`);
      this.previewCache.delete(`${id}:full`);
      return;
    }
    if (!this.renderDeviceMatches(desktop)) {
      throw new ResourceError(409, 'Computer render-device grant differs from the current operator setting.');
    }
    const network = await this.network(this.names.privateNetwork(id), id, 'private-network');
    const subnet = network?.IPAM.Config[0]?.Subnet;
    if (!network || !subnet) throw new ResourceError(503, 'Computer network is unavailable.');
    const gateway = await this.container(this.names.gateway(id), id, 'egress', name);
    if (!gateway) throw new ResourceError(503, 'Computer egress gateway is missing.');
    await this.ensureNetwork(this.names.egressNetwork, null, 'egress-network');
    // Never attach a running desktop to a gateway that is still loading its
    // firewall rules: bring the filtered gateway up first.
    if (!gateway.State.Running) await this.docker.request('POST', `${this.path('containers', gateway.Id)}/start`);
    if (!desktop.State.Running) {
      // A host Keep/Cache folder whose disk did not mount would start an empty computer: refuse instead.
      await this.checkMountedStorage(id, desktop);
      await this.docker.request('POST', `${this.path('containers', desktop.Id)}/start`);
      await this.lxcfs?.attach(desktop.Id);
      await this.waitDesktopReady(this.names.desktop(id));
    }
    const running = await this.container(this.names.desktop(id), id, 'desktop', name);
    if (running?.State.Running) await this.ensureMedia(id, name, running);
    this.previewCache.delete(`${id}:thumb`);
    this.previewCache.delete(`${id}:full`);
  }

  async start(idRaw: string, nameRaw: string) {
    const id = validateId(idRaw),
      name = validateName(nameRaw);
    return this.exclusive(() => this.powerOwned(id, name, 'start'));
  }

  async stop(idRaw: string, nameRaw: string) {
    const id = validateId(idRaw),
      name = validateName(nameRaw);
    return this.exclusive(() => this.powerOwned(id, name, 'stop'));
  }

  async resume() {
    return this.exclusive(async () => {
      const rows = await this.listIds();
      for (const row of rows) {
        const id = row.Labels['swarm.ng.id'];
        const name = row.Labels['swarm.ng.name'];
        try {
          if (!id || !name) continue;
          validateId(id);
          validateName(name);
          const desktop = await this.container(this.names.desktop(id), id, 'desktop', name);
          if (!desktop) continue;
          if (!this.renderDeviceMatches(desktop)) {
            // Revoking the operator's GPU grant must take effect when this
            // controller restarts. Stop only the owned computer; preserve its
            // volumes and refuse to restart with stale host-device access.
            if (desktop.State.Running)
              await this.docker.request('POST', `${this.path('containers', desktop.Id)}/stop?t=5`);
            console.error('Computer render-device setting changed; owned desktop stopped:', id);
            continue;
          }
          const gateway = await this.container(this.names.gateway(id), id, 'egress', name);
          const network = await this.network(this.names.privateNetwork(id), id, 'private-network');
          const subnet = network?.IPAM.Config[0]?.Subnet;
          if (!network || !subnet) continue;
          // A restarting gateway attached to the private bridge has a brief
          // period before its firewall loads. Never start it with a computer
          // running through that bridge: stop the computer first, then bring
          // up the filtered gateway and resume the desktop.
          if (!gateway?.State.Running && desktop.State.Running) {
            await this.docker.request('POST', `${this.path('containers', desktop.Id)}/stop?t=5`);
          }
          await this.ensureNetwork(this.names.egressNetwork, null, 'egress-network');
          await this.ensureGateway(id, name, subnet, network);
          const latest = await this.container(this.names.desktop(id), id, 'desktop', name);
          if (latest && !latest.State.Running) {
            await this.docker.request('POST', `${this.path('containers', latest.Id)}/start`);
            await this.lxcfs?.attach(latest.Id);
          }
          const running = await this.container(this.names.desktop(id), id, 'desktop', name);
          if (running?.State.Running) await this.ensureMedia(id, name, running);
        } catch (error) {
          // Keep owned volumes and the resource record for explicit recovery.
          console.error('Computer recovery incomplete:', id, error instanceof Error ? error.message : String(error));
        }
      }
    });
  }

  /** Periodic: restores LXCFS binds in running computers after the lxcfs service restarted (lxcfs.ts). */
  private lxcfsRun?: Promise<void>;
  async refreshLxcfs() {
    const lxcfs = this.lxcfs;
    if (!lxcfs?.enabled) return;
    // One refresh at a time: a slow one is joined, never overlapped.
    return (this.lxcfsRun ??= (async () => {
      const rows = await this.listIds();
      await lxcfs.refresh(rows.filter(row => row.State === 'running').map(row => row.Id));
    })().finally(() => (this.lxcfsRun = undefined)));
  }

  private async listIds() {
    const filters = encodeURIComponent(
      JSON.stringify({
        label: ['swarm.ng.managed=computer', `swarm.ng.namespace=${this.names.namespace}`, 'swarm.ng.role=desktop'],
      }),
    );
    const rows = await this.docker.json<ListedContainer[]>('GET', `/containers/json?all=1&filters=${filters}`);
    if (rows.length > 100) throw new ResourceError(503, 'Too many managed computers.');
    return rows.filter(
      row =>
        row.Labels?.['swarm.ng.role'] === 'desktop' &&
        row.Labels?.['swarm.ng.namespace'] === this.names.namespace &&
        row.Labels?.['swarm.ng.managed'] === 'computer',
    );
  }
  /** Enforced container quotas, cached per Docker container id. Recreation
   * produces a new id, so the cache cannot serve a stale quota. */
  private quotas = new Map<
    string,
    { memory: number | null; cpuCount: number | null; displayServer?: DisplayServer; imageId?: string }
  >();
  private async containerQuota(containerId: string) {
    const cached = this.quotas.get(containerId);
    if (cached) return cached;
    const quota: { memory: number | null; cpuCount: number | null; displayServer?: DisplayServer; imageId?: string } = {
      memory: null,
      cpuCount: null,
    };
    try {
      const info = await this.docker.json<{
        Image?: string;
        HostConfig?: { Memory?: number; NanoCpus?: number };
        Config?: { Image?: string; Labels?: Record<string, string> | null };
      }>('GET', `${this.path('containers', containerId)}/json`);
      // The list call reports an image ID once a tag has moved on; the inspected creation-time name and labels are reliable.
      if (info.Config)
        quota.displayServer = displayServerOf({ Image: info.Config.Image, Labels: info.Config.Labels ?? {} });
      quota.imageId = info.Image;
      // 0 means "no limit configured"; report null rather than an infinite dial.
      if (typeof info.HostConfig?.Memory === 'number' && info.HostConfig.Memory > 0)
        quota.memory = info.HostConfig.Memory;
      if (typeof info.HostConfig?.NanoCpus === 'number' && info.HostConfig.NanoCpus > 0)
        quota.cpuCount = info.HostConfig.NanoCpus / 1_000_000_000;
    } catch {
      /* Dials stay empty when the quota cannot be read. */
    }
    this.quotas.set(containerId, quota);
    return quota;
  }

  async observe() {
    const rows = await this.listIds();
    // A computer made from an older image than the current one can be updated (Update image).
    const current = await this.docker
      .optional<{ Id?: string }>(`${this.path('images', this.image)}/json`)
      .catch(() => null);
    // Prune quotas for containers that no longer exist, so repeated recreation
    // cannot grow the cache without bound.
    const alive = new Set(rows.map(row => row.Id));
    for (const cached of this.quotas.keys()) if (!alive.has(cached)) this.quotas.delete(cached);
    // Docker's non-streaming stats call takes about a second per container, so sample all computers concurrently.
    const computers = await Promise.all(
      rows.map(async row => {
        const id = row.Labels['swarm.ng.id'];
        if (!id || !/^\S+$/.test(id)) return null;
        let cpuPercent: number | null = null,
          memoryBytes: number | null = null,
          memoryLimitBytes: number | null = null,
          cpuCount: number | null = null;
        // Inspected once per container id (cached): it also reveals the creation-time image, which the list call does not.
        const inspected = await this.containerQuota(row.Id);
        if (row.State === 'running') {
          try {
            const stats = await this.docker.json<Statistics>(
              'GET',
              `${this.path('containers', row.Id)}/stats?stream=false`,
            );
            const cpu =
              (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
            const system = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
            if (system > 0 && cpu >= 0)
              cpuPercent = Math.round((cpu / system) * (stats.cpu_stats?.online_cpus ?? 1) * 1000) / 10;
            if (typeof stats.memory_stats?.usage === 'number')
              memoryBytes = Math.max(0, stats.memory_stats.usage - (stats.memory_stats.stats?.inactive_file ?? 0));
            // Sysbox nests the desktop, so the stats payload reports the parent
            // cgroup's limit (host memory) rather than the quota Docker enforces.
            // The enforced HostConfig.Memory is the honest denominator.
            memoryLimitBytes = inspected.memory;
            cpuCount = inspected.cpuCount;
          } catch {
            /* State stays visible when live stats are temporarily unavailable. */
          }
        }
        // Docker reports CPU as the sum across cores, so a 4-CPU computer can
        // read 250%. The count lets the dashboard draw an honest fraction.
        // A replacement prepared while powered off is Docker's `created` state;
        // for the dashboard it is powered off and can be started normally.
        return {
          id,
          status: row.State === 'created' ? 'exited' : row.State,
          cpuPercent,
          memoryBytes,
          memoryLimitBytes,
          cpuCount,
          displayServer: inspected.displayServer ?? displayServerOf(row),
          outdated: Boolean(current?.Id && inspected.imageId && inspected.imageId !== current.Id),
          // Its LXCFS view could not be restored after an lxcfs restart: a restart of the computer fixes it.
          resourceViewStale: row.State === 'running' && (this.lxcfs?.isStale(row.Id) ?? false),
        };
      }),
    );
    return computers.filter((item): item is NonNullable<typeof item> => item !== null);
  }
  /** A running guest desktop by inspected immutable ID, with at most two transfers per guest and six overall. */
  private async transferTarget(idRaw: string) {
    const id = validateId(idRaw);
    const computer = await this.container(this.names.desktop(id), id, 'desktop');
    if (!computer) throw new ResourceError(404, 'Computer not found.');
    if (!computer.State.Running) throw new ResourceError(409, 'Computer is not running.');
    let total = 0;
    for (const count of this.transfers.values()) total += count;
    if ((this.transfers.get(id) ?? 0) >= 2 || total >= 6)
      throw new ResourceError(429, 'File copies are busy. Retry shortly.');
    this.transfers.set(id, (this.transfers.get(id) ?? 0) + 1);
    const done = () => {
      const left = (this.transfers.get(id) ?? 1) - 1;
      if (left > 0) this.transfers.set(id, left);
      else this.transfers.delete(id);
    };
    // Kept and cached paths live in the two mounts (bound inside the computer at boot, invisible to the archive API).
    const storage = mountedStorage(id, computer.Mounts);
    const kept = keptPathsOf(computer.Config?.Env);
    const archived = (path: string) => archivePath(path, kept, Boolean(storage.keep && storage.cache));
    return { container: computer.Id, done, archived };
  }
  /** Streams one regular guest file out (for agent file copies); the caller bounds the size. */
  async exportFile(idRaw: string, rawPath: string, maxBytes: number) {
    const { path, name } = transferPath(rawPath);
    const limit = Math.min(Math.max(0, Math.trunc(maxBytes) || 0), MAX_TRANSFER);
    const { container, done, archived } = await this.transferTarget(idRaw);
    try {
      // Docker's archive API cannot read some computers at all (Sysbox 0.7 with Docker 29: nestybox/sysbox#1017,
      // even a missing path's 404 is not to be trusted there): then the guest itself reads the file.
      const source =
        (await this.archiveExport(container, archived(path), limit)) ??
        (await this.guestExport(container, path, limit));
      let closed = false;
      // Idempotent: runs when the stream ends, fails, or is cancelled (even before it was read).
      const close = () => {
        if (closed) return;
        closed = true;
        source.release();
        done();
      };
      const stream = (async function* () {
        try {
          yield* source.bytes;
        } finally {
          close();
        }
      })();
      return { name, size: source.size, stream, close };
    } catch (error) {
      done();
      throw error;
    }
  }
  /** The file through Docker's archive API, or null when the API cannot read it. */
  private async archiveExport(container: string, path: string, limit: number) {
    const stat = await this.docker.archive('HEAD', container, { path });
    stat.resume();
    if (stat.statusCode !== 200) return null;
    const { size } = regularFile((stat.headers['x-docker-container-path-stat'] as string | undefined) ?? null);
    if (size > limit) throw new ResourceError(413, 'The file is larger than the transfer limit.');
    const response = await this.docker.archive('GET', container, { path });
    if (response.statusCode !== 200) {
      response.resume();
      return null;
    }
    return { size, bytes: untarFirstFile(response, limit), release: () => response.destroy() };
  }
  /** What the guest says a path is: a regular file and its size, or why it cannot be copied. */
  private async guestFile(container: string, path: string) {
    const result = await this.docker.execResult(container, ['stat', '-c', '%F/%s', '--', path], 'root', 19_000, 4096);
    if (result.exitCode !== 0) throw new ResourceError(404, 'Path not found.');
    const [, type, size] = /^(.*)\/(\d+)\n?$/.exec(result.stdout.toString()) ?? [];
    if (type === 'symbolic link')
      throw new ResourceError(400, 'This path is a symbolic link; copy the file it points to instead.');
    if (type !== 'regular file' && type !== 'regular empty file')
      throw new ResourceError(400, 'Path is not available.');
    return Number(size);
  }
  /** The file read by the guest's root (its own paths: Keep and Cache are mounted there). */
  private async guestExport(container: string, path: string, limit: number) {
    const size = await this.guestFile(container, path);
    if (size > limit) throw new ResourceError(413, 'The file is larger than the transfer limit.');
    const run = await this.docker.pipe(container, ['cat', '--', path], 'root');
    const bytes = (async function* () {
      let read = 0;
      for await (const chunk of run.output) {
        read += chunk.length;
        if (read > limit) throw new ResourceError(413, 'The file is larger than the transfer limit.');
        yield chunk;
      }
      if ((await run.exitCode()) !== 0) throw new ResourceError(400, 'Could not read the file.');
    })();
    return { size, bytes, release: () => void bytes.return(undefined).catch(() => {}) };
  }
  /** Writes one file into an existing guest folder, owned by the guest user; replaces a file of the same name. */
  async importFile(idRaw: string, rawPath: string, size: number, body: AsyncIterable<Uint8Array>) {
    const { directory, name } = transferPath(rawPath);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_TRANSFER)
      throw new ResourceError(400, 'Invalid file size.');
    const { container, done, archived } = await this.transferTarget(idRaw);
    try {
      const folder = await this.docker.archive('HEAD', container, { path: archived(directory) });
      folder.resume();
      // When Docker's archive API cannot see the folder (nestybox/sysbox#1017 breaks it for every path), the guest
      // is asked, and writes the file itself.
      const viaArchive = folder.statusCode === 200;
      if (
        !viaArchive &&
        (await this.docker.execResult(container, ['test', '-d', directory], 'root', 19_000, 4096)).exitCode !== 0
      )
        throw new ResourceError(404, 'The destination folder does not exist. Create it first.');
      // Written under a hidden temporary name, then renamed over the target only when complete: a failed or
      // cancelled copy never leaves a partial file where the old one was.
      const partial = `.${crypto.randomUUID()}.swarm-partial`;
      const target = `${directory === '/' ? '' : directory}/${name}`;
      const temporary = `${directory === '/' ? '' : directory}/${partial}`;
      const discard = () =>
        this.docker.exec(container, ['/bin/rm', '-f', '--', temporary], 'root', 10_000).catch(() => {});
      if (viaArchive) {
        let response;
        try {
          response = await this.docker.archive(
            'PUT',
            container,
            // Written as the guest's root (user namespaces make tar owners unreliable), then handed to the guest
            // user. The archive goes where the folder really lives; the guest commands below use its own paths.
            { path: archived(directory), noOverwriteDirNonDir: 'true' },
            tarOneFile(partial, size, body),
          );
        } catch (error) {
          await discard();
          throw error;
        }
        response.resume();
        if (response.statusCode !== 200) {
          await discard();
          if (response.statusCode === 404)
            throw new ResourceError(404, 'The destination folder does not exist. Create it first.');
          throw new ResourceError(400, 'Could not write the file there.');
        }
      } else await this.guestImport(container, temporary, size, body, discard);
      // Docker writes archive files with raw host ids, which a user-namespaced guest cannot own or chown. The
      // guest's root copies the (world-readable) partial file into a file of its own, hands that to the guest
      // user, and renames it over the target (-T: a folder of that name is refused); the partial is removed.
      const staged = `${directory === '/' ? '' : directory}/.${crypto.randomUUID()}.swarm-staged`;
      try {
        await this.docker.exec(
          container,
          [
            '/bin/sh',
            '-c',
            'cat -- "$1" > "$2" && chown 1000:1000 -- "$2" && chmod 0644 -- "$2" && mv -f -T -- "$2" "$3"; s=$?; rm -f -- "$1" "$2"; exit $s',
            'swarm-import',
            temporary,
            staged,
            target,
          ],
          'root',
          120_000,
        );
      } catch {
        await discard();
        throw new ResourceError(400, 'Could not replace the file there (is it a folder?).');
      }
      return { path: target, size };
    } finally {
      done();
    }
  }
  /** Writes exactly `size` bytes of `body` to a new guest file through the guest's root (`cat`). */
  private async guestImport(
    container: string,
    path: string,
    size: number,
    body: AsyncIterable<Uint8Array>,
    discard: () => Promise<unknown>,
  ) {
    let sent = 0;
    const counted = (async function* () {
      for await (const chunk of body) {
        sent += chunk.length;
        if (sent > size) throw new ResourceError(400, 'The file is larger than declared.');
        yield chunk;
      }
      if (sent !== size) throw new ResourceError(400, 'The file is smaller than declared.');
    })();
    try {
      const run = await this.docker.pipe(
        container,
        ['/bin/sh', '-c', 'umask 077 && cat > "$1"', 'swarm-import', path],
        'root',
        counted,
      );
      for await (const _ of run.output);
      if (sent !== size || (await run.exitCode()) !== 0)
        throw new ResourceError(400, 'Could not write the file there.');
    } catch (error) {
      await discard();
      throw error;
    }
  }
  /** The inspected immutable ID of a managed, running guest. */
  private async operatorGuest(id: string) {
    const computer = await this.container(this.names.desktop(id), id, 'desktop');
    if (!computer) throw new ResourceError(404, 'Computer not found.');
    if (!computer.State.Running) throw new ResourceError(409, 'Computer is not running.');
    return computer.Id;
  }
  private operatorCommand(mode: string, request: object) {
    return ['/usr/bin/python3', '-I', '-c', operatorFilesScript, mode, JSON.stringify(request)];
  }
  /** Operator reads neither acquire nor release agent control. One per guest, two globally (transfers excluded). */
  async operatorFiles(idRaw: string, mode: FileOperation, query: FileQuery) {
    const id = validateId(idRaw);
    validateFileQuery(mode, query);
    return this.operatorExclusive(id, async guest =>
      decodeFileResult(await this.operatorExec(guest, mode, query), mode),
    );
  }
  /** A new folder in an existing guest folder (an existing folder of that name is fine), as the guest user. */
  async operatorFolder(idRaw: string, path: unknown, name: unknown) {
    const id = validateId(idRaw);
    if (!validName(name)) throw new ResourceError(400, 'Use a folder name without slashes, of at most 255 bytes.');
    validateFileQuery('files', { path: path as string });
    return this.operatorExclusive(id, async guest => {
      const { result } = decodeFileResult(await this.operatorExec(guest, 'folder', { path, name }), 'files');
      if (typeof result?.path !== 'string' || typeof result.created !== 'boolean')
        throw new ResourceError(503, 'Invalid guest file response.');
      return result as { path: string; created: boolean };
    });
  }
  private async operatorExclusive<T>(id: string, work: (guest: string) => Promise<T>) {
    if (this.fileOperations.has(id) || this.fileOperations.size >= 2)
      throw new ResourceError(429, 'File operations are busy. Retry shortly.');
    this.fileOperations.add(id);
    try {
      return await work(await this.operatorGuest(id));
    } finally {
      this.fileOperations.delete(id);
    }
  }
  private operatorExec(guest: string, mode: string, request: object) {
    return this.docker.exec(
      guest,
      ['/usr/bin/timeout', '--signal=TERM', '--kill-after=2s', '18s', ...this.operatorCommand(mode, request)],
      '1000:1000',
      23_000,
      2 * 1024 * 1024,
    );
  }
  /** A transfer slot (one download piece or upload part): six per guest and sixteen overall; an idempotent release. */
  private operatorTransferSlot(id: string) {
    let total = 0;
    for (const count of this.operatorTransfers.values()) total += count;
    if ((this.operatorTransfers.get(id) ?? 0) >= 6 || total >= 16)
      throw new ResourceError(429, 'Too many transfers are running. Retry when one finishes.');
    this.operatorTransfers.set(id, (this.operatorTransfers.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.operatorTransfers.get(id) ?? 1) - 1;
      if (left > 0) this.operatorTransfers.set(id, left);
      else this.operatorTransfers.delete(id);
    };
  }
  /**
   * Streams one piece (byte range) of a regular guest file out, read by the guest user through the descriptor-safe
   * walk. The caller bounds the piece (this runtime reads the guest's output as fast as it comes). `close` (or ending
   * the stream) stops the guest reader.
   */
  async operatorDownload(idRaw: string, query: DownloadQuery) {
    const id = validateId(idRaw);
    validateDownloadQuery(query);
    const release = this.operatorTransferSlot(id);
    let iterator: AsyncIterator<Buffer> | undefined;
    try {
      const guest = await this.operatorGuest(id);
      // The guest stays quiet only while the reader is slow (back-pressure); a stalled reader times out.
      const run = await this.docker.pipe(guest, this.operatorCommand('download', query), '1000:1000', undefined, {
        idleTimeoutMs: 300_000,
      });
      iterator = run.output[Symbol.asyncIterator]();
      const { line, rest } = await readStatusLine(iterator);
      const result = downloadResult(headerResult(line));
      const source = iterator;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        void source.return?.(undefined)?.catch(() => {});
        release();
      };
      const stream = (async function* () {
        try {
          let left = result.length;
          let chunk: Buffer | undefined = rest.length ? rest : undefined;
          while (left > 0) {
            if (!chunk) {
              const next = await source.next();
              if (next.done) throw new ResourceError(503, 'The file changed while it was read.');
              chunk = next.value;
            }
            const part = chunk.length > left ? chunk.subarray(0, left) : chunk;
            left -= part.length;
            chunk = undefined;
            yield part;
          }
        } finally {
          close();
        }
      })();
      return { result, stream, close };
    } catch (error) {
      await iterator?.return?.(undefined)?.catch(() => {});
      release();
      throw error;
    }
  }
  /**
   * Streams one part of an upload (`length` bytes of `body`) into the guest, written by the guest user to a hidden
   * file beside the target; the last part renames it into place (never a half file). `mode` decides a name that is
   * taken: refused (409), replaced, or kept as "name (1).ext".
   */
  async operatorUpload(idRaw: string, query: UploadQuery, body: AsyncIterable<Uint8Array>) {
    const id = validateId(idRaw);
    validateUploadQuery(query);
    const release = this.operatorTransferSlot(id);
    try {
      const guest = await this.operatorGuest(id);
      let sent = 0;
      const counted = (async function* () {
        for await (const chunk of body) {
          sent += chunk.byteLength;
          if (sent > query.length) throw new ResourceError(400, 'The upload part is larger than announced.');
          yield chunk;
        }
        // Ended short (the sender went away): failing here closes the stream, so the guest sees the end and cleans up.
        if (sent !== query.length) throw new ResourceError(400, 'The upload did not finish.');
      })();
      const run = await this.docker.pipe(guest, this.operatorCommand('upload', query), '1000:1000', counted, {
        // The final flush to disk of a large file can be quiet for a while.
        idleTimeoutMs: 600_000,
        // The guest reads exactly `length` bytes; the stream closes when it answered (or the sender went away).
        keepStdinOpen: true,
      });
      let output = Buffer.alloc(0);
      try {
        for await (const chunk of run.output) {
          output = Buffer.concat([output, chunk]);
          if (output.length > 65536) throw new ResourceError(503, 'Invalid guest file response.');
        }
      } catch (error) {
        // The guest may have answered (a conflict, a full disk) before the rest of the body was sent.
        if (output.indexOf(10) < 0) {
          if (error instanceof ResourceError) throw error;
          throw new ResourceError(400, 'The upload did not finish.');
        }
      }
      const newline = output.indexOf(10);
      if (newline < 0) throw new ResourceError(503, 'Invalid guest file response.');
      const result = headerResult(output.subarray(0, newline));
      if (query.offset + query.length < query.size) {
        if (result?.received !== query.offset + query.length)
          throw new ResourceError(503, 'Invalid guest file response.');
        return { received: query.offset + query.length };
      }
      if (typeof result?.name !== 'string' || result.size !== query.size)
        throw new ResourceError(503, 'Invalid guest file response.');
      const directory = query.path.replace(/\/+$/, '');
      return { name: result.name, size: query.size, path: `${directory}/${result.name}` };
    } finally {
      release();
    }
  }
  /** Removes an unfinished upload's hidden file (the person cancelled it). */
  async operatorCancelUpload(idRaw: string, path: unknown, name: unknown, upload: unknown) {
    const id = validateId(idRaw);
    validateFileQuery('files', { path: path as string });
    if (!validName(name) || !validUpload(upload)) throw new ResourceError(400, 'Invalid guest file request.');
    const guest = await this.operatorGuest(id);
    decodeFileResult(await this.operatorExec(guest, 'cancel', { path, name, upload }), 'files');
    return { cancelled: true };
  }

  /** Fixed guest program only, addressed by inspected immutable ID after label/running checks. */
  async computerUseExec(idRaw: string, mode: 'state' | 'capture' | 'validate' | 'execute' | 'cancel', input: unknown) {
    const id = validateId(idRaw);
    const computer = await this.container(this.names.desktop(id), id, 'desktop');
    if (!computer) throw new ResourceError(404, 'Computer not found.');
    if (!computer.State.Running) {
      // A stopped container has no executing guest process. A later boot has a fresh /run generation.
      if (mode === 'cancel') return Buffer.from('{"settled":true}');
      throw new ResourceError(503, 'Computer desktop is unavailable.');
    }
    return this.docker.exec(
      computer.Id,
      [
        '/usr/bin/timeout',
        '--signal=TERM',
        '--kill-after=2s',
        '18s',
        '/usr/bin/python3',
        '/opt/swarm/computer-use.py',
        mode,
        JSON.stringify(input),
      ],
      'agent',
      23_000,
      3 * 1024 * 1024,
    );
  }

  /** Human-only PTY attachment: fixed helper/uid, bound to the inspected immutable guest. */
  async terminalStream(
    idRaw: string,
    session: string,
    signal: AbortSignal,
    onOutput: (chunk: Buffer) => void,
    onEnd: () => void,
  ) {
    const id = validateId(idRaw);
    validateId(session);
    const computer = await this.container(this.names.desktop(id), id, 'desktop');
    if (!computer) throw new ResourceError(404, 'Computer not found.');
    if (!computer.State.Running) throw new ResourceError(409, 'Computer is not running.');
    signal.throwIfAborted();
    return this.docker.execStream(
      computer.Id,
      ['/usr/bin/python3', '-I', '/opt/swarm/computer-terminal-viewer.py', session],
      signal,
      onOutput,
      onEnd,
    );
  }

  /**
   * A monitor: the agent's command runs in the guest as `agent` (home folder, its own process group) and its
   * stdout streams back line by line. The wrapper kills the whole group when the stream closes (the platform stopped
   * the monitor), and reports the command's exit code on stderr when it ends by itself.
   */
  async monitorStream(
    idRaw: string,
    command: unknown,
    signal: AbortSignal,
    onOutput: (chunk: Buffer) => void,
    onStderr: (chunk: Buffer) => void,
    onEnd: () => void,
  ) {
    const id = validateId(idRaw);
    if (typeof command !== 'string' || !command.trim() || command.length > 4000 || command.includes('\0'))
      throw new ResourceError(400, 'A monitor command is 1..4000 characters.');
    const computer = await this.container(this.names.desktop(id), id, 'desktop');
    if (!computer) throw new ResourceError(404, 'Computer not found.');
    if (!computer.State.Running) throw new ResourceError(409, 'Computer is not running.');
    signal.throwIfAborted();
    const wrapper = [
      'setsid /bin/sh -c "$1" </dev/null & child=$!',
      // A background job's stdin is /dev/null in a non-interactive shell: hand it the stream's stdin explicitly.
      'exec 3<&0',
      '( cat <&3 >/dev/null; kill -TERM -"$child" 2>/dev/null ) &',
      'wait "$child"; code=$?',
      'printf \'\\000monitor-exit %s\\n\' "$code" >&2',
    ].join('\n');
    return this.docker.execStream(
      computer.Id,
      ['/bin/sh', '-c', wrapper, 'monitor', command],
      signal,
      onOutput,
      onEnd,
      {
        env: [
          'HOME=/home/agent',
          'XDG_RUNTIME_DIR=/run/user/1000',
          'LANG=C.UTF-8',
          'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        ],
        workingDir: '/home/agent',
        idleTimeoutMs: 0,
        onStderr,
      },
    );
  }

  /** Fixed root supervisor drops all file/shell work to the guest account; never a host command. */
  async computerCoreExec(idRaw: string, mode: 'prepare' | 'execute' | 'cancel', input: unknown) {
    const id = validateId(idRaw);
    const computer = await this.container(this.names.desktop(id), id, 'desktop');
    if (!computer) throw new ResourceError(404, 'Computer not found.');
    if (!computer.State.Running) {
      if (mode === 'cancel') return Buffer.from('{"settled":true}');
      throw new ResourceError(503, 'Computer is not running.');
    }
    return this.docker.exec(
      computer.Id,
      [
        '/usr/bin/timeout',
        '--signal=TERM',
        '--kill-after=8s',
        '130s',
        '/usr/bin/python3',
        '-I',
        '/opt/swarm/computer-core.py',
        mode,
        JSON.stringify(input),
      ],
      'root',
      145_000,
      3 * 1024 * 1024,
    );
  }

  /** Agent recordings: the guest's recording.py as the guest account (stop may encode for minutes). */
  async recording(idRaw: string, op: RecordingOp, input: unknown) {
    const id = validateId(idRaw);
    const value = validateRecording(op, input);
    const computer = await this.container(this.names.desktop(id), id, 'desktop');
    if (!computer) throw new ResourceError(404, 'Computer not found.');
    if (!computer.State.Running) throw new ResourceError(503, 'Computer is not running.');
    const output = await this.docker.exec(
      computer.Id,
      ['/usr/bin/python3', '/opt/swarm/recording.py', op, JSON.stringify(value)],
      'agent',
      op === 'stop' ? 900_000 : 30_000,
      8 * 1024 * 1024,
    );
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(output.toString().trim().split('\n').at(-1) ?? '');
    } catch {
      throw new ResourceError(503, 'The recorder gave no answer; update this computer to record.');
    }
    if (typeof result.error === 'string') throw new ResourceError(409, result.error);
    return result;
  }

  async pointer(idRaw: string, x: number, y: number) {
    const id = validateId(idRaw);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      throw new ResourceError(400, 'Invalid desktop coordinates.');
    }
    const name = this.names.desktop(id);
    const computer = await this.container(name, id, 'desktop');
    if (!computer) throw new ResourceError(404, 'Computer not found.');
    if (!computer.State.Running) throw new ResourceError(503, 'Computer desktop is unavailable.');
    await this.docker.exec(name, ['/opt/swarm/desktop-input.sh', String(x), String(y)], 'agent', 10_000);
  }

  async preview(idRaw: string, full = false) {
    const id = validateId(idRaw);
    const key = `${id}:${full ? 'full' : 'thumb'}`;
    const cached = this.previewCache.get(key);
    // Grid cards poll every 500 ms. The old 1.8 s TTL returned the same JPEG
    // for four polls despite unique URLs. Start the thumbnail window when
    // capture begins so execution time cannot eat into the next poll's budget.
    if (cached && Date.now() - cached.at < (full ? 1800 : 400)) return cached.image;
    const pending = this.previewPending.get(key);
    if (pending) return pending;
    const work = (async () => {
      const name = this.names.desktop(id);
      const container = await this.container(name, id, 'desktop');
      if (!container) return null;
      if (!container.State.Running) return null;
      const capturedAt = Date.now();
      const encoded = await this.docker.exec(
        name,
        ['/opt/swarm/render-preview.sh', ...(full ? ['--full'] : [])],
        'agent',
        16_000,
      );
      if (encoded.length > (full ? 700 : 256) * 1024) throw new ResourceError(503, 'Preview exceeded its limit.');
      const image = Buffer.from(encoded.toString().trim(), 'base64');
      if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image.at(-2) !== 0xff || image.at(-1) !== 0xd9)
        throw new ResourceError(503, 'Preview is not a JPEG.');
      if (image.length > (full ? 512 : 192) * 1024) throw new ResourceError(503, 'Preview exceeded its limit.');
      this.previewCache.set(key, { at: full ? Date.now() : capturedAt, image });
      return image;
    })().finally(() => {
      this.previewPending.delete(key);
    });
    this.previewPending.set(key, work);
    return work;
  }
}
