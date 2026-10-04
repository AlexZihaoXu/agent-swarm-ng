import { expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { checkedStop } from './recordings';

it("checks the recorder's answer: bounded names, a folder in the home, a real JPEG sheet", async () => {
  const jpeg = (await createCanvas(64, 32).encode('jpeg')).toString('base64');
  const result = checkedStop(
    {
      folder: '/etc/cron.d',
      files: [
        { name: `clip‮${'x'.repeat(400)}`, size: 2048, seconds: 3 },
        { name: 'bad', size: -1 },
        ...Array.from({ length: 80 }, (_, i) => ({ name: `f${i}`, size: 1 })),
      ],
      sheet: { mimeType: 'image/jpeg', data: jpeg, width: 99999, height: 1 },
    },
    '/home/agent/Videos/demo',
  );
  expect(result.folder).toBe('/home/agent/Videos/demo');
  // At most 50 looked at; the invalid one among them is dropped.
  expect(result.files).toHaveLength(49);
  expect(result.files[0]!.name).toHaveLength(255);
  expect(result.files[0]!.name).not.toContain('‮');
  expect(result.sheet).toMatchObject({ width: 64, height: 32 });
  expect(
    checkedStop({ folder: '/home/agent/x', files: [], sheet: { data: 'aGVsbG8=' } }, '/home/agent/y').sheet,
  ).toBeNull();
  expect(checkedStop(null, '/home/agent/y')).toMatchObject({ folder: '/home/agent/y', files: [] });
});
