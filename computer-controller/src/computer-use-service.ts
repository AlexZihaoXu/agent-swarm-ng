import {
  captureGeometry,
  MAX_IMAGE_BYTES,
  MAX_USE_BODY,
  validateCapture,
  validateCombo,
  validateDesktop,
  type ActionResult,
  type CaptureResult,
  type DesktopState,
  type ValidationResult,
} from './computer-use';
import { ResourceError } from './resources';

type GuestMode = 'state' | 'capture' | 'validate' | 'execute' | 'cancel';
type GuestExec = (id: string, mode: GuestMode, input: unknown) => Promise<Buffer>;
const unavailable = (): never => {
  throw new ResourceError(
    503,
    'Invalid or uncertain guest computer-use response. Cancel and settle before transferring control.',
  );
};
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/** Read bounded JPEG SOF dimensions before accepting guest-controlled compressed bytes. */
export function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217)
    return unavailable();
  let offset = 2;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 255) return unavailable();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return unavailable();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return unavailable();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) return unavailable();
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return unavailable();
}

/** Request/response boundary only; no retries, image cache or implicit HTTP-disconnect cancellation. */
export class ComputerUseService {
  constructor(private readonly exec: GuestExec) {}
  private async guest(id: string, mode: GuestMode, input: unknown): Promise<Record<string, unknown>> {
    if (Buffer.byteLength(JSON.stringify(input)) > MAX_USE_BODY)
      throw new ResourceError(400, 'Request exceeds 64 KiB.');
    const raw = await this.exec(id, mode, input);
    if (raw.length > 3 * 1024 * 1024) unavailable();
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(raw.toString());
    } catch {
      return unavailable();
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
    if ('rejected' in value) {
      if (typeof value.error !== 'string' || value.error.length > 512) unavailable();
      throw new ResourceError(value.rejected === true ? 400 : 503, value.error as string);
    }
    return value;
  }
  private state(value: Record<string, unknown>): DesktopState {
    const pointer = value.pointer as { x?: number; y?: number } | undefined;
    const state = {
      width: value.sourceWidth,
      height: value.sourceHeight,
      x: pointer?.x,
      y: pointer?.y,
    } as DesktopState;
    try {
      validateDesktop(state);
    } catch {
      return unavailable();
    }
    return state;
  }
  async capture(id: string, input: unknown): Promise<CaptureResult> {
    const request = validateCapture(input);
    const result = await this.guest(id, 'capture', request);
    if (
      result.mimeType !== 'image/jpeg' ||
      typeof result.data !== 'string' ||
      result.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(result.data)
    )
      unavailable();
    const bytes = Buffer.from(result.data as string, 'base64');
    if (
      bytes.length > MAX_IMAGE_BYTES ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes.at(-2) !== 255 ||
      bytes.at(-1) !== 217
    )
      unavailable();
    let expected: ReturnType<typeof captureGeometry>;
    try {
      expected = captureGeometry(request, result.sourceWidth as number, result.sourceHeight as number);
    } catch {
      return unavailable();
    }
    const dimensions = jpegDimensions(bytes);
    if (
      dimensions.width !== expected.width ||
      dimensions.height !== expected.height ||
      result.width !== expected.width ||
      result.height !== expected.height ||
      !Array.isArray(result.bounds) ||
      result.bounds.length !== 4 ||
      result.bounds.some((value, i) => !finite(value) || Math.abs(value - expected.bounds[i]) > 1e-9)
    )
      unavailable();
    return result as CaptureResult;
  }
  async validate(id: string, input: unknown): Promise<ValidationResult> {
    const state = this.state(await this.guest(id, 'state', {}));
    validateCombo(input, state);
    const result = await this.guest(id, 'validate', input);
    const actual = this.state(result);
    const plan = validateCombo(input, actual);
    if (
      result.valid !== true ||
      typeof result.validationToken !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(result.validationToken) ||
      !finite(result.actionSeconds) ||
      !finite(result.totalSeconds) ||
      Math.abs((result.actionSeconds as number) - plan.actionSeconds) > 1e-9 ||
      Math.abs((result.totalSeconds as number) - plan.totalSeconds) > 1e-9
    )
      unavailable();
    return result as ValidationResult;
  }
  async execute(id: string, input: unknown): Promise<ActionResult> {
    // A failed revalidation never starts input and must not consume the backend's allowance.
    try {
      const state = this.state(await this.guest(id, 'state', {}));
      validateCombo(input, state);
      if (
        !input ||
        typeof input !== 'object' ||
        !('validationToken' in input) ||
        typeof input.validationToken !== 'string'
      )
        throw new ResourceError(400, 'Validate the combo before execution.');
    } catch (error) {
      if (error instanceof ResourceError && error.code === 400)
        return { started: false, completed: 0, error: error.message };
      throw error;
    }
    let result: Record<string, unknown>;
    try {
      result = await this.guest(id, 'execute', input);
    } catch (error) {
      if (error instanceof ResourceError && error.code === 400)
        return { started: false, completed: 0, error: error.message };
      throw error;
    }
    const count = (input as unknown as { actions: unknown[] }).actions.length;
    if (
      typeof result.started !== 'boolean' ||
      !Number.isInteger(result.completed) ||
      (result.completed as number) < 0 ||
      (result.completed as number) > count ||
      (result.error !== null && (typeof result.error !== 'string' || result.error.length > 512)) ||
      (!result.started && result.completed !== 0) ||
      (result.error === null && (!result.started || result.completed !== count))
    )
      unavailable();
    return result as ActionResult;
  }
  async cancel(id: string) {
    const result = await this.guest(id, 'cancel', {});
    if (result.settled !== true) unavailable();
    return { settled: true as const };
  }
}
