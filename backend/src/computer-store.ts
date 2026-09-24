import type { PlatformStore } from './platform-store';
import type { Computer } from './generated/prisma/client';

export class ComputerStoreError extends Error {
  constructor(readonly code: 'missing' | 'confirmation' | 'conflict' | 'invalid', message: string) { super(message); }
}

/** Private platform identity. Docker is observed state, not a second identity store. */
export class ComputerStore {
  constructor(private readonly platform: PlatformStore) {}

  async reserve(rawName: string, requestKey: string) {
    await this.platform.initialize();
    const name = rawName.trim();
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new ComputerStoreError('invalid', 'Computer name must be 1–80 printable characters.');
    const existing = await this.platform.client.computer.findUnique({ where: { requestKey } });
    if (existing) return { computer: this.sameRequest(existing, name), created: false };
    try {
      const computer = await this.platform.client.computer.create({ data: { name, requestKey } });
      return { computer, created: true };
    } catch (error) {
      // Two simultaneous HTTP retries may race on the unique operation key.
      const raced = await this.platform.client.computer.findUnique({ where: { requestKey } });
      if (!raced) throw error;
      return { computer: this.sameRequest(raced, name), created: false };
    }
  }

  private sameRequest<T extends { name: string }>(computer: T, name: string) {
    if (computer.name !== name) throw new ComputerStoreError('conflict', 'This create request was used with a different name.');
    return computer;
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
    return (await this.platform.client.computer.updateMany({ where: { id, state: 'creating' }, data: { state: 'running' } })).count === 1;
  }

  async markFailed(id: string) {
    await this.platform.initialize();
    return (await this.platform.client.computer.updateMany({ where: { id, state: 'creating' }, data: { state: 'failed' } })).count === 1;
  }

  async markDeleting(id: string, confirmation: string): Promise<Computer> {
    await this.platform.initialize();
    const record = await this.get(id);
    if (!record) throw new ComputerStoreError('missing', 'Computer not found.');
    if (record.name !== confirmation) throw new ComputerStoreError('confirmation', 'Type the computer name exactly to confirm deletion.');
    if (record.state === 'creating') throw new ComputerStoreError('conflict', 'Computer is being created. Wait for it to finish before deleting.');
    if (record.state === 'deleting') return record;
    const updated = await this.platform.client.computer.updateMany({ where: { id, name: confirmation, state: record.state }, data: { state: 'deleting' } });
    if (updated.count !== 1) return this.markDeleting(id, confirmation);
    return (await this.get(id))!;
  }

  async finalizeDelete(id: string, confirmation: string) {
    await this.platform.initialize();
    return (await this.platform.client.computer.deleteMany({ where: { id, name: confirmation, state: 'deleting' } })).count === 1;
  }
}
