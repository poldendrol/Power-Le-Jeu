// Board artwork and unit icons, all drawn in SVG so nothing needs downloading.
import { BOARD_SIZE, COL_W, COL_X, GRID, ROW_H, ROW_Y, SECTORS, type Color, type Sector } from '../shared/board';
import type { Kind } from '../shared/rules';

export const ARMY_HEX: Record<Color, string> = { red: '#ef4444', blue: '#3b82f6', yellow: '#eab308', green: '#22c55e' };

const X = (x: number) => COL_X[x] ?? BOARD_SIZE;
const Y = (y: number) => ROW_Y[y] ?? BOARD_SIZE;

/** Bounding box of a sector, in board pixels. */
export function bbox(s: Sector) {
  const xs = s.cells.map(c => c[0]), ys = s.cells.map(c => c[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x: X(x0), y: Y(y0), w: X(x1) + COL_W[x1] - X(x0), h: Y(y1) + ROW_H[y1] - Y(y0) };
}

/** Outline of a sector as one path (union of its grid cells). */
export function sectorPath(s: Sector) {
  return s.cells.map(([x, y]) => `M${X(x)},${Y(y)}h${COL_W[x]}v${ROW_H[y]}h${-COL_W[x]}z`).join('');
}

// 24×24 silhouettes, drawn in white on the army colour.
export const ICON: Record<Kind, string> = {
  S: 'M12 4a7 7 0 0 1 7 7v1H5v-1a7 7 0 0 1 7-7zM3 13h18v2.2H3zM9 16.5h6l-.8 3h-4.4z',
  R: 'M12 3l8 4.5v3L12 6 4 10.5v-3zM12 9l8 4.5v3L12 12l-8 4.5v-3zM12 15l8 4.5V22l-8-4-8 4v-2.5z',
  T: 'M3 14h18l-2.2 4.5H5.2zM7 9.5h8.5V14H7zM15.5 10.6H22v1.6h-6.5z',
  A: 'M2 14h20l-2.4 5H4.4zM6 9h10v5H6zM16 9.2h6.5v1.5H16zM16 11.6h6.5v1.5H16zM8 6.5h5V9H8z',
  C: 'M12 2l1.6 7.2 8.4 4.3v2.1l-8.5-2.3-.4 5.2 3 2.2V22L12 20.6 7.9 22v-1.3l3-2.2-.4-5.2L2 15.6v-2.1l8.4-4.3z',
  B: 'M12 2.5l1.3 6.2L23 12v2.6l-9.6-1.9-.4 5 3.2 2.1V22L12 20.8 7.8 22v-2.2l3.2-2.1-.4-5L1 14.6V12l9.7-3.3z',
  D: 'M2 14h20l-3.2 5.5H5.2zM8 10h7.5v4H8zM10.8 6.5h2v3.5h-2z',
  CR: 'M1.5 13.5h21l-3.3 6H4.8zM5 9.5h6v4H5zM12.5 8.5h6.5v5h-6.5zM7 6.5h1.8v3H7zM15 4.5h1.8v4H15z',
  M: 'M12 1.5c3.2 3 4.3 7.2 4.3 11.3l2.2 3.2v4l-3.3-2.2H8.8L5.5 20v-4l2.2-3.2C7.7 8.7 8.8 4.5 12 1.5zM12 6.5a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z',
};

export function iconSvg(k: Kind, size = 18, fill = 'currentColor') {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${ICON[k]}" fill="${fill}"/></svg>`;
}

/** The static painted board: sea, landmasses with relief, beaches, islands and HQ bunkers. */
export function boardArt(): string {
  const S = BOARD_SIZE;
  const land = SECTORS.filter(s => s.kind === 'land');
  const territories = [...new Set(land.map(s => s.territory!))].map(t => {
    const cells = land.filter(s => s.territory === t).flatMap(s => s.cells);
    return { t, b: bbox({ cells } as unknown as Sector) };
  });
  const islands = SECTORS.filter(s => s.kind === 'island');
  const hqs = SECTORS.filter(s => s.kind === 'hq');

  const shape = (b: { x: number; y: number; w: number; h: number }, grow: number, r: number, attrs: string) =>
    `<rect x="${b.x - grow}" y="${b.y - grow}" width="${b.w + 2 * grow}" height="${b.h + 2 * grow}" rx="${r + grow}" ${attrs}/>`;

  // Sea sector dividers: dashed lines where two different sea sectors meet.
  const seaLines: string[] = [];
  for (let y = 0; y < GRID.length; y++) for (let x = 0; x < GRID[0].length; x++) {
    const t = GRID[y][x];
    if (!t.startsWith('S')) continue;
    const r = GRID[y][x + 1], d = GRID[y + 1]?.[x];
    if (r && r !== t && r.startsWith('S')) seaLines.push(`M${X(x + 1)},${Y(y)}v${ROW_H[y]}`);
    if (d && d !== t && d.startsWith('S')) seaLines.push(`M${X(x)},${Y(y + 1)}h${COL_W[x]}`);
  }
  // Sector grid inside each territory.
  const grid = territories.map(({ b }) => {
    const out: string[] = [];
    for (let i = 1; i < 3; i++) {
      out.push(`M${b.x + (b.w * i) / 3},${b.y + 6}v${b.h - 12}`);
      out.push(`M${b.x + 6},${b.y + (b.h * i) / 3}h${b.w - 12}`);
    }
    return out.join('');
  }).join('');

  return `
  <defs>
    <radialGradient id="sea" cx="50%" cy="50%" r="75%">
      <stop offset="0" stop-color="#1f6f9e"/><stop offset=".55" stop-color="#135078"/><stop offset="1" stop-color="#0a2a44"/>
    </radialGradient>
    <filter id="waves" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves="3" seed="7"/>
      <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.4 -0.62"/>
    </filter>
    <filter id="relief" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="5" seed="3" result="noise"/>
      <feDiffuseLighting in="noise" surfaceScale="4.5" lighting-color="#fff" result="light"><feDistantLight azimuth="225" elevation="48"/></feDiffuseLighting>
      <feComposite in="SourceGraphic" in2="light" operator="arithmetic" k1="1.25" k2="0" k3="0" k4="0" result="lit"/>
      <feComposite in="lit" in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
    <linearGradient id="earth" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8da35a"/><stop offset=".5" stop-color="#6f8a45"/><stop offset="1" stop-color="#a08b5a"/>
    </linearGradient>
    <linearGradient id="sand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8d7a3"/><stop offset="1" stop-color="#c9b077"/></linearGradient>
    <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3446"/><stop offset="1" stop-color="#121925"/></linearGradient>
    <marker id="head" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7z" fill="#fde68a"/></marker>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#sea)"/>
  <rect width="${S}" height="${S}" filter="url(#waves)" opacity=".35"/>
  <path d="${seaLines.join('')}" class="sea-line"/>
  ${[...territories.map(x => x.b), ...islands.map(bbox)].map(b => shape(b, 9, 16, 'fill="#5fc4dd" opacity=".35" filter="url(#soft)"')).join('')}
  ${territories.map(({ t, b }) => `
    ${shape(b, 3, 16, 'fill="url(#sand)"')}
    ${shape(b, -2, 13, 'fill="url(#earth)" filter="url(#relief)"')}
    ${shape(b, -2, 13, `fill="${ARMY_HEX[t]}" opacity=".22"`)}
    ${shape(b, -2, 13, `fill="none" stroke="${ARMY_HEX[t]}" stroke-width="2.5" opacity=".9"`)}`).join('')}
  <path d="${grid}" class="land-grid"/>
  ${islands.map(s => { const b = bbox(s); const p = { x: b.x + 8, y: b.y + 8, w: b.w - 16, h: b.h - 16 };
    return `${shape(p, 3, 18, 'fill="url(#sand)"')}${shape(p, -2, 15, 'fill="url(#earth)" filter="url(#relief)"')}`; }).join('')}
  ${hqs.map(s => { const b = bbox(s); const p = { x: b.x + 5, y: b.y + 5, w: b.w - 10, h: b.h - 10 }; const c = ARMY_HEX[s.territory!];
    return `${shape(p, 0, 10, `fill="url(#steel)" stroke="${c}" stroke-width="2.5"`)}
      ${shape(p, 0, 10, `fill="none" stroke="${c}" stroke-width="6" opacity=".35" filter="url(#glow)"`)}
      <path d="M${p.x + 8},${p.y + p.h - 8}l8,-8M${p.x + 16},${p.y + p.h - 8}l8,-8M${p.x + 24},${p.y + p.h - 8}l8,-8" stroke="${c}" stroke-width="2.5" opacity=".55"/>`; }).join('')}`;
}
