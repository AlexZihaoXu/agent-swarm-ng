import { controllerHeaders } from '../controller-auth';
import {
  ComputerUseError,
  ComputerExecutionError,
  type ActionReceipt,
  type CoreReceipt,
  type ComputerRuntime,
  type ScreenFrame,
} from './service';
const MAX_RESPONSE = 3 * 1024 * 1024;

/** Fixed internal controller origin; commands target only the inspected authorized guest, never the host. */
export class HttpComputerRuntime implements ComputerRuntime {
  constructor(
    private url: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    id: string,
    path: string,
    input: unknown,
    signal?: AbortSignal,
    timeout = 20_000,
  ): Promise<Record<string, any>> {
    const response = await this.fetcher(new URL(`/computers/${encodeURIComponent(id)}/${path}`, this.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...controllerHeaders() },
      body: JSON.stringify(input),
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Controller response unavailable.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_RESPONSE) {
          await reader.cancel();
          throw new Error('Controller response exceeds its bound.');
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    let body: Record<string, any>;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new Error('Invalid controller response.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid controller response.');
    if (!response.ok) {
      if (response.status === 400)
        throw new ComputerUseError(
          `${String(body.message ?? body.error ?? 'Invalid action combo.').slice(0, 512)} Read Swarm Knowledge ${
            (input as { kind?: string } | undefined)?.kind === 'terminal' ? 'practices/terminals' : 'practices/desktop'
          }.`,
        );
      throw new ComputerUseError('Computer execution unavailable; do not retry input blindly.', 503);
    }
    return body;
  }
  async capture(id: string, request: unknown, signal?: AbortSignal): Promise<ScreenFrame> {
    const result = await this.request(id, 'capture', request, signal);
    if (
      result.mimeType !== 'image/jpeg' ||
      typeof result.data !== 'string' ||
      !Array.isArray(result.bounds) ||
      result.bounds.length !== 4 ||
      result.bounds.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 999) ||
      !Number.isInteger(result.width) ||
      !Number.isInteger(result.height) ||
      result.width < 1 ||
      result.height < 1 ||
      result.width > 4096 ||
      result.height > 4096
    )
      throw new Error('Invalid screenshot metadata.');
    const data = Buffer.from(result.data, 'base64');
    if (
      data.byteLength > 2 * 1024 * 1024 ||
      data[0] !== 255 ||
      data[1] !== 216 ||
      data.at(-2) !== 255 ||
      data.at(-1) !== 217
    )
      throw new Error('Invalid screenshot.');
    return { mimeType: result.mimeType, data, bounds: result.bounds, width: result.width, height: result.height };
  }
  async validate(id: string, request: unknown, signal?: AbortSignal) {
    const result = await this.request(id, 'actions/validate', request, signal);
    if (result.valid !== true || typeof result.validationToken !== 'string')
      throw new Error('Invalid action validation.');
    return { ...(request as object), validationToken: result.validationToken };
  }
  async execute(id: string, request: unknown, signal?: AbortSignal): Promise<ActionReceipt> {
    try {
      const result = await this.request(id, 'actions', request, signal, 16_000);
      if (
        typeof result.started !== 'boolean' ||
        !Number.isInteger(result.completed) ||
        result.completed < 0 ||
        result.completed > 16 ||
        (result.error !== null && typeof result.error !== 'string')
      )
        throw new Error('Invalid action receipt.');
      return result as ActionReceipt;
    } catch (error) {
      if (error instanceof ComputerUseError && error.status === 400)
        return { started: false, completed: 0, error: error.message };
      // Fetch cancellation is not guest cancellation. Fence and join before reporting stop.
      await this.cancel(id);
      throw new ComputerExecutionError(
        'Combo interrupted or its result is uncertain. Input is now settled, but completed effects remain; take a fresh look rather than repeating it.',
        true,
      );
    }
  }
  async prepareCore(id: string, request: unknown, signal?: AbortSignal) {
    const result = await this.request(id, 'core/prepare', request, signal);
    if (typeof result.validationToken !== 'string' || !/^[0-9a-f-]{36}$/.test(result.validationToken))
      throw new ComputerUseError('Invalid core authorization receipt.', 503);
    return { ...(request as object), validationToken: result.validationToken };
  }
  async core(id: string, request: unknown, signal?: AbortSignal): Promise<CoreReceipt> {
    try {
      const result = await this.request(id, 'core/execute', request, signal, 140_000);
      if (
        typeof result.started !== 'boolean' ||
        result.settled !== true ||
        (result.error !== undefined && typeof result.error !== 'string') ||
        (!result.error && (!result.result || typeof result.result !== 'object'))
      )
        throw new Error('Invalid core operation receipt.');
      return result as CoreReceipt;
    } catch (error) {
      if (error instanceof ComputerUseError && error.status === 400)
        return { started: false, settled: true, error: error.message };
      await this.cancel(id);
      throw new ComputerExecutionError(
        'Core operation interrupted or result uncertain. Request delivery is settled; persistent terminal programs and other effects may remain. Inspect before retrying.',
        true,
      );
    }
  }
  async cancel(id: string) {
    const core = await this.request(id, 'core/cancel', {}, undefined, 20_000);
    if (core.settled !== true) throw new Error('Core command cancellation could not be confirmed.');
    const result = await this.request(id, 'actions/cancel', {}, undefined, 20_000);
    if (result.settled !== true) throw new Error('Computer input cancellation could not be confirmed.');
  }
}
