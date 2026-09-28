import { ResourceError } from './resources';
import { jpegDimensions } from './computer-use-service';
const fail = (message: string): never => { throw new ResourceError(400, message); };
const uncertain = (): never => { throw new ResourceError(503, 'Computer core operation settlement is uncertain. Do not transfer control.'); };
export type CoreMode = 'prepare' | 'execute' | 'cancel';
export function validateCore(input: unknown, prepared = false): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Expected a core tool request.');
  const value = input as Record<string, any>;
  if (Buffer.byteLength(JSON.stringify(value)) > 65536) fail('Request exceeds 64 KiB.');
  const fields: Record<string, string[]> = { read: ['path','offset','limit'], write: ['path','content'], edit: ['path','edits'], bash: ['command','cwd','timeout'] };
  if (typeof value.kind !== 'string' || !Object.hasOwn(fields, value.kind)) fail('Unknown core tool.');
  if (Object.keys(value).some(key => !['kind', ...(prepared ? ['validationToken'] : []), ...fields[value.kind]].includes(key))) fail('Unknown core tool field.');
  const text = (key: string, max: number, empty = false) => {
    if (typeof value[key] !== 'string' || (!empty && !value[key].length) || value[key].length > max) fail(`Invalid ${key}.`);
  };
  if (value.kind !== 'bash') text('path', 4096);
  if (typeof value.path === 'string' && value.path.includes('\0')) fail('Invalid path.');
  if (value.kind === 'read') {
    if (value.offset !== undefined && (!Number.isSafeInteger(value.offset) || value.offset < 1)) fail('offset must be a positive line number.');
    if (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 2000)) fail('limit must be 1..2000.');
  }
  if (value.kind === 'write') text('content', 65536, true);
  if (value.kind === 'edit') {
    if (!Array.isArray(value.edits) || !value.edits.length || value.edits.length > 100 || value.edits.some((edit: any) => !edit || typeof edit.oldText !== 'string' || !edit.oldText || typeof edit.newText !== 'string' || Object.keys(edit).some(key => !['oldText','newText'].includes(key)))) fail('Use 1..100 exact oldText/newText replacements.');
  }
  if (value.kind === 'bash') {
    text('command', 65536); if (!value.command.trim()) fail('command must be nonempty.');
    if (value.cwd !== undefined) text('cwd', 4096);
    if (value.cwd?.includes('\0')) fail('Invalid cwd.');
    if (value.timeout !== undefined && (typeof value.timeout !== 'number' || !Number.isFinite(value.timeout) || value.timeout <= 0 || value.timeout > 120)) fail('timeout must be within (0,120] seconds.');
  }
  if (prepared && (typeof value.validationToken !== 'string' || !/^[0-9a-f-]{36}$/.test(value.validationToken))) fail('Prepare the request before execution.');
  return value;
}

export class ComputerCoreService {
  private prepared = new Map<string, { token: string; guestToken: string }>();
  private epochs = new Map<string, number>();
  private active = new Map<string, Promise<unknown>>();
  private cancelling = new Map<string, Promise<{ settled: boolean }>>();
  constructor(private exec: (id: string, mode: CoreMode, input: unknown) => Promise<Buffer>) {}
  private async guest(id: string, mode: CoreMode, input: unknown) {
    const bytes = await this.exec(id, mode, input);
    if (bytes.length > 3 * 1024 * 1024) uncertain();
    let value: any; try { value = JSON.parse(bytes.toString()); } catch { return uncertain(); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) uncertain();
    return value;
  }
  async prepare(id: string, input: unknown) {
    validateCore(input);
    if (this.active.has(id) || this.cancelling.has(id)) throw new ResourceError(409, 'Computer operation is busy.');
    const epoch = this.epochs.get(id) ?? 0;
    const result = await this.guest(id, 'prepare', {});
    if (epoch !== (this.epochs.get(id) ?? 0) || this.cancelling.has(id) || this.active.has(id)) throw new ResourceError(409, 'Preparation was cancelled.');
    if (typeof result.validationToken !== 'string' || !/^[0-9a-f-]{36}$/.test(result.validationToken)) uncertain();
    const token = crypto.randomUUID();
    this.prepared.set(id, { token, guestToken: result.validationToken });
    return { validationToken: token };
  }
  async execute(id: string, input: unknown) {
    const request = validateCore(input, true), ticket = this.prepared.get(id);
    if (!ticket || ticket.token !== request.validationToken || this.active.has(id) || this.cancelling.has(id)) throw new ResourceError(400, 'Core authorization expired or was consumed; prepare again.');
    this.prepared.delete(id);
    const finished = this.executeGuest(id, { ...request, validationToken: ticket.guestToken }).finally(() => this.active.delete(id));
    this.active.set(id, finished);
    return finished;
  }
  private async executeGuest(id: string, request: Record<string, any>) {
    const value = await this.guest(id, 'execute', request);
    if (typeof value.started !== 'boolean' || value.settled !== true) uncertain();
    if (value.error !== undefined) {
      if (typeof value.error !== 'string' || value.error.length > 512) uncertain();
      return { started: value.started, settled: true, error: value.error };
    }
    const result = value.result;
    if (!value.started || !result || typeof result !== 'object') uncertain();
    if (result.type === 'image') {
      if (request.kind !== 'read' || !['image/png','image/jpeg'].includes(result.mimeType) || typeof result.data !== 'string' || result.data.length > 2_796_204 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.data)) uncertain();
      const bytes = Buffer.from(result.data, 'base64');
      if (bytes.length > 2 * 1024 * 1024) uncertain();
      let dimensions;
      if (result.mimeType === 'image/jpeg') dimensions = jpegDimensions(bytes);
      else {
        if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii',12,16) !== 'IHDR') uncertain();
        dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
      }
      if (dimensions.width !== result.width || dimensions.height !== result.height || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 4096 || dimensions.height > 4096 || dimensions.width * dimensions.height > 16000000) uncertain();
    } else if (result.type !== 'text' || (request.kind === 'bash'
      ? !Number.isInteger(result.exitCode) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || result.stdout.length > 50000 || result.stderr.length > 50000
      : typeof result.text !== 'string' || result.text.length > 50000)) uncertain();
    const string = (key: string, max: number) => {
      if (typeof result[key] !== 'string' || Buffer.byteLength(result[key]) > max) uncertain();
      return result[key] as string;
    };
    const path = string(request.kind === 'bash' ? 'cwd' : 'path', 16384);
    let safe: Record<string, unknown>;
    if (result.type === 'image') safe = { type: 'image', path, mimeType: result.mimeType, data: result.data, width: result.width, height: result.height, firstFrameOnly: true };
    else if (request.kind === 'bash') {
      if (typeof result.truncated?.stdout !== 'boolean' || typeof result.truncated?.stderr !== 'boolean') uncertain();
      safe = { type: 'text', cwd: path, exitCode: result.exitCode, stdout: string('stdout',25000), stderr: string('stderr',25000), truncated: { stdout: result.truncated.stdout, stderr: result.truncated.stderr }, note: string('note',512) };
    } else if (request.kind === 'read') {
      if (typeof result.truncated !== 'boolean' || typeof result.partialLine !== 'boolean' || !Number.isSafeInteger(result.offset) || result.offset < 1 || !Number.isInteger(result.lines) || result.lines < 0 || result.lines > 2000 || (result.nextOffset !== null && (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= result.offset))) uncertain();
      safe = { type: 'text', path, text: string('text',50000), offset: result.offset, lines: result.lines, truncated: result.truncated, partialLine: result.partialLine, nextOffset: result.nextOffset, note: string('note',512) };
    } else {
      if (!Number.isInteger(result.bytes) || result.bytes < 0 || result.bytes > 16 * 1024 * 1024 || typeof result.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(result.sha256)) uncertain();
      safe = { type: 'text', path, text: string('text',512), bytes: result.bytes, sha256: result.sha256 };
    }
    return { started: true, settled: true, result: safe };
  }
  async cancel(id: string): Promise<{ settled: boolean }> {
    const previous = this.cancelling.get(id); if (previous) return previous;
    this.prepared.delete(id); this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    const active = this.active.get(id);
    const finished = (async () => {
      const value = await this.guest(id, 'cancel', {});
      if (value.settled !== true) uncertain();
      // Join even an earlier Docker exec whose delivery was delayed past guest cancellation.
      await active?.catch(() => {});
      return { settled: true };
    })().finally(() => this.cancelling.delete(id));
    this.cancelling.set(id, finished);
    return finished;
  }
}
