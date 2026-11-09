'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const compression = require('compression');
const { WebSocketServer } = require('ws');
const { isValidWord, evaluate } = require('./lib/game');

const PORT = process.env.PORT || 3000;
const MAX_GUESSES = 6;
const COUNTDOWN_MS = 3000;
const TIMER_CHOICES = [0, 60, 90, 120, 180, 300]; // seconds, 0 = no limit
const DEFAULT_TIMER = 120;
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ROOMS = 5000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const rooms = new Map();

/* ---------- helpers ---------- */

const cleanName = (n) =>
  String(n || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 16) || 'Player';

const validCode = (c) => typeof c === 'string' && /^[A-Z0-9]{4,8}$/.test(c);
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);

function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function makeRoom(code) {
  return {
    code,
    players: [],
    settings: { timer: DEFAULT_TIMER },
    draws: 0,
    phase: 'lobby', // lobby | countdown | playing | finished
    startsAt: null,
    endsAt: null,
    result: null,
    rematch: new Set(),
    timeouts: { start: null, end: null },
    touched: Date.now(),
  };
}

const other = (room, p) => room.players.find((x) => x !== p) || null;

/* ---------- state sent to each player ---------- */

function viewFor(room, p) {
  const o = other(room, p);
  const target = o && o.word; // the word p is trying to guess
  // Both boards are coloured against p's own target, so every guess
  // (theirs and mine) reveals something useful to p.
  const colour = (w) => (target ? evaluate(w, target) : 'aaaaa');
  const finished = room.phase === 'finished';
  const view = {
    type: 'state',
    room: room.code,
    phase: room.phase,
    settings: room.settings,
    serverNow: Date.now(),
    startsAt: room.startsAt,
    endsAt: room.endsAt,
    maxGuesses: MAX_GUESSES,
    you: {
      id: p.id,
      name: p.name,
      word: p.word, // you know the word you set for your opponent
      hasWord: !!p.word,
      out: p.out,
      solved: p.solved,
    },
    opp: o && {
      name: o.name,
      online: !!o.ws,
      hasWord: !!o.word,
      out: o.out,
      solved: o.solved,
    },
    scores: { you: p.wins, opp: o ? o.wins : 0, draws: room.draws },
    myGuesses: p.guesses.map((w) => ({ w, m: colour(w) })),
    oppGuesses: o ? o.guesses.map((w) => ({ w, m: colour(w), solved: w === p.word })) : [],
    rematch: { you: room.rematch.has(p.id), opp: o ? room.rematch.has(o.id) : false },
    result: null,
  };
  if (finished && room.result) {
    view.result = {
      winner: room.result.winnerId === null ? 'draw' : room.result.winnerId === p.id ? 'you' : 'opp',
      reason: room.result.reason,
      yourTarget: target, // word you were guessing
      theirTarget: p.word, // word they were guessing
    };
  }
  return view;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(room) {
  room.touched = Date.now();
  for (const p of room.players) if (p.ws) send(p.ws, viewFor(room, p));
}

/* ---------- game flow ---------- */

function clearTimers(room) {
  clearTimeout(room.timeouts.start);
  clearTimeout(room.timeouts.end);
  room.timeouts.start = room.timeouts.end = null;
}

function maybeStart(room) {
  if (room.phase !== 'lobby' || room.players.length < 2) return;
  if (!room.players.every((p) => p.word)) return;
  room.phase = 'countdown';
  room.startsAt = Date.now() + COUNTDOWN_MS;
  room.timeouts.start = setTimeout(() => beginRound(room), COUNTDOWN_MS);
  broadcast(room);
}

function beginRound(room) {
  if (room.phase !== 'countdown') return;
  room.phase = 'playing';
  const t = room.settings.timer;
  room.endsAt = t ? Date.now() + t * 1000 : null;
  if (room.endsAt) room.timeouts.end = setTimeout(() => finish(room, null, 'time'), t * 1000);
  broadcast(room);
}

function finish(room, winner, reason) {
  if (room.phase !== 'playing') return;
  clearTimers(room);
  room.phase = 'finished';
  room.result = { winnerId: winner ? winner.id : null, reason };
  if (winner) winner.wins++;
  else room.draws++;
  room.rematch = new Set();
  broadcast(room);
}

function resetToLobby(room) {
  clearTimers(room);
  room.phase = 'lobby';
  room.startsAt = room.endsAt = null;
  room.result = null;
  room.rematch = new Set();
  for (const p of room.players) {
    p.word = null;
    p.guesses = [];
    p.solved = false;
    p.out = false;
  }
  broadcast(room);
}

/* ---------- message handling ---------- */

function handle(ws, ctx, msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'ping') return send(ws, { type: 'pong' });

  if (msg.type === 'join') {
    if (ctx.room) return;
    const code = String(msg.room || '').toUpperCase();
    if (!validCode(code) || !validId(msg.id)) return send(ws, { type: 'error', code: 'bad_join' });
    let room = rooms.get(code);
    if (!room) {
      if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', code: 'busy' });
      room = makeRoom(code);
      rooms.set(code, room);
    }
    let p = room.players.find((x) => x.id === msg.id);
    if (!p) {
      if (room.players.length >= 2) return send(ws, { type: 'full' });
      p = { id: msg.id, name: cleanName(msg.name), ws: null, word: null, guesses: [], solved: false, out: false, wins: 0 };
      room.players.push(p);
    } else if (msg.name) {
      p.name = cleanName(msg.name);
    }
    if (p.ws && p.ws !== ws) {
      p.ws.ctx = null;
      p.ws.close(4000, 'replaced');
    }
    p.ws = ws;
    ctx.room = room;
    ctx.player = p;
    broadcast(room);
    return;
  }

  const { room, player: p } = ctx;
  if (!room || !p) return;
  room.touched = Date.now();

  switch (msg.type) {
    case 'setName':
      p.name = cleanName(msg.name);
      return broadcast(room);

    case 'setTimer': {
      const t = Number(msg.timer);
      if (room.phase !== 'lobby' || !TIMER_CHOICES.includes(t)) return;
      room.settings.timer = t;
      return broadcast(room);
    }

    case 'setWord': {
      if (room.phase !== 'lobby') return;
      const w = String(msg.word || '').toLowerCase();
      if (!isValidWord(w)) return send(ws, { type: 'error', code: 'invalid_word' });
      p.word = w;
      broadcast(room);
      return maybeStart(room);
    }

    case 'clearWord':
      if (room.phase !== 'lobby') return;
      p.word = null;
      return broadcast(room);

    case 'guess': {
      if (room.phase !== 'playing' || p.solved || p.out) return;
      const o = other(room, p);
      if (!o || !o.word) return;
      const w = String(msg.word || '').toLowerCase();
      if (!isValidWord(w)) return send(ws, { type: 'error', code: 'invalid_guess' });
      if (room.endsAt && Date.now() > room.endsAt + 300) return; // timer is authoritative
      if (p.guesses.length >= MAX_GUESSES) return;
      p.guesses.push(w);
      if (w === o.word) {
        p.solved = true;
        return finish(room, p, 'solved');
      }
      if (p.guesses.length >= MAX_GUESSES) {
        p.out = true;
        if (o.out || o.solved) return finish(room, null, 'out');
      }
      return broadcast(room);
    }

    case 'rematch':
      if (room.phase !== 'finished') return;
      room.rematch.add(p.id);
      if (room.players.length === 2 && room.players.every((x) => room.rematch.has(x.id))) {
        return resetToLobby(room);
      }
      return broadcast(room);
  }
}

/* ---------- http + ws ---------- */

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.post('/api/rooms', (_req, res) => {
  if (rooms.size >= MAX_ROOMS) return res.status(503).json({ error: 'busy' });
  const code = newCode();
  if (!code) return res.status(503).json({ error: 'busy' });
  rooms.set(code, makeRoom(code));
  res.json({ code });
});
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: '5m',
    setHeaders: (res, file) => {
      if (/\.txt$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  })
);
app.get(/^\/r\/[A-Za-z0-9]{4,8}\/?$/, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((_req, res) => res.redirect('/'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws) => {
  const ctx = { room: null, player: null };
  ws.ctx = ctx;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    try {
      handle(ws, ctx, msg);
    } catch (e) {
      console.error('handler error', e);
    }
  });
  ws.on('close', () => {
    const { room, player } = ctx;
    if (room && player && player.ws === ws) {
      player.ws = null;
      broadcast(room);
    }
  });
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
    const online = room.players.some((p) => p.ws);
    if (!online && now - room.touched > ROOM_TTL_MS) {
      clearTimers(room);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Duelle listening on :${PORT}`));
}

module.exports = { server, rooms };
