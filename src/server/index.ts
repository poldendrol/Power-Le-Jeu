import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { newGame, resolveRound, type GameState, type Order } from '../shared/rules';
import type { ClientMsg, Options, RoomView, SeatOrders, ServerMsg } from '../shared/protocol';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(fileURLToPath(import.meta.url), '../../public');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PAUSE_MS = 3 * 60_000;

interface Seat { name: string; token: string; socket: WebSocket | null; draft: SeatOrders | null; submitted: boolean; pauseUsed: boolean }
interface Room {
  id: string; seats: Seat[]; game: GameState | null; options: Options;
  deadline: number | null; gameEndsAt: number | null; timer: NodeJS.Timeout | null; touched: number;
}
const rooms = new Map<string, Room>();

const server = createServer(async (req, res) => {
  const path = normalize(new URL(req.url ?? '/', 'http://x').pathname);
  const file = join(PUBLIC, path === '/' ? 'index.html' : path);
  try {
    if (!file.startsWith(PUBLIC)) throw new Error('outside');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    res.end(await readFile(join(PUBLIC, 'index.html')));
  }
});

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  let room: Room | null = null;
  let seat: Seat | null = null;
  const send = (m: ServerMsg) => ws.send(JSON.stringify(m));

  ws.on('message', raw => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.t === 'join') {
      const id = String(msg.room).slice(0, 12);
      room = rooms.get(id) ?? { id, seats: [], game: null, options: { timerMin: 3, limitMin: 0 }, deadline: null, gameEndsAt: null, timer: null, touched: Date.now() };
      rooms.set(id, room);
      seat = room.seats.find(s => s.token === msg.token) ?? null;
      if (!seat) {
        if (room.game || room.seats.length >= 4) {
          send({ t: 'error', message: room.game ? 'La partie a déjà commencé : tu peux la regarder.' : 'La salle est pleine (4 joueurs).' });
        } else {
          seat = { name: String(msg.name).slice(0, 20) || 'Joueur', token: String(msg.token), socket: null, draft: null, submitted: false, pauseUsed: false };
          room.seats.push(seat);
        }
      }
      if (seat) seat.socket = ws; else watchers.set(ws, room);
      broadcast(room);
      return;
    }
    if (!room || !seat) return;
    const r = room, me = seat, idx = r.seats.indexOf(me);
    r.touched = Date.now();
    if (msg.t === 'options') {
      if (r.game || idx !== 0) return;
      const timerMin = [0, 1, 2, 3, 5, 10].includes(msg.options.timerMin) ? msg.options.timerMin : 3;
      const limitMin = [0, 60, 90, 120, 180].includes(msg.options.limitMin) ? msg.options.limitMin : 0;
      r.options = { timerMin, limitMin };
    } else if (msg.t === 'start') {
      if (r.game || idx !== 0) return;
      if (r.seats.length < 2) return send({ t: 'error', message: 'Il faut au moins 2 joueurs' });
      r.game = newGame(r.seats.map(s => s.name));
      r.gameEndsAt = r.options.limitMin ? Date.now() + r.options.limitMin * 60_000 : null;
      startRound(r);
    } else if (msg.t === 'orders') {
      const g = r.game;
      if (!g || g.winner !== undefined) return;
      me.draft = sanitize(g, idx, msg.orders);
      me.submitted = !!msg.final;
      const waiting = r.seats.filter((s, i) => !s.submitted && g.armies.some(a => a.seat === i && a.alive));
      if (!waiting.length) return endRound(r);
    } else if (msg.t === 'pause') {
      if (!r.game || me.pauseUsed || !r.deadline) return;
      me.pauseUsed = true;
      r.deadline += PAUSE_MS;
      schedule(r);
    }
    broadcast(r);
  });

  ws.on('close', () => {
    watchers.delete(ws);
    if (seat && seat.socket === ws) seat.socket = null;
    if (room) broadcast(room);
  });
});
const watchers = new Map<WebSocket, Room>();

/** Keep only well-formed orders for the armies this seat commands. Legality is checked when they run. */
function sanitize(g: GameState, seat: number, orders: SeatOrders): SeatOrders {
  const out: SeatOrders = {};
  for (const color of g.seats[seat].armies) {
    const list = Array.isArray(orders?.[color]) ? orders[color]! : [];
    out[color] = list.slice(0, g.ordersPerArmy).filter((o: Order) => o && typeof o === 'object' && typeof o.type === 'string');
  }
  return out;
}

function startRound(r: Room) {
  const g = r.game!;
  for (const s of r.seats) { s.draft = null; s.submitted = false; }
  if (r.gameEndsAt && Date.now() >= r.gameEndsAt && !g.lastRound) g.lastRound = true;
  // Two armies to command means twice the writing time, as in the two-player rules.
  const armies = Math.max(...g.seats.map(s => s.armies.length));
  r.deadline = r.options.timerMin && g.winner === undefined ? Date.now() + r.options.timerMin * armies * 60_000 : null;
  schedule(r);
}

function schedule(r: Room) {
  if (r.timer) clearTimeout(r.timer);
  r.timer = r.deadline ? setTimeout(() => endRound(r), Math.max(0, r.deadline - Date.now())) : null;
}

function endRound(r: Room) {
  if (!r.game || r.game.winner !== undefined) return;
  const all: SeatOrders = {};
  for (const s of r.seats) Object.assign(all, s.draft ?? {});
  r.game = resolveRound(r.game, all);
  startRound(r);
  broadcast(r);
}

function broadcast(r: Room) {
  const view = (you: number | null): RoomView => ({
    id: r.id,
    seats: r.seats.map(s => ({ name: s.name, connected: !!s.socket, submitted: s.submitted, pauseUsed: s.pauseUsed })),
    you, options: r.options, game: r.game, deadline: r.deadline, gameEndsAt: r.gameEndsAt, now: Date.now(),
    draft: you === null ? null : r.seats[you].draft,
  });
  r.seats.forEach((s, i) => s.socket?.send(JSON.stringify({ t: 'room', room: view(i) } satisfies ServerMsg)));
  for (const [ws, wr] of watchers) if (wr === r) ws.send(JSON.stringify({ t: 'room', room: view(null) } satisfies ServerMsg));
}

// Forget rooms nobody has touched for a day.
setInterval(() => {
  for (const [id, r] of rooms) if (Date.now() - r.touched > 86_400_000 && r.seats.every(s => !s.socket)) {
    if (r.timer) clearTimeout(r.timer);
    rooms.delete(id);
  }
}, 3_600_000);

server.listen(PORT, () => console.log(`Power, le jeu on http://localhost:${PORT}`));
