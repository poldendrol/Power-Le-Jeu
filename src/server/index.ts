import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { COLORS, newGame, resolveTurn, validateOrders, type Color, type GameState, type Order } from '../shared/rules';
import type { ClientMsg, RoomView, ServerMsg } from '../shared/protocol';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(fileURLToPath(import.meta.url), '../../public');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

interface Seat { color: Color; name: string; token: string; socket: WebSocket | null; orders: Order[] | null }
interface Room { id: string; seats: Seat[]; game: GameState | null; touched: number }
const rooms = new Map<string, Room>();

const server = createServer(async (req, res) => {
  const path = normalize(new URL(req.url ?? '/', 'http://x').pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, path === '/' ? 'index.html' : path);
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(200, { 'content-type': 'text/html' });
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
      room = rooms.get(id) ?? { id, seats: [], game: null, touched: Date.now() };
      rooms.set(id, room);
      seat = room.seats.find(s => s.token === msg.token) ?? null;
      if (!seat) {
        const free = COLORS.find(c => !room!.seats.some(s => s.color === c));
        if (room.game || !free) { send({ t: 'error', message: room.game ? 'La partie a déjà commencé' : 'La salle est pleine' }); seat = null; broadcast(room, ws); return; }
        seat = { color: free, name: String(msg.name).slice(0, 20) || free, token: msg.token, socket: null, orders: null };
        room.seats.push(seat);
      }
      seat.socket = ws;
      broadcast(room);
      return;
    }
    if (!room || !seat) return;
    room.touched = Date.now();
    if (msg.t === 'start') {
      if (room.game || room.seats[0] !== seat) return;
      if (room.seats.length < 2) return send({ t: 'error', message: 'Il faut au moins 2 joueurs' });
      room.game = newGame(room.seats.map(s => ({ color: s.color, name: s.name })));
    } else if (msg.t === 'orders') {
      const g = room.game;
      if (!g || g.winner || !g.players.find(p => p.color === seat!.color)?.alive) return;
      const err = validateOrders(g, seat.color, msg.orders);
      if (err) return send({ t: 'error', message: err });
      seat.orders = msg.orders;
      const alive = g.players.filter(p => p.alive).map(p => p.color);
      const waiting = room.seats.filter(s => alive.includes(s.color) && !s.orders);
      if (!waiting.length) {
        room.game = resolveTurn(g, Object.fromEntries(room.seats.map(s => [s.color, s.orders ?? []])));
        for (const s of room.seats) s.orders = null;
      }
    } else if (msg.t === 'unsubmit') {
      seat.orders = null;
    }
    broadcast(room);
  });

  ws.on('close', () => {
    if (seat && seat.socket === ws) seat.socket = null;
    if (room) broadcast(room);
  });
});

function broadcast(room: Room, extra?: WebSocket) {
  const view = (you: Color | null): RoomView => ({
    id: room.id,
    hostColor: room.seats[0]?.color ?? null,
    seats: room.seats.map(s => ({ color: s.color, name: s.name, connected: !!s.socket, submitted: !!s.orders })),
    game: room.game,
    you,
  });
  for (const s of room.seats) s.socket?.send(JSON.stringify({ t: 'room', room: view(s.color) } satisfies ServerMsg));
  extra?.send(JSON.stringify({ t: 'room', room: view(null) } satisfies ServerMsg));
}

// Forget rooms idle for a day.
setInterval(() => {
  for (const [id, r] of rooms) if (Date.now() - r.touched > 86_400_000 && r.seats.every(s => !s.socket)) rooms.delete(id);
}, 3_600_000);

server.listen(PORT, () => console.log(`Power, le jeu on http://localhost:${PORT}`));
