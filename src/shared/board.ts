// The board, as a graph of sectors. The rules page has no picture of the board,
// so this layout is a RECONSTRUCTION built to fit everything the rules say:
// four territories of nine sectors (0-8, sector 4 in the middle), a headquarters
// on the board edge of each, five islands (Nord, Sud, Est, Ouest, X) and twelve
// sea sectors. Replace MAP once we have a photo of the real board.

export type Color = 'red' | 'blue' | 'yellow' | 'green';
export const COLORS: Color[] = ['red', 'blue', 'yellow', 'green']; // clockwise from top left
export const LETTER: Record<Color, string> = { red: 'R', blue: 'B', yellow: 'J', green: 'V' };
export const COLOR_FR: Record<Color, string> = { red: 'Rouge', blue: 'Bleu', yellow: 'Jaune', green: 'Vert' };

export type SectorKind = 'land' | 'hq' | 'island' | 'sea';
export interface Sector {
  id: number;
  code: string;          // R4, S3, IX, QG-R …
  name: string;          // French display name
  kind: SectorKind;
  territory?: Color;     // for land and hq
  num?: number;          // territory sector number 0-8
  cells: [number, number][];
  anchor: [number, number]; // cell where pieces are drawn
  adj: number[];
  coastal: boolean;      // land sector a ship may enter
}

// Each token is one cell of an 11×11 grid; "--" is off the board.
// Territory sectors are numbered from the board edge (0) toward Île X (8).
const MAP = `
--  QR  QR  QR  S1  IN  S3  QB  QB  QB  --
--  R0  R1  R2  S1  IN  S3  B2  B1  B0  --
--  R3  R4  R5  S1  S2  S3  B5  B4  B3  --
--  R6  R7  R8  S1  S2  S3  B8  B7  B6  --
S12 S12 S12 S12 IX  IX  IX  S4  S4  S4  S4
IW  IW  S11 S11 IX  IX  IX  S5  S5  IE  IE
S10 S10 S10 S10 IX  IX  IX  S6  S6  S6  S6
--  V6  V7  V8  S9  S8  S7  J8  J7  J6  --
--  V3  V4  V5  S9  S8  S7  J5  J4  J3  --
--  V0  V1  V2  S9  IS  S7  J2  J1  J0  --
--  QV  QV  QV  S9  IS  S7  QJ  QJ  QJ  --`;

export const GRID = MAP.trim().split('\n').map(r => r.trim().split(/\s+/));
export const GW = GRID[0].length;
export const GH = GRID.length;

const BY_LETTER: Record<string, Color> = { R: 'red', B: 'blue', J: 'yellow', V: 'green' };
const ISLANDS: Record<string, string> = { IN: 'Île Nord', IS: 'Île Sud', IE: 'Île Est', IW: 'Île Ouest', IX: 'Île X' };

function build(): Sector[] {
  const codes = [...new Set(GRID.flat().filter(t => t !== '--'))];
  const sectors: Sector[] = codes.map((code, id) => {
    const cells: [number, number][] = [];
    GRID.forEach((row, y) => row.forEach((t, x) => { if (t === code) cells.push([x, y]); }));
    const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length, cy = cells.reduce((s, c) => s + c[1], 0) / cells.length;
    const anchor = [...cells].sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy))[0];
    const base = { id, code, cells, anchor, adj: [], coastal: false };
    if (code.startsWith('Q')) { const t = BY_LETTER[code[1]]; return { ...base, code: `QG-${code[1]}`, name: `QG ${code[1]}`, kind: 'hq', territory: t }; }
    if (ISLANDS[code]) return { ...base, name: ISLANDS[code], kind: 'island' };
    if (code.startsWith('S')) return { ...base, name: `Mer ${code.slice(1)}`, kind: 'sea' };
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
