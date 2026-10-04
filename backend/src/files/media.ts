import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** What a model receives for an image: at most this many pixels on the long side, and at most 2 MiB. */
const MAX_SIDE = 2048;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** PDFs larger than this are not opened in the backend (copy one to a computer instead). */
export const MAX_PDF_BYTES = 64 * 1024 * 1024;
const PDF_TEXT_PAGES = 20;
const PDF_TEXT_CHARACTERS = 50_000;

export class MediaError extends Error {}

/** Decoding is refused above this (a 48-megapixel photo fits; about 160 MB of pixels at most). */
const MAX_DECODE_PIXELS = 40_000_000;
const MAX_DECODE_SIDE = 20_000;

/**
 * Width and height from the header alone (PNG, JPEG, GIF, WebP), so a small file declaring enormous dimensions (a
 * decompression bomb from untrusted chat or Discord) is refused before it is decoded. Null when unreadable.
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.toString('ascii', 12, 16) === 'IHDR')
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data.length >= 10 && data.toString('ascii', 0, 3) === 'GIF')
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  if (data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = data.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const bits = data.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    return null;
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let at = 2;
    while (at + 9 < data.length) {
      if (data[at] !== 0xff) return null;
      const marker = data[at + 1]!;
      if (marker === 0xff) {
        at++;
        continue;
      }
      // Start of frame (baseline, progressive, …): height then width.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { width: data.readUInt16BE(at + 7), height: data.readUInt16BE(at + 5) };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      at += 2 + data.readUInt16BE(at + 2);
    }
  }
  return null;
}

async function decode(bytes: Uint8Array) {
  const size = imageDimensions(bytes);
  if (!size) throw new MediaError('This image could not be decoded.');
  if (size.width > MAX_DECODE_SIDE || size.height > MAX_DECODE_SIDE || size.width * size.height > MAX_DECODE_PIXELS)
    throw new MediaError(`This image is too large to open (${size.width}×${size.height}).`);
  try {
    return await loadImage(Buffer.from(bytes));
  } catch {
    throw new MediaError('This image could not be decoded.');
  }
}

/** Re-encodes an image (a JPEG screenshot, say) as PNG at its own size. */
export async function toPng(bytes: Uint8Array) {
  const image = await decode(bytes);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.encode('png');
}

/** Decodes an image (PNG, JPEG, GIF first frame, WebP) and re-encodes it small enough for a model. */
export async function fitImage(bytes: Uint8Array) {
  const image = await decode(bytes);
  if (!image.width || !image.height) throw new MediaError('This image has no pixels.');
  let scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  for (let attempt = 0; attempt < 4; attempt++, scale *= 0.7) {
    const width = Math.max(1, Math.round(image.width * scale)),
      height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; // transparent areas read as white, as most viewers show them
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const data = await canvas.encode('jpeg', 85);
    if (data.length <= MAX_IMAGE_BYTES)
      return {
        data,
        mimeType: 'image/jpeg' as const,
        width,
        height,
        original: { width: image.width, height: image.height },
      };
  }
  throw new MediaError('This image is too detailed to send to the model.');
}

let pdfjs: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined;
/** Opens a PDF (pdf.js runs no eval; XFA and system/remote fonts are off); the caller must close it. */
async function openPdf(bytes: Uint8Array) {
  if (bytes.length > MAX_PDF_BYTES) throw new MediaError('This PDF is too large to open here. Copy it to a computer.');
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  const library = await pdfjs;
  const task = library.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    standardFontDataUrl: join(
      dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')),
      'standard_fonts/',
    ),
    verbosity: 0,
  });
  try {
    return { document: await task.promise, close: () => task.destroy() };
  } catch {
    await task.destroy();
    throw new MediaError('This PDF could not be opened (it may be damaged or encrypted).');
  }
}

/** Text of a range of pages, bounded; says where to continue. */
export async function pdfText(bytes: Uint8Array, firstPage = 1) {
  const { document, close } = await openPdf(bytes);
  try {
    const pages = document.numPages;
    if (firstPage < 1 || firstPage > pages) throw new MediaError(`This PDF has ${pages} pages.`);
    const parts: string[] = [];
    let length = 0,
      page = firstPage;
    for (; page <= pages && page < firstPage + PDF_TEXT_PAGES && length < PDF_TEXT_CHARACTERS; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      let text = '';
      for (const item of content.items) if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '');
      const section = `--- Page ${page} ---\n${text.trim() || '(no extractable text: view this page as an image)'}\n`;
      parts.push(section.slice(0, PDF_TEXT_CHARACTERS - length));
      length += section.length;
    }
    return { pages, from: firstPage, to: page - 1, text: parts.join('\n'), nextPage: page <= pages ? page : null };
  } finally {
    await close();
  }
}

/** One page rendered to an image a model can look at. */
export async function pdfPage(bytes: Uint8Array, pageNumber: number) {
  const { document, close } = await openPdf(bytes);
  try {
    if (pageNumber < 1 || pageNumber > document.numPages)
      throw new MediaError(`This PDF has ${document.numPages} pages.`);
    const page = await document.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, MAX_SIDE / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context as never, viewport, canvas: canvas as never }).promise;
    const data = await canvas.encode('jpeg', 85);
    return {
      data,
      mimeType: 'image/jpeg' as const,
      pages: document.numPages,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    await close();
  }
}
