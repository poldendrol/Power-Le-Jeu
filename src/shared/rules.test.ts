import assert from 'node:assert/strict';
import { byCode as at } from './board';
import { SECTORS, armyOf, hqOf, newGame, pickMissile, reachable, resolveRound, type GameState, type Kind, type Piece } from './rules';

const codes = (set: Set<number>) => [...set].map(i => SECTORS[i].code).sort();
const place = (s: GameState, army: Piece['army'], kind: Kind, code: string | 'RV') => {
  const p: Piece = { id: s.nextId++, kind, army, loc: code === 'RV' ? 'RV' : at(code) };
  s.pieces.push(p);
  return p;
};
const empty = (n = 4) => { const s = newGame(['A', 'B', 'C', 'D'].slice(0, n)); s.pieces = []; for (const a of s.armies) a.power = 10; return s; };

// Board sanity.
assert.equal(SECTORS.filter(s => s.kind === 'sea').length, 12);
assert.equal(SECTORS.filter(s => s.kind === 'island').length, 5);
assert.equal(SECTORS.filter(s => s.kind === 'land').length, 36);
assert.ok(!SECTORS[at('R4')].coastal && SECTORS[at('R8')].coastal);

// Movement.
assert.ok(reachable('S', at('R5')).has(at('IX')));            // soldier: 2 steps via R8
assert.ok(!reachable('S', at('R4')).has(at('B8')));           // cannot cross Île X in one move
assert.ok(!reachable('T', at('R8')).has(at('S1')));           // never into the sea
assert.deepEqual(codes(reachable('D', at('S1'))), ['IN', 'IX', 'R2', 'R5', 'R8'].sort());
assert.ok(!reachable('D', at('R8')).has(at('R4')));           // ships never enter sector 4
assert.ok(reachable('C', hqOf('red')).has(at('B8')));         // fighter: QG → R2 → R5 → R8 → IX → B8
assert.ok(reachable('T', at('IX')).has(at('J6')));            // leaving an island next round is fine

// Bigger side captures into its reserve.
{
  const s = empty(2);
  place(s, 'red', 'T', 'R8'); const b = place(s, 'blue', 'S', 'IX');
  const n = resolveRound(s, { red: [{ type: 'move', kind: 'T', from: at('R8'), to: at('IX') }] });
  const moved = n.pieces.find(p => p.id === b.id)!;
  assert.equal(moved.loc, 'RV'); assert.equal(moved.army, 'red');
}
// Tie: the piece that moved bounces back; a second tie means nobody captures.
{
  const s = empty();
  place(s, 'red', 'T', 'R8'); place(s, 'blue', 'T', 'IX');
  const n = resolveRound(s, { red: [{ type: 'move', kind: 'T', from: at('R8'), to: at('IX') }] });
  assert.equal(n.pieces.filter(p => p.loc === at('R8')).length, 1);
}
// Three-way: the two weakest tie, the strongest takes both.
{
  const s = empty();
  place(s, 'red', 'D', 'IX'); place(s, 'blue', 'S', 'IX'); place(s, 'yellow', 'S', 'IX');
  const n = resolveRound(s, {});
  assert.equal(n.pieces.filter(p => p.army === 'red' && p.loc === 'RV').length, 2);
}
// Exchanges, Power and the méga-missile.
{
  const s = empty(2);
  armyOf(s, 'red').power = 4;
  for (let i = 0; i < 3; i++) place(s, 'red', 'S', 'R0');
  const n = resolveRound(s, { red: [
    { type: 'buy', kind: 'S' },
    { type: 'upgrade', kind: 'S', at: at('R0') },
    { type: 'move', kind: 'R', from: at('R0'), to: at('R1') },  // illegal: an exchanged piece cannot move
    { type: 'move', kind: 'S', from: 'RV', to: hqOf('red') },
  ] });
  assert.equal(n.pieces.find(p => p.kind === 'R')!.loc, at('R0'));
  assert.equal(n.pieces.filter(p => p.kind === 'S' && p.loc === hqOf('red')).length, 1);
  assert.equal(armyOf(n, 'red').power, 2);
  assert.equal(n.report!.orders[0].results.filter(r => !r.ok).length, 1);
}
{
  const s = empty(2);
  place(s, 'red', 'CR', 'S1'); place(s, 'red', 'CR', 'S1'); place(s, 'red', 'S', 'S1');
  const pick = pickMissile(s, 'red', at('S1'))!;
  assert.deepEqual(pick.use, { CR: 2 });
  place(s, 'blue', 'A', 'B4'); place(s, 'red', 'C', 'B4');
  const n = resolveRound(s, { red: [
    { type: 'missile', at: at('S1'), use: pick.use, power: 0 },
    { type: 'launch', from: at('S1'), target: at('B4') },
  ] });
  assert.equal(n.pieces.filter(p => p.loc === at('B4')).length, 0);
  assert.equal(n.pieces.filter(p => p.loc === at('S1')).length, 1);
}
// Power: 1 per occupied enemy territory.
{
  const s = empty();
  place(s, 'red', 'S', 'B0'); place(s, 'red', 'S', 'B1'); place(s, 'red', 'C', 'J4');
  const n = resolveRound(s, { red: [{ type: 'move', kind: 'C', from: at('J4'), to: at('J3') }] });
  assert.equal(armyOf(n, 'red').power, 12);
}
// Penalty: no legal order costs 1 Power, or turns the smallest piece into Power.
{
  const s = empty(2);
  armyOf(s, 'red').power = 0;
  place(s, 'red', 'T', 'R0'); place(s, 'red', 'S', 'R0');
  const n = resolveRound(s, {});
  assert.equal(n.pieces.filter(p => p.army === 'red').length, 1);
  assert.equal(armyOf(n, 'red').power, 1);
}
// Flag: needs a Soldat or Régiment; the winner takes the loser's pieces and Power.
{
  const s = empty();
  place(s, 'red', 'C', 'B0'); place(s, 'blue', 'T', 'J0');
  armyOf(s, 'blue').power = 5;
  let n = resolveRound(s, { red: [{ type: 'move', kind: 'C', from: at('B0'), to: hqOf('blue') }] });
  assert.ok(armyOf(n, 'blue').alive);
  place(n, 'red', 'S', 'B1');
  n = resolveRound(n, { red: [{ type: 'move', kind: 'S', from: at('B1'), to: hqOf('blue') }] });
  assert.ok(!armyOf(n, 'blue').alive);
  assert.deepEqual(armyOf(n, 'red').flags, ['red', 'blue']);
  assert.equal(armyOf(n, 'red').power, 15); // 10 + blue's 5 (penalties offset by Power from J0)
  assert.equal(n.pieces.find(p => p.kind === 'T')!.army, 'red');
}
// Two players: winning both flags wins the game.
{
  const s = empty(2);
  place(s, 'red', 'S', 'B0'); place(s, 'green', 'S', 'J0');
  const n = resolveRound(s, {
    red: [{ type: 'move', kind: 'S', from: at('B0'), to: hqOf('blue') }],
    green: [{ type: 'move', kind: 'S', from: at('J0'), to: hqOf('yellow') }],
  });
  assert.equal(n.winner, 0);
}
console.log('rules ok');
