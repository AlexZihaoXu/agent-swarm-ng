import { SettingsManager } from '@earendil-works/pi-coding-agent';

/**
 * Settings for every Pi session the platform creates: in memory, never the developer's settings files. Pi's prompt
 * cache warming stays off: it would send extra model requests on its own (outside the agent's turn and its metering).
 */
export function piSettings(settings: Parameters<typeof SettingsManager.inMemory>[0] = {}) {
  return SettingsManager.inMemory({ ...settings, cacheWarming: 'off' });
}
