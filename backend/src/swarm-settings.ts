import type { PlatformStore } from './platform-store';

/**
 * Operator-wide settings: how many computers may exist, the file-storage limits and how long Discord history is kept. They live in the platform
 * database (one row) and are edited in Settings → Swarm; there are no environment variables for them.
 */
export const swarmSettingBounds = {
  maxComputers: { min: 1, max: 100, default: 4, label: 'Computers', unit: '' },
  uploadMaxMb: { min: 1, max: 1024, default: 100, label: 'Largest chat file', unit: 'MB' },
  scratchFileMaxKb: { min: 16, max: 16384, default: 1024, label: 'Largest scratch file', unit: 'KB' },
  scratchMaxFiles: { min: 10, max: 10000, default: 500, label: 'Scratch files per agent', unit: '' },
  scratchTotalMb: { min: 1, max: 10240, default: 50, label: 'Scratch space per agent', unit: 'MB' },
  storageBudgetGb: { min: 1, max: 10000, default: 10, label: 'Total file storage', unit: 'GB' },
  discordHistoryDays: { min: 1, max: 365, default: 30, label: 'Discord history kept', unit: 'days' },
} as const;
export type SwarmSettingKey = keyof typeof swarmSettingBounds;
export type SwarmSettings = Record<SwarmSettingKey, number>;
export class SwarmSettingsError extends Error {}

export const defaultSwarmSettings = Object.fromEntries(
  Object.entries(swarmSettingBounds).map(([key, bound]) => [key, bound.default]),
) as SwarmSettings;

export class SwarmSettingsStore {
  constructor(private database: PlatformStore) {}

  async get(): Promise<SwarmSettings> {
    await this.database.initialize();
    const row = await this.database.client.swarmSettings.findUnique({ where: { id: 1 } });
    if (!row) return { ...defaultSwarmSettings };
    return Object.fromEntries(
      Object.keys(swarmSettingBounds).map(key => [key, row[key as SwarmSettingKey]]),
    ) as SwarmSettings;
  }

  /** Changes some settings; every value must be a whole number within its bounds. */
  async update(changes: Partial<SwarmSettings>): Promise<SwarmSettings> {
    for (const [key, value] of Object.entries(changes)) {
      const bound = swarmSettingBounds[key as SwarmSettingKey];
      if (!bound) throw new SwarmSettingsError(`Unknown setting ${key}.`);
      if (!Number.isInteger(value) || value < bound.min || value > bound.max)
        throw new SwarmSettingsError(`${bound.label} must be a whole number from ${bound.min} to ${bound.max}.`);
    }
    await this.database.initialize();
    await this.database.client.swarmSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...defaultSwarmSettings, ...changes },
      update: changes,
    });
    return this.get();
  }
}
