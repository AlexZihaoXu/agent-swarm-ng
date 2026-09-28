export type ResourceRole = 'desktop' | 'egress' | 'media' | 'private-network' | 'egress-network' | 'home' | 'workspace';
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAMESPACE = /^[a-z0-9][a-z0-9-]{0,29}$/;

export class ResourceError extends Error {
  constructor(readonly code: 400 | 403 | 404 | 409 | 413 | 429 | 503 | 504, message: string) { super(message); }
}

export function validateNamespace(namespace: string) {
  if (!NAMESPACE.test(namespace)) throw new Error('Invalid controller namespace.');
  return namespace;
}
export function validateId(id: string) {
  if (!ID.test(id)) throw new ResourceError(400, 'Invalid computer ID.');
  return id.toLowerCase();
}
export function validateName(name: string) {
  if (typeof name !== 'string' || name.trim() !== name || name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new ResourceError(400, 'Invalid computer name.');
  return name;
}

export class ComputerNames {
  readonly namespace: string;
  readonly egressNetwork: string;
  readonly mediaNetwork: string;
  constructor(namespace: string) {
    this.namespace = validateNamespace(namespace);
    this.egressNetwork = `${namespace}-computer-egress`;
    this.mediaNetwork = `${namespace}-computer-media`;
  }
  desktop(id: string) { return `${this.namespace}-computer-${validateId(id)}`; }
  gateway(id: string) { return `${this.desktop(id)}-gateway`; }
  media(id: string) { return `${this.desktop(id)}-media`; }
  // Docker resource names can exceed a 63-byte DNS label in test namespaces.
  // This alias is short, canonical and confined to one Compose media bridge.
  mediaAlias(id: string) { return `computer-${validateId(id)}`; }
  privateNetwork(id: string) { return `${this.desktop(id)}-private`; }
  volume(id: string, role: 'home' | 'workspace') { return `${this.desktop(id)}-${role}`; }
  labels(id: string | null, role: ResourceRole, name?: string): Record<string, string> {
    return {
      'swarm.ng.managed': 'computer', 'swarm.ng.namespace': this.namespace,
      'swarm.ng.role': role, ...(id ? { 'swarm.ng.id': validateId(id) } : {}),
      ...(name ? { 'swarm.ng.name': validateName(name) } : {}),
    };
  }
  assertOwned(labels: Record<string, string> | undefined, id: string | null, role: ResourceRole, name?: string) {
    const expected = this.labels(id, role, name);
    if (!labels || Object.entries(expected).some(([key, value]) => labels[key] !== value)) throw new ResourceError(409, 'Docker resource does not belong to this computer.');
  }
}
