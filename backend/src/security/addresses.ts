import { isIPv4, isIPv6 } from 'node:net';
import type { PlatformStore } from '../platform-store';

/** An address as a number in its family's space (IPv4-mapped IPv6 counts as IPv4). */
function toBits(ip: string): { family: 4 | 6; value: bigint } | null {
  let text = ip.trim().toLowerCase();
  if (text.startsWith('::ffff:') && isIPv4(text.slice(7))) text = text.slice(7);
  if (isIPv4(text)) return { family: 4, value: text.split('.').reduce((sum, part) => (sum << 8n) + BigInt(part), 0n) };
  if (!isIPv6(text)) return null;
  const [head = '', tail = ''] = text.split('::');
  const groups = (part: string) => (part ? part.split(':') : []);
  let left = groups(head),
    right = text.includes('::') ? groups(tail) : [];
  // An embedded IPv4 tail (::ffff:… handled above, or 64:ff9b::192.0.2.4) is two groups.
  const last = right.length ? right : left;
  const v4 = last.at(-1);
  if (v4 && isIPv4(v4)) {
    const n = v4.split('.').map(Number);
    last.splice(-1, 1, ((n[0]! << 8) | n[1]!).toString(16), ((n[2]! << 8) | n[3]!).toString(16));
  }
  if (!text.includes('::')) ((left = last), (right = []));
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const all = [...left, ...new Array<string>(missing).fill('0'), ...right];
  if (!all.every(group => /^[0-9a-f]{1,4}$/.test(group))) return null;
  const value = all.reduce((sum, group) => (sum << 16n) + BigInt(parseInt(group, 16)), 0n);
  // Every IPv4-mapped form (::ffff:192.0.2.4, ::ffff:c000:0204, 0:0:0:0:0:ffff:…) is that IPv4 address.
  if (value >> 32n === 0xffffn) return { family: 4, value: value & 0xffffffffn };
  return { family: 6, value };
}

export type Range = { family: 4 | 6; base: bigint; prefix: number };

/** "192.0.2.4", "100.64.0.0/10", "2001:db8::/32" → its normalized text and range; null when not an address. */
export function parseRange(input: string): { text: string; range: Range } | null {
  const parts = input.trim().split('/');
  if (parts.length > 2) return null;
  const [address = '', prefixText] = parts;
  const bits = toBits(address);
  if (!bits) return null;
  const width = bits.family === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? width : Number(prefixText);
  if (
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > width ||
    (prefixText !== undefined && !/^\d+$/.test(prefixText))
  )
    return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(width - prefix);
  const base = bits.value & mask;
  return {
    text: `${format(bits.family, base)}${prefix === width ? '' : `/${prefix}`}`,
    range: { family: bits.family, base, prefix },
  };
}

function format(family: 4 | 6, value: bigint) {
  if (family === 4) return [24n, 16n, 8n, 0n].map(shift => Number((value >> shift) & 255n)).join('.');
  const groups = Array.from({ length: 8 }, (_, i) => Number((value >> BigInt((7 - i) * 16)) & 0xffffn).toString(16));
  // The longest run of zero groups becomes "::".
  let best = { start: -1, length: 0 };
  for (let i = 0; i < 8;) {
    if (groups[i] !== '0') {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === '0') j++;
    if (j - i > best.length && j - i > 1) best = { start: i, length: j - i };
    i = j;
  }
  if (best.start < 0) return groups.join(':');
  return `${groups.slice(0, best.start).join(':')}::${groups.slice(best.start + best.length).join(':')}`;
}

export function contains(range: Range, ip: string) {
  const bits = toBits(ip);
  if (!bits || bits.family !== range.family) return false;
  const width = range.family === 4 ? 32 : 128;
  return (
    range.prefix === 0 || bits.value >> BigInt(width - range.prefix) === range.base >> BigInt(width - range.prefix)
  );
}

export type KnownAddressView = { id: string; address: string; label: string; trusted: boolean; createdAt: string };

/**
 * Known client addresses (Settings → Known addresses): a label for the audit log and whether the address is trusted
 * (it may sign in during a lockdown). The most specific match wins.
 */
export class KnownAddresses {
  private cache: (KnownAddressView & { range: Range })[] | null = null;

  constructor(private readonly platform: PlatformStore) {}

  async list(): Promise<(KnownAddressView & { range: Range })[]> {
    if (this.cache) return this.cache;
    await this.platform.initialize();
    const rows = await this.platform.client.knownAddress.findMany({ orderBy: { sequence: 'asc' } });
    this.cache = rows.flatMap(row => {
      const parsed = parseRange(row.address);
      return parsed
        ? [
            {
              id: row.id,
              address: row.address,
              label: row.label,
              trusted: row.trusted,
              createdAt: row.createdAt.toISOString(),
              range: parsed.range,
            },
          ]
        : [];
    });
    return this.cache;
  }

  async match(ip: string | null | undefined) {
    if (!ip) return null;
    let found: (KnownAddressView & { range: Range }) | null = null;
    for (const entry of await this.list())
      if (contains(entry.range, ip) && (!found || entry.range.prefix > found.range.prefix)) found = entry;
    return found;
  }

  async trusted(ip: string | null | undefined) {
    return Boolean((await this.match(ip))?.trusted);
  }

  async add(input: { address: string; label: string; trusted: boolean }) {
    const parsed = parseRange(input.address);
    if (!parsed) throw new KnownAddressError('Enter an IP address or a range such as 100.64.0.0/10.');
    await this.platform.initialize();
    const exists = await this.platform.client.knownAddress.findUnique({ where: { address: parsed.text } });
    if (exists) throw new KnownAddressError(`${parsed.text} is already listed.`);
    const row = await this.platform.client.knownAddress.create({
      data: { address: parsed.text, label: input.label.trim(), trusted: input.trusted },
    });
    this.cache = null;
    return row;
  }

  async update(id: string, changes: { label?: string; trusted?: boolean }) {
    await this.platform.initialize();
    const row = await this.platform.client.knownAddress.update({
      where: { id },
      data: {
        ...(changes.label !== undefined ? { label: changes.label.trim() } : {}),
        ...(changes.trusted !== undefined ? { trusted: changes.trusted } : {}),
      },
    });
    this.cache = null;
    return row;
  }

  async remove(id: string) {
    await this.platform.initialize();
    const row = await this.platform.client.knownAddress.delete({ where: { id } });
    this.cache = null;
    return row;
  }
}

export class KnownAddressError extends Error {}
