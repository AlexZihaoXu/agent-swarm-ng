import { readFileSync } from 'node:fs';
import { DockerApi, DockerApiError } from './docker-api';
import { ComputerNames, ResourceError, validateId, validateName, type ResourceRole } from './resources';

type Container = {
  Id: string; Config: { Labels?: Record<string, string> }; State: { Running: boolean; Status: string };
  NetworkSettings: { Networks: Record<string, { IPAddress: string }> };
};
type ListedContainer = { Id: string; State: string; Labels: Record<string, string> };
type Network = { Id: string; Internal: boolean; EnableIPv6: boolean; Labels?: Record<string, string>; Options?: Record<string, string>; IPAM: { Config: { Subnet?: string }[] } };
type Volume = { Name: string; Labels?: Record<string, string> };
type Statistics = { cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number }; precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number }; memory_stats?: { usage?: number; stats?: { inactive_file?: number } } };

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const PRIVATE_MODE = 'com.docker.network.bridge.gateway_mode_ipv4';
const DEFAULT_IMAGE = 'agent-swarm-default:stage1';
const DEFAULT_GATEWAY_IMAGE = 'agent-swarm-computer-egress:dev';

/** Owns only its labelled Docker computers; other projects and agent containers are untouchable. */
export class ComputerManager {
  readonly names: ComputerNames;
  private queue: Promise<void> = Promise.resolve();
  private previewCache = new Map<string, { at: number; image: Buffer }>();
  private previewPending = new Map<string, Promise<Buffer | null>>();
  constructor(
    private readonly docker: DockerApi,
    namespace: string,
    private readonly seccomp: string = readFileSync(new URL('../../templates/default/security/chromium-seccomp.json', import.meta.url), 'utf8'),
    private readonly image = DEFAULT_IMAGE,
    private readonly gatewayImage = DEFAULT_GATEWAY_IMAGE,
    private readonly maxComputers = 4,
  ) { this.names = new ComputerNames(namespace); }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let done!: () => void;
    this.queue = new Promise<void>(resolve => { done = resolve; });
    await previous;
    try { return await operation(); } finally { done(); }
  }
  private path(kind: string, name: string) { return `/${kind}/${encodeURIComponent(name)}`; }
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
        Name: name, CheckDuplicate: true, Driver: 'bridge', Internal: role === 'private-network', EnableIPv6: false,
        Labels: this.names.labels(id, role), Options: role === 'private-network' ? { [PRIVATE_MODE]: 'isolated' } : {},
      });
      result = await this.network(name, id, role);
    }
    if (!result || result.Internal !== (role === 'private-network') || result.EnableIPv6 || (role === 'private-network' && result.Options?.[PRIVATE_MODE] !== 'isolated')) throw new ResourceError(409, 'Computer network has unsafe settings.');
    return result;
  }
  private async ensureVolume(id: string, role: 'home' | 'workspace') {
    const name = this.names.volume(id, role);
    if (await this.volume(name, id, role)) return;
    await this.docker.request('POST', '/volumes/create', { Name: name, Labels: this.names.labels(id, role) });
    if (!await this.volume(name, id, role)) throw new ResourceError(503, 'Computer volume was not created.');
  }
  private async ensureGateway(id: string, name: string, subnet: string, network: Network) {
    const gatewayName = this.names.gateway(id);
    let gateway = await this.container(gatewayName, id, 'egress', name);
    if (!gateway) {
      await this.docker.request('POST', `/containers/create?name=${encodeURIComponent(gatewayName)}`, {
        Image: this.gatewayImage, Labels: this.names.labels(id, 'egress', name), Env: [`COMPUTER_SUBNET=${subnet}`],
        HostConfig: {
          NetworkMode: this.names.egressNetwork, CapDrop: ['ALL'], CapAdd: ['NET_ADMIN'],
          SecurityOpt: ['no-new-privileges:true'], Tmpfs: { '/tmp': 'rw,nosuid,size=16m' },
          Memory: 128 * 1024 * 1024, PidsLimit: 128, RestartPolicy: { Name: 'no' },
        },
      });
      gateway = await this.container(gatewayName, id, 'egress', name);
    }
    if (!gateway) throw new ResourceError(503, 'Computer egress was not created.');
    if (!gateway.State.Running) await this.docker.request('POST', `${this.path('containers', gatewayName)}/start`);
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await this.docker.exec(gatewayName, ['test', '-f', '/tmp/ready'], 'root', 4000); ready = true; break; }
      catch { await delay(250); }
    }
    if (!ready) throw new ResourceError(503, 'Computer egress did not become ready.');
    if (!gateway.NetworkSettings.Networks[this.names.privateNetwork(id)]) {
      await this.docker.request('POST', `${this.path('networks', network.Id)}/connect`, { Container: gatewayName });
    }
    gateway = await this.container(gatewayName, id, 'egress', name);
    const address = gateway?.NetworkSettings.Networks[this.names.privateNetwork(id)]?.IPAddress;
    if (!address || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) throw new ResourceError(503, 'Computer egress address is unavailable.');
    return address;
  }

  private async createOwned(id: string, name: string) {
    const computerName = this.names.desktop(id);
    const existing = await this.container(computerName, id, 'desktop', name);
    if (existing) {
      if (!existing.State.Running) throw new ResourceError(409, 'Computer is stopped; automatic restart is not enabled.');
      return;
    }
    const count = await this.listIds();
    if (count.length >= this.maxComputers) throw new ResourceError(409, 'Computer limit reached.');
    // These images are operator-built, never supplied by the browser.
    for (const image of [this.image, this.gatewayImage]) {
      if (!await this.docker.optional(this.path('images', image) + '/json')) throw new ResourceError(503, 'Build the approved computer images before creating computers.');
    }
    const egress = await this.ensureNetwork(this.names.egressNetwork, null, 'egress-network');
    const privateNetwork = await this.ensureNetwork(this.names.privateNetwork(id), id, 'private-network');
    const subnet = privateNetwork.IPAM.Config[0]?.Subnet;
    if (!subnet || !/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(subnet)) throw new ResourceError(503, 'Computer subnet is unavailable.');
    if (!egress.Id) throw new ResourceError(503, 'Public egress network is unavailable.');
    const gateway = await this.ensureGateway(id, name, subnet, privateNetwork);
    await this.ensureVolume(id, 'home');
    await this.ensureVolume(id, 'workspace');
    await this.docker.request('POST', `/containers/create?name=${encodeURIComponent(computerName)}`, {
      Image: this.image, User: 'root', Cmd: ['/opt/swarm/start-computer.sh'],
      Labels: this.names.labels(id, 'desktop', name), Env: [`COMPUTER_GATEWAY=${gateway}`],
      HostConfig: {
        Runtime: 'sysbox-runc', NetworkMode: this.names.privateNetwork(id), Dns: ['1.1.1.1'],
        CapDrop: ['ALL'], SecurityOpt: [`seccomp=${this.seccomp}`], Init: true,
        Tmpfs: { '/run': 'rw,nosuid,size=64m' }, ShmSize: 256 * 1024 * 1024,
        NanoCpus: 2_000_000_000, Memory: 4 * 1024 * 1024 * 1024, PidsLimit: 1024,
        RestartPolicy: { Name: 'no' },
        Mounts: [
          { Type: 'volume', Source: this.names.volume(id, 'home'), Target: '/home/ubuntu' },
          { Type: 'volume', Source: this.names.volume(id, 'workspace'), Target: '/workspace' },
        ],
      },
    });
    await this.docker.request('POST', `${this.path('containers', computerName)}/start`);
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { await this.docker.exec(computerName, ['test', '-f', '/run/user/1000/screencast-node'], 'ubuntu', 4000); ready = true; break; }
      catch { await delay(500); }
    }
    if (!ready) throw new ResourceError(503, 'Computer desktop did not become ready.');
  }

  async create(idRaw: string, nameRaw: string) {
    const id = validateId(idRaw), name = validateName(nameRaw);
    // Never erase a computer or its persistent volumes on a failed/retried
    // create. A partial resource remains visible through its failed DB record;
    // only exact-name confirmed DELETE may remove it.
    return this.exclusive(() => this.createOwned(id, name));
  }

  private async removeOwned(id: string, name: string) {
    const computer = await this.container(this.names.desktop(id), id, 'desktop', name);
    const gateway = await this.container(this.names.gateway(id), id, 'egress', name);
    const network = await this.network(this.names.privateNetwork(id), id, 'private-network');
    const home = await this.volume(this.names.volume(id, 'home'), id, 'home');
    const workspace = await this.volume(this.names.volume(id, 'workspace'), id, 'workspace');
    // All present resources have passed ownership/name checks before any deletion.
    if (computer) await this.docker.request('DELETE', `${this.path('containers', computer.Id)}?force=true&v=false`);
    if (gateway) await this.docker.request('DELETE', `${this.path('containers', gateway.Id)}?force=true&v=false`);
    if (home) await this.docker.request('DELETE', this.path('volumes', home.Name));
    if (workspace) await this.docker.request('DELETE', this.path('volumes', workspace.Name));
    if (network) await this.docker.request('DELETE', this.path('networks', network.Id));
    this.previewCache.delete(id);
  }
  async remove(idRaw: string, nameRaw: string) {
    const id = validateId(idRaw), name = validateName(nameRaw);
    return this.exclusive(() => this.removeOwned(id, name));
  }

  async resume() {
    return this.exclusive(async () => {
      const rows = await this.listIds();
      for (const row of rows) {
        const id = row.Labels['swarm.ng.id'];
        const name = row.Labels['swarm.ng.name'];
        try {
          if (!id || !name) continue;
          validateId(id); validateName(name);
          const desktop = await this.container(this.names.desktop(id), id, 'desktop', name);
          const gateway = await this.container(this.names.gateway(id), id, 'egress', name);
          const network = await this.network(this.names.privateNetwork(id), id, 'private-network');
          const subnet = network?.IPAM.Config[0]?.Subnet;
          if (!desktop || !network || !subnet) continue;
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
          if (latest && !latest.State.Running) await this.docker.request('POST', `${this.path('containers', latest.Id)}/start`);
        } catch (error) {
          // Keep owned volumes and the resource record for explicit recovery.
          console.error('Computer recovery incomplete:', id, error instanceof Error ? error.message : String(error));
        }
      }
    });
  }

  private async listIds() {
    const filters = encodeURIComponent(JSON.stringify({ label: ['swarm.ng.managed=computer', `swarm.ng.namespace=${this.names.namespace}`, 'swarm.ng.role=desktop'] }));
    const rows = await this.docker.json<ListedContainer[]>('GET', `/containers/json?all=1&filters=${filters}`);
    if (rows.length > 100) throw new ResourceError(503, 'Too many managed computers.');
    return rows.filter(row => row.Labels?.['swarm.ng.role'] === 'desktop' && row.Labels?.['swarm.ng.namespace'] === this.names.namespace && row.Labels?.['swarm.ng.managed'] === 'computer');
  }
  async observe() {
    const rows = await this.listIds();
    const computers = [];
    for (const row of rows) {
      const id = row.Labels['swarm.ng.id'];
      if (!id || !/^\S+$/.test(id)) continue;
      let cpuPercent: number | null = null, memoryBytes: number | null = null;
      if (row.State === 'running') {
        try {
          const stats = await this.docker.json<Statistics>('GET', `${this.path('containers', row.Id)}/stats?stream=false`);
          const cpu = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
          const system = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
          if (system > 0 && cpu >= 0) cpuPercent = Math.round(cpu / system * (stats.cpu_stats?.online_cpus ?? 1) * 1000) / 10;
          if (typeof stats.memory_stats?.usage === 'number') memoryBytes = Math.max(0, stats.memory_stats.usage - (stats.memory_stats.stats?.inactive_file ?? 0));
        } catch { /* State stays visible when live stats are temporarily unavailable. */ }
      }
      computers.push({ id, status: row.State, cpuPercent, memoryBytes });
    }
    return computers;
  }
  async preview(idRaw: string) {
    const id = validateId(idRaw);
    const cached = this.previewCache.get(id);
    if (cached && Date.now() - cached.at < 1800) return cached.image;
    const pending = this.previewPending.get(id);
    if (pending) return pending;
    const work = (async () => {
      const name = this.names.desktop(id);
      const container = await this.container(name, id, 'desktop');
      if (!container) return null;
      if (!container.State.Running) return null;
      const encoded = await this.docker.exec(name, ['/opt/swarm/render-preview.sh'], 'ubuntu', 16_000);
      if (encoded.length > 256 * 1024) throw new ResourceError(503, 'Preview exceeded its limit.');
      const image = Buffer.from(encoded.toString().trim(), 'base64');
      if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image.at(-2) !== 0xff || image.at(-1) !== 0xd9) throw new ResourceError(503, 'Preview is not a JPEG.');
      this.previewCache.set(id, { at: Date.now(), image });
      return image;
    })().finally(() => { this.previewPending.delete(id); });
    this.previewPending.set(id, work);
    return work;
  }
}
