import { Resvg } from '@resvg/resvg-js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A terminal view as an image, for agents that ask to see its colours. The guest sends the view's rows with SGR
// (colour/style) escapes only; they are laid out on a monospace grid and rasterised. Colours follow the dashboard
// terminal (xterm.js defaults), like its previews (frontend/src/lib/ansi.ts, which parses the same escapes).

const FONTS = fileURLToPath(new URL('../../assets/fonts', import.meta.url));
const FONT_SIZE = 16;
/** DejaVu Sans Mono's advance is 0.602 em. */
const CELL = { width: FONT_SIZE * 0.602, height: Math.round(FONT_SIZE * 1.25) };
const PAD = 8;
const THEME = { background: '#141414', foreground: '#ededed' };
const PALETTE = [
  '#000000',
  '#cd3131',
  '#0dbc79',
  '#e5e510',
  '#2472c8',
  '#bc3fbc',
  '#11a8cd',
  '#e5e5e5',
  '#666666',
  '#f14c4c',
  '#23d18b',
  '#f5f543',
  '#3b8eea',
  '#d670d6',
  '#29b8db',
  '#e5e5e5',
];
function color256(index: number) {
  if (index < 16) return PALETTE[index];
  if (index < 232) {
    const n = index - 16;
    const level = (value: number) => (value ? value * 40 + 55 : 0);
    return `rgb(${level(Math.floor(n / 36))},${level(Math.floor(n / 6) % 6)},${level(n % 6)})`;
  }
  const grey = (index - 232) * 10 + 8;
  return `rgb(${grey},${grey},${grey})`;
}

type Style = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
};
function apply(style: Style, params: string): Style {
  const codes = params === '' ? [0] : params.split(/[;:]/).map(part => (part === '' ? 0 : Number(part)));
  let next = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) next.bold = next.dim = undefined;
    else if (code === 23) next.italic = undefined;
    else if (code === 24) next.underline = undefined;
    else if (code === 27) next.inverse = undefined;
    else if (code >= 30 && code <= 37) next.fg = PALETTE[code - 30];
    else if (code >= 90 && code <= 97) next.fg = PALETTE[code - 90 + 8];
    else if (code === 39) next.fg = undefined;
    else if (code >= 40 && code <= 47) next.bg = PALETTE[code - 40];
    else if (code >= 100 && code <= 107) next.bg = PALETTE[code - 100 + 8];
    else if (code === 49) next.bg = undefined;
    else if (code === 38 || code === 48) {
      const key = code === 38 ? 'fg' : 'bg';
      if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        next[key] = color256(Math.min(255, codes[i + 2]));
        i += 2;
      } else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) {
        next[key] = `rgb(${codes
          .slice(i + 2, i + 5)
          .map(value => Math.min(255, value))
          .join(',')})`;
        i += 4;
      }
    }
  }
  return next;
}
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An SVG of the rows on a `columns`-wide grid (one cell per code point; wide characters are not special-cased). */
export function terminalSvg(ansi: string, columns: number) {
  const lines = ansi.replace(/\n$/, '').split('\n');
  const width = Math.ceil(columns * CELL.width + PAD * 2);
  const height = lines.length * CELL.height + PAD * 2;
  const shapes: string[] = [];
  const texts: string[] = [];
  let style: Style = {};
  lines.forEach((line, row) => {
    let column = 0;
    const y = PAD + row * CELL.height;
    const run = (text: string) => {
      const cells = [...text];
      if (!cells.length) return;
      const fg = (style.inverse ? style.bg : style.fg) ?? (style.inverse ? THEME.background : THEME.foreground);
      const bg = style.inverse ? (style.fg ?? THEME.foreground) : style.bg;
      const x = PAD + column * CELL.width;
      const w = cells.length * CELL.width;
      if (bg) shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${CELL.height}" fill="${bg}"/>`);
      if (text.trim())
        texts.push(
          `<text x="${x}" y="${y + FONT_SIZE}" fill="${fg}"${style.bold ? ' font-weight="bold"' : ''}${style.italic ? ' font-style="italic"' : ''}${style.dim ? ' opacity="0.6"' : ''}${style.underline ? ' text-decoration="underline"' : ''}>${escape(text)}</text>`,
        );
      column += cells.length;
    };
    let position = 0;
    for (const match of line.matchAll(/\x1b\[([0-9;:]*)m/g)) {
      run(line.slice(position, match.index));
      style = apply(style, match[1]);
      position = match.index + match[0].length;
    }
    run(line.slice(position));
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="DejaVu Sans Mono" font-size="${FONT_SIZE}" xml:space="preserve"><rect width="100%" height="100%" fill="${THEME.background}"/>${shapes.join('')}${texts.join('')}</svg>`;
}

/** The rows rendered as a PNG, as a person would see them in the terminal. */
export function renderTerminal(ansi: string, columns: number) {
  const image = new Resvg(terminalSvg(ansi, columns), {
    font: {
      fontFiles: [join(FONTS, 'DejaVuSansMono.ttf'), join(FONTS, 'DejaVuSansMono-Bold.ttf')],
      loadSystemFonts: false,
      defaultFontFamily: 'DejaVu Sans Mono',
      monospaceFamily: 'DejaVu Sans Mono',
    },
  });
  const rendered = image.render();
  return { data: rendered.asPng(), width: rendered.width, height: rendered.height };
}
