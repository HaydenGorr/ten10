'use strict';
// Battleships: two players hide a fleet each, then take turns firing.
// Rooms live in memory and are keyed by the platform-wide room code.

const SIZE = 10;
const FLEET = [5, 4, 3, 3, 2];
const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // drop rooms idle for 12 hours

const rooms = new Map();

const cleanName = (n) =>
  String(n || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 16) || 'Player';
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);

function createRoom(code) {
  const room = {
    code,
    players: [], // { id, name, ws, ships, ready, shots, wins, rematch }
    phase: 'waiting', // waiting | placing | playing | over
    turn: 0,
    winner: null,
    starter: Math.random() < 0.5 ? 0 : 1,
    touched: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function cellsOf(ship) {
  const out = [];
  for (let i = 0; i < ship.len; i++) out.push([ship.x + (ship.h ? i : 0), ship.y + (ship.h ? 0 : i)]);
  return out;
}

function validFleet(ships) {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return null;
  const clean = [];
  const taken = new Set();
  for (const s of ships) {
    if (!s || !Number.isInteger(s.x) || !Number.isInteger(s.y) || !Number.isInteger(s.len)) return null;
    const ship = { x: s.x, y: s.y, len: s.len, h: !!s.h };
    for (const [cx, cy] of cellsOf(ship)) {
      if (cx < 0 || cy < 0 || cx >= SIZE || cy >= SIZE) return null;
      const k = cy * SIZE + cx;
      if (taken.has(k)) return null;
      taken.add(k);
    }
    clean.push(ship);
  }
  const lens = clean.map((s) => s.len).sort((a, b) => b - a);
  if (lens.join() !== [...FLEET].sort((a, b) => b - a).join()) return null;
  return clean;
}

function shipHits(ship, opponentShots) {
  const hit = new Set(opponentShots.filter((s) => s.hit).map((s) => s.y * SIZE + s.x));
  return cellsOf(ship).filter(([x, y]) => hit.has(y * SIZE + x)).length;
}

function resetForRematch(room) {
  room.phase = 'placing';
  room.winner = null;
  room.starter = 1 - room.starter;
  for (const p of room.players) {
    p.ships = null;
    p.ready = false;
    p.shots = [];
    p.rematch = false;
  }
}

/* ---------- state sent to each player ---------- */

function stateFor(room, idx) {
  const me = room.players[idx];
  const opp = room.players[1 - idx];
  const over = room.phase === 'over';
  const sunk = opp && opp.ships ? opp.ships.filter((s) => shipHits(s, me.shots) === s.len) : [];
  return {
    type: 'state',
    room: room.code,
    you: idx,
    phase: room.phase,
    turn: room.turn,
    winner: room.winner,
    names: [me.name, opp ? opp.name : null],
    oppConnected: !!(opp && opp.ws),
    hasOpp: !!opp,
    ready: [me.ready, !!(opp && opp.ready)],
    wins: [me.wins, opp ? opp.wins : 0],
    rematch: [me.rematch, !!(opp && opp.rematch)],
    myShips: me.ships || [],
    myShots: me.shots,
    oppShots: opp ? opp.shots : [],
    oppSunk: sunk,
    oppShips: over && opp && opp.ships ? opp.ships : null,
  };
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(room) {
  room.touched = Date.now();
  room.players.forEach((p, i) => send(p.ws, stateFor(room, i)));
}

/* ---------- message handling ---------- */

// canCreate(code) says whether a missing room may be opened under this code
// (it may not when the code belongs to another game).
function handle(ws, msg, canCreate) {
  if (msg.type === 'ping') return send(ws, { type: 'pong' });
  if (msg.type === 'join') return join(ws, msg, canCreate);
  const { room, idx } = ws.ctx || {};
  if (!room) return;
  const me = room.players[idx];
  const opp = room.players[1 - idx];

  if (msg.type === 'setName') {
    me.name = cleanName(msg.name);
    return broadcast(room);
  }

  if (msg.type === 'place') {
    if (room.phase !== 'placing' || me.ready) return;
    const ships = validFleet(msg.ships);
    if (!ships) return send(ws, { type: 'error', msg: 'That fleet layout is not valid.' });
    me.ships = ships;
    me.ready = true;
    if (opp && opp.ready) {
      room.phase = 'playing';
      room.turn = room.starter;
    }
    return broadcast(room);
  }

  if (msg.type === 'fire') {
    if (room.phase !== 'playing' || room.turn !== idx || !opp) return;
    const { x, y } = msg;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    if (me.shots.some((s) => s.x === x && s.y === y)) return;
    const target = opp.ships.find((s) => cellsOf(s).some(([cx, cy]) => cx === x && cy === y));
    me.shots.push({ x, y, hit: !!target });
    if (opp.ships.every((s) => shipHits(s, me.shots) === s.len)) {
      room.phase = 'over';
      room.winner = idx;
      me.wins++;
    } else {
      room.turn = 1 - idx;
    }
    return broadcast(room);
  }

  if (msg.type === 'rematch') {
    if (room.phase !== 'over') return;
    me.rematch = true;
    if (opp && opp.rematch) resetForRematch(room);
    return broadcast(room);
  }
}

function join(ws, msg, canCreate) {
  if (ws.ctx) return;
  const code = String(msg.room || '').toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code) || !validId(msg.id)) {
    return send(ws, { type: 'error', fatal: true, msg: 'This game link is not valid.' });
  }
  let room = rooms.get(code);
  if (!room) {
    // rooms are in memory, so a restart forgets them: reopen the code rather than strand the link
    if (!canCreate(code)) return send(ws, { type: 'error', fatal: true, msg: 'This game does not exist or has expired.' });
    room = createRoom(code);
  }

  let idx = room.players.findIndex((p) => p.id === msg.id);
  if (idx === -1) {
    if (room.players.length >= 2) return send(ws, { type: 'error', fatal: true, msg: 'This game already has two players.' });
    room.players.push({ id: msg.id, name: cleanName(msg.name), ws: null, ships: null, ready: false, shots: [], wins: 0, rematch: false });
    idx = room.players.length - 1;
    if (room.players.length === 2) room.phase = 'placing';
  } else if (msg.name) {
    room.players[idx].name = cleanName(msg.name);
  }
  const player = room.players[idx];
  if (player.ws && player.ws !== ws) {
    player.ws.ctx = null;
    player.ws.close(4000, 'replaced'); // same player in another tab
  }
  player.ws = ws;
  ws.ctx = { room, idx };
  broadcast(room);
}

function leave(ws) {
  const ctx = ws.ctx;
  if (!ctx) return;
  const p = ctx.room.players[ctx.idx];
  if (p && p.ws === ws) {
    p.ws = null;
    broadcast(ctx.room);
  }
}

/* ---------- websocket wiring ---------- */

function attach(wss, canCreate) {
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      try {
        handle(ws, msg, canCreate);
      } catch (e) {
        console.error('battleships handler error', e);
      }
    });
    ws.on('close', () => leave(ws));
    ws.on('error', () => {});
  });

  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25000).unref();

  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (!room.players.some((p) => p.ws) && now - room.touched > ROOM_TTL_MS) rooms.delete(code);
    }
  }, 10 * 60 * 1000).unref();
}

module.exports = { rooms, createRoom, attach, SIZE, FLEET };
