// Game rules for Power, le jeu. Everything marked PROVISIONAL is a best guess
// waiting to be confirmed against the original rulebook.

export type Color = 'red' | 'blue' | 'green' | 'yellow';
export const COLORS: Color[] = ['red', 'blue', 'green', 'yellow'];

export type Terrain = 'land' | 'sea';
export type UnitKind =
  | 'soldier' | 'tank' | 'fighter' | 'destroyer'
  | 'regiment' | 'heavyTank' | 'bomber' | 'cruiser'
  | 'megamissile';

export interface UnitSpec {
  name: string;      // French display name
  power: number;
  move: number;      // max squares per order (orthogonal steps)
  domain: 'land' | 'sea' | 'air'; // air may cross and stop anywhere
}

// PROVISIONAL values for big units, move ranges and domains.
export const UNITS: Record<Exclude<UnitKind, 'megamissile'>, UnitSpec> = {
  soldier:   { name: 'Soldat',      power: 2,   move: 1, domain: 'land' },
  tank:      { name: 'Tank',        power: 3,   move: 2, domain: 'land' },
  fighter:   { name: 'Avion',       power: 5,   move: 4, domain: 'air' },
  destroyer: { name: 'Destroyer',   power: 10,  move: 3, domain: 'sea' },
  regiment:  { name: 'Régiment',    power: 20,  move: 1, domain: 'land' },
  heavyTank: { name: 'Tank lourd',  power: 30,  move: 2, domain: 'land' },
  bomber:    { name: 'Bombardier',  power: 50,  move: 4, domain: 'air' },
  cruiser:   { name: 'Croiseur',    power: 100, move: 3, domain: 'sea' },
};
export type BoardUnitKind = keyof typeof UNITS;

// PROVISIONAL trade-up recipes: pieces in reserve -> one new piece in reserve.
export const TRADES: { give: Partial<Record<UnitKind, number>>; get: UnitKind }[] = [
  { give: { soldier: 3 }, get: 'regiment' },
  { give: { tank: 3 }, get: 'heavyTank' },
  { give: { fighter: 3 }, get: 'bomber' },
  { give: { destroyer: 3 }, get: 'cruiser' },
  { give: { regiment: 1, heavyTank: 1, bomber: 1, cruiser: 1 }, get: 'megamissile' },
];

// PROVISIONAL starting forces, placed on the home country.
export const START_FORCES: Partial<Record<BoardUnitKind, number>> = {
  soldier: 6, tank: 4, fighter: 2, destroyer: 2,
};
export const ORDERS_PER_TURN = 5;

// ---------- Board ----------
// PROVISIONAL layout. Lowercase letter = headquarters (flag) of that color,
// uppercase = home land, n = neutral land, . = sea.
const MAP = [
  'rRRRnnnBBBb',
  'RRRRn.nBBBB',
  'RRRRn.nBBBB',
  'RRR.....BBB',
  'nnn.....nnn',
  'n....n....n',
  'nnn.....nnn',
  'GGG.....YYY',
  'GGGGn.nYYYY',
  'GGGGn.nYYYY',
  'gGGGnnnYYYy',
];
const LETTER: Record<string, Color> = { r: 'red', b: 'blue', g: 'green', y: 'yellow' };

export interface Cell { id: number; x: number; y: number; terrain: Terrain; home?: Color; hq?: Color }
export const W = MAP[0].length;
export const H = MAP.length;
export const CELLS: Cell[] = MAP.flatMap((row, y) => [...row].map((ch, x) => {
  const id = y * W + x;
  if (ch === '.') return { id, x, y, terrain: 'sea' as Terrain };
  if (ch === 'n') return { id, x, y, terrain: 'land' as Terrain };
  const color = LETTER[ch.toLowerCase()];
  return { id, x, y, terrain: 'land' as Terrain, home: color, hq: ch === ch.toLowerCase() ? color : undefined };
}));
export const hqOf = (c: Color) => CELLS.find(k => k.hq === c)!.id;

function neighbors(id: number): number[] {
  const x = id % W, y = Math.floor(id / W), out: number[] = [];
  if (x > 0) out.push(id - 1);
  if (x < W - 1) out.push(id + 1);
  if (y > 0) out.push(id - W);
  if (y < H - 1) out.push(id + W);
  return out;
}

const canEnter = (kind: BoardUnitKind, cell: Cell) =>
  UNITS[kind].domain === 'air' || UNITS[kind].domain === cell.terrain;

/** Cells reachable by a unit kind from `from` (excluding `from`). Sea units may
 *  also enter a coastal land square? No: they stay at sea. PROVISIONAL. */
export function reachable(kind: BoardUnitKind, from: number): Set<number> {
  const seen = new Map<number, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = seen.get(cur)!;
    if (d === UNITS[kind].move) continue;
    for (const n of neighbors(cur)) {
      if (seen.has(n) || !canEnter(kind, CELLS[n])) continue;
      seen.set(n, d + 1);
      queue.push(n);
    }
  }
  seen.delete(from);
  return new Set(seen.keys());
}

// ---------- State ----------
export interface Unit { id: number; kind: BoardUnitKind; owner: Color; cell: number }
export interface Player { color: Color; name: string; alive: boolean; reserve: Partial<Record<UnitKind, number>> }
export interface GameState {
  turn: number;
  players: Player[];
  units: Unit[];
  nextUnitId: number;
  winner?: Color;
  log: string[]; // events of the last resolved turn
}

export type Order =
  | { type: 'move'; unitIds: number[]; to: number }
  | { type: 'deploy'; kind: BoardUnitKind; count: number; to: number } // reserve -> own home land
  | { type: 'trade'; recipe: number }
  | { type: 'missile'; target: number };

export function newGame(players: { color: Color; name: string }[]): GameState {
  const state: GameState = { turn: 1, players: [], units: [], nextUnitId: 1, log: [] };
  for (const p of players) {
    state.players.push({ color: p.color, name: p.name, alive: true, reserve: {} });
    const land = CELLS.filter(c => c.home === p.color && !c.hq);
    const hq = hqOf(p.color);
    // The fleet starts on the sea square touching the home country nearest the HQ.
    const sea = CELLS.filter(c => c.terrain === 'sea' && neighbors(c.id).some(n => CELLS[n].home === p.color))
      .sort((a, b) => dist(a.id, hq) - dist(b.id, hq));
    let li = 0;
    for (const [kind, n] of Object.entries(START_FORCES) as [BoardUnitKind, number][]) {
      for (let i = 0; i < n; i++) {
        const cell = UNITS[kind].domain === 'sea' ? sea[0].id : land[li++ % land.length].id;
        state.units.push({ id: state.nextUnitId++, kind, owner: p.color, cell });
      }
    }
  }
  return state;
}

const dist = (a: number, b: number) =>
  Math.abs((a % W) - (b % W)) + Math.abs(Math.floor(a / W) - Math.floor(b / W));

export const power = (units: Unit[]) => units.reduce((s, u) => s + UNITS[u.kind].power, 0);

/** Returns an error message, or null if the order list is legal for this player. */
export function validateOrders(state: GameState, color: Color, orders: Order[]): string | null {
  if (orders.length > ORDERS_PER_TURN) return `Maximum ${ORDERS_PER_TURN} ordres`;
  const used = new Set<number>();
  const reserve = { ...state.players.find(p => p.color === color)!.reserve };
  for (const o of orders) {
    if (o.type === 'move') {
      if (!o.unitIds.length) return 'Ordre vide';
      const units = o.unitIds.map(id => state.units.find(u => u.id === id));
      if (units.some(u => !u || u.owner !== color)) return 'Unité invalide';
      const from = units[0]!.cell;
      for (const u of units as Unit[]) {
        if (used.has(u.id)) return 'Une unité ne peut recevoir qu’un ordre';
        used.add(u.id);
        if (u.cell !== from) return 'Un ordre déplace des unités d’une seule case';
        if (!reachable(u.kind, from).has(o.to)) return `${UNITS[u.kind].name} ne peut pas atteindre cette case`;
      }
    } else if (o.type === 'deploy') {
      const cell = CELLS[o.to];
      if (cell?.home !== color) return 'Déploiement uniquement dans votre pays';
      if (!canEnter(o.kind, cell) || o.count < 1) return 'Déploiement invalide';
      if ((reserve[o.kind] ?? 0) < o.count) return 'Pas assez d’unités en réserve';
      reserve[o.kind]! -= o.count;
    } else if (o.type === 'trade') {
      const r = TRADES[o.recipe];
      if (!r) return 'Échange invalide';
      for (const [k, n] of Object.entries(r.give) as [UnitKind, number][]) {
        if ((reserve[k] ?? 0) < n) return 'Pas assez d’unités en réserve pour cet échange';
        reserve[k]! -= n;
      }
      reserve[r.get] = (reserve[r.get] ?? 0) + 1;
    } else if (o.type === 'missile') {
      if ((reserve.megamissile ?? 0) < 1) return 'Pas de mégamissile en réserve';
      if (!CELLS[o.target]) return 'Cible invalide';
      reserve.megamissile! -= 1;
    } else return 'Ordre inconnu';
  }
  return null;
}

const nameOf = (s: GameState, c: Color) => s.players.find(p => p.color === c)!.name;
const at = (c: number) => `${String.fromCharCode(65 + (c % W))}${Math.floor(c / W) + 1}`;
export const cellLabel = at;

/** Resolve one turn: all orders of all players happen at the same time. */
export function resolveTurn(prev: GameState, allOrders: Partial<Record<Color, Order[]>>): GameState {
  const s: GameState = structuredClone(prev);
  s.log = [];
  const P = (c: Color) => s.players.find(p => p.color === c)!;

  // 1. Trades, in reserve.
  for (const [color, orders] of Object.entries(allOrders) as [Color, Order[]][]) {
    for (const o of orders) if (o.type === 'trade') {
      const r = TRADES[o.recipe], res = P(color).reserve;
      for (const [k, n] of Object.entries(r.give) as [UnitKind, number][]) res[k]! -= n;
      res[r.get] = (res[r.get] ?? 0) + 1;
      s.log.push(`${nameOf(s, color)} échange contre ${r.get === 'megamissile' ? 'un mégamissile' : UNITS[r.get as BoardUnitKind].name}`);
    }
  }
  // 2. Moves and deployments, simultaneously.
  for (const [color, orders] of Object.entries(allOrders) as [Color, Order[]][]) {
    for (const o of orders) {
      if (o.type === 'move') {
        for (const id of o.unitIds) s.units.find(u => u.id === id)!.cell = o.to;
      } else if (o.type === 'deploy') {
        P(color).reserve[o.kind]! -= o.count;
        for (let i = 0; i < o.count; i++) s.units.push({ id: s.nextUnitId++, kind: o.kind, owner: color, cell: o.to });
        s.log.push(`${nameOf(s, color)} déploie ${o.count} ${UNITS[o.kind].name} en ${at(o.to)}`);
      }
    }
  }
  // 3. Megamissiles destroy everything on the target square, after movement.
  for (const [color, orders] of Object.entries(allOrders) as [Color, Order[]][]) {
    for (const o of orders) if (o.type === 'missile') {
      P(color).reserve.megamissile! -= 1;
      const hit = s.units.filter(u => u.cell === o.target);
      s.units = s.units.filter(u => u.cell !== o.target);
      s.log.push(`💥 ${nameOf(s, color)} lance un mégamissile sur ${at(o.target)} (${hit.length} unités détruites)`);
    }
  }
  // 4. Battles: on each contested square the strongest force captures the others.
  //    PROVISIONAL: on a tie nobody is captured and the forces stay.
  const byCell = new Map<number, Unit[]>();
  for (const u of s.units) byCell.set(u.cell, [...(byCell.get(u.cell) ?? []), u]);
  for (const [cell, units] of byCell) {
    const owners = [...new Set(units.map(u => u.owner))];
    if (owners.length < 2) continue;
    const totals = owners.map(o => ({ o, p: power(units.filter(u => u.owner === o)) })).sort((a, b) => b.p - a.p);
    const summary = totals.map(t => `${nameOf(s, t.o)} ${t.p}`).join(' vs ');
    if (totals[0].p === totals[1].p) { s.log.push(`⚔️ ${at(cell)}: égalité (${summary})`); continue; }
    const winner = totals[0].o;
    const losers = units.filter(u => u.owner !== winner);
    for (const u of losers) P(winner).reserve[u.kind] = (P(winner).reserve[u.kind] ?? 0) + 1;
    const lost = new Set(losers.map(u => u.id));
    s.units = s.units.filter(u => !lost.has(u.id));
    s.log.push(`⚔️ ${at(cell)}: ${nameOf(s, winner)} gagne (${summary}) et capture ${losers.length} unités`);
  }
  // 5. Flags: a player alone on an enemy headquarters captures that flag.
  //    The defeated player's remaining pieces leave the board. PROVISIONAL.
  for (const p of s.players) if (p.alive) {
    const occupants = s.units.filter(u => u.cell === hqOf(p.color));
    const owners = new Set(occupants.map(u => u.owner));
    if (owners.size === 1 && !owners.has(p.color)) {
      const captor = [...owners][0];
      p.alive = false;
      s.units = s.units.filter(u => u.owner !== p.color);
      s.log.push(`🚩 ${nameOf(s, captor)} prend le drapeau de ${p.name} !`);
    }
  }
  const alive = s.players.filter(p => p.alive);
  if (alive.length === 1) { s.winner = alive[0].color; s.log.push(`🏆 ${alive[0].name} remporte la partie`); }
  s.turn++;
  return s;
}
