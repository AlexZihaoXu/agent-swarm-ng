import { expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';
import { fitImage, imageDimensions } from './media';

const crc = (bytes: Buffer) => {
  let value = ~0;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return ~value >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), body.length + 4);
  return out;
};
/** A few hundred bytes declaring a 40000×40000 image: decoding it would take about 6 GB. */
function bombPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(40_000, 0);
  header.writeUInt32BE(40_000, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(1024))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

it('reads image sizes from headers and refuses a decompression bomb before decoding it', async () => {
  const canvas = createCanvas(320, 200);
  canvas.getContext('2d').fillRect(0, 0, 10, 10);
  for (const format of ['png', 'jpeg', 'webp'] as const)
    expect(imageDimensions(await canvas.encode(format as 'png')), format).toEqual({ width: 320, height: 200 });
  expect(imageDimensions(Buffer.from('not an image'))).toBeNull();
  const bomb = bombPng();
  expect(imageDimensions(bomb)).toEqual({ width: 40_000, height: 40_000 });
  await expect(fitImage(bomb)).rejects.toThrow('too large to open');
  expect((await fitImage(await canvas.encode('png'))).original).toEqual({ width: 320, height: 200 });
});
