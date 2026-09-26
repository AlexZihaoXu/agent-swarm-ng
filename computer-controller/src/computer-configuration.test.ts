import { describe, expect, it } from 'vitest';
import { deriveComputerLimits, validateComputerConfiguration } from './computer-configuration';

const gib = 1024 ** 3;

describe('host-bounded computer settings', () => {
  it('detects host capacity but keeps today\'s 4-core/4-GiB/Toronto defaults', () => {
    expect(deriveComputerLimits({ NCPU: 16, MemTotal: 28 * gib }, 4, 'America/Toronto')).toEqual({
      cpuCores: { min: 1, max: 8, default: 4 },
      memoryGiB: { min: 1, max: 16, default: 4 },
      timezoneDefault: 'America/Toronto',
    });
  });

  it('does not advertise limits or defaults above a smaller Docker host', () => {
    expect(deriveComputerLimits({ NCPU: 2, MemTotal: 3 * gib }, 4, '')).toEqual({
      cpuCores: { min: 1, max: 2, default: 2 },
      memoryGiB: { min: 1, max: 3, default: 3 },
      timezoneDefault: 'America/Toronto',
    });
    for (const invalid of [{ NCPU: 0, MemTotal: 4 * gib }, { NCPU: 4, MemTotal: 0 }, { NCPU: NaN, MemTotal: 4 * gib }]) {
      expect(() => deriveComputerLimits(invalid, 4, 'America/Toronto')).toThrow('capacity');
    }
  });

  it('revalidates browser choices at the Docker execution boundary', () => {
    const limits = deriveComputerLimits({ NCPU: 4, MemTotal: 6 * gib }, 4, 'America/Toronto');
    expect(validateComputerConfiguration({ cpuCores: 2, memoryGiB: 5, timezone: 'America/Toronto' }, limits)).toEqual({ cpuCores: 2, memoryGiB: 5, timezone: 'America/Toronto' });
    for (const input of [
      { cpuCores: 0, memoryGiB: 4, timezone: 'America/Toronto' },
      { cpuCores: 2.5, memoryGiB: 4, timezone: 'America/Toronto' },
      { cpuCores: 5, memoryGiB: 4, timezone: 'America/Toronto' },
      { cpuCores: 2, memoryGiB: 0, timezone: 'America/Toronto' },
      { cpuCores: 2, memoryGiB: 7, timezone: 'America/Toronto' },
      { cpuCores: 2, memoryGiB: 4.5, timezone: 'America/Toronto' },
      { cpuCores: 2, memoryGiB: 4, timezone: '../etc/passwd' },
      { cpuCores: 2, memoryGiB: 4, timezone: 'Not/A/Zone' },
    ]) expect(() => validateComputerConfiguration(input, limits)).toThrow();
  });
});
