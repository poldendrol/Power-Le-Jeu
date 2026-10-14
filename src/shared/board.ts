// The board, as a graph of sectors, copied from the original layout: four
// territories of nine sectors (0-8, sector 4 in the middle) each surrounded by
// sea, a headquarters in each corner, the North, South, East and West islands
// between territories along the edges and Island X in the centre, and twelve sea sectors
// (an outer strip along each side of each territory, plus four channels).

export type Color = 'red' | 'blue' | 'yellow' | 'green';
export const COLORS: Color[] = ['yellow', 'green', 'red', 'blue']; // clockwise from top left
export const LETTER: Record<Color, string> = { red: 'R', blue: 'B', yellow: 'Y', green: 'G' };
export const COLOR_NAME: Record<Color, string> = { red: 'Red', blue: 'Blue', yellow: 'Yellow', green: 'Green' };

export type SectorKind = 'land' | 'hq' | 'island' | 'sea';
export interface Sector {
  id: number;
  code: string;          // R4, S3, IX, HQ-R …
  name: string;          // display name
  kind: SectorKind;
  territory?: Color;     // for land and hq
  num?: number;          // territory sector number 0-8
  cells: [number, number][];
  anchor: [number, number]; // cell where pieces are drawn
  adj: number[];
  coastal: boolean;      // land sector a ship may enter
}

// Each token is one cell of a 9×9 grid. Territory sectors are numbered from
// the HQ corner (0) to the corner facing Island X (8).
const MAP = `
QY  S1  S1  S1  IN  S2  S2  S2  QG
S11 Y0  Y1  Y2  S3  G2  G1  G0  S4
S11 Y3  Y4  Y5  S3  G5  G4  G3  S4
S11 Y6  Y7  Y8  S3  G8  G7  G6  S4
IW  S12 S12 S12 IX  S6  S6  S6  IE
S10 B6  B7  B8  S9  R8  R7  R6  S5
S10 B3  B4  B5  S9  R5  R4  R3  S5
S10 B0  B1  B2  S9  R2  R1  R0  S5
QB  S8  S8  S8  IS  S7  S7  S7  QR`;

// Drawing sizes: sea strips and channels are narrower than land sectors.
const SIZES = [66, 76, 76, 76, 58, 76, 76, 76, 66];
export const COL_X = SIZES.reduce<number[]>((a, w, i) => [...a, i ? a[i - 1] + SIZES[i - 1] : 0], []);
export const COL_W = SIZES;
export const ROW_Y = COL_X;
export const ROW_H = SIZES;
export const BOARD_SIZE = SIZES.reduce((a, b) => a + b, 0);

export const GRID = MAP.trim().split('\n').map(r => r.trim().split(/\s+/));
export const GW = GRID[0].length;
export const GH = GRID.length;

const BY_LETTER: Record<string, Color> = { R: 'red', B: 'blue', Y: 'yellow', G: 'green' };
const ISLANDS: Record<string, string> = { IN: 'North Island', IS: 'South Island', IE: 'East Island', IW: 'West Island', IX: 'Island X' };

function build(): Sector[] {
  const codes = [...new Set(GRID.flat().filter(t => t !== '--'))];
  const sectors: Sector[] = codes.map((code, id) => {
    const cells: [number, number][] = [];
    GRID.forEach((row, y) => row.forEach((t, x) => { if (t === code) cells.push([x, y]); }));
    const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length, cy = cells.reduce((s, c) => s + c[1], 0) / cells.length;
    const anchor = [...cells].sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy))[0];
    const base = { id, code, cells, anchor, adj: [], coastal: false };
    if (code.startsWith('Q')) { const t = BY_LETTER[code[1]]; return { ...base, code: `HQ-${code[1]}`, name: `HQ ${code[1]}`, kind: 'hq', territory: t }; }
    if (ISLANDS[code]) return { ...base, name: ISLANDS[code], kind: 'island' };
    if (code.startsWith('S')) return { ...base, name: `Sea ${code.slice(1)}`, kind: 'sea' };
    return { ...base, name: code, kind: 'land', territory: BY_LETTER[code[0]], num: Number(code.slice(1)) };
  });
  const idOf = new Map(codes.map((c, i) => [c, i]));
  for (const s of sectors) {
    const set = new Set<number>();
    for (const [x, y] of s.cells) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const t = GRID[y + dy]?.[x + dx];
      if (!t || t === '--') continue;
      const n = idOf.get(t)!;
      if (n === s.id) continue;
      // Sea sectors never touch each other directly: changing sea needs an island or a territory.
      if (s.kind === 'sea' && sectors[n].kind === 'sea') continue;
      set.add(n);
    }
    s.adj = [...set].sort((a, b) => a - b);
  }
  for (const s of sectors) s.coastal = s.kind === 'land' && s.num !== 4 && s.adj.some(n => sectors[n].kind === 'sea');
  return sectors;
}

export const SECTORS = build();
export const sectorAt = (x: number, y: number) => {
  const t = GRID[y]?.[x];
  return !t || t === '--' ? undefined : SECTORS.find(s => s.cells.some(c => c[0] === x && c[1] === y));
};
export const hqOf = (c: Color) => SECTORS.find(s => s.kind === 'hq' && s.territory === c)!.id;
export const byCode = (code: string) => SECTORS.find(s => s.code === code)!.id;
