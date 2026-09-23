import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUuid } from './random-uuid';

afterEach(() => vi.unstubAllGlobals());

describe('randomUuid', () => {
  it('makes an RFC 4122 v4 UUID without crypto.randomUUID (HTTP origins)', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(Uint8Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    expect(randomUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('generates distinct valid UUIDs', () => {
    const ids = Array.from({ length: 20 }, randomUuid);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
