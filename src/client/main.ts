import {
  CELLS, H, ORDERS_PER_TURN, TRADES, UNITS, W, cellLabel, power, reachable, validateOrders,
  type BoardUnitKind, type Color, type Order, type UnitKind,
} from '../shared/rules';
import type { ClientMsg, RoomView, ServerMsg } from '../shared/protocol';

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const app = $('#app');
const ICON: Record<UnitKind, string> = {
  soldier: '🪖', tank: '🛡️', fighter: '✈️', destroyer: '🚢',
  regiment: '🎖️', heavyTank: '🏗️', bomber: '🛩️', cruiser: '⚓', megamissile: '🚀',
};
const COLOR_FR: Record<Color, string> = { red: 'Rouge', blue: 'Bleu', green: 'Vert', yellow: 'Jaune' };

function store(key: string, fallback: () => string) {
  try { const v = localStorage.getItem(key); if (v) return v; const n = fallback(); localStorage.setItem(key, n); return n; }
  catch { return fallback(); }
}
const token = store('power.token', () => crypto.randomUUID());
const roomId = () => location.hash.slice(1);

let room: RoomView | null = null;
let ws: WebSocket | null = null;
let error = '';
// Local planning state for this turn.
let orders: Order[] = [];
let plannedTurn = 0;
let selCell: number | null = null;
let selCounts: Partial<Record<BoardUnitKind, number>> = {};
let mode: { kind: 'move' } | { kind: 'deploy'; unit: BoardUnitKind; count: number } | { kind: 'missile' } | null = null;

function send(m: ClientMsg) { ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m)); }

function connect(name: string) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => send({ t: 'join', room: roomId(), name, token });
  ws.onmessage = e => {
    const m: ServerMsg = JSON.parse(e.data);
    if (m.t === 'room') {
      room = m.room;
      if (room.game && room.game.turn !== plannedTurn) { orders = []; plannedTurn = room.game.turn; selCell = null; mode = null; }
      error = '';
    } else error = m.message;
    render();
  };
  ws.onclose = () => { error = 'Connexion perdue, reconnexion…'; render(); setTimeout(() => connect(name), 2000); };
}

// ---------- Screens ----------
function render() {
  if (!roomId()) return renderHome();
  if (!room) { app.innerHTML = `<p class="muted">Connexion…</p>`; return; }
  if (!room.game) return renderLobby(room);
  renderGame(room);
}

function renderHome() {
  app.innerHTML = `
    <div class="card narrow">
      <h1>Power, le jeu</h1>
      <p class="muted">Crée une partie et envoie le lien à tes amis (2 à 4 joueurs).</p>
      <button id="create">Créer une partie</button>
    </div>`;
  $('#create').onclick = () => { location.hash = Math.random().toString(36).slice(2, 8); };
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
  $('#join').onclick = go;
  $('#name').onkeydown = e => { if (e.key === 'Enter') go(); };
}

function renderLobby(r: RoomView) {
  const isHost = r.you && r.you === r.hostColor;
  app.innerHTML = `
    <div class="card narrow">
      <h1>Salle ${esc(r.id)}</h1>
      <p>Envoie ce lien à tes amis :</p>
      <div class="row"><input readonly value="${esc(location.href)}" id="link"><button id="copy" class="secondary">Copier</button></div>
      <ul class="seats">${r.seats.map(s => `<li><span class="dot ${s.color}"></span>${esc(s.name)}${s.color === r.you ? ' (toi)' : ''}${s.connected ? '' : ' <span class="muted">· déconnecté</span>'}</li>`).join('')}</ul>
      ${r.you ? '' : '<p class="error">La salle est pleine ou la partie a commencé.</p>'}
      ${isHost ? `<button id="start" ${r.seats.length < 2 ? 'disabled' : ''}>Lancer la partie</button>` : '<p class="muted">En attente que l’hôte lance la partie…</p>'}
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
    </div>`;
  $('#copy').onclick = () => navigator.clipboard?.writeText(location.href);
  if (isHost) $('#start').onclick = () => send({ t: 'start' });
}

function renderGame(r: RoomView) {
  const g = r.game!;
  const me = r.you;
  const mine = g.players.find(p => p.color === me);
  const seat = r.seats.find(s => s.color === me);
  const submitted = !!seat?.submitted;
  const canPlan = !!mine?.alive && !g.winner && !submitted;
  const ordered = new Set(orders.flatMap(o => (o.type === 'move' ? o.unitIds : [])));

  // Highlighted target squares for the current mode.
  let targets = new Set<number>();
  if (mode?.kind === 'move' && selCell !== null) {
    const kinds = (Object.keys(selCounts) as BoardUnitKind[]).filter(k => selCounts[k]! > 0);
    if (kinds.length) {
      targets = reachable(kinds[0], selCell);
      for (const k of kinds.slice(1)) { const r2 = reachable(k, selCell); targets = new Set([...targets].filter(c => r2.has(c))); }
    }
  } else if (mode?.kind === 'deploy') {
    const m = mode;
    targets = new Set(CELLS.filter(c => c.home === me && (UNITS[m.unit].domain === 'air' || UNITS[m.unit].domain === c.terrain)).map(c => c.id));
  } else if (mode?.kind === 'missile') targets = new Set(CELLS.map(c => c.id));

  // ----- Board (SVG) -----
  const S = 56;
  const cells = CELLS.map(c => {
    const units = g.units.filter(u => u.cell === c.id);
    const owners = [...new Set(units.map(u => u.owner))];
    const stacks = owners.map((o, i) => {
      const us = units.filter(u => u.owner === o);
      const kinds = [...new Set(us.map(u => u.kind))];
      const label = kinds.map(k => `${ICON[k]}${us.filter(u => u.kind === k).length}`).join(' ');
      return `<g transform="translate(${c.x * S + 3},${c.y * S + 14 + i * 13})">
        <rect width="${S - 6}" height="12" rx="3" class="stack ${o}"/>
        <text x="3" y="9.5" class="stack-text">${label}</text></g>`;
    }).join('');
    const cls = ['cell', c.terrain, c.home ? `home-${c.home}` : '', targets.has(c.id) ? 'target' : '', selCell === c.id ? 'sel' : ''].join(' ');
    return `<g data-cell="${c.id}">
      <rect x="${c.x * S}" y="${c.y * S}" width="${S}" height="${S}" class="${cls}"/>
      <text x="${c.x * S + 3}" y="${c.y * S + 10}" class="coord">${cellLabel(c.id)}</text>
      ${c.hq ? `<text x="${c.x * S + S - 16}" y="${c.y * S + 12}" class="flag">🚩</text>` : ''}
      ${stacks}</g>`;
  }).join('');
  const arrows = orders.map(o => {
    const from = o.type === 'move' ? g.units.find(u => u.id === o.unitIds[0])!.cell : null;
    const to = o.type === 'move' || o.type === 'deploy' ? o.to : o.type === 'missile' ? o.target : null;
    if (to === null) return '';
    const cx = (id: number) => (id % W) * S + S / 2, cy = (id: number) => Math.floor(id / W) * S + S / 2;
    if (from === null) return `<circle cx="${cx(to)}" cy="${cy(to)}" r="${S / 2 - 4}" class="plan-ring ${o.type}"/>`;
    return `<line x1="${cx(from)}" y1="${cy(from)}" x2="${cx(to)}" y2="${cy(to)}" class="plan-arrow" marker-end="url(#head)"/>`;
  }).join('');

  // ----- Side panel -----
  const players = g.players.map(p => {
    const s = r.seats.find(x => x.color === p.color);
    const pw = power(g.units.filter(u => u.owner === p.color));
    const res = Object.entries(p.reserve).filter(([, n]) => n! > 0).map(([k, n]) => `${ICON[k as UnitKind]}${n}`).join(' ') || '—';
    return `<li class="${p.alive ? '' : 'dead'}"><span class="dot ${p.color}"></span><b>${esc(p.name)}</b>
      ${p.alive ? (s?.submitted ? '✅' : '⏳') : '☠️'} <span class="muted">puissance ${pw} · réserve ${res}</span></li>`;
  }).join('');

  let action = '';
  if (g.winner) action = `<h2>🏆 ${esc(g.players.find(p => p.color === g.winner)!.name)} gagne !</h2>`;
  else if (!mine) action = `<p class="muted">Tu regardes la partie.</p>`;
  else if (!mine.alive) action = `<p class="muted">Ton drapeau est tombé. Tu peux regarder la fin de la partie.</p>`;
  else if (submitted) action = `<p>Ordres envoyés. En attente des autres joueurs…</p><button id="unsubmit" class="secondary">Modifier mes ordres</button>`;
  else {
    const sel = selCell !== null ? g.units.filter(u => u.cell === selCell && u.owner === me && !ordered.has(u.id)) : [];
    const kindsHere = [...new Set(sel.map(u => u.kind))];
    const selector = mode?.kind === 'move' && kindsHere.length ? `
      <div class="box"><b>Case ${cellLabel(selCell!)}</b> : choisis les unités, puis clique la destination.
      ${kindsHere.map(k => `<div class="row"><span>${ICON[k]} ${UNITS[k].name} (${UNITS[k].power}, dépl. ${UNITS[k].move})</span>
        <button class="mini" data-dec="${k}">−</button><b>${selCounts[k] ?? 0}</b>/${sel.filter(u => u.kind === k).length}<button class="mini" data-inc="${k}">+</button></div>`).join('')}
      <button id="cancel" class="secondary mini">Annuler</button></div>` : '';
    const reserve = (Object.entries(mine.reserve) as [UnitKind, number][]).filter(([, n]) => n > 0);
    const trades = TRADES.map((t, i) => ({ t, i })).filter(({ i }) => validateOrders(g, me!, [...orders, { type: 'trade', recipe: i }]) === null);
    action = `
      <p class="muted">Clique une case avec tes unités pour les déplacer. ${ORDERS_PER_TURN} ordres maximum.</p>
      ${selector}
      ${mode?.kind === 'deploy' ? `<div class="box">Clique une case de ton pays pour déployer ${mode.count} ${UNITS[mode.unit].name}. <button id="cancel" class="secondary mini">Annuler</button></div>` : ''}
      ${mode?.kind === 'missile' ? `<div class="box">Clique la case cible du mégamissile. <button id="cancel" class="secondary mini">Annuler</button></div>` : ''}
      ${reserve.length ? `<h3>Réserve</h3>${reserve.map(([k, n]) => k === 'megamissile'
        ? `<div class="row">${ICON[k]} Mégamissile ×${n} <button class="mini" id="missile">Lancer</button></div>`
        : `<div class="row">${ICON[k]} ${UNITS[k as BoardUnitKind].name} ×${n} <button class="mini" data-deploy="${k}">Déployer</button></div>`).join('')}` : ''}
      ${trades.length ? `<h3>Échanges possibles</h3>${trades.map(({ t, i }) => `<div class="row">${Object.entries(t.give).map(([k, n]) => `${n}×${ICON[k as UnitKind]}`).join(' + ')} → ${ICON[t.get]} <button class="mini" data-trade="${i}">Échanger</button></div>`).join('')}` : ''}
      <h3>Mes ordres (${orders.length}/${ORDERS_PER_TURN})</h3>
      <ol class="orders">${orders.map((o, i) => `<li>${describe(o)} <button class="mini secondary" data-del="${i}">✕</button></li>`).join('') || '<li class="muted">Aucun ordre</li>'}</ol>
      <button id="submit">Envoyer mes ordres</button>`;
  }

  app.innerHTML = `
    <div class="game">
      <div class="board-wrap"><svg viewBox="0 0 ${W * S} ${H * S}" class="board">
        <defs><marker id="head" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8z" class="arrowhead"/></marker></defs>
        ${cells}${arrows}</svg></div>
      <aside class="panel">
        <h2>Tour ${g.turn}${me ? ` · <span class="dot ${me}"></span>${COLOR_FR[me]}` : ''}</h2>
        <ul class="players">${players}</ul>
        ${action}
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        ${g.log.length ? `<h3>Tour précédent</h3><ul class="log">${g.log.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      </aside>
    </div>`;

  // ----- Events -----
  app.querySelectorAll<SVGGElement>('[data-cell]').forEach(el => el.addEventListener('click', () => {
    if (!canPlan) return;
    const id = Number(el.dataset.cell);
    if (mode && targets.has(id)) {
      if (mode.kind === 'move' && selCell !== null) {
        const ids: number[] = [];
        for (const [k, n] of Object.entries(selCounts) as [BoardUnitKind, number][]) {
          ids.push(...g.units.filter(u => u.cell === selCell && u.owner === me && u.kind === k && !ordered.has(u.id)).slice(0, n).map(u => u.id));
        }
        if (ids.length) addOrder({ type: 'move', unitIds: ids, to: id });
      } else if (mode.kind === 'deploy') addOrder({ type: 'deploy', kind: mode.unit, count: mode.count, to: id });
      else if (mode.kind === 'missile') addOrder({ type: 'missile', target: id });
      return;
    }
    const free = g.units.filter(u => u.cell === id && u.owner === me && !ordered.has(u.id));
    if (free.length) {
      selCell = id; mode = { kind: 'move' }; selCounts = {};
      for (const u of free) selCounts[u.kind] = (selCounts[u.kind] ?? 0) + 1;
    } else { selCell = null; mode = null; }
    render();
  }));
  app.querySelectorAll<HTMLElement>('[data-inc],[data-dec]').forEach(b => b.onclick = () => {
    const k = (b.dataset.inc ?? b.dataset.dec) as BoardUnitKind;
    const max = g.units.filter(u => u.cell === selCell && u.owner === me && u.kind === k && !ordered.has(u.id)).length;
    selCounts[k] = Math.max(0, Math.min(max, (selCounts[k] ?? 0) + (b.dataset.inc ? 1 : -1)));
    render();
  });
  app.querySelectorAll<HTMLElement>('[data-deploy]').forEach(b => b.onclick = () => {
    const k = b.dataset.deploy as BoardUnitKind;
    const have = mine!.reserve[k] ?? 0;
    const count = have > 1 ? Number(prompt(`Combien de ${UNITS[k].name} déployer ? (max ${have})`, String(have))) : 1;
    if (count >= 1 && count <= have) { mode = { kind: 'deploy', unit: k, count }; selCell = null; render(); }
  });
  app.querySelectorAll<HTMLElement>('[data-trade]').forEach(b => b.onclick = () => addOrder({ type: 'trade', recipe: Number(b.dataset.trade) }));
  app.querySelectorAll<HTMLElement>('[data-del]').forEach(b => b.onclick = () => { orders.splice(Number(b.dataset.del), 1); render(); });
  $('#missile') && ($('#missile').onclick = () => { mode = { kind: 'missile' }; selCell = null; render(); });
  $('#cancel') && ($('#cancel').onclick = () => { mode = null; selCell = null; render(); });
  $('#submit') && ($('#submit').onclick = () => send({ t: 'orders', orders }));
  $('#unsubmit') && ($('#unsubmit').onclick = () => send({ t: 'unsubmit' }));

  function addOrder(o: Order) {
    const err = validateOrders(g, me!, [...orders, o]);
    if (err) { error = err; } else { orders.push(o); error = ''; }
    mode = null; selCell = null;
    render();
  }
  function describe(o: Order) {
    if (o.type === 'move') {
      const us = o.unitIds.map(id => g.units.find(u => u.id === id)!);
      const kinds = [...new Set(us.map(u => u.kind))].map(k => `${us.filter(u => u.kind === k).length}${ICON[k]}`).join(' ');
      return `${kinds} ${cellLabel(us[0].cell)} → ${cellLabel(o.to)}`;
    }
    if (o.type === 'deploy') return `Déployer ${o.count}${ICON[o.kind]} en ${cellLabel(o.to)}`;
    if (o.type === 'trade') return `Échange → ${ICON[TRADES[o.recipe].get]}`;
    return `🚀 Mégamissile sur ${cellLabel(o.target)}`;
  }
}

function esc(s: string) { return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`); }

window.addEventListener('hashchange', () => location.reload());
if (roomId()) askNameAndJoin(); else render();
