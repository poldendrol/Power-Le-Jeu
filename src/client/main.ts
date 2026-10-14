import { GH, GRID, GW, sectorAt } from '../shared/board';
import {
  BASE_KINDS, COLOR_FR, LETTER, MISSILE_COST, SECTORS, UNITS, armyOf, describeOrder, executeOrder, hqOf, locName,
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
let mode: { t: 'move'; kind: Kind; from: Loc } | { t: 'launch'; from: Loc } | null = null;

const send = (m: ClientMsg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

function connect(name: string) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => send({ t: 'join', room: roomId(), name, token });
  ws.onmessage = e => {
    const m: ServerMsg = JSON.parse(e.data);
    if (m.t === 'room') {
      room = m.room;
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
  ws.onclose = () => { error = 'Connexion perdue, reconnexion…'; render(); setTimeout(() => connect(name), 2000); };
}

// ---------- Screens ----------
function render() {
  if (!roomId()) return renderHome();
  if (!room) { app.innerHTML = `<p class="muted center">Connexion…</p>`; return; }
  if (!room.game) return renderLobby(room);
  renderGame(room, room.game);
}

function renderHome() {
  app.innerHTML = `
    <div class="card narrow">
      <h1>Power, le jeu</h1>
      <p class="muted">Crée une partie et envoie le lien à tes amis (2 à 4 joueurs).</p>
      <button id="create">Créer une partie</button>
    </div>`;
  $('#create')!.onclick = () => { location.hash = Math.random().toString(36).slice(2, 8); };
}

function askNameAndJoin() {
  const saved = store('power.name', () => '');
  app.innerHTML = `
    <div class="card narrow">
      <h1>Power, le jeu</h1>
      <label>Ton nom <input id="name" maxlength="20" value="${esc(saved)}" autofocus></label>
      <button id="join">Rejoindre la partie</button>
    </div>`;
  const go = () => {
    const name = ($('#name') as HTMLInputElement).value.trim() || 'Joueur';
    try { localStorage.setItem('power.name', name); } catch { /* private mode */ }
    connect(name); render();
  };
  $('#join')!.onclick = go;
  $('#name')!.onkeydown = e => { if (e.key === 'Enter') go(); };
}

function renderLobby(r: RoomView) {
  const host = r.you === 0;
  const n = r.seats.length;
  const variant = n === 2 ? 'À 2 : chaque joueur commande deux armées voisines (10 ordres par manche).'
    : n === 3 ? 'À 3 : le territoire Vert reste vide.' : n === 4 ? 'À 4 : une armée chacun.' : '';
  const opt = (id: string, cur: number, vals: [number, string][]) =>
    `<select id="${id}" ${host ? '' : 'disabled'}>${vals.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  app.innerHTML = `
    <div class="card narrow">
      <h1>Partie ${esc(r.id)}</h1>
      <p>Envoie ce lien à tes amis :</p>
      <div class="row"><input readonly value="${esc(location.href)}"><button id="copy" class="secondary">Copier</button></div>
      <ul class="seats">${r.seats.map((s, i) => `<li>${esc(s.name)}${i === r.you ? ' (toi)' : ''}${i === 0 ? ' · hôte' : ''}${s.connected ? '' : ' <span class="muted">· déconnecté</span>'}</li>`).join('')}</ul>
      <p class="muted">${variant}</p>
      <label>Temps pour écrire les ordres ${opt('timer', r.options.timerMin, [[0, 'Illimité'], [1, '1 min'], [2, '2 min'], [3, '3 min (règle)'], [5, '5 min'], [10, '10 min']])}</label>
      <label>Durée de la partie ${opt('limit', r.options.limitMin, [[0, 'Jusqu’au dernier drapeau'], [60, '1 h'], [90, '1 h 30'], [120, '2 h (règle)'], [180, '3 h']])}</label>
      ${r.you === null ? '<p class="error">La salle est pleine ou la partie a commencé.</p>' : ''}
      ${host ? `<button id="start" ${n < 2 ? 'disabled' : ''}>Lancer la partie</button>` : '<p class="muted">En attente que l’hôte lance la partie…</p>'}
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
    </div>`;
  $('#copy')!.onclick = () => navigator.clipboard?.writeText(location.href);
  if (host) {
    const sendOpts = () => send({ t: 'options', options: { timerMin: Number(($('#timer') as HTMLSelectElement).value), limitMin: Number(($('#limit') as HTMLSelectElement).value) } satisfies Options });
    $('#timer')!.onchange = sendOpts; $('#limit')!.onchange = sendOpts;
    $('#start')!.onclick = () => send({ t: 'start' });
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
  try { return executeOrder(s, ctx, color, o); } catch { return 'Ordre invalide'; }
}

function renderGame(r: RoomView, g: GameState) {
  const me = r.you;
  const myArmies = me !== null ? g.seats[me].armies : [];
  const submitted = me !== null && r.seats[me].submitted;
  const over = g.winner !== undefined;
  const canPlan = !!army && !submitted && !over && armyOf(g, army).alive;
  const { s: proj, ctx, errors } = project(g);
  const list = army ? orders[army] ?? [] : [];

  // Target squares for the current mode.
  let targets = new Set<number>();
  if (mode?.t === 'move') targets = mode.from === 'RV' ? new Set([hqOf(army!)]) : reachable(mode.kind, mode.from);
  else if (mode?.t === 'launch') targets = new Set(SECTORS.map(x => x.id));

  // ----- Board -----
  const S = 60;
  const cells: string[] = [];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const sec = sectorAt(x, y);
    if (!sec) continue;
    const cls = ['cell', sec.kind, sec.territory ? `t-${sec.territory}` : '', targets.has(sec.id) ? 'target' : '', sel === sec.id ? 'sel' : ''].join(' ');
    cells.push(`<rect x="${x * S}" y="${y * S}" width="${S}" height="${S}" class="${cls}" data-sec="${sec.id}"/>`);
  }
  // Thick borders between different sectors.
  const borders: string[] = [];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const t = GRID[y][x];
    if (t === '--') continue;
    if (GRID[y][x + 1] !== t) borders.push(`M${(x + 1) * S},${y * S}v${S}`);
    if (GRID[y + 1]?.[x] !== t) borders.push(`M${x * S},${(y + 1) * S}h${S}`);
    if (x === 0 || GRID[y][x - 1] === '--') borders.push(`M${x * S},${y * S}v${S}`);
    if (y === 0 || GRID[y - 1]?.[x] === '--') borders.push(`M${x * S},${y * S}h${S}`);
  }
  const labels = SECTORS.map(sec => {
    const [x, y] = sec.anchor;
    const hqFlag = sec.kind === 'hq' ? ` ${flagsAt(g, sec.territory!)}` : '';
    return `<text x="${x * S + 3}" y="${y * S + 11}" class="code">${sec.code}${hqFlag}</text>`;
  }).join('');
  const chips = SECTORS.map(sec => {
    const here = proj.pieces.filter(p => p.loc === sec.id);
    const armies = [...new Set(here.map(p => p.army))];
    const [x, y] = sec.anchor;
    return armies.map((c, i) => {
      const ps = here.filter(p => p.army === c);
      const txt = kindsSummary(ps.map(p => p.kind));
      const movedIn = ps.some(p => ctx.moved.has(p.id) && ctx.prev.get(p.id) !== sec.id);
      return `<g transform="translate(${x * S + 2},${y * S + 14 + i * 14})" class="${movedIn ? 'planned' : ''}">
        <rect width="${S - 4}" height="13" rx="3" class="chip ${c}"/><text x="3" y="10" class="chip-text">${txt}</text></g>`;
    }).join('');
  }).join('');
  const arrows = list.map(o => {
    const c = (id: number) => { const [x, y] = SECTORS[id].anchor; return [x * S + S / 2, y * S + S / 2]; };
    if (o.type === 'move' && typeof o.to === 'number') {
      const to = c(o.to);
      const from = o.from === 'RV' ? [to[0], to[1] - S * 0.8] : c(o.from);
      return `<line x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}" class="arrow ${errors.has(o) ? 'bad' : ''}" marker-end="url(#head)"/>`;
    }
    if (o.type === 'launch' && o.target !== 'RV') { const t = c(o.target); return `<circle cx="${t[0]}" cy="${t[1]}" r="${S / 2 - 6}" class="boom"/>`; }
    return '';
  }).join('');

  // ----- Panel -----
  const deadline = r.deadline ? r.deadline - clockSkew : null;
  const head = `
    <div class="row between"><h2>Manche ${g.round}</h2>${deadline && !over ? `<span class="timer" id="timer"></span>` : ''}</div>
    ${g.lastRound && !over ? '<p class="banner">Dernière manche !</p>' : ''}
    <ul class="players">${g.seats.map((seat, i) => `
      <li class="${seat.armies.every(c => !armyOf(g, c).alive) ? 'dead' : ''}">
        <b>${esc(seat.name)}</b>${i === me ? ' (toi)' : ''} ${over ? '' : r.seats[i]?.submitted ? '✅' : '✍️'}
        <span class="muted">· puissance ${totalPower(g, i)}</span>
        ${seat.armies.map(c => { const a = armyOf(g, c); return `<div class="army"><span class="dot ${c}"></span>${COLOR_FR[c]} ${a.alive ? '' : '☠️'} <span class="muted">Power ${a.power} · 🚩${a.flags.length} · réserve ${kindsSummary(g.pieces.filter(p => p.army === c && p.loc === 'RV').map(p => p.kind)) || '—'}</span></div>`; }).join('')}
      </li>`).join('')}
    </ul>`;

  let action = '';
  if (over) action = `<p class="banner">🏆 ${esc(g.seats[g.winner!].name)} gagne la partie !</p>`;
  else if (me === null) action = `<p class="muted">Tu regardes la partie.</p>`;
  else if (!myArmies.some(c => armyOf(g, c).alive)) action = `<p class="muted">Tes drapeaux sont tombés. Tu peux regarder la fin de la partie.</p>`;
  else if (submitted) action = `<p>Ordres envoyés. En attente des autres…</p><button id="edit" class="secondary">Modifier mes ordres</button>`;
  else {
    const tabs = myArmies.length > 1 ? `<div class="tabs">${myArmies.filter(c => armyOf(g, c).alive).map(c =>
      `<button class="tab ${c === army ? 'on' : ''}" data-army="${c}"><span class="dot ${c}"></span>${COLOR_FR[c]} (${(orders[c] ?? []).length}/${g.ordersPerArmy})</button>`).join('')}</div>` : '';
    action = `${tabs}
      ${mode ? `<div class="box">${mode.t === 'move' ? `Clique où envoyer ${UNITS[mode.kind].name}.` : `Clique la cible du méga-missile, ou une réserve : ${g.armies.filter(a => a.alive).map(a => `<button class="mini" data-reserve="${a.color}">Réserve ${LETTER[a.color]}</button>`).join(' ')}`} <button id="cancel" class="secondary mini">Annuler</button></div>` : ''}
      ${!mode && sel !== null ? locPanel(proj, ctx, sel) : ''}
      ${!mode && sel === null ? `<p class="muted">Clique un secteur avec tes pièces, ou ta réserve ci-dessous. ${g.ordersPerArmy} ordres maximum par armée.</p>` : ''}
      <button class="secondary wide" id="reserve">Réserve ${COLOR_FR[army!]} · Power ${armyOf(proj, army!).power}</button>
      <h3>Ordres ${COLOR_FR[army!]} (${list.length}/${g.ordersPerArmy})</h3>
      <ol class="orders">${list.map((o, i) => `<li class="${errors.has(o) ? 'bad' : ''}">${esc(describeOrder(o, army!))}${errors.has(o) ? ` <span class="muted">(${esc(errors.get(o)!)})</span>` : ''} <button class="mini secondary" data-del="${i}">✕</button></li>`).join('') || '<li class="muted">Aucun ordre</li>'}</ol>
      <div class="row"><button id="submit">Envoyer mes ordres</button>${r.deadline && !r.seats[me].pauseUsed ? '<button id="pause" class="secondary">Pause (+3 min)</button>' : ''}</div>`;
  }

  const report = g.report ? `
    <h3>Manche ${g.report.round}</h3>
    <ul class="log">${g.report.events.map(e => `<li>${esc(e)}</li>`).join('') || '<li class="muted">Aucun combat.</li>'}</ul>
    <details><summary>Feuilles d’ordres</summary>${g.report.orders.map(o => `<p><span class="dot ${o.army}"></span><b>${COLOR_FR[o.army]}</b></p><ol class="orders">${o.results.map(x => `<li class="${x.ok ? '' : 'bad'}">${esc(describeOrder(x.order, o.army))}${x.ok ? '' : ` <span class="muted">(${esc(x.note ?? '')})</span>`}</li>`).join('') || '<li class="muted">Aucun ordre</li>'}</ol>`).join('')}</details>` : '';

  app.innerHTML = `
    <div class="game">
      <div class="board-wrap"><svg viewBox="0 0 ${GW * S} ${GH * S}" class="board">
        <defs><marker id="head" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8z" class="arrowhead"/></marker></defs>
        ${cells.join('')}<path d="${borders.join('')}" class="borders"/>${labels}${chips}${arrows}</svg></div>
      <aside class="panel">${head}${action}${error ? `<p class="error">${esc(error)}</p>` : ''}${report}</aside>
    </div>`;

  // ----- Events -----
  app.querySelectorAll<SVGRectElement>('[data-sec]').forEach(el => el.addEventListener('click', () => {
    if (!canPlan) return;
    const id = Number(el.dataset.sec);
    if (mode && targets.has(id)) {
      if (mode.t === 'move') add({ type: 'move', kind: mode.kind, from: mode.from, to: id });
      else add({ type: 'launch', from: mode.from, target: id });
      return;
    }
    mode = null;
    sel = proj.pieces.some(p => p.army === army && p.loc === id) ? id : null;
    render();
  }));
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
  on('submit', () => { sel = null; mode = null; send({ t: 'orders', orders, final: true }); });
  on('edit', () => send({ t: 'orders', orders, final: false }));
  on('pause', () => send({ t: 'pause' }));
  tick();

  function add(o: Order) {
    const cur = orders[army!] ?? [];
    if (cur.length >= g.ordersPerArmy) { error = `Maximum ${g.ordersPerArmy} ordres`; mode = null; return render(); }
    const err = safeExec(structuredClone(proj), structuredClone(ctx), army!, o);
    if (err) { error = err; mode = null; return render(); }
    orders[army!] = [...cur, o];
    error = '';
    mode = null;
    if (o.type === 'move') sel = null;
    changed();
  }
}

/** Options for the selected sector or reserve of the active army. */
function locPanel(s: GameState, ctx: ReturnType<typeof newCtx>, at: Loc) {
  const ps = s.pieces.filter(p => p.army === army && p.loc === at);
  const kinds = [...new Set(ps.map(p => p.kind))].sort((a, b) => UNITS[a].power - UNITS[b].power);
  const a = armyOf(s, army!);
  const rows = kinds.map(k => {
    const all = ps.filter(p => p.kind === k), free = all.filter(p => !ctx.moved.has(p.id));
    const btns = [
      k !== 'M' && free.length ? `<button class="mini" data-move="${k}">${at === 'RV' ? 'Vers le QG' : 'Déplacer'}</button>` : '',
      UNITS[k].up && all.length >= 3 ? `<button class="mini secondary" data-upgrade="${k}">3 → ${UNITS[UNITS[k].up!].name}</button>` : '',
      k === 'M' ? `<button class="mini" data-launch>Lancer</button>` : '',
    ].join(' ');
    return `<div class="row"><span>${UNITS[k].name} ×${all.length}${free.length < all.length && k !== 'M' ? ` <span class="muted">(${all.length - free.length} déjà joué)</span>` : ''}</span>${btns}</div>`;
  }).join('');
  const buys = at === 'RV' ? `<div class="row">Acheter : ${BASE_KINDS.map(k => `<button class="mini secondary" data-buy="${k}" ${a.power < UNITS[k].power ? 'disabled' : ''}>${UNITS[k].name} (${UNITS[k].power})</button>`).join(' ')}</div>` : '';
  const canMissile = value(ps) + (at === 'RV' ? a.power : 0) >= MISSILE_COST;
  return `<div class="box"><b>${at === 'RV' ? `Réserve ${COLOR_FR[army!]} · Power ${a.power}` : SECTORS[at].name}</b>
    ${rows || '<p class="muted">Aucune pièce.</p>'}${buys}
    ${canMissile ? `<button class="mini" id="missile">Créer un méga-missile (≥ ${MISSILE_COST})</button>` : ''}</div>`;
}

function changed() {
  send({ t: 'orders', orders, final: false });
  render();
}

function kindsSummary(kinds: Kind[]) {
  const order: Kind[] = ['S', 'R', 'T', 'A', 'C', 'B', 'D', 'CR', 'M'];
  return order.filter(k => kinds.includes(k)).map(k => `${k}${kinds.filter(x => x === k).length}`).join(' ');
}
function flagsAt(g: GameState, c: Color) {
  const a = armyOf(g, c);
  return a?.alive ? '🚩'.repeat(a.flags.length) : '';
}

let tickTimer = 0;
function tick() {
  clearInterval(tickTimer);
  const el = () => $('#timer');
  const upd = () => {
    if (!room?.deadline || !el()) return;
    const left = Math.max(0, room.deadline - clockSkew - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    el()!.textContent = `⏳ ${m}:${String(s).padStart(2, '0')}`;
    el()!.classList.toggle('urgent', left < 30000);
  };
  upd();
  tickTimer = window.setInterval(upd, 500);
}

function esc(s: string) { return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`); }

window.addEventListener('hashchange', () => location.reload());
if (roomId()) askNameAndJoin(); else render();
