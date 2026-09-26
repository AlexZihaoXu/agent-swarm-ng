import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateComputerName } from './computer-name';

afterEach(() => vi.unstubAllGlobals());

/** Stub getRandomValues with queued byte arrays; repeats the last array afterwards. */
function stubBytes(...batches: number[][]) {
  const queue = batches.map(batch => Uint8Array.from(batch));
  let calls = 0;
  vi.stubGlobal('crypto', {
    getRandomValues: vi.fn((target: Uint8Array) => {
      const batch = queue[Math.min(calls, queue.length - 1)];
      calls += 1;
      target.set(batch);
      return target;
    }),
  });
}

describe('generateComputerName', () => {
  it('builds Workspace-NG plus four uppercase letters from random bytes', () => {
    stubBytes([3, 4, 5, 6]);
    expect(generateComputerName()).toBe('Workspace-NGDEFG');
  });

  it('ignores bytes that would bias the alphabet and draws again', () => {
    // 250 and 254 are >= 26 * 9, so only D, E, F, G map from the two draws.
    stubBytes([250, 3, 4, 5], [6, 254, 254, 254]);
    expect(generateComputerName()).toBe('Workspace-NGDEFG');
  });

  it('skips a candidate that is already taken, case-insensitively', () => {
    stubBytes([3, 4, 5, 6], [7, 8, 9, 10]);
    expect(generateComputerName(['workspace-ngdefg', 'Other'])).toBe('Workspace-NGHIJK');
  });

  it('reports no suggestion when every random candidate collides', () => {
    stubBytes([0, 0, 0, 0]);
    const taken = Array.from({ length: 600 }, () => 'Workspace-NGAAAA');
    expect(generateComputerName(taken)).toBeNull();
  });

  it('suggests distinct names for a fresh roster', () => {
    const names = Array.from({ length: 30 }, () => generateComputerName(['Workspace']));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^Workspace-NG[A-Z]{4}$/);
      expect(name).not.toBe('Workspace');
    }
  });
});
