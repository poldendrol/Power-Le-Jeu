// Bot-vs-bot games, to check the computer player plays legal, sensible games.
import { botOrders } from './ai';
import { newGame, resolveRound, totalPower, type GameState } from './rules';

for (const n of [2, 3, 4]) {
  let wins = 0, rounds = 0, bad = 0, total = 0;
  for (let game = 0; game < 10; game++) {
    let g: GameState = newGame(Array.from({ length: n }, (_, i) => `Bot${i}`));
    while (g.winner === undefined && g.round <= 150) {
      const orders = Object.assign({}, ...g.seats.map((_, i) => botOrders(g, i)));
      g = resolveRound(g, orders);
      for (const o of g.report!.orders) for (const r of o.results) { total++; if (!r.ok) bad++; }
    }
    if (g.winner !== undefined) wins++;
    rounds += g.round;
    if (game === 0) console.log(`  ${n}p sample: round ${g.round}, winner ${g.winner ?? '-'}, power ${g.seats.map((_, i) => totalPower(g, i)).join('/')}`);
  }
  console.log(`${n} players: ${wins}/10 decided, avg ${Math.round(rounds / 10)} rounds, illegal orders ${bad}/${total}`);
}
