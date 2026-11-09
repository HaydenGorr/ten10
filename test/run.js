'use strict';
const assert = require('assert');
const WebSocket = require('ws');
const { evaluate, isValidWord } = require('../lib/game');
const { server } = require('../server');

// ---- scoring (duplicate letters are the classic bug) ----
const cases = [
  ['crane', 'crane', 'ccccc'],
  ['speed', 'abide', 'aapap'],
  ['llama', 'hello', 'ppaaa'],
  ['geese', 'melee', 'acpac'],
  ['hello', 'llama', 'aappa'],
  ['allee', 'apple', 'cpaac'],
];
for (const [g, t, want] of cases) assert.strictEqual(evaluate(g, t), want, `${g} vs ${t}`);
assert.ok(isValidWord('crane') && isValidWord('CRANE'));
assert.ok(!isValidWord('zzzzz') && !isValidWord('cran') && !isValidWord(null));
console.log('ok  scoring + word list');

// ---- two-player flow over real websockets ----
function client(port, room, id, name) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, state: null, errors: [], waiters: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.type === 'state') {
      c.state = m;
      c.waiters = c.waiters.filter((w) => !w.fn(m) || (w.res(m), false));
    } else if (m.type === 'error') c.errors.push(m.code);
    else c.last = m;
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.until = (fn) =>
    new Promise((res) => {
      if (c.state && fn(c.state)) return res(c.state);
      c.waiters.push({ fn, res });
    });
  return new Promise((res) => ws.on('open', () => (c.send({ type: 'join', room, id, name }), res(c))));
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const A = await client(port, 'TEST', 'aaaaaaaa-1', 'Alice');
  const B = await client(port, 'TEST', 'bbbbbbbb-2', 'Bob');
  const C = await client(port, 'TEST', 'cccccccc-3', 'Carol');
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(C.last && C.last.type, 'full');
  console.log('ok  third player is told the room is full');

  await A.until((s) => s.opp && s.opp.name === 'Bob');
  A.send({ type: 'setTimer', timer: 60 });
  A.send({ type: 'setWord', word: 'zzzzz' });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepStrictEqual(A.errors, ['invalid_word']);

  A.send({ type: 'setWord', word: 'crane' }); // Bob must guess "crane"
  await B.until((s) => s.opp.hasWord);
  assert.ok(!JSON.stringify(B.state).includes('crane'), 'secret leaked to opponent');
  B.send({ type: 'setWord', word: 'slate' }); // Alice must guess "slate"
  await A.until((s) => s.phase === 'countdown');
  await A.until((s) => s.phase === 'playing');
  assert.strictEqual(A.state.settings.timer, 60);
  assert.ok(A.state.endsAt > Date.now());
  console.log('ok  words locked -> countdown -> playing');

  // Alice guesses "slang" (target slate), Bob guesses "trace" (target crane)
  A.send({ type: 'guess', word: 'slang' });
  B.send({ type: 'guess', word: 'trace' });
  A.send({ type: 'guess', word: 'qqqqq' });
  const a = await A.until((s) => s.myGuesses.length === 1 && s.oppGuesses.length === 1);
  const b = await B.until((s) => s.myGuesses.length === 1 && s.oppGuesses.length === 1);
  // Alice's view: everything coloured against HER target ("slate")
  assert.strictEqual(a.myGuesses[0].m, evaluate('slang', 'slate'));
  assert.strictEqual(a.oppGuesses[0].m, evaluate('trace', 'slate'));
  // Bob's view: everything coloured against HIS target ("crane")
  assert.strictEqual(b.myGuesses[0].m, evaluate('trace', 'crane'));
  assert.strictEqual(b.oppGuesses[0].m, evaluate('slang', 'crane'));
  assert.ok(A.errors.includes('invalid_guess'));
  assert.ok(!JSON.stringify(a).includes('"crane"') || a.you.word === 'crane');
  console.log('ok  both boards shown to both players, coloured per viewer');

  A.send({ type: 'guess', word: 'slate' });
  const fin = await B.until((s) => s.phase === 'finished');
  assert.strictEqual(fin.result.winner, 'opp');
  assert.strictEqual(fin.result.yourTarget, 'crane');
  assert.deepStrictEqual(fin.scores, { you: 0, opp: 1, draws: 0 });
  console.log('ok  solve ends the round, words revealed, score updated');

  A.send({ type: 'rematch' });
  const w = await B.until((s) => s.rematch.opp);
  assert.strictEqual(w.phase, 'finished');
  B.send({ type: 'rematch' });
  const lobby = await A.until((s) => s.phase === 'lobby');
  assert.deepStrictEqual(lobby.scores, { you: 1, opp: 0, draws: 0 });
  assert.strictEqual(lobby.myGuesses.length, 0);
  assert.strictEqual(lobby.you.hasWord, false);
  console.log('ok  rematch in same room keeps scores, resets round');

  // reconnect: same id gets the same seat back
  A.ws.close();
  await B.until((s) => s.opp && !s.opp.online);
  const A2 = await client(port, 'TEST', 'aaaaaaaa-1', 'Alice');
  const re = await A2.until((s) => s.opp && s.opp.name === 'Bob');
  assert.strictEqual(re.scores.you, 1);
  console.log('ok  reconnect restores seat');

  // timeout -> draw
  A2.send({ type: 'setTimer', timer: 60 });
  console.log('\nall tests passed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
