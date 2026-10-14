import assert from 'node:assert/strict';
import { newGame, resolveTurn, validateOrders, hqOf, type GameState } from './rules';

const base = newGame([{ color: 'red', name: 'A' }, { color: 'blue', name: 'B' }]);

// Bigger force captures the smaller one on the same square.
{
  const s: GameState = structuredClone(base);
  const r = s.units.find(u => u.owner === 'red' && u.kind === 'tank')!;
  const b = s.units.find(u => u.owner === 'blue' && u.kind === 'soldier')!;
  b.cell = 4; r.cell = 3; // tank at D1, soldier at E1
  assert.equal(validateOrders(s, 'red', [{ type: 'move', unitIds: [r.id], to: 4 }]), null);
  const n = resolveTurn(s, { red: [{ type: 'move', unitIds: [r.id], to: 4 }], blue: [] });
  assert.equal(n.units.some(u => u.id === b.id), false);
  assert.equal(n.players[0].reserve.soldier, 1);
}
// Too many orders are refused.
assert.ok(validateOrders(base, 'red', Array(6).fill({ type: 'trade', recipe: 0 })));
// A soldier cannot walk into the sea.
{
  const sol = base.units.find(u => u.owner === 'red' && u.kind === 'soldier')!;
  const sea = 5 * 11 + 3;
  assert.ok(validateOrders(base, 'red', [{ type: 'move', unitIds: [sol.id], to: sea }]));
}
// Taking the flag eliminates the player and ends a 2-player game.
{
  const s: GameState = structuredClone(base);
  s.units = s.units.filter(u => u.cell !== hqOf('blue'));
  const f = s.units.find(u => u.owner === 'red' && u.kind === 'fighter')!;
  f.cell = hqOf('blue') - 1;
  const n = resolveTurn(s, { red: [{ type: 'move', unitIds: [f.id], to: hqOf('blue') }], blue: [] });
  assert.equal(n.winner, 'red');
}
console.log('rules ok');
