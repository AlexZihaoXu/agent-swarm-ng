import { readFileSync } from 'node:fs';
import { DockerApi, DockerApiError } from './docker-api';
import { MAX_TRANSFER, regularFile, tarOneFile, transferPath, untarFirstFile } from './file-transfer';
import {
  decodeFileResult,
  MAX_DOWNLOAD,
  operatorFilesScript,
  validateFileQuery,
  type FileOperation,
  type FileQuery,
} from './operator-files';
import { ComputerNames, ResourceError, validateId, validateName, type ResourceRole } from './resources';
import {
  deriveComputerLimits,
  validateComputerConfiguration,
  type ComputerConfiguration,
  type ComputerLimits,
} from './computer-configuration';

type Container = {
  Id: string;
  Image?: string;
  Config: { Labels?: Record<string, string>; Env?: string[] };
  State: { Running: boolean; Status: string };
  HostConfig?: {
    Devices?: { PathOnHost: string; PathInContainer: string; CgroupPermissions: string }[] | null;
    NanoCpus?: number;
    Memory?: number;
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
  homeVolume: string;
  workspaceVolume: string;
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
      Mounts: [
        { Type: 'volume', Source: input.homeVolume, Target: '/home/agent' },
        { Type: 'volume', Source: input.workspaceVolume, Target: '/workspace' },
      ],
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
  private async volume(name: string, id: string, role: 'home' | 'workspace') {
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
  private async ensureVolume(id: string, role: 'home' | 'workspace') {
    const name = this.names.volume(id, role);
    if (await this.volume(name, id, role)) return;
    await this.docker.request('POST', '/volumes/create', { Name: name, Labels: this.names.labels(id, role) });
    if (!(await this.volume(name, id, role))) throw new ResourceError(503, 'Computer volume was not created.');
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
    let relay = await this.container(mediaName, id, 'media', name);
    if (!relay) {
      await this.approvedImage(this.mediaImage);
      await this.docker.request('POST', `/containers/create?name=${encodeURIComponent(mediaName)}`, {
        Image: this.mediaImage,
        Labels: this.names.labels(id, 'media', name),
        Env: [`COMPUTER_PRIVATE_IP=${target}`, `COMPUTER_MEDIA_SUBNET=${subnet}`],
        HostConfig: {
          NetworkMode: this.names.mediaNetwork,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges:true'],
          ReadonlyRootfs: true,
          Memory: 64 * 1024 * 1024,
          PidsLimit: 64,
          RestartPolicy: { Name: 'no' },
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

  private async createOwned(id: string, name: string, requested: ComputerConfiguration | undefined, limit: number) {
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
      const home = await this.volume(this.names.volume(id, 'home'), id, 'home');
      const workspace = await this.volume(this.names.volume(id, 'workspace'), id, 'workspace');
      if (!gateway?.State.Running || !network || !home || !workspace)
        throw new ResourceError(503, 'Computer resources are incomplete.');
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
    await this.ensureVolume(id, 'home');
    await this.ensureVolume(id, 'workspace');
    await this.docker.request(
      'POST',
      `/containers/create?name=${encodeURIComponent(computerName)}`,
      desktopCreateBody({
        image: this.image,
        labels: this.names.labels(id, 'desktop', name),
        env: desktopEnvironment(id, gateway, this.renderDevice, settings.timezone),
        hostname: computerHostname(name, id),
        privateNetwork: this.names.privateNetwork(id),
        seccomp: this.seccomp,
        renderDevice: this.renderDevice,
        cpuLimit: settings.cpuCores,
        memoryGiB: settings.memoryGiB,
        homeVolume: this.names.volume(id, 'home'),
        workspaceVolume: this.names.volume(id, 'workspace'),
      }),
    );
    await this.docker.request('POST', `${this.path('containers', computerName)}/start`);
    await this.waitDesktopReady(computerName);
    const computer = await this.container(computerName, id, 'desktop', name);
    if (!computer) throw new ResourceError(503, 'Computer container is unavailable.');
    await this.ensureMedia(id, name, computer);
  }

  /**
   * `maxComputers` is the operator's limit from Settings → Swarm (sent by the backend with each create); the
   * controller never goes past it, nor past its own ceiling of MAX_COMPUTERS.
   */
  async create(idRaw: string, nameRaw: string, requested?: ComputerConfiguration, maxComputers = MAX_COMPUTERS) {
    const id = validateId(idRaw),
      name = validateName(nameRaw);
    const settings = requested ? validateComputerConfiguration(requested, await this.limits()) : undefined;
    // Never erase a computer or its persistent volumes on a failed/retried
    // create. A partial resource remains visible through its failed DB record;
    // only exact-name confirmed DELETE may remove it.
    const limit = Math.min(Math.max(1, Math.floor(maxComputers)), MAX_COMPUTERS);
    return this.exclusive(() => this.createOwned(id, name, settings, limit));
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

  /** Replace only a powered-off owned desktop to change immutable TZ env.
   * Keep the old stopped container until the replacement is created, renamed
   * and checked; named data volumes/network stay intact throughout. A stale
   * relay must be removed before the next start binds it to the new private IP. */
  async replaceStopped(idRaw: string, nameRaw: string, requested: ComputerConfiguration) {
    const id = validateId(idRaw),
      name = validateName(nameRaw);
    const settings = validateComputerConfiguration(requested, await this.limits());
    return this.exclusive(async () => {
      const canonical = this.names.desktop(id);
      const old = await this.container(canonical, id, 'desktop', name);
      if (!old) throw new ResourceError(404, 'Computer not found.');
      if (old.State.Running) throw new ResourceError(409, 'Power off this computer before changing its timezone.');
      if (!old.Image || !this.renderDeviceMatches(old))
        throw new ResourceError(409, 'Computer image or render grant is unavailable for replacement.');
      const gateway = await this.container(this.names.gateway(id), id, 'egress', name);
      const network = await this.network(this.names.privateNetwork(id), id, 'private-network');
      const home = await this.volume(this.names.volume(id, 'home'), id, 'home');
      const workspace = await this.volume(this.names.volume(id, 'workspace'), id, 'workspace');
      if (!gateway?.State.Running || !network || !home || !workspace)
        throw new ResourceError(503, 'Computer resources are incomplete.');
      const privateAddress = gateway.NetworkSettings.Networks[this.names.privateNetwork(id)]?.IPAddress;
      if (!privateAddress) throw new ResourceError(503, 'Computer egress address is unavailable.');
      const relay = await this.container(this.names.media(id), id, 'media', name);
      if (relay?.State.Running) throw new ResourceError(409, 'Computer media relay must be stopped first.');
      await this.approvedImage(old.Image);
      const nextName = `${canonical}-settings-next`,
        previousName = `${canonical}-settings-previous`;
      if (
        (await this.container(nextName, id, 'desktop', name)) ||
        (await this.container(previousName, id, 'desktop', name))
      ) {
        throw new ResourceError(409, 'An incomplete computer settings replacement needs operator recovery.');
      }
      let createdId: string | null = null,
        oldRenamed = false;
      try {
        const created = await this.docker.json<{ Id: string }>(
          'POST',
          `/containers/create?name=${encodeURIComponent(nextName)}`,
          desktopCreateBody({
            image: old.Image,
            labels: this.names.labels(id, 'desktop', name),
            env: desktopEnvironment(id, privateAddress, this.renderDevice, settings.timezone),
            hostname: computerHostname(name, id),
            privateNetwork: this.names.privateNetwork(id),
            seccomp: this.seccomp,
            renderDevice: this.renderDevice,
            cpuLimit: settings.cpuCores,
            memoryGiB: settings.memoryGiB,
            homeVolume: home.Name,
            workspaceVolume: workspace.Name,
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
          !replacement.Config.Env?.includes(`TZ=${settings.timezone}`)
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

  private async removeOwned(id: string, name: string) {
    const computer = await this.container(this.names.desktop(id), id, 'desktop', name);
    const gateway = await this.container(this.names.gateway(id), id, 'egress', name);
    const media = await this.container(this.names.media(id), id, 'media', name);
    const network = await this.network(this.names.privateNetwork(id), id, 'private-network');
    const home = await this.volume(this.names.volume(id, 'home'), id, 'home');
    const workspace = await this.volume(this.names.volume(id, 'workspace'), id, 'workspace');
    // All present resources have passed ownership/name checks before any deletion.
    if (media) await this.docker.request('DELETE', `${this.path('containers', media.Id)}?force=true&v=false`);
    if (computer) await this.docker.request('DELETE', `${this.path('containers', computer.Id)}?force=true&v=false`);
    if (gateway) await this.docker.request('DELETE', `${this.path('containers', gateway.Id)}?force=true&v=false`);
    if (home) await this.docker.request('DELETE', this.path('volumes', home.Name));
    if (workspace) await this.docker.request('DELETE', this.path('volumes', workspace.Name));
    if (network) await this.docker.request('DELETE', this.path('networks', network.Id));
    this.previewCache.delete(`${id}:thumb`);
    this.previewCache.delete(`${id}:full`);
  }
  async remove(idRaw: string, nameRaw: string) {
    const id = validateId(idRaw),
      name = validateName(nameRaw);
    return this.exclusive(() => this.removeOwned(id, name));
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
      await this.docker.request('POST', `${this.path('containers', desktop.Id)}/start`);
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
          if (latest && !latest.State.Running)
            await this.docker.request('POST', `${this.path('containers', latest.Id)}/start`);
          const running = await this.container(this.names.desktop(id), id, 'desktop', name);
          if (running?.State.Running) await this.ensureMedia(id, name, running);
        } catch (error) {
          // Keep owned volumes and the resource record for explicit recovery.
          console.error('Computer recovery incomplete:', id, error instanceof Error ? error.message : String(error));
        }
      }
    });
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
  private quotas = new Map<string, { memory: number | null; cpuCount: number | null; displayServer?: DisplayServer }>();
  private async containerQuota(containerId: string) {
    const cached = this.quotas.get(containerId);
    if (cached) return cached;
    const quota: { memory: number | null; cpuCount: number | null; displayServer?: DisplayServer } = {
      memory: null,
      cpuCount: null,
    };
    try {
      const info = await this.docker.json<{
        HostConfig?: { Memory?: number; NanoCpus?: number };
        Config?: { Image?: string; Labels?: Record<string, string> | null };
      }>('GET', `${this.path('containers', containerId)}/json`);
      // The list call reports an image ID once a tag has moved on; the inspected creation-time name and labels are reliable.
      if (info.Config)
        quota.displayServer = displayServerOf({ Image: info.Config.Image, Labels: info.Config.Labels ?? {} });
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
    return { container: computer.Id, done };
  }
  /** Streams one regular guest file out (for agent file copies); the caller bounds the size. */
  async exportFile(idRaw: string, rawPath: string, maxBytes: number) {
    const { path, name } = transferPath(rawPath);
    const limit = Math.min(Math.max(0, Math.trunc(maxBytes) || 0), MAX_TRANSFER);
    const { container, done } = await this.transferTarget(idRaw);
    try {
      const stat = await this.docker.archive('HEAD', container, { path });
      stat.resume();
      if (stat.statusCode === 404) throw new ResourceError(404, 'Path not found.');
      if (stat.statusCode !== 200) throw new ResourceError(400, 'Path is not available.');
      const { size } = regularFile((stat.headers['x-docker-container-path-stat'] as string | undefined) ?? null);
      if (size > limit) throw new ResourceError(413, 'The file is larger than the transfer limit.');
      const response = await this.docker.archive('GET', container, { path });
      if (response.statusCode !== 200) {
        response.resume();
        throw new ResourceError(response.statusCode === 404 ? 404 : 400, 'Path is not available.');
      }
      const bytes = untarFirstFile(response, limit);
      let closed = false;
      // Idempotent: runs when the stream ends, fails, or is cancelled (even before it was read).
      const close = () => {
        if (closed) return;
        closed = true;
        response.destroy();
        done();
      };
      const stream = (async function* () {
        try {
          yield* bytes;
        } finally {
          close();
        }
      })();
      return { name, size, stream, close };
    } catch (error) {
      done();
      throw error;
    }
  }
  /** Writes one file into an existing guest folder, owned by the guest user; replaces a file of the same name. */
  async importFile(idRaw: string, rawPath: string, size: number, body: AsyncIterable<Uint8Array>) {
    const { directory, name } = transferPath(rawPath);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_TRANSFER)
      throw new ResourceError(400, 'Invalid file size.');
    const { container, done } = await this.transferTarget(idRaw);
    try {
      const folder = await this.docker.archive('HEAD', container, { path: directory });
      folder.resume();
      if (folder.statusCode === 404)
        throw new ResourceError(404, 'The destination folder does not exist. Create it first.');
      // Written under a hidden temporary name, then renamed over the target only when complete: a failed or
      // cancelled copy never leaves a partial file where the old one was.
      const partial = `.${crypto.randomUUID()}.swarm-partial`;
      const target = `${directory === '/' ? '' : directory}/${name}`;
      const temporary = `${directory === '/' ? '' : directory}/${partial}`;
      const discard = () =>
        this.docker.exec(container, ['/bin/rm', '-f', '--', temporary], 'root', 10_000).catch(() => {});
      let response;
      try {
        response = await this.docker.archive(
          'PUT',
          container,
          // Written as the guest's root (user namespaces make tar owners unreliable), then handed to the guest user.
          { path: directory, noOverwriteDirNonDir: 'true' },
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
  /** Operator reads neither acquire nor release agent control. One per guest, two globally. */
  async operatorFiles(idRaw: string, mode: FileOperation, query: FileQuery) {
    const id = validateId(idRaw);
    validateFileQuery(mode, query);
    if (this.fileOperations.has(id) || this.fileOperations.size >= 2)
      throw new ResourceError(429, 'File operations are busy. Retry shortly.');
    this.fileOperations.add(id);
    try {
      const computer = await this.container(this.names.desktop(id), id, 'desktop');
      if (!computer) throw new ResourceError(404, 'Computer not found.');
      if (!computer.State.Running) throw new ResourceError(409, 'Computer is not running.');
      const raw = await this.docker.exec(
        computer.Id,
        [
          '/usr/bin/timeout',
          '--signal=TERM',
          '--kill-after=2s',
          '18s',
          '/usr/bin/python3',
          '-I',
          '-c',
          operatorFilesScript,
          mode,
          JSON.stringify(query),
        ],
        '1000:1000',
        23_000,
        mode === 'download' ? MAX_DOWNLOAD + 1024 * 1024 : 2 * 1024 * 1024,
      );
      return decodeFileResult(raw, mode);
    } finally {
      this.fileOperations.delete(id);
    }
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
