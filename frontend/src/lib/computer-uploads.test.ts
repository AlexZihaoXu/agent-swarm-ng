import { expect, it } from 'vitest';
import { timeLeft, TransferRate, transferSpeed } from './computer-uploads';

it('smooths the speed over the last seconds and estimates the time left', () => {
  const rate = new TransferRate(4000);
  rate.add(0, 0);
  expect(rate.speed).toBeNull();
  rate.add(1_000_000, 1000);
  expect(rate.speed).toBe(1_000_000);
  // A burst long ago stops counting once it leaves the window.
  for (let second = 2; second <= 10; second++) rate.add(1_000_000 + (second - 1) * 500_000, second * 1000);
  expect(rate.speed).toBeCloseTo(500_000, -3);
  expect(rate.remaining(10_000_000)).toBeCloseTo((10_000_000 - 5_500_000) / 500_000, 0);
  expect(transferSpeed(12.3 * 1024 * 1024)).toBe('12.3 MB/s');
  expect(timeLeft(0.2)).toBe('1 s left');
  expect(timeLeft(125)).toBe('3 min left');
  expect(timeLeft(3 * 3600 + 60)).toBe('3 h 1 min left');
});
