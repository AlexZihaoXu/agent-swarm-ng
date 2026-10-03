/** What the chat can do with a file: show an image, play a video, preview text, read a PDF, or only offer a download. */
export type FileKind = 'image' | 'video' | 'text' | 'pdf' | 'other';

const textTypes: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  py: 'text/x-python',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  sh: 'text/x-shellscript',
};
const extension = (name: string) => name.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1] ?? '';
const starts = (head: Uint8Array, bytes: number[], at = 0) => bytes.every((byte, index) => head[at + index] === byte);
const ascii = (text: string) => [...text].map(character => character.charCodeAt(0));
/** ISO media brands that are video (MP4, M4V, QuickTime, 3GP); others (M4A audio, HEIC/AVIF images) are not. */
const VIDEO_BRANDS = /^(isom|iso[2-9]|mp4[12]|avc1|M4V[ HP]|qt {2}|dash|3gp[4-9]|3g2[a-c]|mmp4|f4v )$/;
function videoType(head: Uint8Array) {
  if (starts(head, ascii('ftyp'), 4)) {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (VIDEO_BRANDS.test(brand)) return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  if (starts(head, [0x1a, 0x45, 0xdf, 0xa3]) && new TextDecoder().decode(head.subarray(0, 64)).includes('webm'))
    return 'video/webm';
  return null;
}

/** Looks like UTF-8 text: no NUL bytes and valid UTF-8 (a character cut at the end of the sample is fine). */
function isText(head: Uint8Array) {
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return true;
  } catch {
    // The sample may end inside a multi-byte character.
    for (let cut = 1; cut <= 3 && cut < head.length; cut++)
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, head.length - cut));
        return true;
      } catch {
        /* try a shorter cut */
      }
    return false;
  }
}

/**
 * The kind and media type of a file from its first bytes (never trusting the name alone for images or PDFs).
 * SVG and HTML count as text: they are previewed as source, never rendered.
 */
export function detectFile(name: string, head: Uint8Array): { kind: FileKind; mime: string } {
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png' };
  if (starts(head, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' };
  if (starts(head, ascii('GIF87a')) || starts(head, ascii('GIF89a'))) return { kind: 'image', mime: 'image/gif' };
  if (starts(head, ascii('RIFF')) && starts(head, ascii('WEBP'), 8)) return { kind: 'image', mime: 'image/webp' };
  const video = videoType(head);
  if (video) return { kind: 'video', mime: video };
  if (starts(head, ascii('%PDF-'))) return { kind: 'pdf', mime: 'application/pdf' };
  const ext = extension(name);
  if (head.length === 0 || isText(head)) return { kind: 'text', mime: textTypes[ext] ?? 'text/plain' };
  return { kind: 'other', mime: 'application/octet-stream' };
}

/**
 * Invisible characters that can disguise a name: bidi controls (U+061C, U+200E/F, U+202A–E, U+2066–9, which can make
 * "invoice\u202Efdp.exe" display as "invoiceexe.pdf") and zero-width or invisible formatting (U+180E, U+200B,
 * U+2060–4, U+FEFF). The joiners U+200C/D stay: scripts and emoji need them.
 */
export const INVISIBLE_NAME_CHARACTERS =
  /[\u061c\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** A safe display name: no folders, control or invisible characters, or leading dots; at most 255 characters. */
export function fileName(raw: string) {
  const base = String(raw ?? '')
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '')
    .replace(INVISIBLE_NAME_CHARACTERS, '')
    .trim()
    .replace(/^\.+/, '');
  return (base || 'file').slice(0, 255);
}
