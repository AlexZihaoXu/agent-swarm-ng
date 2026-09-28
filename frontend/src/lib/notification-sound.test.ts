import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotificationSound } from './notification-sound';

afterEach(() => vi.unstubAllGlobals());
function audio() {
  const start = vi.fn(),
    stop = vi.fn(),
    decode = vi.fn(async () => ({})),
    close = vi.fn(async () => {});
  class Context {
    state = 'suspended';
    destination = {};
    resume = vi.fn(async () => {
      this.state = 'running';
    });
    close = close;
    decodeAudioData = decode;
    createGain = () => ({ gain: { value: 1 }, connect: vi.fn() });
    createBufferSource = () => ({ buffer: null, connect: vi.fn(), disconnect: vi.fn(), start, stop, onended: null });
  }
  vi.stubGlobal('AudioContext', Context);
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', fetcher);
  return { start, stop, decode, close, fetcher };
}
describe('notification sound', () => {
  it('waits for interaction, decodes once, and avoids overlapping sounds', async () => {
    const mock = audio();
    const sound = createNotificationSound();
    await sound.play();
    expect(mock.fetcher).not.toHaveBeenCalled();
    await sound.unlock();
    await sound.play();
    await sound.unlock();
    await sound.play();
    expect(mock.fetcher).toHaveBeenCalledTimes(1);
    expect(mock.decode).toHaveBeenCalledTimes(1);
    expect(mock.start).toHaveBeenCalledTimes(2);
    expect(mock.stop).toHaveBeenCalledTimes(1);
    sound.dispose();
    await sound.play();
    expect(mock.start).toHaveBeenCalledTimes(2);
    expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it('treats unavailable audio and failed downloads as nonfatal', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const unavailable = createNotificationSound();
    await expect(unavailable.unlock()).resolves.toBeUndefined();
    await expect(unavailable.play()).resolves.toBeUndefined();
    unavailable.dispose();
    const mock = audio();
    mock.fetcher.mockRejectedValue(new Error('Offline'));
    const sound = createNotificationSound();
    await sound.unlock();
    await expect(sound.play()).resolves.toBeUndefined();
    expect(mock.start).not.toHaveBeenCalled();
    sound.dispose();
  });
});
