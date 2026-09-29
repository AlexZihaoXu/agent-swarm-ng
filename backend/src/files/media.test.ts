import { expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { fitImage, MediaError, pdfPage, pdfText } from './media';

// A one-page PDF with "Hello PDF" in Helvetica (a standard font).
const pdf = new TextEncoder().encode(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 20 100 Td (Hello PDF) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`);

it('shrinks large images to at most 2048px on the long side as JPEG, keeping small ones at size', async () => {
  const canvas = createCanvas(4000, 1000);
  canvas.getContext('2d').fillRect(0, 0, 10, 10);
  const big = await fitImage(await canvas.encode('png'));
  expect(big).toMatchObject({ mimeType: 'image/jpeg', width: 2048, height: 512, original: { width: 4000 } });
  const small = await fitImage(await createCanvas(30, 20).encode('png'));
  expect(small).toMatchObject({ width: 30, height: 20 });
  await expect(fitImage(new TextEncoder().encode('not an image'))).rejects.toBeInstanceOf(MediaError);
});

it('reads PDF text by page and renders a page as an image', async () => {
  expect(await pdfText(pdf)).toMatchObject({ pages: 1, from: 1, to: 1, nextPage: null });
  expect((await pdfText(pdf)).text).toContain('Hello PDF');
  await expect(pdfText(pdf, 2)).rejects.toThrow('1 pages');
  const page = await pdfPage(pdf, 1);
  // Small pages render at up to 3x their size, large ones fit 2048px.
  expect(page).toMatchObject({ mimeType: 'image/jpeg', pages: 1, width: 600, height: 600 });
  await expect(pdfText(new TextEncoder().encode('%PDF-1.4 garbage'))).rejects.toBeInstanceOf(MediaError);
});
