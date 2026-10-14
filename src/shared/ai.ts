// Computer player: a greedy planner. It scores every possible order against
// the public board, keeps the best one, replays it, and repeats up to the
// order limit. It never sees other players' orders.
import { SECTORS, hqOf } from './board';
import {
  BASE_KINDS, UNITS, armyOf, executeOrder, newCtx, pickMissile, reachable, seatOfArmy,
  type Color, type GameState, type Kind, type Loc, type Order, type Piece,
} from './rules';

type Ctx = ReturnType<typeof newCtx>;

/** Plain sector distance, ignoring terrain, for "get closer to the enemy". */
const DIST: number[][] = SECTORS.map(s => {
  const d = SECTORS.map(() => Infinity);
  d[s.id] = 0;
  const q = [s.id];
  while (q.length) { const c = q.shift()!; for (const n of SECTORS[c].adj) if (d[n] === Infinity) { d[n] = d[c] + 1; q.push(n); } }
  return d;
});

export function botOrders(g: GameState, seat: number, rand: () => number = Math.random): Partial<Record<Color, Order[]>> {
  const proj: GameState = structuredClone(g);
  const ctx = newCtx();
  const out: Partial<Record<Color, Order[]>> = {};
  const enemyPieces = g.pieces.filter(p => p.loc !== 'RV' && seatOfArmy(g, p.army) !== seat);
  // Enemy force that could reach each sector next round.
  const threat = new Map<number, number>();
  for (const p of enemyPieces) {
    const v = UNITS[p.kind].power;
    for (const d of [p.loc as number, ...reachable(p.kind, p.loc as number)]) threat.set(d, (threat.get(d) ?? 0) + v);
  }
  const enemyHqs = g.armies.filter(a => a.alive && a.seat !== seat).map(a => hqOf(a.color));

  for (const color of g.seats[seat].armies) {
    if (!armyOf(g, color).alive) continue;
    const list: Order[] = [];
    for (let i = 0; i < g.ordersPerArmy; i++) {
      const cands = candidates(proj, ctx, color).map(o => ({ o, score: score(proj, ctx, seat, color, o, threat, enemyHqs) + rand() * 0.5 }));
      cands.sort((a, b) => b.score - a.score);
      const best = cands.find(c => c.score > 1 || list.length === 0);
      if (!best) break;
      if (executeOrder(proj, ctx, color, best.o)) continue;
      list.push(best.o);
    }
    out[color] = list;
  }
  return out;
}

function candidates(s: GameState, ctx: Ctx, color: Color): Order[] {
  const out: Order[] = [];
  const mine = s.pieces.filter(p => p.army === color);
  const groups = new Map<string, Piece>();
  for (const p of mine) if (!ctx.moved.has(p.id)) groups.set(`${p.kind}@${p.loc}`, p);
  for (const p of groups.values()) {
    if (p.kind === 'M') {
      for (const sec of SECTORS) out.push({ type: 'launch', from: p.loc, target: sec.id });
      continue;
    }
    if (p.loc === 'RV') out.push({ type: 'move', kind: p.kind, from: 'RV', to: hqOf(color) });
    else for (const d of reachable(p.kind, p.loc)) out.push({ type: 'move', kind: p.kind, from: p.loc, to: d });
  }
  const locs = new Set<Loc>(mine.map(p => p.loc));
  for (const at of locs) {
    for (const k of BASE_KINDS) if (mine.filter(p => p.loc === at && p.kind === k).length >= 3) out.push({ type: 'upgrade', kind: k, at });
    const pick = at === 'RV' ? pickMissile(s, color, at) : null; // only build missiles from the reserve
    if (pick) out.push({ type: 'missile', at, ...pick });
  }
  for (const k of BASE_KINDS) if (armyOf(s, color).power >= UNITS[k].power) out.push({ type: 'buy', kind: k });
  return out;
}

function score(s: GameState, ctx: Ctx, seat: number, color: Color, o: Order, threat: Map<number, number>, enemyHqs: number[]): number {
  const valueAt = (loc: number, mineSide: boolean) =>
    s.pieces.filter(p => p.loc === loc && (seatOfArmy(s, p.army) === seat) === mineSide).reduce((t, p) => t + UNITS[p.kind].power, 0);
  const strongestEnemyAt = (loc: number) => {
    const by = new Map<number, number>();
    for (const p of s.pieces) if (p.loc === loc && seatOfArmy(s, p.army) !== seat) by.set(seatOfArmy(s, p.army), (by.get(seatOfArmy(s, p.army)) ?? 0) + UNITS[p.kind].power);
    return Math.max(0, ...by.values());
  };
  const hq = hqOf(color);

  switch (o.type) {
    case 'buy': return UNITS[o.kind].power * 1.5 + (o.kind === 'S' ? 3 : 0); // infantry can take flags
    case 'upgrade': return 15;
    case 'missile': return 40;
    case 'launch': {
      if (o.target === 'RV') return 0;
      return valueAt(o.target, false) - 2 * valueAt(o.target, true) + (o.target === hq ? -1000 : 0) - 20;
    }
    case 'move': {
      const k = o.kind, v = UNITS[k].power, d = o.to;
      const sec = SECTORS[d];
      const ours = valueAt(d, true) + v;
      const enemy = strongestEnemyAt(d);
      let sc = 0;
      if (enemy > 0) sc += ours > enemy ? 2 * enemy + 10 : ours === enemy ? -2 : -60;
      // Taking a flag needs infantry or a regiment and a winning force.
      if (enemyHqs.includes(d) && (k === 'S' || k === 'R') && ours > enemy) sc += 1000;
      if (enemyHqs.includes(d) && enemy === 0) sc += 15;
      // Power comes from occupying enemy territories that still have their flag.
      if (sec.kind === 'land' && sec.territory) {
        const owner = s.armies.find(a => a.color === sec.territory);
        const already = s.pieces.some(p => p.army === color && p.loc !== 'RV' && SECTORS[p.loc].territory === sec.territory && SECTORS[p.loc].kind === 'land');
        if (owner?.alive && owner.seat !== seat && !already) sc += 8;
      }
      // Don't walk into a bigger force.
      const t = threat.get(d) ?? 0;
      if (t >= ours) sc -= v * 0.8;
      // Keep the HQ defended against anything that could reach it.
      if (o.from === hq) {
        const left = valueAt(hq, true) - v, danger = threat.get(hq) ?? 0;
        if (danger > 0 && left <= danger) sc -= 200;
        if (left <= 0) sc -= 6;
      }
      if (o.from === 'RV') sc += v * 1.2 + ((threat.get(hq) ?? 0) > valueAt(hq, true) ? 50 : 0);
      // Head toward the nearest enemy HQ.
      if (o.from !== 'RV' && enemyHqs.length) {
        const near = (l: number) => Math.min(...enemyHqs.map(h => DIST[l][h]));
        sc += (near(o.from) - near(d)) * 2.5;
      }
      return sc;
    }
  }
}
