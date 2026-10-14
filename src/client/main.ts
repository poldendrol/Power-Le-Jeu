import { BOARD_SIZE } from '../shared/board';
import { ARMY_HEX, ICON, bbox, boardArt, iconSvg, sectorPath } from './art';
import {
  BASE_KINDS, COLOR_NAME, LETTER, MISSILE_COST, SECTORS, UNITS, armyOf, describeOrder, executeOrder, hqOf, locName,
  newCtx, pickMissile, reachable, totalPower, value,
  type Color, type GameState, type Kind, type Loc, type Order,
} from '../shared/rules';
import type { ClientMsg, Options, RoomView, SeatOrders, ServerMsg } from '../shared/protocol';

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const app = $('#app')!;

function store(key: string, fallback: () => string) {
  try { const v = localStorage.getItem(key); if (v) return v; const n = fallback(); localStorage.setItem(key, n); return n; }
  catch { return fallback(); }
}
const token = store('power.token', () => crypto.randomUUID());
const roomId = () => location.hash.slice(1);

let room: RoomView | null = null;
let ws: WebSocket | null = null;
let error = '';
let clockSkew = 0;
// Planning state for this round.
let orders: SeatOrders = {};
let plannedRound = 0;
let army: Color | null = null;   // army whose orders are being written
let sel: Loc | null = null;       // selected sector or reserve
let mode: { t: 'move'; kind: Kind; from: Loc } | { t: 'pick'; kind: Kind } | { t: 'launch'; from: Loc } | null = null;

const send = (m: ClientMsg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

function connect(name: string) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => send({ t: 'join', room: roomId(), name, token });
  ws.onmessage = e => {
    const m: ServerMsg = JSON.parse(e.data);
    if (m.t === 'room') {
      const before = room?.game;
      room = m.room;
      const after = room.game;
      if (before && after?.report && after.round === before.round + 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) startReplay(before, after);
      clockSkew = room.now - Date.now();
      const g = room.game;
      if (g && g.round !== plannedRound) {
        plannedRound = g.round;
        orders = room.draft ?? {};
        sel = null; mode = null;
        const mine = room.you !== null ? g.seats[room.you].armies.filter(c => armyOf(g, c).alive) : [];
        if (!army || !mine.includes(army)) army = mine[0] ?? null;
      }
      error = '';
    } else error = m.message;
    render();
  };
  ws.onclose = () => { error = 'Connection lost, reconnecting…'; render(); setTimeout(() => connect(name), 2000); };
}

// ---------- Screens ----------
function render() {
  if (!roomId()) return renderHome();
  if (!room) { app.innerHTML = `<div class="splash"><div class="spinner"></div><p class="muted">Connecting…</p></div>`; return; }
  if (!room.game) return renderLobby(room);
  renderGame(room, replay ? replay.prev : room.game);
}

const hero = (inner: string) => `
  <div class="hero">
    <svg class="hero-art" viewBox="0 0 ${BOARD_SIZE} ${BOARD_SIZE}" preserveAspectRatio="xMidYMid slice">${ART}</svg>
    <div class="hero-card">
      <div class="logo">POWER</div>
      <p class="tagline">Secret orders. Simultaneous strikes. One flag to rule them all.</p>
      ${inner}
    </div>
  </div>`;

function renderHome() {
  app.innerHTML = hero(`
    <button id="create" class="primary big">Create a game</button>
    <p class="muted small">Invite up to 3 friends with a link, or fill the table with computer players.</p>`);
  $('#create')!.onclick = () => { location.hash = Math.random().toString(36).slice(2, 8); };
}

function askNameAndJoin() {
  const saved = store('power.name', () => '');
  app.innerHTML = hero(`
    <label class="field"><span>Your commander name</span><input id="name" maxlength="20" value="${esc(saved)}" autofocus></label>
    <button id="join" class="primary big">Join the game</button>`);
  const go = () => {
    const name = ($('#name') as HTMLInputElement).value.trim() || 'Player';
    try { localStorage.setItem('power.name', name); } catch { /* private mode */ }
    connect(name); render();
  };
  $('#join')!.onclick = go;
  $('#name')!.onkeydown = e => { if (e.key === 'Enter') go(); };
}

function renderLobby(r: RoomView) {
  const host = r.you === 0;
  const n = r.seats.length;
  const variant = n === 2 ? 'Two players: each commands two neighbouring armies, 10 orders per round.'
    : n === 3 ? 'Three players: the Blue territory stays empty.' : n === 4 ? 'Four players: one army each.' : 'Waiting for at least one more player.';
  const colors: Color[][] = n === 2 ? [['yellow', 'blue'], ['green', 'red']] : [['yellow'], ['green'], ['red'], ['blue']];
  const opt = (id: string, cur: number, vals: [number, string][]) =>
    `<select id="${id}" ${host ? '' : 'disabled'}>${vals.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const seatCards = [0, 1, 2, 3].map(i => {
    const s = r.seats[i];
    if (!s) return `<div class="seat empty">${host && i === n ? '<button id="addbot" class="ghost">＋ Add computer</button>' : '<span class="muted">Open seat</span>'}</div>`;
    return `<div class="seat">
      <div class="seat-colors">${(colors[i] ?? []).map(c => `<span class="swatch" style="background:${ARMY_HEX[c]}"></span>`).join('')}</div>
      <div class="seat-name">${s.bot ? '<span class="bot">AI</span>' : ''}${esc(s.name)}</div>
      <div class="muted small">${i === 0 ? 'Host' : s.bot ? 'Computer' : s.connected ? 'Ready' : 'Disconnected'}${i === r.you ? ' · you' : ''}</div>
      ${s.bot && host ? `<button class="link" data-rmbot="${i}">Remove</button>` : ''}
    </div>`;
  }).join('');
  app.innerHTML = hero(`
    <div class="lobby-head"><span class="muted small">GAME</span> <b>${esc(r.id)}</b></div>
    <div class="share"><input readonly value="${esc(location.href)}"><button id="copy" class="ghost">Copy link</button></div>
    <div class="seats">${seatCards}</div>
    <p class="muted small">${variant}</p>
    <div class="opts">
      <label class="field"><span>Order time</span>${opt('timer', r.options.timerMin, [[0, 'Unlimited'], [1, '1 min'], [2, '2 min'], [3, '3 min (rules)'], [5, '5 min'], [10, '10 min']])}</label>
      <label class="field"><span>Game length</span>${opt('limit', r.options.limitMin, [[0, 'Until the last flag'], [60, '1 h'], [90, '1 h 30'], [120, '2 h (rules)'], [180, '3 h']])}</label>
    </div>
    ${r.you === null ? '<p class="error">This game is full or has already started.</p>' : ''}
    ${host ? `<button id="start" class="primary big" ${n < 2 ? 'disabled' : ''}>Start the game</button>` : '<p class="muted">Waiting for the host to start the game…</p>'}
    ${error ? `<p class="error">${esc(error)}</p>` : ''}`);
  $('#copy')!.onclick = () => { navigator.clipboard?.writeText(location.href); $('#copy')!.textContent = 'Copied!'; };
  if (host) {
    const sendOpts = () => send({ t: 'options', options: { timerMin: Number(($('#timer') as HTMLSelectElement).value), limitMin: Number(($('#limit') as HTMLSelectElement).value) } satisfies Options });
    $('#timer')!.onchange = sendOpts; $('#limit')!.onchange = sendOpts;
    $('#start')!.onclick = () => send({ t: 'start' });
    const add = $('#addbot'); if (add) add.onclick = () => send({ t: 'addBot' });
    app.querySelectorAll<HTMLElement>('[data-rmbot]').forEach(b => b.onclick = () => send({ t: 'removeBot', seat: Number(b.dataset.rmbot) }));
  }
}

/** Replay this player's own orders on a copy of the board, to show where pieces will be. */
function project(g: GameState) {
  const s: GameState = structuredClone(g);
  const ctx = newCtx();
  const errors = new Map<Order, string>();
  for (const [color, list] of Object.entries(orders) as [Color, Order[]][]) {
    for (const o of list) { const e = safeExec(s, ctx, color, o); if (e) errors.set(o, e); }
  }
  return { s, ctx, errors };
}
function safeExec(s: GameState, ctx: ReturnType<typeof newCtx>, color: Color, o: Order) {
  try { return executeOrder(s, ctx, color, o); } catch { return 'Invalid order'; }
}

const ART = boardArt();
const KIND_ORDER: Kind[] = ['S', 'R', 'T', 'A', 'C', 'B', 'D', 'CR', 'M'];
let focusKind: Kind | null = null; // highlight this kind of your pieces on the board

function pieceToken(k: Kind, color: Color, n: number, x: number, y: number, extra = '', attrs = '') {
  return `<g class="token ${extra}" ${attrs} transform="translate(${x},${y})">
    <ellipse rx="11" ry="3.5" cy="11" class="token-shadow"/>
    <path d="${ICON[k]}" transform="translate(-13,-13) scale(1.08)" fill="${ARMY_HEX[color]}" class="token-shape"/>
    ${n > 1 ? `<g transform="translate(11,8)"><circle r="6.5" class="badge"/><text class="badge-text" y="3">${n}</text></g>` : ''}
  </g>`;
}

// Replay of the round that just resolved: pieces fly to their targets, then battles flash.
let replay: { prev: GameState; next: GameState; timer: number; start: number } | null = null;
const MOVE_MS = 900;
function replayMoves(rp: { next: GameState }) {
  return rp.next.report!.orders.flatMap(o => o.results.filter(x => x.ok && x.order.type === 'move').map(x => ({ army: o.army, ...(x.order as Extract<Order, { type: 'move' }>) })));
}
function replayTiming(n: number) { const stagger = n ? Math.min(110, 1600 / n) : 0; return { stagger, movesEnd: n * stagger + MOVE_MS }; }
function startReplay(prev: GameState, next: GameState) {
  if (replay) clearTimeout(replay.timer);
  const { movesEnd } = replayTiming(replayMoves({ next }).length);
  const fx = next.report!.battles.length + next.report!.blasts.length;
  replay = { prev, next, start: performance.now(), timer: window.setTimeout(endReplay, movesEnd + (fx ? 1100 : 200)) };
}
function endReplay() { if (replay) clearTimeout(replay.timer); replay = null; render(); }

function renderGame(r: RoomView, g: GameState) {
  const me = r.you;
  const myArmies = me !== null ? g.seats[me].armies : [];
  const submitted = me !== null && r.seats[me].submitted;
  const over = g.winner !== undefined;
  const canPlan = !replay && !!army && !submitted && !over && armyOf(g, army).alive;
  const { s: proj, ctx, errors } = replay ? { s: structuredClone(g), ctx: newCtx(), errors: new Map<Order, string>() } : project(g);
  const movers = replay ? replayMoves(replay) : [];
  for (const mv of movers) {
    const i = proj.pieces.findIndex(p => p.army === mv.army && p.kind === mv.kind && p.loc === mv.from);
    if (i >= 0) proj.pieces.splice(i, 1);
  }
  const list = army ? orders[army] ?? [] : [];

  const center = (id: number) => { const b = bbox(SECTORS[id]); return [b.x + b.w / 2, b.y + b.h / 2]; };
  // Target sectors for the current mode.
  let targets = new Set<number>();
  // Pick mode: a unit type was chosen in the army panel; any sector one of them can reach is a target.
  const pickFrom = new Map<number, Loc>(); // destination -> source sector used for it
  const sources = new Set<number>();
  if (mode?.t === 'move') targets = mode.from === 'RV' ? new Set([hqOf(army!)]) : reachable(mode.kind, mode.from);
  else if (mode?.t === 'pick') {
    const k = mode.kind;
    const free = proj.pieces.filter(p => p.army === army && p.kind === k && !ctx.moved.has(p.id));
    const locs = [...new Set(free.map(p => p.loc))];
    const dist = (a: Loc, b: number) => { if (a === 'RV') return 99; const [ax, ay] = center(a), [bx, by] = center(b); return Math.hypot(ax - bx, ay - by); };
    for (const l of locs) {
      if (l !== 'RV') sources.add(l);
      const reach = l === 'RV' ? new Set([hqOf(army!)]) : reachable(k, l);
      for (const d of reach) { const cur = pickFrom.get(d); if (cur === undefined || dist(l, d) < dist(cur, d)) pickFrom.set(d, l); }
    }
    targets = new Set(pickFrom.keys());
  }
  else if (mode?.t === 'launch') targets = new Set(SECTORS.map(x => x.id));

  // ----- Board -----
  const labels = SECTORS.map(sec => {
    const b = bbox(sec);
    const txt = sec.kind === 'hq' ? `HQ ${'⚑'.repeat(armyOf(g, sec.territory!)?.alive ? armyOf(g, sec.territory!).flags.length : 0)}` : sec.code;
    return `<text x="${b.x + 5}" y="${b.y + 12}" class="code ${sec.kind}">${txt}</text>`;
  }).join('');
  const tokens = SECTORS.map(sec => {
    const here = proj.pieces.filter(p => p.loc === sec.id);
    if (!here.length) return '';
    const b = bbox(sec);
    const items: { k: Kind; c: Color; n: number; cls: string }[] = [];
    for (const c of [...new Set(here.map(p => p.army))]) for (const k of KIND_ORDER) {
      const ps = here.filter(p => p.army === c && p.kind === k);
      if (!ps.length) continue;
      const planned = ps.some(p => ctx.moved.has(p.id) && ctx.prev.get(p.id) !== sec.id);
      const focus = (focusKind === k || (mode?.t === 'pick' && mode.kind === k) || (mode?.t === 'move' && mode.from === sec.id && mode.kind === k)) && c === army;
      const mine = canPlan && c === army && k !== 'M';
      items.push({ k, c, n: ps.length, cls: `${planned ? 'planned' : ''} ${focus ? 'focus' : ''} ${mine ? 'mine' : ''}` });
    }
    const per = Math.max(1, Math.floor((b.w - 6) / 30));
    const rows = Math.ceil(items.length / per);
    const top = b.y + Math.max(28, (b.h - rows * 30) / 2 + 15);
    return items.map((it, i) => {
      const row = Math.floor(i / per), inRow = Math.min(per, items.length - row * per);
      const x = b.x + b.w / 2 + ((i % per) - (inRow - 1) / 2) * 30;
      return pieceToken(it.k, it.c, it.n, x, top + row * 30, it.cls, it.cls.includes('mine') ? `data-tok-sec="${sec.id}" data-tok-kind="${it.k}"` : '');
    }).join('');
  }).join('');
  const hits = SECTORS.map(sec => `<path d="${sectorPath(sec)}" data-sec="${sec.id}" class="hit ${targets.has(sec.id) ? 'target' : ''} ${sources.has(sec.id) ? 'src' : ''} ${sel === sec.id ? 'sel' : ''}"/>`).join('');
  const fxLayer = replay ? `<g class="fx">${movers.map((mv, i) => `<g class="mover" data-i="${i}">${pieceToken(mv.kind, mv.army, 1, 0, 0)}</g>`).join('')}
    ${replay.next.report!.battles.map(id => { const [x, y] = center(id); return `<g transform="translate(${x},${y})"><circle r="26" class="clash"/><text class="clash-icon" y="7">⚔</text></g>`; }).join('')}
    ${replay.next.report!.blasts.map(id => { const [x, y] = center(id); return `<g transform="translate(${x},${y})"><circle r="34" class="blast"/></g>`; }).join('')}</g>` : '';
  const arrows = replay ? '' : list.map(o => {
    if (o.type === 'move' && typeof o.to === 'number') {
      const [tx, ty] = center(o.to);
      const [fx, fy] = o.from === 'RV' ? [tx, ty - 50] : center(o.from);
      const mx = (fx + tx) / 2 - (ty - fy) * 0.15, my = (fy + ty) / 2 + (tx - fx) * 0.15;
      return `<path d="M${fx},${fy} Q${mx},${my} ${tx},${ty}" class="arrow ${errors.has(o) ? 'bad' : ''}" marker-end="url(#head)"/>`;
    }
    if (o.type === 'launch' && o.target !== 'RV') { const [x, y] = center(o.target); return `<circle cx="${x}" cy="${y}" r="24" class="boom"/>`; }
    return '';
  }).join('');

  // ----- Top bar -----
  const maxStrength = Math.max(1, ...g.seats.map((_, i) => totalPower(g, i)));
  const playerChips = g.seats.map((seat, i) => {
    const dead = seat.armies.every(c => !armyOf(g, c).alive);
    const strength = totalPower(g, i);
    const flags = seat.armies.reduce((t, c) => t + armyOf(g, c).flags.length, 0);
    const status = over ? '' : dead ? 'out' : r.seats[i]?.submitted ? 'ready' : 'writing';
    return `<div class="pchip ${dead ? 'dead' : ''} ${i === me ? 'me' : ''}">
      <div class="pchip-colors">${seat.armies.map(c => `<span class="swatch" style="background:${ARMY_HEX[c]}"></span>`).join('')}</div>
      <div class="pchip-body">
        <div class="pchip-name">${r.seats[i]?.bot ? '<span class="bot">AI</span>' : ''}${esc(seat.name)}${i === me ? ' <span class="muted">(you)</span>' : ''}</div>
        <div class="bar"><span style="width:${(strength / maxStrength) * 100}%;background:${ARMY_HEX[seat.armies[0]]}"></span></div>
        <div class="pchip-stats"><span title="Total strength">⚔ ${strength}</span><span title="Flags">⚑ ${flags}</span>${status ? `<span class="status ${status}">${status === 'ready' ? 'Ready' : status === 'writing' ? 'Writing…' : 'Out'}</span>` : ''}</div>
      </div></div>`;
  }).join('');
  const deadline = r.deadline ? r.deadline - clockSkew : null;
  const topbar = `<header class="topbar">
    <div class="brand">POWER</div>
    <div class="round"><span class="muted small">ROUND</span><b>${g.round}</b></div>
    ${replay ? `<button class="pill play" id="skip">▶ Round ${g.round} in action · skip</button>` : ''}
    ${deadline && !over ? `<div class="timer" id="timer"></div>` : ''}
    ${g.lastRound && !over ? '<div class="pill warn">Last round</div>' : ''}
    <div class="pchips">${playerChips}</div>
  </header>`;

  // ----- Forces card: what you have, at a glance -----
  let forces = '';
  if (army) {
    const a = armyOf(proj, army);
    const mine = g.pieces.filter(p => p.army === army);
    const held = new Set(mine.filter(p => p.loc !== 'RV' && SECTORS[p.loc].kind === 'land' && SECTORS[p.loc].territory !== army).map(p => SECTORS[p.loc as number].territory));
    const tabs = myArmies.length > 1 ? `<div class="tabs">${myArmies.map(c =>
      `<button class="tab ${c === army ? 'on' : ''}" data-army="${c}" ${armyOf(g, c).alive ? '' : 'disabled'}><span class="swatch" style="background:${ARMY_HEX[c]}"></span>${COLOR_NAME[c]} <span class="muted">${(orders[c] ?? []).length}/${g.ordersPerArmy}</span></button>`).join('')}</div>` : '';
    const roster = KIND_ORDER.map(k => {
      const onBoard = mine.filter(p => p.kind === k && p.loc !== 'RV').length, inRes = mine.filter(p => p.kind === k && p.loc === 'RV').length;
      return `<button class="unit ${onBoard + inRes ? '' : 'none'} ${mode?.t === 'pick' && mode.kind === k ? 'on' : ''}" data-pick="${k}" title="${UNITS[k].name}: power ${UNITS[k].power}${UNITS[k].move ? `, moves ${UNITS[k].move}` : ''}">
        <span class="unit-icon">${iconSvg(k, 26, ARMY_HEX[army!])}</span>
        <span class="unit-text"><span class="unit-name">${UNITS[k].name}</span><span class="unit-count"><b>${onBoard}</b>${inRes ? `<i>+${inRes} in reserve</i>` : ''}</span></span>
      </button>`;
    }).join('');
    forces = `<section class="card">
      ${tabs}
      <div class="card-head"><span class="swatch lg" style="background:${ARMY_HEX[army]}"></span><h2>${COLOR_NAME[army]} army</h2>${armyOf(g, army).alive ? '' : '<span class="pill">Defeated</span>'}</div>
      <div class="stats">
        <div class="stat"><b>${value(mine)}</b><span>Strength</span></div>
        <div class="stat"><b>${a.power}</b><span>Power ⚡</span></div>
        <div class="stat"><b>${armyOf(g, army).flags.length}</b><span>Flags ⚑</span></div>
        <div class="stat"><b>${held.size}</b><span>Territories</span></div>
      </div>
      <div class="roster">${roster}</div>
    </section>`;
  }

  // ----- Command card -----
  let command = '';
  if (over) command = `<section class="card win"><div class="trophy">🏆</div><h2>${esc(g.seats[g.winner!].name)} wins!</h2><p class="muted">${g.endReason === 'time' ? 'Most total strength when time ran out.' : 'Every flag captured.'}</p></section>`;
  else if (me === null) command = `<section class="card"><p class="muted">You are watching this game.</p></section>`;
  else if (!myArmies.some(c => armyOf(g, c).alive)) command = `<section class="card"><p class="muted">Your flags have fallen. You can watch the rest of the game.</p></section>`;
  else if (submitted) command = `<section class="card"><h3>Orders sent</h3><p class="muted">Waiting for the other commanders…</p><button id="edit" class="ghost">Edit my orders</button></section>`;
  else {
    const slots = Array.from({ length: g.ordersPerArmy }, (_, i) => {
      const o = list[i];
      if (!o) return `<li class="slot empty"><span class="num">${i + 1}</span><span class="muted">Empty order</span></li>`;
      return `<li class="slot ${errors.has(o) ? 'bad' : ''}"><span class="num">${i + 1}</span><span>${esc(describeOrder(o, army!))}${errors.has(o) ? `<em>${esc(errors.get(o)!)}</em>` : ''}</span><button class="x" data-del="${i}" title="Remove">✕</button></li>`;
    }).join('');
    const hint = mode?.t === 'move' && mode.from === sel
      ? `<div class="hint active"><span>Click a <b>gold</b> sector to send the ${UNITS[mode.kind].name}, or click another of your units.</span> <button id="cancel" class="link">Cancel</button></div>${locPanel(proj, ctx, sel, mode.kind)}`
      : mode
      ? `<div class="hint active">${mode.t === 'move' ? `Click a <b>gold</b> sector to send the ${UNITS[mode.kind].name}.` : mode.t === 'pick' ? `Click a <b>gold</b> sector to move a ${UNITS[mode.kind].name} there.${targets.size ? '' : ' None of them can move this round.'}` : `Pick the megamissile's target, or a reserve: ${g.armies.filter(a => a.alive).map(a => `<button class="chipbtn" data-reserve="${a.color}"><span class="swatch" style="background:${ARMY_HEX[a.color]}"></span>${COLOR_NAME[a.color]}</button>`).join(' ')}`} <button id="cancel" class="link">Cancel</button></div>`
      : sel !== null ? locPanel(proj, ctx, sel)
      : `<div class="hint">Click one of your units on the map, then a <b>gold</b> sector to move it. Or pick a unit type above.</div>`;
    command = `<section class="card">
      <div class="card-head"><h3>Orders</h3><span class="muted small">${list.length} / ${g.ordersPerArmy}</span>
        <button class="ghost sm" id="reserve">Reserve · ⚡${armyOf(proj, army!).power}</button></div>
      ${hint}
      <ol class="slots">${slots}</ol>
      <div class="actions"><button id="submit" class="primary">Send orders</button>${r.deadline && !r.seats[me].pauseUsed ? '<button id="pause" class="ghost">Pause +3 min</button>' : ''}</div>
    </section>`;
  }

  const report = g.report ? `<section class="card">
    <h3>Round ${g.report.round} report</h3>
    <ul class="log">${g.report.events.map(e => `<li>${esc(e)}</li>`).join('') || '<li class="muted">No battles.</li>'}</ul>
    <details><summary>Order sheets</summary>${g.report.orders.map(o => `<div class="sheet"><div><span class="swatch" style="background:${ARMY_HEX[o.army]}"></span><b>${COLOR_NAME[o.army]}</b></div><ol>${o.results.map(x => `<li class="${x.ok ? '' : 'bad'}">${esc(describeOrder(x.order, o.army))}${x.ok ? '' : ` <em>${esc(x.note ?? '')}</em>`}</li>`).join('') || '<li class="muted">No orders</li>'}</ol></div>`).join('')}</details>
  </section>` : '';

  app.innerHTML = `
    <div class="game">
      ${topbar}
      <main class="field-area">
        <div class="board-frame"><svg viewBox="0 0 ${BOARD_SIZE} ${BOARD_SIZE}" class="board">${ART}${labels}${hits}${tokens}${arrows}${fxLayer}</svg>
          <div class="tooltip" id="tip" hidden></div></div>
        <aside class="side">${error ? `<div class="toast">${esc(error)}</div>` : ''}${forces}${command}${report}</aside>
      </main>
    </div>`;

  if (replay) {
    const { stagger } = replayTiming(movers.length);
    const elapsed = performance.now() - replay.start; // re-renders mid-replay continue where they were
    app.querySelectorAll<SVGGElement>('.mover').forEach(el => {
      const mv = movers[Number(el.dataset.i)];
      const [tx, ty] = center(mv.to);
      const [fx, fy] = mv.from === 'RV' ? [tx, ty - 60] : center(mv.from);
      el.animate([{ transform: `translate(${fx}px,${fy}px) scale(1)` }, { transform: `translate(${(fx + tx) / 2}px,${(fy + ty) / 2}px) scale(1.35)`, offset: .5 }, { transform: `translate(${tx}px,${ty}px) scale(1)` }],
        { duration: MOVE_MS, delay: Number(el.dataset.i) * stagger - elapsed, easing: 'ease-in-out', fill: 'both' });
    });
    const end = replayTiming(movers.length).movesEnd;
    app.querySelectorAll<SVGElement>('.clash, .clash-icon').forEach(el => el.animate(
      [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1.15)', offset: .4 }, { opacity: 0, transform: 'scale(1.4)' }],
      { duration: 1000, delay: end - elapsed, fill: 'both' }));
    app.querySelectorAll<SVGElement>('.blast').forEach(el => el.animate(
      [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1)', offset: .3 }, { opacity: 0, transform: 'scale(1.6)' }],
      { duration: 1000, delay: end - elapsed, fill: 'both' }));
    const skip = $('#skip'); if (skip) skip.onclick = endReplay;
    app.querySelector('.board')?.addEventListener('click', endReplay);
  }

  // ----- Events -----
  const tip = $('#tip')!;
  app.querySelectorAll<SVGPathElement>('[data-sec]').forEach(el => {
    const id = Number(el.dataset.sec);
    el.addEventListener('mouseenter', () => {
      const here = proj.pieces.filter(p => p.loc === id);
      const sec = SECTORS[id];
      const byArmy = [...new Set(here.map(p => p.army))].map(c => `<div class="tip-row"><span class="swatch" style="background:${ARMY_HEX[c]}"></span>${here.filter(p => p.army === c).length} pieces · ⚔ ${value(here.filter(p => p.army === c))}<div class="tip-units">${KIND_ORDER.filter(k => here.some(p => p.army === c && p.kind === k)).map(k => `${here.filter(p => p.army === c && p.kind === k).length} ${UNITS[k].name}`).join(', ')}</div></div>`).join('');
      tip.innerHTML = `<b>${esc(sec.name)}</b>${sec.coastal ? ' <span class="muted">· coast</span>' : ''}${byArmy || '<div class="muted">Empty</div>'}`;
      tip.hidden = false;
    });
    el.addEventListener('mousemove', e => {
      const box = (el.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect();
      tip.style.left = `${Math.min(e.clientX - box.left + 14, box.width - 200)}px`;
      tip.style.top = `${e.clientY - box.top + 14}px`;
    });
    el.addEventListener('mouseleave', () => { tip.hidden = true; });
    el.addEventListener('click', () => clickSector(id));
  });
  // Your own units on the map: click one, then click where it should go.
  app.querySelectorAll<SVGGElement>('[data-tok-sec]').forEach(el => {
    const id = Number(el.dataset.tokSec);
    const hit = app.querySelector<SVGPathElement>(`[data-sec="${id}"]`)!;
    el.addEventListener('mouseenter', () => hit.dispatchEvent(new MouseEvent('mouseenter')));
    el.addEventListener('mousemove', e => hit.dispatchEvent(new MouseEvent('mousemove', e)));
    el.addEventListener('mouseleave', () => { tip.hidden = true; });
    el.addEventListener('click', () => clickSector(id, el.dataset.tokKind as Kind));
  });
  function clickSector(id: number, kind?: Kind) {
    if (!canPlan) return;
    const sameUnit = mode?.t === 'move' && mode.from === id && (!kind || mode.kind === kind);
    if (mode && targets.has(id) && !(kind && mode.t === 'move' && mode.from === id)) {
      if (mode.t === 'move') add({ type: 'move', kind: mode.kind, from: mode.from, to: id });
      else if (mode.t === 'pick') add({ type: 'move', kind: mode.kind, from: pickFrom.get(id)!, to: id });
      else add({ type: 'launch', from: mode.from, target: id });
      return;
    }
    if (sameUnit) { mode = null; sel = null; return render(); } // clicking the picked unit again cancels
    const free = (k: Kind) => proj.pieces.some(p => p.army === army && p.loc === id && p.kind === k && !ctx.moved.has(p.id));
    const k = kind && free(kind) ? kind : KIND_ORDER.find(k => k !== 'M' && free(k));
    sel = proj.pieces.some(p => p.army === army && p.loc === id) ? id : null;
    mode = sel !== null && k ? { t: 'move', kind: k, from: id } : null;
    render();
  }
  app.querySelectorAll<HTMLElement>('[data-pick]').forEach(b => b.onclick = () => {
    const k = b.dataset.pick as Kind;
    if (!canPlan) { focusKind = focusKind === k ? null : k; return render(); }
    if (mode?.t === 'pick' && mode.kind === k) { mode = null; return render(); }
    sel = null;
    if (k === 'M') {
      const m = proj.pieces.find(p => p.army === army && p.kind === 'M');
      mode = m ? { t: 'launch', from: m.loc } : null;
    } else mode = { t: 'pick', kind: k };
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-army]').forEach(b => b.onclick = () => { army = b.dataset.army as Color; sel = null; mode = null; render(); });
  app.querySelectorAll<HTMLElement>('[data-move]').forEach(b => b.onclick = () => { mode = { t: 'move', kind: b.dataset.move as Kind, from: sel! }; render(); });
  app.querySelectorAll<HTMLElement>('[data-upgrade]').forEach(b => b.onclick = () => add({ type: 'upgrade', kind: b.dataset.upgrade as 'S', at: sel! }));
  app.querySelectorAll<HTMLElement>('[data-buy]').forEach(b => b.onclick = () => add({ type: 'buy', kind: b.dataset.buy as 'S' }));
  app.querySelectorAll<HTMLElement>('[data-launch]').forEach(b => b.onclick = () => { mode = { t: 'launch', from: sel! }; render(); });
  app.querySelectorAll<HTMLElement>('[data-reserve]').forEach(b => b.onclick = () => {
    if (mode?.t === 'launch') add({ type: 'launch', from: mode.from, target: 'RV', reserveOf: b.dataset.reserve as Color });
  });
  app.querySelectorAll<HTMLElement>('[data-del]').forEach(b => b.onclick = () => { orders[army!]!.splice(Number(b.dataset.del), 1); changed(); });
  const on = (id: string, f: () => void) => { const el = $(`#${id}`); if (el) el.onclick = f; };
  on('missile', () => { const pick = pickMissile(proj, army!, sel!); if (pick) add({ type: 'missile', at: sel!, ...pick }); });
  on('reserve', () => { sel = 'RV'; mode = null; render(); });
  on('cancel', () => { mode = null; render(); });
  on('close', () => { sel = null; render(); });
  on('submit', () => { sel = null; mode = null; send({ t: 'orders', orders, final: true }); });
  on('edit', () => send({ t: 'orders', orders, final: false }));
  on('pause', () => send({ t: 'pause' }));
  tick();

  function add(o: Order) {
    const cur = orders[army!] ?? [];
    if (cur.length >= g.ordersPerArmy) { error = `Up to ${g.ordersPerArmy} orders`; mode = null; return render(); }
    const err = safeExec(structuredClone(proj), structuredClone(ctx), army!, o);
    if (err) { error = err; mode = null; return render(); }
    orders[army!] = [...cur, o];
    error = '';
    mode = mode?.t === 'pick' && cur.length + 1 < g.ordersPerArmy ? mode : null;
    if (o.type === 'move') sel = null;
    changed();
  }
}

/** Actions for the selected sector or reserve of the active army. */
function locPanel(s: GameState, ctx: ReturnType<typeof newCtx>, at: Loc, active?: Kind) {
  const ps = s.pieces.filter(p => p.army === army && p.loc === at);
  const kinds = KIND_ORDER.filter(k => ps.some(p => p.kind === k));
  const a = armyOf(s, army!);
  const rows = kinds.map(k => {
    const all = ps.filter(p => p.kind === k), free = all.filter(p => !ctx.moved.has(p.id));
    const btns = [
      k !== 'M' && free.length ? `<button class="sm ${active === k ? 'primary' : 'ghost'}" data-move="${k}">${active === k ? 'Selected' : at === 'RV' ? 'To HQ' : 'Move'}</button>` : '',
      UNITS[k].up && all.length >= 3 ? `<button class="sm ghost" data-upgrade="${k}">3 → ${UNITS[UNITS[k].up!].name}</button>` : '',
      k === 'M' ? `<button class="sm danger" data-launch>Launch</button>` : '',
    ].join('');
    return `<div class="urow"><span class="unit-icon sm">${iconSvg(k, 20, ARMY_HEX[army!])}</span>
      <span class="urow-name">${UNITS[k].name} <b>×${all.length}</b>${free.length < all.length && k !== 'M' ? ` <em>${all.length - free.length} ordered</em>` : ''}</span>${btns}</div>`;
  }).join('');
  const buys = at === 'RV' ? `<div class="buy"><span class="muted small">Buy with Power</span><div class="buy-row">${BASE_KINDS.map(k => `<button class="buybtn" data-buy="${k}" ${a.power < UNITS[k].power ? 'disabled' : ''}>${iconSvg(k, 16)}<span>${UNITS[k].name}</span><b>⚡${UNITS[k].power}</b></button>`).join('')}</div></div>` : '';
  const canMissile = value(ps) + (at === 'RV' ? a.power : 0) >= MISSILE_COST;
  return `<div class="selpanel">
    <div class="selhead"><b>${at === 'RV' ? `${COLOR_NAME[army!]} reserve` : SECTORS[at].name}</b>${at === 'RV' ? `<span class="muted small">⚡ ${a.power} Power</span>` : ''}<button id="close" class="link">Close</button></div>
    ${rows || '<p class="muted small">No pieces here.</p>'}${buys}
    ${canMissile ? `<button class="sm danger wide" id="missile">${iconSvg('M', 14)} Build a megamissile (≥ ${MISSILE_COST})</button>` : ''}</div>`;
}

function changed() {
  send({ t: 'orders', orders, final: false });
  render();
}

let tickTimer = 0;
function tick() {
  clearInterval(tickTimer);
  const el = () => $('#timer');
  const upd = () => {
    if (!room?.deadline || !el()) return;
    const left = Math.max(0, room.deadline - clockSkew - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    el()!.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el()!.classList.toggle('urgent', left < 30000);
  };
  upd();
  tickTimer = window.setInterval(upd, 500);
}

function esc(s: string) { return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`); }

window.addEventListener('hashchange', () => location.reload());
if (roomId()) askNameAndJoin(); else render();
