// Rules of Power, following http://jeuxstrategie.free.fr/Power_complet.php
import { COLORS, COLOR_NAME, LETTER, SECTORS, hqOf, type Color } from './board';
export { COLORS, COLOR_NAME, LETTER, SECTORS, hqOf, type Color };

export type Kind = 'S' | 'T' | 'C' | 'D' | 'R' | 'A' | 'B' | 'CR' | 'M';
export type BaseKind = 'S' | 'T' | 'C' | 'D';
export type Mobility = 'ground' | 'air' | 'ship' | 'none';

export interface UnitSpec { name: string; abbr: string; power: number; move: number; mobility: Mobility; group: 1 | 2 | 0; up?: Kind; base?: BaseKind }
export const UNITS: Record<Kind, UnitSpec> = {
  S:  { name: 'Infantry',       abbr: 'I',  power: 2,  move: 2, mobility: 'ground', group: 1, up: 'R' },
  T:  { name: 'Tank',           abbr: 'T',  power: 3,  move: 3, mobility: 'ground', group: 1, up: 'A' },
  C:  { name: 'Fighter',        abbr: 'F',  power: 5,  move: 5, mobility: 'air',    group: 1, up: 'B' },
  D:  { name: 'Destroyer',      abbr: 'D',  power: 10, move: 1, mobility: 'ship',   group: 1, up: 'CR' },
  R:  { name: 'Regiment',       abbr: 'R',  power: 20, move: 2, mobility: 'ground', group: 2, base: 'S' },
  A:  { name: 'Heavy Tank',     abbr: 'HT', power: 30, move: 3, mobility: 'ground', group: 2, base: 'T' },
  B:  { name: 'Bomber',         abbr: 'B',  power: 25, move: 5, mobility: 'air',    group: 2, base: 'C' },
  CR: { name: 'Cruiser',        abbr: 'C',  power: 50, move: 1, mobility: 'ship',   group: 2, base: 'D' },
  M:  { name: 'Megamissile',    abbr: 'M',  power: 0,  move: 0, mobility: 'none',   group: 0 },
};
export const KINDS = Object.keys(UNITS) as Kind[];
export const BASE_KINDS: BaseKind[] = ['S', 'T', 'C', 'D'];
export const MISSILE_COST = 100;
export const ORDERS_PER_ARMY = 5;
export const START: Partial<Record<Kind, number>> = { S: 2, T: 2, C: 2, D: 2 };

// ---------- Movement ----------
/** Sectors a piece of `kind` standing on `from` may move to this round. */
export function reachable(kind: Kind, from: number): Set<number> {
  const u = UNITS[kind];
  const out = new Set<number>();
  if (u.mobility === 'none') return out;
  const enter = (id: number) => {
    const s = SECTORS[id];
    if (u.mobility === 'ship') return s.kind === 'sea' || s.kind === 'island' || s.coastal;
    return s.kind !== 'sea'; // ground and air never enter or cross the sea
  };
  // Ground pieces stop on an island or HQ: they cannot cross it in the same round.
  const passThrough = (id: number) => u.mobility === 'air' || (SECTORS[id].kind !== 'island' && SECTORS[id].kind !== 'hq');
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    if (d === u.move || (cur !== from && !passThrough(cur))) continue;
    for (const n of SECTORS[cur].adj) {
      if (dist.has(n) || !enter(n)) continue;
      dist.set(n, d + 1);
      out.add(n);
      queue.push(n);
    }
  }
  return out;
}

// ---------- State ----------
export type Loc = number | 'RV';
export interface Piece { id: number; kind: Kind; army: Color; loc: Loc }
export interface Army { color: Color; seat: number; alive: boolean; power: number; flags: Color[] }
export interface Seat { name: string; armies: Color[] }
export interface OrderResult { order: Order; ok: boolean; note?: string }
export interface Report { round: number; orders: { army: Color; results: OrderResult[] }[]; events: string[] }
export interface GameState {
  round: number;
  arbiter: number;         // seat that executes first this round
  seats: Seat[];
  armies: Army[];
  pieces: Piece[];
  nextId: number;
  ordersPerArmy: number;
  powerCap: number;        // max Power collected per army per round
  lastRound: boolean;      // time is up: this round is the final one
  winner?: number;         // seat index
  endReason?: string;
  report: Report | null;
}

export type Order =
  | { type: 'move'; kind: Kind; from: Loc; to: number }
  | { type: 'buy'; kind: BaseKind }
  | { type: 'upgrade'; kind: BaseKind; at: Loc }
  | { type: 'missile'; at: Loc; use: Partial<Record<Kind, number>>; power: number }
  | { type: 'launch'; from: Loc; target: Loc; reserveOf?: Color };

export function newGame(names: string[]): GameState {
  const n = names.length;
  if (n < 2 || n > 4) throw new Error('2 to 4 players');
  // Two players: each commands two neighbouring armies. Three players: the blue territory stays empty.
  const split: Color[][] = n === 2 ? [['yellow', 'blue'], ['green', 'red']] : COLORS.slice(0, n).map(c => [c]);
  const s: GameState = {
    round: 1, arbiter: 0, seats: names.map((name, i) => ({ name, armies: split[i] })), armies: [], pieces: [], nextId: 1,
    ordersPerArmy: ORDERS_PER_ARMY, powerCap: n === 2 ? 2 : 3, lastRound: false, report: null,
  };
  s.seats.forEach((seat, i) => seat.armies.forEach(color => {
    s.armies.push({ color, seat: i, alive: true, power: 0, flags: [color] });
    for (const [k, c] of Object.entries(START) as [Kind, number][]) for (let j = 0; j < c; j++) s.pieces.push({ id: s.nextId++, kind: k, army: color, loc: hqOf(color) });
  }));
  return s;
}

export const armyOf = (s: GameState, c: Color) => s.armies.find(a => a.color === c)!;
export const seatOfArmy = (s: GameState, c: Color) => armyOf(s, c).seat;
export const value = (ps: Piece[]) => ps.reduce((t, p) => t + UNITS[p.kind].power, 0);
export const locName = (l: Loc, army?: Color) => l === 'RV' ? (army ? `Reserve ${LETTER[army]}` : 'Reserve') : SECTORS[l].code;
export const totalPower = (s: GameState, seat: number) =>
  s.armies.filter(a => a.seat === seat).reduce((t, a) => t + a.power + value(s.pieces.filter(p => p.army === a.color)), 0);

export function describeOrder(o: Order, army: Color): string {
  switch (o.type) {
    case 'move': return `${UNITS[o.kind].name} ${locName(o.from, army)} → ${locName(o.to)}`;
    case 'buy': return `Exchange ${UNITS[o.kind].power} Power for 1 ${UNITS[o.kind].name}`;
    case 'upgrade': return `3 ${UNITS[o.kind].name} → 1 ${UNITS[UNITS[o.kind].up!].name} (${locName(o.at, army)})`;
    case 'missile': return `Build a megamissile (${locName(o.at, army)})`;
    case 'launch': return `Launch a megamissile at ${o.target === 'RV' ? `Reserve ${LETTER[o.reserveOf!]}` : locName(o.target)}`;
  }
}

// ---------- Executing orders ----------
interface Ctx {
  moved: Set<number>;           // pieces that moved (or were created by an exchange on the board) this round
  prev: Map<number, Loc>;       // where a moved piece came from, for rebounds
  launches: { army: Color; target: Loc; reserveOf?: Color }[];
}
export const newCtx = (): Ctx => ({ moved: new Set(), prev: new Map(), launches: [] });

const piecesAt = (s: GameState, army: Color, loc: Loc, kind?: Kind) =>
  s.pieces.filter(p => p.army === army && p.loc === loc && (!kind || p.kind === kind));

/** Apply one order for `army`. Returns an error (the order is then skipped) or null. */
export function executeOrder(s: GameState, ctx: Ctx, army: Color, o: Order): string | null {
  const a = armyOf(s, army);
  if (!a.alive) return 'Army eliminated';
  const isLoc = (l: unknown) => l === 'RV' || (typeof l === 'number' && !!SECTORS[l]);
  if ('kind' in o && !UNITS[o.kind]) return 'Invalid order';
  if (('from' in o && !isLoc(o.from)) || ('at' in o && !isLoc(o.at)) || ('to' in o && !SECTORS[o.to])) return 'Invalid order';
  switch (o.type) {
    case 'move': {
      const p = piecesAt(s, army, o.from, o.kind).find(p => !ctx.moved.has(p.id));
      if (!p) return `No ${UNITS[o.kind].name} available on ${locName(o.from, army)}`;
      if (o.kind === 'M') return 'A megamissile cannot move';
      if (o.from === 'RV') { if (o.to !== hqOf(army)) return 'From the reserve, pieces can only go to their HQ'; }
      else if (!reachable(o.kind, o.from).has(o.to)) return `${UNITS[o.kind].name} cannot go from ${locName(o.from)} to ${locName(o.to)}`;
      ctx.moved.add(p.id); ctx.prev.set(p.id, p.loc); p.loc = o.to;
      return null;
    }
    case 'buy': {
      const cost = UNITS[o.kind]?.power;
      if (!BASE_KINDS.includes(o.kind)) return 'Invalid exchange';
      if (a.power < cost) return 'Not enough Power';
      a.power -= cost;
      s.pieces.push({ id: s.nextId++, kind: o.kind, army, loc: 'RV' });
      return null;
    }
    case 'upgrade': {
      if (!BASE_KINDS.includes(o.kind)) return 'Invalid exchange';
      const three = piecesAt(s, army, o.at, o.kind).slice(0, 3);
      if (three.length < 3) return `Needs 3 ${UNITS[o.kind].name} on the same sector`;
      const gone = new Set(three.map(p => p.id));
      s.pieces = s.pieces.filter(p => !gone.has(p.id));
      const np = { id: s.nextId++, kind: UNITS[o.kind].up!, army, loc: o.at };
      s.pieces.push(np);
      if (o.at !== 'RV') ctx.moved.add(np.id); // an exchanged piece cannot move afterwards
      return null;
    }
    case 'missile': {
      const power = o.at === 'RV' ? Math.max(0, Math.floor(o.power || 0)) : 0;
      if (power > a.power) return 'Not enough Power';
      const used: Piece[] = [];
      for (const [k, n] of Object.entries(o.use) as [Kind, number][]) {
        if (k === 'M' || !n) continue;
        const avail = piecesAt(s, army, o.at, k).filter(p => !used.includes(p));
        if (avail.length < n) return 'Missing pieces for the megamissile';
        used.push(...avail.slice(0, n));
      }
      if (value(used) + power < MISSILE_COST) return `Needs at least ${MISSILE_COST} power`;
      a.power -= power;
      const gone = new Set(used.map(p => p.id));
      s.pieces = s.pieces.filter(p => !gone.has(p.id));
      const np = { id: s.nextId++, kind: 'M' as Kind, army, loc: o.at };
      s.pieces.push(np);
      return null;
    }
    case 'launch': {
      const m = piecesAt(s, army, o.from, 'M')[0];
      if (!m) return `No megamissile on ${locName(o.from, army)}`;
      if (o.target === 'RV' ? !o.reserveOf || !armyOf(s, o.reserveOf) : !SECTORS[o.target]) return 'Invalid target';
      s.pieces = s.pieces.filter(p => p !== m);
      ctx.launches.push({ army, target: o.target, reserveOf: o.reserveOf });
      return null;
    }
  }
  return 'Unknown order';
}

/** Best set of pieces at `at` reaching MISSILE_COST with the least waste (Power fills the gap in reserve). */
export function pickMissile(s: GameState, army: Color, at: Loc): { use: Partial<Record<Kind, number>>; power: number } | null {
  const ps = s.pieces.filter(p => p.army === army && p.loc === at && p.kind !== 'M');
  const powerAvail = at === 'RV' ? armyOf(s, army).power : 0;
  // Subset-sum over piece values, capped search space (pieces per sector stay small).
  let best: { sum: number; set: Piece[] } | null = null;
  const sorted = [...ps].sort((x, y) => UNITS[y.kind].power - UNITS[x.kind].power);
  const go = (i: number, sum: number, set: Piece[]) => {
    const need = Math.max(0, MISSILE_COST - sum);
    if (need <= powerAvail) {
      const total = sum + need;
      if (!best || total < best.sum || (total === best.sum && set.length > best.set.length)) best = { sum: total, set: [...set] };
      if (need === 0) return;
    }
    if (i >= sorted.length) return;
    go(i + 1, sum + UNITS[sorted[i].kind].power, [...set, sorted[i]]);
    go(i + 1, sum, set);
  };
  if (sorted.length <= 18) go(0, 0, []);
  if (!best) return null;
  const b = best as { sum: number; set: Piece[] };
  const use: Partial<Record<Kind, number>> = {};
  for (const p of b.set) use[p.kind] = (use[p.kind] ?? 0) + 1;
  return { use, power: Math.max(0, MISSILE_COST - value(b.set)) };
}

// ---------- Resolving a round ----------
export function resolveRound(prev: GameState, orders: Partial<Record<Color, Order[]>>): GameState {
  const s: GameState = structuredClone(prev);
  const ctx = newCtx();
  const report: Report = { round: s.round, orders: [], events: [] };
  const ev = (t: string) => report.events.push(t);
  const seatName = (i: number) => s.seats[i].name;

  // 1-2. Orders are executed seat by seat, starting with the arbiter, each list top to bottom.
  for (let k = 0; k < s.seats.length; k++) {
    const seat = (s.arbiter + k) % s.seats.length;
    for (const color of s.seats[seat].armies) {
      const a = armyOf(s, color);
      if (!a.alive) continue;
      const list = (orders[color] ?? []).slice(0, s.ordersPerArmy);
      const results = list.map(o => {
        let err: string | null;
        try { err = executeOrder(s, ctx, color, o); } catch { err = 'Invalid order'; }
        return { order: o, ok: !err, note: err ?? undefined };
      });
      report.orders.push({ army: color, results });
      if (!results.some(r => r.ok)) penalty(s, a, ev);
    }
  }

  // Megamissiles land once every piece has moved.
  for (const l of ctx.launches) {
    const hit = l.target === 'RV' ? s.pieces.filter(p => p.army === l.reserveOf && p.loc === 'RV') : s.pieces.filter(p => p.loc === l.target);
    const gone = new Set(hit.map(p => p.id));
    s.pieces = s.pieces.filter(p => !gone.has(p.id));
    ev(`💥 ${COLOR_NAME[l.army]} launches a megamissile at ${l.target === 'RV' ? `Reserve ${LETTER[l.reserveOf!]}` : locName(l.target)}: ${hit.length} piece(s) destroyed`);
  }

  // 3. Conflicts. Ties first: tied pieces that moved bounce back once.
  const rebounded = new Set<number>();
  const contested = () => {
    const m = new Map<number, Piece[]>();
    for (const p of s.pieces) if (p.loc !== 'RV') m.set(p.loc, [...(m.get(p.loc) ?? []), p]);
    return [...m].filter(([, ps]) => new Set(ps.map(p => seatOfArmy(s, p.army))).size > 1);
  };
  const totals = (ps: Piece[]) => {
    const t = new Map<number, number>();
    for (const p of ps) t.set(seatOfArmy(s, p.army), (t.get(seatOfArmy(s, p.army)) ?? 0) + UNITS[p.kind].power);
    return [...t].map(([seat, p]) => ({ seat, p })).sort((x, y) => y.p - x.p);
  };
  for (let guard = 0; guard < 50; guard++) {
    let bounced = false;
    for (const [loc, ps] of contested()) {
      const t = totals(ps);
      if (t[0].p !== t[1].p) continue;
      const tied = new Set(t.filter(x => x.p === t[0].p).map(x => x.seat));
      const back = ps.filter(p => tied.has(seatOfArmy(s, p.army)) && ctx.moved.has(p.id) && ctx.prev.has(p.id) && !rebounded.has(p.id));
      if (!back.length) continue;
      for (const p of back) { p.loc = ctx.prev.get(p.id)!; rebounded.add(p.id); }
      ev(`↩️ ${locName(loc)}: tie (${t.map(x => `${seatName(x.seat)} ${x.p}`).join(' / ')}), arriving pieces bounce back`);
      bounced = true;
    }
    if (!bounced) break;
  }
  // 4. Captures: the strongest side takes every enemy piece on the sector.
  for (const [loc, ps] of contested()) {
    const t = totals(ps);
    if (t[0].p === t[1].p) { ev(`⚖️ ${locName(loc)}: still tied, nobody captures`); continue; }
    const win = t[0].seat;
    const mine = ps.filter(p => seatOfArmy(s, p.army) === win);
    // Captured pieces go to the reserve of the winning army with the most power here.
    const byArmy = s.seats[win].armies.map(c => ({ c, v: value(mine.filter(p => p.army === c)) })).sort((x, y) => y.v - x.v);
    const to = byArmy[0].c;
    const lost = ps.filter(p => seatOfArmy(s, p.army) !== win);
    for (const p of lost) { p.army = to; p.loc = 'RV'; }
    ev(`⚔️ ${locName(loc)}: ${seatName(win)} wins (${t.map(x => `${seatName(x.seat)} ${x.p}`).join(' / ')}) and captures ${lost.length} piece(s)`);
  }

  // 5. Power: 1 per enemy territory (still holding its flag) occupied, capped per army.
  for (const a of s.armies) if (a.alive) {
    const occupied = new Set<Color>();
    for (const p of s.pieces) {
      if (p.army !== a.color || p.loc === 'RV') continue;
      const sec = SECTORS[p.loc];
      if (sec.kind !== 'land' || !sec.territory) continue;
      const owner = s.armies.find(x => x.color === sec.territory);
      if (owner && owner.alive && owner.seat !== a.seat) occupied.add(sec.territory);
    }
    const gain = Math.min(occupied.size, s.powerCap);
    if (gain) { a.power += gain; ev(`⚡ ${COLOR_NAME[a.color]} collects ${gain} Power`); }
  }

  // 6. Flags: a side alone on an enemy HQ with at least one Infantry or Regiment takes the flag.
  for (const a of s.armies) if (a.alive) {
    const there = s.pieces.filter(p => p.loc === hqOf(a.color));
    const seats = new Set(there.map(p => seatOfArmy(s, p.army)));
    if (seats.size !== 1 || seats.has(a.seat)) continue;
    const infantry = there.find(p => p.kind === 'S' || p.kind === 'R');
    if (!infantry) continue;
    const captor = armyOf(s, infantry.army);
    a.alive = false;
    captor.flags.push(...a.flags);
    a.flags = [];
    captor.power += a.power; a.power = 0;
    for (const p of s.pieces) if (p.army === a.color) { p.army = captor.color; p.loc = 'RV'; }
    ev(`🚩 ${seatName(captor.seat)} (${COLOR_NAME[captor.color]}) captures the ${COLOR_NAME[a.color]} flag!`);
  }

  // Victory.
  const aliveSeats = [...new Set(s.armies.filter(a => a.alive).map(a => a.seat))];
  if (aliveSeats.length === 1) {
    s.winner = aliveSeats[0]; s.endReason = 'flags';
    ev(`🏆 ${seatName(s.winner)} has captured every flag!`);
  } else if (s.lastRound) {
    const rank = aliveSeats.map(i => ({ i, p: totalPower(s, i), f: s.armies.filter(a => a.seat === i).reduce((t, a) => t + a.flags.length, 0) }))
      .sort((x, y) => y.p - x.p || y.f - x.f);
    s.winner = rank[0].i; s.endReason = 'time';
    ev(`⏰ Time is up. ${seatName(s.winner)} wins with ${rank[0].p} total power`);
  }
  s.report = report;
  s.round++;
  s.arbiter = (s.arbiter + 1) % s.seats.length;
  return s;
}

/** No legal order this round: give back 1 Power, or turn the smallest piece into Power first. */
function penalty(s: GameState, a: Army, ev: (t: string) => void) {
  let converted = '';
  if (a.power < 1) {
    const ps = s.pieces.filter(p => p.army === a.color && p.kind !== 'M').sort((x, y) => UNITS[x.kind].power - UNITS[y.kind].power);
    const p = ps[0];
    if (!p) return;
    s.pieces = s.pieces.filter(x => x !== p);
    const spec = UNITS[p.kind];
    if (spec.group === 2) {
      // Split into three base pieces, one of which becomes Power.
      for (let i = 0; i < 2; i++) s.pieces.push({ id: s.nextId++, kind: spec.base!, army: a.color, loc: 'RV' });
      a.power += UNITS[spec.base!].power;
    } else a.power += spec.power;
    converted = `, turns one ${spec.name} into Power`;
  }
  a.power -= 1;
  ev(`⚠️ ${COLOR_NAME[a.color]} carried out no valid order${converted} and loses 1 Power`);
}
