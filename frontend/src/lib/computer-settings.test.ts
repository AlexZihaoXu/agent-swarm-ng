import { describe, expect, it } from 'vitest';
import { defaultComputerSettings, parseComputerSettings, type ComputerLimits } from './computer-settings';

const limits: ComputerLimits = {
  cpuCores: { min: 1, max: 8, default: 4 },
  memoryGiB: { min: 1, max: 16, default: 4 },
  timezoneDefault: 'America/Toronto',
};

describe('computer settings form', () => {
  it('prefills the operator’s current 4-core/4-GiB/Toronto selection', () => {
    const draft = defaultComputerSettings(limits);
    expect(draft).toEqual({ cpuCores: '4', memoryGiB: '4', timezone: 'America/Toronto' });
    expect(parseComputerSettings(draft, limits)).toEqual({ cpuCores: 4, memoryGiB: 4, timezone: 'America/Toronto' });
  });
  it('requires whole numbers within the detected bounds and a real IANA zone', () => {
    for (const draft of [
      { cpuCores: '', memoryGiB: '4', timezone: 'America/Toronto' },
      { cpuCores: '0', memoryGiB: '4', timezone: 'America/Toronto' },
      { cpuCores: '8.5', memoryGiB: '4', timezone: 'America/Toronto' },
      { cpuCores: '4', memoryGiB: '17', timezone: 'America/Toronto' },
      { cpuCores: '4', memoryGiB: '4', timezone: 'Not/A/Zone' },
    ]) expect(parseComputerSettings(draft, limits)).toBeNull();
    expect(parseComputerSettings({ cpuCores: '2', memoryGiB: '6', timezone: 'Etc/UTC' }, limits)).toEqual({ cpuCores: 2, memoryGiB: 6, timezone: 'Etc/UTC' });
  });
});
