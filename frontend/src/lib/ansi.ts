// Colour/style (SGR) escapes to styled text runs, for the live terminal previews. Only SGR is understood; the
// guest strips every other escape before sending a screen. Colours follow xterm.js's default palette, which the
// terminal window uses, so a preview looks like the terminal.

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

/** xterm's 256-colour table: 16 named colours, a 6×6×6 cube, then 24 greys. */
export function color256(index: number): string {
  if (index < 16) return PALETTE[index];
  if (index < 232) {
    const n = index - 16;
    const level = (value: number) => (value ? value * 40 + 55 : 0);
    return `rgb(${level(Math.floor(n / 36))}, ${level(Math.floor(n / 6) % 6)}, ${level(n % 6)})`;
  }
  const grey = (index - 232) * 10 + 8;
  return `rgb(${grey}, ${grey}, ${grey})`;
}

export type Style = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
};
export type Run = { text: string; style: Style };

/** Applies one SGR parameter list (e.g. "1;38;5;208") to a style. */
function apply(style: Style, params: string): Style {
  const codes = params === '' ? [0] : params.split(/[;:]/).map(part => (part === '' ? 0 : Number(part)));
  const next = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) for (const key of Object.keys(next) as (keyof Style)[]) delete next[key];
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 27) delete next.inverse;
    else if (code >= 30 && code <= 37) next.fg = PALETTE[code - 30];
    else if (code >= 90 && code <= 97) next.fg = PALETTE[code - 90 + 8];
    else if (code === 39) delete next.fg;
    else if (code >= 40 && code <= 47) next.bg = PALETTE[code - 40];
    else if (code >= 100 && code <= 107) next.bg = PALETTE[code - 100 + 8];
    else if (code === 49) delete next.bg;
    else if (code === 38 || code === 48) {
      const key = code === 38 ? 'fg' : 'bg';
      if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        next[key] = color256(Math.min(255, codes[i + 2]));
        i += 2;
      } else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) {
        next[key] = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
        i += 4;
      }
    }
  }
  return next;
}

/** A screen of text with SGR escapes, as lines of styled runs. */
export function parseAnsi(screen: string): Run[][] {
  let style: Style = {};
  return screen.split('\n').map(line => {
    const runs: Run[] = [];
    let position = 0;
    for (const match of line.matchAll(/\x1b\[([0-9;:]*)m/g)) {
      if (match.index > position) runs.push({ text: line.slice(position, match.index), style });
      style = apply(style, match[1]);
      position = match.index + match[0].length;
    }
    if (position < line.length) runs.push({ text: line.slice(position), style });
    return runs;
  });
}
