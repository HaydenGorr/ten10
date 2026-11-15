'use strict';
(() => {
  const SIZE = 10;
  const FLEET = [
    { name: 'Carrier', len: 5 },
    { name: 'Battleship', len: 4 },
    { name: 'Cruiser', len: 3 },
    { name: 'Submarine', len: 3 },
    { name: 'Destroyer', len: 2 },
  ];
  const LETTERS = 'ABCDEFGHIJ';

  const app = document.getElementById('app');
  const connEl = document.getElementById('conn');
  const toastEl = document.getElementById('toast');

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) el.append(kid instanceof Node ? kid : document.createTextNode(kid));
    return el;
  }
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
  }
  const key = (x, y) => y * SIZE + x;
  const cellsOf = (s) => Array.from({ length: s.len }, (_, i) => [s.x + (s.h ? i : 0), s.y + (s.h ? 0 : i)]);
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

  // ---------- identity (shared with every game on the site) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let myId = store.get('duelle.id', null);
  if (!myId) {
    myId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/[^A-Za-z0-9-]/g, '');
    store.set('duelle.id', myId);
  }
  let myName = store.get('duelle.name', '');
  const nameEl = document.getElementById('myname');
  const showName = () => (nameEl.textContent = myName);
  showName();
  const oppName = () => (S && S.names && S.names[1]) || 'Opponent';

  const modal = document.getElementById('modal');
  function askName(first) {
    return new Promise((resolve) => {
      const input = h('input', { class: 'input', maxlength: 16, value: myName || '', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Your name' });
      const close = () => { modal.replaceChildren(); resolve(myName); };
      const save = () => {
        const v = input.value.replace(/[<>]/g, '').trim().slice(0, 16);
        if (!v) return input.focus();
        myName = v;
        store.set('duelle.name', v);
        showName();
        send({ type: 'setName', name: v });
        close();
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
      const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (!first && e.target === overlay) close(); } },
        h('div', { class: 'sheet', role: 'dialog' },
          h('h2', {}, first ? 'What should we call you?' : 'Your name'),
          h('p', { class: 'note' }, 'Your name is used in every game on this site.'),
          h('div', { class: 'linkrow' }, input, h('button', { onclick: save }, first ? 'Let’s go' : 'Save'))));
      modal.replaceChildren(overlay);
      setTimeout(() => { input.focus(); input.select(); }, 50);
    });
  }
  document.getElementById('me').addEventListener('click', () => askName(false));

  function makeBoard(onClick, onHover) {
    const cells = [];
    const grid = h('div', { class: 'grid' });
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const c = h('button', { class: 'cell', type: 'button', 'aria-label': LETTERS[x] + (y + 1) });
        if (onClick) c.addEventListener('click', () => onClick(x, y));
        if (onHover) {
          c.addEventListener('mouseenter', () => onHover(x, y));
          c.addEventListener('mouseleave', () => onHover(-1, -1));
        }
        if (!onClick) { c.tabIndex = -1; c.classList.add('static'); }
        cells.push(c);
        grid.append(c);
      }
    }
    const cols = h('div', { class: 'cols' }, [...LETTERS].map((l) => h('span', {}, l)));
    const rows = h('div', { class: 'rows' }, Array.from({ length: SIZE }, (_, i) => h('span', {}, String(i + 1))));
    return { el: h('div', { class: 'board-wrap' }, cols, rows, grid), grid, cells };
  }

  function pips(len, sunk) {
    return h('span', { class: 'pips' }, Array.from({ length: len }, () => h('i', { class: sunk ? 'x' : '' })));
  }

  // ---------- connection ----------
  const path = location.pathname.match(/^\/b\/([A-Za-z0-9]{4,8})\/?$/);
  const roomId = path ? path[1].toUpperCase() : null;
  let ws = null;
  let S = null; // latest server state
  let retry = 0;
  let fatal = false;

  function connect() {
    if (fatal || (ws && ws.readyState <= 1)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/bs/ws`);
    ws.onopen = () => {
      retry = 0;
      connEl.hidden = true;
      ws.send(JSON.stringify({ type: 'join', room: roomId, id: myId, name: myName }));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'state') onState(m);
      else if (m.type === 'error') {
        if (m.fatal) { fatal = true; showMessage('Can’t join this game', m.msg); }
        else toast(m.msg);
      }
    };
    ws.onclose = (e) => {
      if (fatal || e.code === 4000) {
        if (e.code === 4000) { fatal = true; showMessage('Opened in another tab', 'This game is now active in another tab or window.'); }
        return;
      }
      connEl.hidden = false;
      setTimeout(connect, Math.min(1000 * 2 ** retry++, 5000));
    };
  }
  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) connect(); });
  window.addEventListener('online', connect);

  // ---------- views ----------
  let view = ''; // which view is currently built
  let ui = null; // handle to update the current view in place

  function mount(name, node, handle) {
    view = name;
    ui = handle || null;
    app.replaceChildren(node);
  }

  function showMessage(title, text) {
    mount('msg', h('div', { class: 'card center' }, h('h2', {}, title), h('p', {}, text), h('a', { class: 'btn', href: '/' }, 'Back to all games')));
  }

  function waitingView() {
    const link = location.origin + '/b/' + roomId;
    const input = h('input', { value: link, readonly: true, 'aria-label': 'Game link', onfocus: (e) => e.target.select() });
    const copy = h('button', {
      onclick: async () => {
        try { await navigator.clipboard.writeText(link); toast('Link copied'); }
        catch { input.select(); document.execCommand && document.execCommand('copy'); toast('Link copied'); }
      },
    }, 'Copy');
    const actions = [h('div', { class: 'linkrow' }, input, copy)];
    if (navigator.share) {
      actions.push(h('button', { class: 'ghost', style: 'width:100%', onclick: () => navigator.share({ title: 'Battleships', text: `${myName} challenges you to Battleships!`, url: link }).catch(() => {}) }, 'Share…'));
    }
    mount('waiting', h('div', { class: 'card' },
      h('h2', {}, 'Invite your opponent'),
      h('p', {}, 'Send them this link. The game starts as soon as they open it. Keep this tab open, or come back to the same link later.'),
      actions,
      h('p', { class: 'note' }, 'Or they can type the code ', h('b', { class: 'code' }, roomId), ' on the home page.'),
      h('p', { class: 'note', style: 'margin-top:14px' }, h('span', { class: 'pulse' }), 'Waiting for opponent…'),
    ));
  }

  // ----- placement -----
  function placingView() {
    let placed = []; // {x,y,len,h}
    let selected = 0; // index into FLEET
    let horiz = true;
    let hover = null;
    const slotUsed = []; // which FLEET slot each placed ship used

    const board = makeBoard((x, y) => onCell(x, y), (x, y) => { hover = x < 0 ? null : { x, y }; paint(); });
    const tray = h('div', { class: 'tray' });
    const status = h('p', { class: 'note' });
    const rotateBtn = h('button', { class: 'ghost', onclick: () => { horiz = !horiz; paint(); } }, '');
    const randomBtn = h('button', { class: 'ghost', onclick: randomize }, 'Randomise');
    const clearBtn = h('button', { class: 'ghost', onclick: () => { placed = []; slotUsed.length = 0; selected = 0; paint(); } }, 'Clear');
    const readyBtn = h('button', { onclick: ready }, 'Ready');

    function fit(x, y, len, hz) {
      // shift the ship back inside the grid so a tap near the edge still works
      if (hz) x = Math.min(x, SIZE - len); else y = Math.min(y, SIZE - len);
      return { x: Math.max(0, x), y: Math.max(0, y), len, h: hz };
    }
    function collides(ship, ignore) {
      const taken = new Set(placed.filter((p) => p !== ignore).flatMap((p) => cellsOf(p).map(([cx, cy]) => key(cx, cy))));
      return cellsOf(ship).some(([cx, cy]) => taken.has(key(cx, cy)));
    }
    function nextFree() {
      for (let i = 0; i < FLEET.length; i++) if (!slotUsed.includes(i)) return i;
      return -1;
    }
    function onCell(x, y) {
      const hit = placed.findIndex((p) => cellsOf(p).some(([cx, cy]) => cx === x && cy === y));
      if (hit !== -1) { // tapping a placed ship picks it up again
        const [s] = placed.splice(hit, 1);
        const slot = slotUsed.splice(hit, 1)[0];
        selected = slot;
        horiz = s.h;
        return paint();
      }
      if (selected < 0) return;
      const ship = fit(x, y, FLEET[selected].len, horiz);
      if (collides(ship)) return toast('Ships can’t overlap');
      placed.push(ship);
      slotUsed.push(selected);
      selected = nextFree();
      paint();
    }
    function randomize() {
      for (let attempt = 0; attempt < 200; attempt++) {
        const out = [];
        const taken = new Set();
        let ok = true;
        for (const f of FLEET) {
          let done = false;
          for (let t = 0; t < 100 && !done; t++) {
            const hz = Math.random() < 0.5;
            const s = { x: Math.floor(Math.random() * (hz ? SIZE - f.len + 1 : SIZE)), y: Math.floor(Math.random() * (hz ? SIZE : SIZE - f.len + 1)), len: f.len, h: hz };
            const cs = cellsOf(s).map(([cx, cy]) => key(cx, cy));
            if (cs.some((c) => taken.has(c))) continue;
            cs.forEach((c) => taken.add(c));
            out.push(s);
            done = true;
          }
          if (!done) { ok = false; break; }
        }
        if (ok) {
          placed = out;
          slotUsed.length = 0;
          FLEET.forEach((_, i) => slotUsed.push(i));
          selected = -1;
          return paint();
        }
      }
    }
    function ready() {
      if (placed.length !== FLEET.length) return;
      send({ type: 'place', ships: placed });
    }

    function paint() {
      const occ = new Map();
      placed.forEach((p) => cellsOf(p).forEach(([cx, cy]) => occ.set(key(cx, cy), true)));
      let prev = new Set();
      let bad = false;
      if (hover && selected >= 0 && !occ.has(key(hover.x, hover.y))) {
        const ship = fit(hover.x, hover.y, FLEET[selected].len, horiz);
        prev = new Set(cellsOf(ship).map(([cx, cy]) => key(cx, cy)));
        bad = collides(ship);
      }
      board.cells.forEach((c, i) => {
        c.className = 'cell' + (occ.has(i) ? ' ship' : '') + (prev.has(i) ? (bad ? ' prev-bad' : ' prev') : '');
      });
      tray.replaceChildren(...FLEET.map((f, i) => h('button', {
        class: 'ship-btn' + (selected === i ? ' active' : '') + (slotUsed.includes(i) ? ' done' : ''),
        disabled: slotUsed.includes(i),
        onclick: () => { selected = i; paint(); },
      }, pips(f.len), f.name)));
      rotateBtn.textContent = horiz ? 'Direction: across' : 'Direction: down';
      rotateBtn.disabled = selected < 0;
      const left = FLEET.length - placed.length;
      readyBtn.disabled = left > 0;
      status.textContent = left > 0
        ? `Pick a ship, then tap the grid to place it (${left} left). Tap a placed ship to pick it back up.`
        : 'Fleet in position. Tap Ready when you’re happy with it.';
      oppLine();
    }

    const oppNote = h('p', { class: 'note' });
    function oppLine() {
      if (!S) return;
      oppNote.textContent = !S.oppConnected ? `${oppName()} is offline right now.` : S.ready[1] ? `${oppName()} is ready and waiting for you.` : `${oppName()} is placing their fleet…`;
    }

    mount('placing', h('div', { class: 'place' },
      h('div', { class: 'boardcol' }, board.el),
      h('div', {},
        h('h2', {}, 'Place your fleet'),
        status, tray,
        h('div', { class: 'actions', style: 'margin:14px 0' }, rotateBtn, randomBtn, clearBtn),
        readyBtn, oppNote,
      ),
    ), { refresh: oppLine });
    paint();
  }

  function placedWaitingView() {
    const own = makeBoard(null);
    own.grid.parentElement.classList.add('locked');
    const note = h('p', {});
    function paint() {
      const occ = new Set(S.myShips.flatMap((s) => cellsOf(s).map(([x, y]) => key(x, y))));
      own.cells.forEach((c, i) => (c.className = 'cell static' + (occ.has(i) ? ' ship' : '')));
      note.textContent = S.oppConnected ? `Waiting for ${oppName()} to finish placing their fleet…` : `${oppName()} is offline. The game continues when they return to the link.`;
    }
    mount('placed', h('div', { class: 'place' },
      h('div', { class: 'boardcol locked' }, own.el),
      h('div', {}, h('h2', {}, 'Fleet locked in'), note, h('p', { class: 'note' }, h('span', { class: 'pulse' }), 'Waiting…')),
    ), { refresh: paint });
    paint();
  }

  // ----- battle -----
  function battleView() {
    let sel = null;
    const target = makeBoard((x, y) => onTarget(x, y));
    target.el.classList.add('target');
    const own = makeBoard(null);
    own.el.classList.add('locked');
    const statusMsg = h('div', { class: 'msg' });
    const statusSub = h('div', { class: 'sub' });
    const score = h('div', { class: 'score' });
    const status = h('div', { class: 'status' }, h('div', {}, statusMsg, statusSub), score);
    const overBox = h('div', { hidden: true });
    const fireBtn = h('button', { onclick: fire }, 'Fire');
    const fireBar = h('div', { class: 'fire-bar' }, fireBtn);
    const enemyFleet = h('span', { class: 'fleetrow' });
    const myFleet = h('span', { class: 'fleetrow' });

    function onTarget(x, y) {
      if (S.phase !== 'playing' || S.turn !== S.you) return toast(S.phase === 'over' ? 'The game is over' : 'Wait for your turn');
      if (S.myShots.some((s) => s.x === x && s.y === y)) return;
      if (sel && sel.x === x && sel.y === y) return fire(); // second tap confirms
      sel = { x, y };
      paint();
    }
    function fire() {
      if (!sel || S.phase !== 'playing' || S.turn !== S.you) return;
      send({ type: 'fire', x: sel.x, y: sel.y });
      sel = null;
      fireBtn.disabled = true;
    }

    function paint(prevS) {
      const mine = S.phase === 'playing' && S.turn === S.you;
      const over = S.phase === 'over';
      // target board
      const shots = new Map(S.myShots.map((s) => [key(s.x, s.y), s]));
      const sunk = new Set(S.oppSunk.flatMap((s) => cellsOf(s).map(([x, y]) => key(x, y))));
      const reveal = new Set((S.oppShips || []).flatMap((s) => cellsOf(s).map(([x, y]) => key(x, y))));
      const lastMine = S.myShots[S.myShots.length - 1];
      target.cells.forEach((c, i) => {
        const s = shots.get(i);
        let cls = 'cell';
        if (s) cls += s.hit ? (sunk.has(i) ? ' hit sunk' : ' hit') : ' miss';
        else if (reveal.has(i)) cls += ' reveal';
        if (sel && key(sel.x, sel.y) === i) cls += ' sel';
        if (lastMine && key(lastMine.x, lastMine.y) === i && (!prevS || prevS.myShots.length !== S.myShots.length)) cls += ' last';
        c.className = cls;
      });
      // own board
      const occ = new Set(S.myShips.flatMap((s) => cellsOf(s).map(([x, y]) => key(x, y))));
      const inc = new Map(S.oppShots.map((s) => [key(s.x, s.y), s]));
      const mySunk = new Set(S.myShips.filter((s) => cellsOf(s).every(([x, y]) => inc.get(key(x, y))?.hit)).flatMap((s) => cellsOf(s).map(([x, y]) => key(x, y))));
      const lastOpp = S.oppShots[S.oppShots.length - 1];
      own.cells.forEach((c, i) => {
        const s = inc.get(i);
        let cls = 'cell static';
        if (occ.has(i)) cls += ' ship';
        if (s) cls += s.hit ? (mySunk.has(i) ? ' hit sunk' : ' hit') : ' miss';
        if (lastOpp && key(lastOpp.x, lastOpp.y) === i && (!prevS || prevS.oppShots.length !== S.oppShots.length)) cls += ' last';
        c.className = cls;
      });
      // fleets remaining
      const oppSunkLens = S.oppSunk.map((s) => s.len);
      const remaining = [...FLEET.map((f) => f.len)];
      const enemy = [];
      for (const f of FLEET) {
        const j = oppSunkLens.indexOf(f.len);
        if (j !== -1) { oppSunkLens.splice(j, 1); enemy.push(pips(f.len, true)); } else enemy.push(pips(f.len, false));
      }
      enemyFleet.replaceChildren(...enemy);
      const mineSunkLens = S.myShips.filter((s) => cellsOf(s).every(([x, y]) => inc.get(key(x, y))?.hit)).map((s) => s.len);
      const myRow = [];
      for (const f of FLEET) {
        const j = mineSunkLens.indexOf(f.len);
        if (j !== -1) { mineSunkLens.splice(j, 1); myRow.push(pips(f.len, true)); } else myRow.push(pips(f.len, false));
      }
      myFleet.replaceChildren(...myRow);
      void remaining;

      // status
      status.classList.toggle('mine', mine);
      score.textContent = `You ${S.wins[0]} – ${S.wins[1]} ${oppName()}`;
      if (over) {
        statusMsg.textContent = S.winner === S.you ? 'You sank their fleet!' : 'Your fleet was sunk';
        statusSub.textContent = '';
      } else if (mine) {
        statusMsg.textContent = 'Your turn';
        statusSub.textContent = sel ? 'Tap the target again or press Fire' : 'Tap a square to aim';
      } else {
        statusMsg.textContent = S.oppConnected ? `${oppName()} is aiming…` : `${oppName()} is offline`;
        statusSub.textContent = S.oppConnected ? '' : 'The game continues when they return to the link';
      }
      // haptics on state changes
      if (prevS && S.oppShots.length > prevS.oppShots.length) buzz(S.oppShots[S.oppShots.length - 1].hit ? [60, 40, 60] : 20);
      if (prevS && S.myShots.length > prevS.myShots.length && S.myShots[S.myShots.length - 1].hit) buzz(40);

      fireBar.hidden = over;
      fireBtn.disabled = !(mine && sel);
      fireBtn.textContent = sel ? `Fire at ${LETTERS[sel.x]}${sel.y + 1}` : 'Fire';

      // game over
      overBox.hidden = !over;
      if (over) {
        const won = S.winner === S.you;
        const rb = h('button', { onclick: () => send({ type: 'rematch' }), disabled: S.rematch[0] }, S.rematch[0] ? `Waiting for ${oppName()}…` : 'Rematch');
        overBox.replaceChildren(h('div', { class: 'over ' + (won ? 'win' : 'lose') },
          h('h2', {}, won ? 'Victory' : 'Defeat'),
          h('p', {}, S.rematch[1] && !S.rematch[0] ? `${oppName()} wants a rematch.` : S.rematch[0] ? 'Rematch requested.' : 'Same link, fresh fleets. The other player starts first.'),
          h('div', { class: 'actions' }, rb),
        ));
      }
    }

    mount('battle', h('div', {},
      overBox, status,
      h('div', { class: 'battle' },
        h('section', { class: 'panel' }, h('h3', {}, `${oppName()}’s waters`, enemyFleet), target.el),
        h('section', { class: 'panel own' }, h('h3', {}, 'Your fleet', myFleet), own.el),
      ),
      fireBar,
    ), { refresh: paint });
    paint(null);
  }

  // ---------- state routing ----------
  function onState(next) {
    const prev = S;
    S = next;
    let want;
    if (S.phase === 'waiting') want = 'waiting';
    else if (S.phase === 'placing') want = S.ready[0] ? 'placed' : 'placing';
    else want = 'battle';
    if (want !== view) {
      if (want === 'waiting') waitingView();
      else if (want === 'placing') placingView();
      else if (want === 'placed') placedWaitingView();
      else battleView();
    } else if (ui && ui.refresh) ui.refresh(prev);
    // keep the page title informative when the tab is in the background
    document.title = S.phase === 'playing' && S.turn === S.you ? 'Your turn · Battleships' : `Battleships · ${roomId}`;
  }

  if (!roomId) location.replace('/');
  else {
    document.title = `Battleships · ${roomId}`;
    app.replaceChildren(h('p', { class: 'center note' }, 'Joining…'));
    (myName ? Promise.resolve() : askName(true)).then(connect);
  }
})();
