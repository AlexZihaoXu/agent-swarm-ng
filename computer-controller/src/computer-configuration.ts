import { ResourceError } from './resources';

export type ComputerConfiguration = { cpuCores: number; memoryGiB: number; timezone: string };
export type ComputerLimits = {
  cpuCores: { min: 1; max: number; default: number };
  memoryGiB: { min: 1; max: number; default: number };
  timezoneDefault: string;
};

const GiB = 1024 ** 3;
const CPU_POLICY_MAX = 8;
const MEMORY_POLICY_MAX_GIB = 16;

/** Docker-host capacity bounds UI choices; policy caps avoid advertising the
 * entire host as one computer's budget. The operator's existing limits remain
 * the defaults, clamped only if this host is smaller. */
export function deriveComputerLimits(host: { NCPU?: number; MemTotal?: number }, operatorCpu: number, operatorTimezone: string): ComputerLimits {
  if (!Number.isFinite(host.NCPU) || !Number.isFinite(host.MemTotal) || host.NCPU! < 1 || host.MemTotal! < GiB) {
    throw new ResourceError(503, 'Docker host capacity is unavailable.');
  }
  const cpuMax = Math.min(CPU_POLICY_MAX, Math.floor(host.NCPU!));
  const memoryMax = Math.min(MEMORY_POLICY_MAX_GIB, Math.floor(host.MemTotal! / GiB));
  return {
    cpuCores: { min: 1, max: cpuMax, default: Math.min(operatorCpu, cpuMax) },
    memoryGiB: { min: 1, max: memoryMax, default: Math.min(4, memoryMax) },
    timezoneDefault: operatorTimezone || 'America/Toronto',
  };
}

/** Recheck browser-supplied choices where Docker operations actually execute.
 * A plain path check prevents traversal/env injection; ICU rejects unknown IANA
 * zones rather than silently giving the guest a clock unlike the UI selection. */
export function validateComputerConfiguration(input: unknown, limits: ComputerLimits): ComputerConfiguration {
  if (!input || typeof input !== 'object') throw new ResourceError(400, 'Computer settings are required.');
  const values = input as Record<string, unknown>;
  const { cpuCores, memoryGiB, timezone } = values;
  if (!Number.isInteger(cpuCores) || (cpuCores as number) < 1 || (cpuCores as number) > limits.cpuCores.max) {
    throw new ResourceError(400, 'Computer CPU limit exceeds the host or policy capacity.');
  }
  if (!Number.isInteger(memoryGiB) || (memoryGiB as number) < 1 || (memoryGiB as number) > limits.memoryGiB.max) {
    throw new ResourceError(400, 'Computer memory limit exceeds the host or policy capacity.');
  }
  if (typeof timezone !== 'string' || timezone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(timezone)) {
    throw new ResourceError(400, 'Invalid computer timezone.');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
  catch { throw new ResourceError(400, 'Unknown computer timezone.'); }
  return { cpuCores: cpuCores as number, memoryGiB: memoryGiB as number, timezone };
}
