import type { PlatformStore } from './platform-store';
import type { ActivityEntry } from './agent-activity';

export const ACTIVITY_CHUNK_SIZE = 6000;
export const ACTIVITY_PAGE_SIZE = 30;
export type ActivitySnapshot = ActivityEntry & { revision: number; state?: string };
type Row = Omit<ActivityEntry, 'text'> & { sequence: number; revision: number; totalLength: number; bytes: Uint8Array | null };
// Byte offsets avoid SQLite TEXT length/substr stopping at embedded NUL. Only complete
// UTF-8 characters cross the wire; callers continue from nextOffset, never JS string.length.
const columns = 'id, sequence, runId, channelId, kind, label, timestamp, revision, state, length(CAST(text AS BLOB)) AS totalLength';
function textChunk(bytes: Uint8Array | null, totalLength: number, offset = 0) {
  // libSQL returns NULL for a zero-length BLOB substring (empty text or EOF).
  // That is a valid empty fragment, not a missing activity entry.
  if (bytes === null) {
    if (offset < totalLength) throw new Error('Activity text fragment is unavailable.');
    bytes = new Uint8Array(0);
  }
  let end = Math.min(bytes.length, ACTIVITY_CHUNK_SIZE);
  if (end < bytes.length) while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  const next = offset + end;
  return { totalLength, offset, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(0, end)), nextOffset: next < totalLength ? next : null };
}
export function activityTextPreview(text: string) { const bytes = new TextEncoder().encode(text); return textChunk(bytes, bytes.length); }
const view = ({ bytes, ...row }: Row, offset = 0): ActivityEntry => ({ ...row, sequence: Number(row.sequence), revision: Number(row.revision), ...textChunk(bytes, Number(row.totalLength), offset) });

/** Trusted operator archive. No agent tool exposes this store. */
export class ActivityStore {
  constructor(private database: PlatformStore) {}
  async save(agentId: string, entry: ActivitySnapshot): Promise<ActivityEntry> {
    await this.database.initialize();
    await this.database.client.$executeRawUnsafe(`INSERT INTO Activity (id, agentId, runId, channelId, kind, label, text, timestamp, revision, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET text=excluded.text, kind=excluded.kind, label=excluded.label, revision=excluded.revision, state=excluded.state
      WHERE Activity.agentId=excluded.agentId AND Activity.revision < excluded.revision`,
    entry.id, agentId, entry.runId, entry.channelId, entry.kind, entry.label, entry.text, entry.timestamp, entry.revision, entry.state ?? null);
    const saved = await this.fragment(agentId, entry.id, 0);
    if (!saved || saved === 'changed') throw new Error('Activity entry could not be saved.');
    return saved;
  }
  async page(agentId: string, before?: number) {
    await this.database.initialize();
    const rows = await this.database.client.$queryRawUnsafe<Row[]>(`SELECT ${columns}, substr(CAST(text AS BLOB), 1, ?) AS bytes FROM Activity
      WHERE agentId = ? ${before === undefined ? '' : 'AND sequence < ?'} ORDER BY sequence DESC LIMIT ?`,
    ACTIVITY_CHUNK_SIZE + 4, agentId, ...(before === undefined ? [] : [before]), ACTIVITY_PAGE_SIZE + 1);
    const entries = rows.slice(0, ACTIVITY_PAGE_SIZE).reverse().map(row => view(row));
    const context = await this.database.client.$queryRawUnsafe<Row[]>(`SELECT ${columns}, substr(CAST(text AS BLOB), 1, ?) AS bytes FROM Activity
      WHERE agentId = ? AND label = 'Context usage' ORDER BY sequence DESC LIMIT 1`, ACTIVITY_CHUNK_SIZE + 4, agentId);
    return { entries, nextCursor: rows.length > ACTIVITY_PAGE_SIZE ? entries[0].sequence! : null, contextUsage: context[0] ? view(context[0]) : null };
  }
  async fragment(agentId: string, id: string, offset: number, revision?: number): Promise<ActivityEntry | 'changed' | null> {
    await this.database.initialize();
    const rows = await this.database.client.$queryRawUnsafe<Row[]>(`SELECT ${columns}, substr(CAST(text AS BLOB), ?, ?) AS bytes FROM Activity WHERE agentId = ? AND id = ? LIMIT 1`, offset + 1, ACTIVITY_CHUNK_SIZE + 4, agentId, id);
    if (!rows[0]) return null;
    if (revision !== undefined && Number(rows[0].revision) !== revision) return 'changed';
    return view(rows[0], offset);
  }
  async lifecycle(run: { agentId: string; runId: string; channelId: string }, outcome: 'queued' | 'completed' | 'failed' | 'cancelled') {
    await this.database.initialize();
    const id = `${run.runId}:run-status`;
    const previous = await this.database.client.activity.findUnique({ where: { id } });
    // The normal recorder owns completed run status. This covers queue/preparation failures.
    if (previous && previous.state !== 'active') return null;
    if (outcome === 'queued' && previous) return null;
    const label = outcome === 'queued' ? 'Run queued' : outcome === 'cancelled' ? 'Run stopped' : outcome === 'failed' ? 'Run failed' : 'Run ended';
    const text = outcome === 'queued' ? 'Accepted agent work is waiting or preparing.' : outcome === 'cancelled' ? 'Run stopped before or during preparation; committed effects remain.' : outcome === 'failed' ? 'Run failed during preparation or execution. Check the connection and backend status.' : 'Run ended.';
    return this.save(run.agentId, { id, runId: run.runId, channelId: run.channelId, kind: 'status', label, text, timestamp: previous?.timestamp ?? Date.now(), revision: previous ? previous.revision + 1 : 0, state: outcome === 'queued' ? 'active' : outcome });
  }
  async interruptActive() {
    await this.database.initialize();
    await this.database.client.activity.updateMany({ where: { state: 'active' }, data: { state: 'interrupted', label: 'Run interrupted', text: 'Backend restarted during this run. Work was not resumed; partial activity remains unfinished.', revision: { increment: 1 } } });
    // Preserve the actual partial evidence; only its completion state changes on restart.
    await this.database.client.activity.updateMany({ where: { state: { in: ['streaming','pending','running'] } }, data: { state: 'interrupted', revision: { increment: 1 } } });
  }
}
