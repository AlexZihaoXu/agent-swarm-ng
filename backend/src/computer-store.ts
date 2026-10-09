import type { PlatformStore } from './platform-store';
import type { Computer } from './generated/prisma/client';

export type ComputerSettings = { cpuCores: number; memoryGiB: number; timezone: string };
/** Where a computer's Keep and Cache folders live (null = its own Docker volumes) and the paths it keeps. */
export type ComputerStorage = { keepFolder: string | null; cacheFolder: string | null; keptPaths: string[] };
export const DEFAULT_KEPT_PATHS = ['/home/agent', '/usr/local'];
export function storageOf(record: Pick<Computer, 'keepFolder' | 'cacheFolder' | 'keptPaths'>): ComputerStorage {
  let keptPaths = DEFAULT_KEPT_PATHS;
  try {
    const parsed: unknown = JSON.parse(record.keptPaths);
    if (Array.isArray(parsed) && parsed.every(path => typeof path === 'string')) keptPaths = parsed;
  } catch {
    /* the default */
  }
  return { keepFolder: record.keepFolder, cacheFolder: record.cacheFolder, keptPaths };
}

const validName = (raw: string) => {
  const name = raw.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
    throw new ComputerStoreError('invalid', 'Computer name must be 1–80 printable characters.');
  return name;
};
/**
 * Names are how an operator confirms a deletion and how agents pick a computer, so keep them unambiguous. SQLite has
 * no case-insensitive index here, so compare the bounded roster.
 */
async function nameFree(
  tx: { computer: { findMany(args: object): Promise<{ id: string; name: string }[]> } },
  name: string,
  except?: string,
) {
  const taken = await tx.computer.findMany({ select: { id: true, name: true } });
  if (
    taken.some(
      record => record.id !== except && record.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'),
    )
  )
    throw new ComputerStoreError('conflict', 'That computer name is already in use. Choose another name.');
}
/** The name the controller knows a computer's containers by (their label; never renamed). */
export const controllerName = (record: { name: string; labelName?: string | null }) => record.labelName || record.name;

export class ComputerStoreError extends Error {
  constructor(
    readonly code: 'missing' | 'confirmation' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

/** Private platform identity. Docker is observed state, not a second identity store. */
export class ComputerStore {
  constructor(private readonly platform: PlatformStore) {}

  async reserve(
    rawName: string,
    requestKey: string,
    settings?: ComputerSettings,
    storage?: Pick<ComputerStorage, 'keepFolder' | 'cacheFolder'>,
    organizationId?: string,
  ) {
    await this.platform.initialize();
    const name = validName(rawName);
    if (
      settings &&
      (!Number.isInteger(settings.cpuCores) ||
        settings.cpuCores < 1 ||
        settings.cpuCores > 8 ||
        !Number.isInteger(settings.memoryGiB) ||
        settings.memoryGiB < 1 ||
        settings.memoryGiB > 16 ||
        !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(settings.timezone) ||
        settings.timezone.length > 64)
    ) {
      throw new ComputerStoreError('invalid', 'Invalid computer settings.');
    }
    if (settings) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: settings.timezone });
      } catch {
        throw new ComputerStoreError('invalid', 'Unknown computer timezone.');
      }
    }
    const existing = await this.platform.client.computer.findUnique({ where: { requestKey } });
    if (existing) return { computer: this.sameRequest(existing, name, settings), created: false };
    try {
      const computer = await this.platform.client.$transaction(async tx => {
        if ((await tx.computer.count()) >= 100)
          throw new ComputerStoreError('conflict', 'Computer record limit reached. Delete unused computers first.');
        await nameFree(tx, name);
        return tx.computer.create({
          data: {
            name,
            labelName: name,
            requestKey,
            ...(settings ?? {}),
            ...(storage ?? {}),
            ...(organizationId ? { organizationId } : {}),
          },
        });
      });
      return { computer, created: true };
    } catch (error) {
      // Two simultaneous HTTP retries may race on the unique operation key.
      const raced = await this.platform.client.computer.findUnique({ where: { requestKey } });
      if (!raced) throw error;
      return { computer: this.sameRequest(raced, name, settings), created: false };
    }
  }

  private sameRequest<
    T extends { name: string; cpuCores?: number | null; memoryGiB?: number | null; timezone?: string | null },
  >(computer: T, name: string, settings?: ComputerSettings) {
    if (computer.name !== name)
      throw new ComputerStoreError('conflict', 'This create request was used with a different name.');
    if (
      settings &&
      (computer.cpuCores !== settings.cpuCores ||
        computer.memoryGiB !== settings.memoryGiB ||
        computer.timezone !== settings.timezone)
    ) {
      throw new ComputerStoreError('conflict', 'This create request was used with different settings.');
    }
    return computer;
  }

  /** Persist the operator's power intent. A stopped computer must stay stopped
   * across controller restarts, whose boot reconciliation otherwise starts every
   * owned desktop it finds. */
  async setDesiredState(id: string, desired: 'running' | 'stopped') {
    await this.platform.initialize();
    if (desired !== 'running' && desired !== 'stopped')
      throw new ComputerStoreError('invalid', 'Unknown computer power state.');
    const record = await this.platform.client.computer.findUnique({ where: { id } });
    if (!record) throw new ComputerStoreError('missing', 'Computer not found.');
    if (record.state === 'deleting' || record.state === 'failed') {
      throw new ComputerStoreError('conflict', 'This computer is not available for power changes.');
    }
    return this.platform.client.computer.update({ where: { id }, data: { desiredState: desired } });
  }

  /** Resource changes can apply live; keep the persisted request aligned with
   * the controller after its Docker update succeeds. Timezone is deliberately
   * untouched because container Env is immutable without replacement. */
  private async updateSavedSettings(
    id: string,
    settings: Pick<ComputerSettings, 'cpuCores' | 'memoryGiB'> & { timezone?: string },
  ) {
    await this.platform.initialize();
    const record = await this.get(id);
    if (!record) throw new ComputerStoreError('missing', 'Computer not found.');
    if (record.state !== 'running')
      throw new ComputerStoreError('conflict', 'Computer cannot change resources before creation completes.');
    const updated = await this.platform.client.computer.updateMany({ where: { id, state: 'running' }, data: settings });
    if (updated.count !== 1) throw new ComputerStoreError('conflict', 'Computer changed while updating settings.');
    return (await this.get(id))!;
  }

  async updateResources(id: string, settings: Pick<ComputerSettings, 'cpuCores' | 'memoryGiB'>) {
    return this.updateSavedSettings(id, settings);
  }

  /** Called only after the controller has replaced a powered-off desktop with
   * the new immutable TZ environment and preserved the named volumes. */
  async updateSettings(id: string, settings: ComputerSettings, keptPaths?: string[]) {
    const updated = await this.updateSavedSettings(id, settings);
    if (!keptPaths) return updated;
    return this.platform.client.computer.update({ where: { id }, data: { keptPaths: JSON.stringify(keptPaths) } });
  }

  /** Identities the operator explicitly powered off, for startup reconciliation. */
  async stoppedIds() {
    await this.platform.initialize();
    return (
      await this.platform.client.computer.findMany({
        where: { desiredState: 'stopped' },
        select: { id: true },
        orderBy: { sequence: 'asc' },
        take: 100,
      })
    ).map(record => record.id);
  }

  /** A new name for the dashboard and agents; its containers keep the label they were created with (labelName). */
  async rename(id: string, rawName: string) {
    await this.platform.initialize();
    const name = validName(rawName);
    return this.platform.client.$transaction(async tx => {
      const record = await tx.computer.findUnique({ where: { id } });
      if (!record || record.state === 'deleting') throw new ComputerStoreError('missing', 'Computer not found.');
      await nameFree(tx, name, id);
      return tx.computer.update({
        where: { id },
        // A computer from before renaming keeps its original name for the controller.
        data: { name, labelName: controllerName(record) },
      });
    });
  }

  async get(id: string) {
    await this.platform.initialize();
    return this.platform.client.computer.findUnique({ where: { id } });
  }

  async list() {
    await this.platform.initialize();
    return this.platform.client.computer.findMany({ orderBy: { sequence: 'asc' }, take: 100 });
  }

  async markRunning(id: string) {
    await this.platform.initialize();
    return (
      (await this.platform.client.computer.updateMany({ where: { id, state: 'creating' }, data: { state: 'running' } }))
        .count === 1
    );
  }

  /** Drop a reservation the controller refused before creating anything (limit reached, invalid settings). */
  async discardReservation(id: string) {
    await this.platform.initialize();
    return (await this.platform.client.computer.deleteMany({ where: { id, state: 'creating' } })).count === 1;
  }

  async markFailed(id: string) {
    await this.platform.initialize();
    return (
      (await this.platform.client.computer.updateMany({ where: { id, state: 'creating' }, data: { state: 'failed' } }))
        .count === 1
    );
  }

  async markDeleting(id: string, confirmation: string): Promise<Computer> {
    await this.platform.initialize();
    const record = await this.get(id);
    if (!record) throw new ComputerStoreError('missing', 'Computer not found.');
    if (record.name !== confirmation)
      throw new ComputerStoreError('confirmation', 'Type the computer name exactly to confirm deletion.');
    if (record.state === 'creating')
      throw new ComputerStoreError('conflict', 'Computer is being created. Wait for it to finish before deleting.');
    if (record.state === 'deleting') return record;
    const updated = await this.platform.client.computer.updateMany({
      where: { id, name: confirmation, state: record.state },
      data: { state: 'deleting' },
    });
    if (updated.count !== 1) return this.markDeleting(id, confirmation);
    return (await this.get(id))!;
  }

  async finalizeDelete(id: string, confirmation: string) {
    await this.platform.initialize();
    return (
      (await this.platform.client.computer.deleteMany({ where: { id, name: confirmation, state: 'deleting' } }))
        .count === 1
    );
  }
}
