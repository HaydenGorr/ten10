'use strict';
process.env.DUELLE_TEST = '1';
const assert = require('assert');
const WebSocket = require('ws');
const { evaluate, isValidWord, isValidTarget, ANSWERS, WORDS, TARGETS } = require('../lib/game');
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

// ---- guess list vs target list (like the real game) ----
assert.ok(isValidWord('roots') && !isValidTarget('roots'), 'plurals can be guessed, not set');
assert.ok(isValidWord('xylem') && isValidTarget('xylem'), 'non-answer singulars can still be set');
assert.ok(isValidTarget('china') && isValidTarget('chaos') && isValidTarget('bliss') && isValidTarget('lotus'));
assert.ok(ANSWERS.every((w) => TARGETS.has(w)), 'every answer is a legal target');
assert.ok([...TARGETS].every((w) => WORDS.has(w)), 'every target is a legal guess');
assert.ok([...TARGETS].filter((w) => w.endsWith('s') && !w.endsWith('ss') && !ANSWERS.includes(w)).length <= 20, 'only the small singular allowlist may end in s');
console.log('ok  guess list vs target list: plurals guessable, never settable');

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
    new Promise((res, rej) => {
      if (c.state && fn(c.state)) return res(c.state);
      const t = setTimeout(() => rej(new Error('timed out waiting; state=' + JSON.stringify(c.state))), 6000);
      c.waiters.push({ fn, res: (v) => (clearTimeout(t), res(v)) });
    });
  return new Promise((res) => ws.on('open', () => (c.send({ type: 'join', room, id, name }), res(c))));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pair(port, room, wordA, wordB) {
  const A = await client(port, room, room + 'aaaaaaaa', 'Alice');
  const B = await client(port, room, room + 'bbbbbbbb', 'Bob');
  await A.until((s) => s.opp && s.opp.name === 'Bob');
  A.send({ type: 'setWord', word: wordA }); // Bob must guess wordA
  B.send({ type: 'setWord', word: wordB }); // Alice must guess wordB
  await A.until((s) => s.phase === 'playing');
  await B.until((s) => s.phase === 'playing');
  return { A, B };
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  // --- the server refuses a plural as a secret word, but accepts it as a guess ---
  {
    const A = await client(port, 'PLUR', 'plurAAAAAAAA', 'Alice');
    const B = await client(port, 'PLUR', 'plurBBBBBBBB', 'Bob');
    await A.until((s) => s.opp);
    A.send({ type: 'setWord', word: 'roots' });
    await sleep(80);
    assert.deepStrictEqual(A.errors, ['invalid_target']);
    assert.strictEqual(A.state.you.hasWord, false);
    A.send({ type: 'setWord', word: 'xylem' });
    B.send({ type: 'setWord', word: 'slate' });
    await A.until((s) => s.phase === 'playing');
    A.send({ type: 'guess', word: 'roots' });
    B.send({ type: 'guess', word: 'trees' });
    await A.until((s) => s.round === 2);
    assert.strictEqual(A.state.myGuesses[0].w, 'roots');
    console.log('ok  server: plural rejected as a secret word, accepted as a guess');
  }

  // --- room full ---
  {
    const { A } = await pair(port, 'FULL', 'crane', 'slate');
    const C = await client(port, 'FULL', 'cccccccc-3', 'Carol');
    await sleep(100);
    assert.strictEqual(C.last && C.last.type, 'full');
    console.log('ok  third player is told the room is full');
  }

  // --- main flow: held guesses, simultaneous reveal, multiple rounds ---
  const { A, B } = await pair(port, 'MAIN', 'crane', 'slate');
  assert.strictEqual(A.state.settings.timer, 120, 'default timer is 120');
  assert.strictEqual(A.state.round, 1);
  assert.ok(!JSON.stringify(B.state).includes('crane'), 'secret leaked to opponent');
  console.log('ok  both words locked -> playing, timer defaults to 120s per round');

  A.send({ type: 'guess', word: 'qqqqq' });
  A.send({ type: 'guess', word: 'slang' }); // Alice's target is "slate"
  const bSees = await B.until((s) => s.opp.locked);
  assert.strictEqual(bSees.oppGuesses.length, 0, 'opponent guess must stay hidden');
  assert.ok(!JSON.stringify(bSees).includes('slang'), 'held guess leaked');
  const aHeld = await A.until((s) => s.you.locked);
  assert.strictEqual(aHeld.myGuesses.length, 0, 'own guess is held too');
  assert.strictEqual(aHeld.you.pending, 'slang');
  assert.ok(A.errors.includes('invalid_guess'));
  A.send({ type: 'guess', word: 'adieu' }); // can't change once locked
  await sleep(60);
  assert.strictEqual(A.state.you.pending, 'slang');
  console.log('ok  a locked guess is held and hidden until both have locked');

  B.send({ type: 'guess', word: 'trace' }); // Bob's target is "crane"
  const a1 = await A.until((s) => s.round === 2);
  const b1 = await B.until((s) => s.round === 2);
  assert.strictEqual(a1.myGuesses.length, 1);
  assert.strictEqual(a1.oppGuesses.length, 1);
  assert.strictEqual(a1.myGuesses[0].m, evaluate('slang', 'slate'));
  assert.strictEqual(a1.oppGuesses[0].m, evaluate('trace', 'slate'), "Bob's guess is coloured for Alice's word");
  assert.strictEqual(b1.myGuesses[0].m, evaluate('trace', 'crane'));
  assert.strictEqual(b1.oppGuesses[0].m, evaluate('slang', 'crane'), "Alice's guess is coloured for Bob's word");
  assert.strictEqual(a1.you.locked, false);
  assert.ok(a1.endsAt > a1.roundStartsAt && a1.endsAt - a1.roundStartsAt === 120000, 'clock reset to 120s');
  console.log('ok  both reveal together, coloured per viewer, clock resets for round 2');

  // many rounds are allowed (no 6-guess cap)
  const filler = ['about', 'adieu', 'ghost', 'house', 'plumb', 'fjord', 'quick', 'wryly'];
  for (let i = 0; i < filler.length; i++) {
    A.send({ type: 'guess', word: filler[i] });
    B.send({ type: 'guess', word: filler[(i + 3) % filler.length] });
    await A.until((s) => s.round === i + 3);
  }
  assert.strictEqual(A.state.phase, 'playing');
  assert.strictEqual(A.state.myGuesses.length, 9);
  A.send({ type: 'guess', word: 'about' }); // repeat
  await sleep(60);
  assert.ok(A.errors.includes('repeat_guess'));
  console.log('ok  unlimited rounds (9 played, still going), repeats rejected');

  // Alice cracks it; Bob doesn't
  A.send({ type: 'guess', word: 'slate' });
  B.send({ type: 'guess', word: 'zebra' });
  const fin = await B.until((s) => s.phase === 'finished');
  assert.strictEqual(fin.result.winner, 'opp');
  assert.strictEqual(fin.result.reason, 'solved');
  assert.strictEqual(fin.result.yourTarget, 'crane');
  assert.deepStrictEqual(fin.scores, { you: 0, opp: 1, draws: 0 });
  console.log('ok  cracking the word ends the game, words revealed, score updated');

  A.send({ type: 'rematch' });
  const w = await B.until((s) => s.rematch.opp);
  assert.strictEqual(w.phase, 'finished');
  B.send({ type: 'rematch' });
  const lobby = await A.until((s) => s.phase === 'lobby');
  assert.deepStrictEqual(lobby.scores, { you: 1, opp: 0, draws: 0 });
  assert.strictEqual(lobby.myGuesses.length, 0);
  assert.strictEqual(lobby.you.hasWord, false);
  console.log('ok  rematch in the same room keeps scores, resets the game');

  // --- both crack it in the same round = draw ---
  {
    const { A: a, B: b } = await pair(port, 'BOTH', 'crane', 'slate');
    a.send({ type: 'guess', word: 'slate' });
    b.send({ type: 'guess', word: 'crane' });
    const f = await a.until((s) => s.phase === 'finished');
    assert.strictEqual(f.result.winner, 'draw');
    assert.strictEqual(f.result.reason, 'both');
    assert.strictEqual(f.scores.draws, 1);
    console.log('ok  both cracking it in the same round is a draw');
  }

  // --- timer is per round: a missed turn is skipped, the clock restarts, an idle round resets it ---
  {
    const { A: a, B: b } = await pair(port, 'TIME', 'crane', 'slate');
    a.send({ type: 'setTimer', timer: 1 }); // ignored: not in the lobby any more
    await sleep(50);
    assert.strictEqual(a.state.settings.timer, 120);
  }
  {
    const A = await client(port, 'TIM2', 'tim2aaaaaaaa', 'Alice');
    const B = await client(port, 'TIM2', 'tim2bbbbbbbb', 'Bob');
    await A.until((s) => s.opp);
    A.send({ type: 'setTimer', timer: 1 });
    await B.until((s) => s.settings.timer === 1);
    A.send({ type: 'setWord', word: 'crane' });
    B.send({ type: 'setWord', word: 'slate' });
    await A.until((s) => s.phase === 'playing');
    A.send({ type: 'guess', word: 'slang' }); // Bob stays silent
    const r2 = await A.until((s) => s.round === 2); // clock expires -> reveal with Bob skipped
    assert.strictEqual(r2.myGuesses[0].w, 'slang');
    assert.strictEqual(r2.oppGuesses[0].w, null, "Bob's missed turn is a skipped row");
    // round 2: nobody plays -> the clock just restarts, the game carries on
    const before = r2.endsAt;
    const again = await A.until((s) => s.endsAt > before);
    assert.strictEqual(again.phase, 'playing');
    assert.strictEqual(again.round, 2, 'no row is added when nobody locked in');
    assert.strictEqual(again.myGuesses.length, 1);
    A.send({ type: 'guess', word: 'slate' });
    B.send({ type: 'guess', word: 'zebra' });
    const won = await A.until((s) => s.phase === 'finished');
    assert.strictEqual(won.result.winner, 'you');
    console.log('ok  per-round timer: missed turn is skipped, clock restarts, an idle round just resets the clock');
  }

  // --- bot opponent ---
  {
    const res = await fetch(`http://localhost:${port}/api/rooms?bot=1`, { method: 'POST' });
    const { code } = await res.json();
    const H = await client(port, code, 'humanhuman-1', 'Hayden');
    const s0 = await H.until((s) => s.opp);
    assert.strictEqual(s0.opp.name, 'Bot');
    assert.strictEqual(s0.opp.online, true);
    H.send({ type: 'setWord', word: 'crane' });
    await H.until((s) => s.phase === 'playing'); // the bot picked its own word and the game started
    H.send({ type: 'guess', word: 'adieu' });
    const r2 = await H.until((s) => s.round === 2); // bot locked in too, both revealed together
    assert.strictEqual(r2.oppGuesses.length, 1);
    assert.ok(r2.oppGuesses[0].w && r2.oppGuesses[0].w.length === 5);
    // play until the game ends: the bot only uses colours, so it must converge on the human's word
    let rounds = 1;
    while (H.state.phase === 'playing' && rounds < 40) {
      const target = H.state.round;
      const w = ['about', 'ghost', 'house', 'plumb', 'fjord', 'quick', 'wryly', 'zebra', 'mango', 'lemon', 'piano', 'tiger'][rounds % 12];
      if (H.state.myGuesses.some((g) => g.w === w)) { rounds++; continue; }
      H.send({ type: 'guess', word: w });
      await H.until((s) => s.round > target || s.phase !== 'playing');
      rounds++;
    }
    assert.strictEqual(H.state.phase, 'finished', 'bot should crack the word eventually');
    assert.notStrictEqual(H.state.result.winner, 'you');
    H.send({ type: 'rematch' });
    const lobby = await H.until((s) => s.phase === 'lobby'); // the bot accepts rematches
    assert.strictEqual(lobby.scores.opp + lobby.scores.you + lobby.scores.draws, 1);
    console.log(`ok  bot opponent: seated, picks a word, plays ${rounds} rounds from colours alone, accepts a rematch`);
  }

  // --- reconnect keeps the seat ---
  {
    const { A: a, B: b } = await pair(port, 'RECO', 'crane', 'slate');
    a.send({ type: 'guess', word: 'slang' });
    await b.until((s) => s.opp.locked);
    a.ws.close();
    await b.until((s) => !s.opp.online);
    const a2 = await client(port, 'RECO', 'RECOaaaaaaaa', 'Alice');
    const re = await a2.until((s) => s.opp && s.opp.name === 'Bob');
    assert.strictEqual(re.you.pending, 'slang', 'held guess survives a reconnect');
    console.log('ok  reconnect restores the seat and the held guess');
  }

  console.log('\nall tests passed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
