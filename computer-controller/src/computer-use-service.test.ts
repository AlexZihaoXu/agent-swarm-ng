import { describe, expect, it, vi } from 'vitest';
import { ComputerUseService, jpegDimensions } from './computer-use-service';
import { captureGeometry } from './computer-use';
const token = 'edc242f0-06f3-4a19-a941-6c3935e44f87';
const state = { sourceWidth: 1920, sourceHeight: 1080, pointer: { x: 0, y: 0 } };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const combo = { actions: [{ type: 'mouse.left_click' }], validationToken: token };
function jpeg(width: number, height: number) {
  const bytes = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0, 255, 217]);
  bytes.writeUInt16BE(height, 7); bytes.writeUInt16BE(width, 9);
  return bytes;
}
describe('ComputerUseService', () => {
  it('validates before executing and preserves started:false receipt', async () => {
    const exec = vi.fn(async (_id, mode) => encode(mode === 'state' ? state : { started: false, completed: 0, error: 'Cancelled generation.' }));
    const service = new ComputerUseService(exec);
    expect(await service.execute('id', { actions: [{ type: 'keyboard.down', key: 'a' }], validationToken: token })).toMatchObject({ started: false, completed: 0 });
    expect(exec.mock.calls.map(call => call[1])).toEqual(['state']);
    expect(await service.execute('id', combo)).toMatchObject({ started: false, error: 'Cancelled generation.' });
    expect(exec.mock.calls.map(call => call[1])).toEqual(['state', 'state', 'execute']);
  });
  it('returns guest generation and exact fresh pointer timing', async () => {
    const exec = vi.fn(async (_id, mode) => encode(mode === 'state' ? state : { ...state, valid: true, validationToken: token, actionSeconds: .02, totalSeconds: .02 }));
    expect(await new ComputerUseService(exec).validate('id', combo)).toMatchObject({ valid: true, validationToken: token });
  });
  it('never retries uncertain execution or accepts uncertain cancellation', async () => {
    const exec = vi.fn(async (_id, mode) => { if (mode === 'state') return encode(state); throw new Error('Connection lost'); });
    const service = new ComputerUseService(exec);
    await expect(service.execute('id', combo)).rejects.toThrow('Connection lost');
    expect(exec).toHaveBeenCalledTimes(2);
    await expect(service.cancel('id')).rejects.toThrow();
    await expect(new ComputerUseService(async () => encode({ settled: false })).cancel('id')).rejects.toThrow('uncertain');
  });
  it('rejects bogus progress and accepts explicit settled acknowledgement', async () => {
    const service = new ComputerUseService(async (_id, mode) => encode(mode === 'state' ? state : { started: false, completed: 1, error: null }));
    await expect(service.execute('id', combo)).rejects.toThrow('uncertain');
    expect(await new ComputerUseService(async () => encode({ settled: true })).cancel('id')).toEqual({ settled: true });
  });
  it('validates JPEG bytes, actual dimensions, bounds and guest response caps', async () => {
    const request = { kind: 'glance' };
    const geometry = captureGeometry(request, 1920, 1080);
    const image = { ...state, ...geometry, mimeType: 'image/jpeg', data: jpeg(634, 356).toString('base64') };
    expect(await new ComputerUseService(async () => encode(image)).capture('id', request)).toMatchObject({ width: 634, height: 356 });
    for (const invalid of [{ ...image, bounds: [0, 0, 998, 999] }, { ...image, data: jpeg(600, 356).toString('base64') }, { ...image, data: 'not an image' }, { ...image, sourceWidth: 99999 }]) {
      await expect(new ComputerUseService(async () => encode(invalid)).capture('id', request)).rejects.toThrow('uncertain');
    }
  });
  it('normalizes known guest pre-execution rejection without claiming it started', async () => {
    const service = new ComputerUseService(async (_id, mode) => encode(mode === 'state' ? state : { rejected: true, error: 'Another operation is active.' }));
    expect(await service.execute('id', combo)).toEqual({ started: false, completed: 0, error: 'Another operation is active.' });
  });
});
describe('jpegDimensions', () => {
  it('reads frame bounds but rejects short or missing frame headers', () => {
    expect(jpegDimensions(jpeg(634, 356))).toEqual({ width: 634, height: 356 });
    for (const input of [Buffer.alloc(0), Buffer.from([255, 216, 255, 217]), Buffer.from([255, 216, 255, 192, 255, 255, 255, 217])]) expect(() => jpegDimensions(input)).toThrow();
  });
});
