/**
 * Token buckets keyed by string (an address, a person): each holds up to `perMinute` requests and refills
 * continuously at `perMinute` a minute, so a page load's burst passes while a sustained flood is refused. In memory
 * and bounded: beyond `maxKeys` the least recently used key is forgotten (its next request starts with a full bucket).
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private maxKeys = 10_000) {}

  /** Takes one request for `key`: 0 when allowed, otherwise the whole seconds to wait for the next one. */
  take(key: string, perMinute: number, now = Date.now()): number {
    const perMs = perMinute / 60_000;
    const bucket = this.buckets.get(key);
    const tokens = bucket ? Math.min(perMinute, bucket.tokens + (now - bucket.at) * perMs) : perMinute;
    // Re-inserting moves the key to the end, so the first key is always the least recently used.
    this.buckets.delete(key);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, at: now });
      return Math.max(1, Math.ceil((1 - tokens) / perMs / 1000));
    }
    this.buckets.set(key, { tokens: tokens - 1, at: now });
    if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    return 0;
  }

  get size() {
    return this.buckets.size;
  }
}
