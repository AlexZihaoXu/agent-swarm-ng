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
  // Agent recordings (start_recording): a lease the agent renews, reminded halfway; GPU-encoded desktop video.
  recordingLeaseSeconds: { min: 60, max: 3600, default: 300, label: 'Recording stops unless renewed after', unit: 's' },
  recordingReminderSeconds: { min: 30, max: 3540, default: 150, label: 'Recording renewal reminder after', unit: 's' },
  recordingMaxMinutes: { min: 1, max: 240, default: 30, label: 'Longest recording', unit: 'min' },
  recordingDesktopKbps: { min: 100, max: 50000, default: 1000, label: 'Desktop recording bitrate (max)', unit: 'kbps' },
  recordingDesktopFps: { min: 1, max: 60, default: 30, label: 'Desktop recording frame rate', unit: 'fps' },
  recordingTerminalFps: { min: 1, max: 30, default: 15, label: 'Terminal recording frame rate', unit: 'fps' },
  recordingPadBeforeMs: { min: 0, max: 30000, default: 2500, label: 'Clip starts before an event', unit: 'ms' },
  recordingPadAfterMs: { min: 0, max: 30000, default: 2500, label: 'Clip ends after an event', unit: 'ms' },
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
