'use strict';
process.env.DUELLE_TEST = '1';
const assert = require('assert');
const WebSocket = require('ws');
const { server, rooms: wordleRooms, battleships } = require('../server');

const FLEET = [
  { x: 0, y: 0, len: 5, h: true },
  { x: 0, y: 1, len: 4, h: true },
  { x: 0, y: 2, len: 3, h: true },
  { x: 0, y: 3, len: 3, h: true },
  { x: 0, y: 4, len: 2, h: true },
];
const ship = FLEET.flatMap((s) => Array.from({ length: s.len }, (_, i) => ({ x: s.x + i, y: s.y })));

function client(port, room, token, name) {
  const ws = new WebSocket(`ws://localhost:${port}/bs/ws`);
  const c = { ws, state: null, errors: [], waiters: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.type === 'state') c.state = m;
    if (m.type === 'error') c.errors.push(m);
    c.waiters = c.waiters.filter((w) => !w());
  });
  c.open = new Promise((r) => ws.on('open', () => { ws.send(JSON.stringify({ type: 'join', room, id: 'player-' + token, name: name || token })); r(); }));
  c.send = (o) => ws.send(JSON.stringify(o));
  c.until = (fn) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout; state=' + JSON.stringify(c.state))), 2000);
    const check = () => (c.state && fn(c.state) ? (clearTimeout(t), res(c.state), true) : false);
    if (!check()) c.waiters.push(check);
  });
  return c;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const { code: id } = await (await fetch(`${base}/api/battleships`, { method: 'POST' })).json();
  assert.match(id, /^[A-Z0-9]{4}$/);
  const page = await fetch(`${base}/b/${id}`);
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /battleships\/app\.js/);
  assert.strictEqual((await fetch(`${base}/healthz`)).status, 200);

  // one code space for every game, and the home page's join box can find either
  const { code: wCode } = await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json();
  assert.notStrictEqual(wCode, id);
  assert.deepStrictEqual(await (await fetch(`${base}/api/lookup/${id.toLowerCase()}`)).json(), { game: 'battleships', path: '/b/' + id });
  assert.deepStrictEqual(await (await fetch(`${base}/api/lookup/${wCode}`)).json(), { game: 'wordle', path: '/r/' + wCode });
  assert.strictEqual((await fetch(`${base}/api/lookup/ZZZZ`)).status, 404);
  console.log('ok  battleships: rooms share the code space and the lookup finds either game');

  // a Wordle client that opens a Battleships code is told which game it is, and no Wordle room appears
  const wrong = new WebSocket(`ws://localhost:${port}/ws`);
  const wrongMsg = await new Promise((r) => {
    wrong.on('open', () => wrong.send(JSON.stringify({ type: 'join', room: id, id: 'someone-123', name: 'X' })));
    wrong.on('message', (d) => r(JSON.parse(d)));
  });
  assert.deepStrictEqual([wrongMsg.code, wrongMsg.game], ['other_game', 'battleships']);
  assert.ok(!wordleRooms.has(id));
  wrong.close();

  // a link that outlived a restart reopens the room, but a Wordle code is never taken over
  const re = client(port, 'QQ22', 'tok-r');
  await re.open;
  await re.until((s) => s.phase === 'waiting' && s.room === 'QQ22');
  re.ws.close();
  const steal = client(port, wCode, 'tok-s');
  await steal.open;
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(steal.errors[0] && steal.errors[0].fatal && !battleships.rooms.has(wCode));
  steal.ws.close();
  console.log('ok  battleships: wrong-game codes are refused, expired links reopen');

  const a = client(port, id, 'tok-a', 'Alice');
  await a.open;
  await a.until((s) => s.phase === 'waiting');
  const b = client(port, id, 'tok-b', 'Bob');
  await b.open;
  await a.until((s) => s.phase === 'placing');
  assert.deepStrictEqual(a.state.names, ['Alice', 'Bob']);
  await b.until((s) => s.phase === 'placing');
  assert.deepStrictEqual(b.state.names, ['Bob', 'Alice']);
  b.send({ type: 'setName', name: 'Bobby' });
  await a.until((s) => s.names[1] === 'Bobby');
  console.log('ok  battleships: players carry their names');

  // third player is refused
  const x = client(port, id, 'tok-x');
  await x.open;
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(x.errors[0] && x.errors[0].fatal, 'third player rejected');
  x.ws.close();

  // invalid fleet rejected
  a.send({ type: 'place', ships: [{ x: 9, y: 9, len: 5, h: true }] });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(a.errors.length, 'invalid fleet rejected');

  // cannot fire before game starts
  a.send({ type: 'fire', x: 0, y: 0 });
  a.send({ type: 'place', ships: FLEET });
  b.send({ type: 'place', ships: FLEET });
  await a.until((s) => s.phase === 'playing');
  await b.until((s) => s.phase === 'playing');
  assert.strictEqual(a.state.myShots.length, 0);
  const firstStarter = a.state.turn;

  // reconnect mid-game keeps state
  a.ws.close();
  await b.until((s) => !s.oppConnected);
  const a2 = client(port, id, 'tok-a', 'Alice');
  await a2.open;
  await a2.until((s) => s.phase === 'playing' && s.myShips.length === 5);

  // play the game: a2 always hits ship cells, b shoots empty water
  let winner = null, miss = 0;
  const targets = [...ship];
  for (let guard = 0; !winner && guard < 100; guard++) {
    await a2.until((s) => s.phase === 'over' || s.turn === s.you || b.state.turn === b.state.you);
    await b.until((s) => s.turn === a2.state.turn);
    if (a2.state.phase === 'over') break;
    const a2Turn = a2.state.turn === a2.state.you;
    const p = a2Turn ? a2 : b;
    const before = p.state.myShots.length;
    if (a2Turn) { const t = targets.shift(); p.send({ type: 'fire', x: t.x, y: t.y }); }
    else { p.send({ type: 'fire', x: miss % 10, y: 5 + Math.floor(miss / 10) }); miss++; }
    await p.until((s) => s.myShots.length > before);
    await a2.until((s) => s.myShots.length + s.oppShots.length === a2.state.myShots.length + a2.state.oppShots.length);
    await new Promise((r) => setTimeout(r, 20));
    if (a2.state.phase === 'over') winner = a2.state.winner;
  }
  assert.strictEqual(winner, a2.state.you, 'hunter wins');
  assert.strictEqual(a2.state.wins[0], 1);
  assert.ok(b.state.oppShips && b.state.oppShips.length === 5, 'fleet revealed at end');

  // duplicate / out-of-turn shots ignored after game end
  const n = a2.state.myShots.length;
  a2.send({ type: 'fire', x: 9, y: 9 });
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(a2.state.myShots.length, n);

  // rematch needs both players and keeps the room
  a2.send({ type: 'rematch' });
  await b.until((s) => s.rematch[1]);
  assert.strictEqual(b.state.phase, 'over');
  b.send({ type: 'rematch' });
  await a2.until((s) => s.phase === 'placing');
  assert.deepStrictEqual(a2.state.myShots, []);
  assert.deepStrictEqual(a2.state.myShips, []);
  assert.strictEqual(a2.state.wins[0], 1, 'score persists');
  a2.send({ type: 'place', ships: FLEET });
  b.send({ type: 'place', ships: FLEET });
  await a2.until((s) => s.phase === 'playing');
  assert.notStrictEqual(a2.state.turn, firstStarter, 'starter alternates');

  console.log('ok  battleships: full game, reconnect, rematch with alternating starter');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
