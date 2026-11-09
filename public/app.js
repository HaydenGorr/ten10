(() => {
  'use strict';

  /* ================= utilities ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app');

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return e;
  }

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch { return d; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const session = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="3"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m17 9-6 6m0-6 6 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    dice: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><g fill="currentColor" stroke="none"><circle cx="8.5" cy="8.5" r="1.6"/><circle cx="15.5" cy="8.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="8.5" cy="15.5" r="1.6"/><circle cx="15.5" cy="15.5" r="1.6"/></g></svg>',
    eye: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.6M6.2 6.2C3.6 7.9 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/></svg>',
  };
  const icon = (n) => h('span', { html: ICONS[n], style: 'display:inline-flex' });

  function toast(text) {
    const el = h('div', { class: 'toast' }, text);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 2100);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
      return ok;
    }
  }

  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  /* ================= local data ================= */
  const K = { name: 'duelle.name', id: 'duelle.id', words: 'duelle.words', history: 'duelle.history', hideMine: 'duelle.hideMine' };

  let myId = store.get(K.id, null);
  if (!myId) {
    myId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/[^A-Za-z0-9-]/g, '');
    store.set(K.id, myId);
  }
  let myName = store.get(K.name, '');
  let myWords = store.get(K.words, []);
  // Every word you lock in for an opponent lands here (most recent first), whether or not it is in your list.
  let myHistory = store.get(K.history, []).filter((x) => x && typeof x.w === 'string');
  function recordHistory(w) {
    const prev = myHistory.find((x) => x.w === w);
    myHistory = [{ w, n: (prev ? prev.n : 0) + 1, t: Date.now() }, ...myHistory.filter((x) => x.w !== w)].slice(0, 100);
    store.set(K.history, myHistory);
  }
  let WORDS = null; // may be guessed
  let TARGETS = null; // may be chosen as a secret word (no plurals)
  let ANSWERS = [];

  async function loadWords() {
    if (WORDS) return;
    for (let i = 0; i < 4; i++) {
      try {
        const [a, b, c] = await Promise.all([fetch('/words.txt'), fetch('/answers.txt'), fetch('/targets.txt')]);
        if (!a.ok || !b.ok || !c.ok) throw new Error('bad status');
        WORDS = new Set((await a.text()).split('\n').filter(Boolean));
        ANSWERS = (await b.text()).split('\n').filter(Boolean);
        TARGETS = new Set((await c.text()).split('\n').filter(Boolean));
        // the saved list holds words to use as secret words: valid and not plurals
        const clean = myWords.filter((w) => TARGETS.has(w));
        if (clean.length !== myWords.length) { myWords = clean; store.set(K.words, myWords); }
        return;
      } catch { await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
    }
    throw new Error('Could not load the word list');
  }

  /* ================= modal ================= */
  let modalOpen = false;
  function openModal(content, { dismissable = true, onClose } = {}) {
    const root = $('#modal');
    const close = () => { root.replaceChildren(); modalOpen = false; onClose && onClose(); };
    const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (dismissable && e.target === overlay) close(); } }, h('div', { class: 'sheet', role: 'dialog' }, content(close)));
    root.replaceChildren(overlay);
    modalOpen = true;
    return close;
  }

  function askName({ first = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      openModal(
        (close) => {
          const input = h('input', { class: 'input', maxlength: 16, value: myName || '', placeholder: 'hayden, rachel', autocomplete: 'off', spellcheck: 'false' });
          const save = () => {
            const v = input.value.replace(/[<>]/g, '').trim().slice(0, 16);
            if (!v) return input.focus();
            myName = v;
            store.set(K.name, v);
            done = true;
            close();
            resolve(v);
          };
          input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
          setTimeout(() => { input.focus(); input.select(); }, 50);
          return [
            h('h2', {}, first ? 'What should we call you?' : 'Your name'),
            h('div', { class: 'join', style: 'margin:0' }, input, h('button', { class: 'btn primary', onclick: save }, first ? "Let's go" : 'Save')),
          ];
        },
        { dismissable: !first, onClose: () => { if (!done) resolve(myName); } }
      );
    });
  }

  /* ---------- word list manager (profile) ---------- */
  function openProfile(onChange) {
    openModal((close) => {
      const nameIn = h('input', { class: 'input', maxlength: 16, value: myName, autocomplete: 'off', spellcheck: 'false' });
      const saveName = () => {
        const v = nameIn.value.replace(/[<>]/g, '').trim().slice(0, 16);
        if (!v || v === myName) return;
        myName = v;
        store.set(K.name, v);
        onChange && onChange('name');
      };
      nameIn.addEventListener('change', saveName);
      nameIn.addEventListener('blur', saveName);
      nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && (saveName(), nameIn.blur()));

      const msg = h('div', { class: 'msg' });
      const addIn = h('input', { class: 'input word-in', maxlength: 5, placeholder: 'crane', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' });
      const addBtn = h('button', { class: 'btn primary small', style: 'height:46px', disabled: true, onclick: () => add() }, 'Add');
      const listBox = h('div', { class: 'chips' });
      const count = h('span');

      const renderList = () => {
        count.textContent = myWords.length ? `${myWords.length}` : '';
        listBox.replaceChildren(...myWords.map((w) => h('span', { class: 'chip' }, w, h('button', { class: 'x', 'aria-label': 'Remove ' + w, onclick: () => { myWords = myWords.filter((x) => x !== w); store.set(K.words, myWords); renderList(); onChange && onChange('words'); } }, '✕'))));
      };
      // validates the moment the fifth letter goes in
      const check = () => {
        const w = addIn.value;
        let state = '', text = '';
        if (w.length === 5 && WORDS) {
          if (!WORDS.has(w)) { state = 'bad'; text = 'Not in word list'; }
          else if (TARGETS && !TARGETS.has(w)) { state = 'bad'; text = 'No plurals'; }
          else if (myWords.includes(w)) { state = 'bad'; text = 'Already in your list'; }
          else state = 'good';
        }
        addIn.classList.toggle('bad', state === 'bad');
        addIn.classList.toggle('good', state === 'good');
        msg.className = 'msg' + (state ? ' ' + state : '');
        msg.textContent = text;
        addBtn.disabled = state !== 'good';
        return state === 'good';
      };
      addIn.addEventListener('input', () => {
        const v = addIn.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 5);
        if (v !== addIn.value) addIn.value = v;
        check();
      });
      const add = () => {
        if (!check()) return;
        myWords.push(addIn.value);
        store.set(K.words, myWords);
        addIn.value = '';
        check();
        renderList();
        renderHist();
        onChange && onChange('words');
        addIn.focus();
      };
      addIn.addEventListener('keydown', (e) => e.key === 'Enter' && add());
      const histBox = h('div', { class: 'chips' });
      const histWrap = h('div');
      const renderHist = () => {
        histWrap.hidden = !myHistory.length;
        histBox.replaceChildren(...myHistory.map((x) => {
          const saved = myWords.includes(x.w);
          return h('span', { class: 'chip' + (saved ? ' on' : '') }, x.w + (x.n > 1 ? ` ×${x.n}` : ''),
            saved ? null : h('button', { class: 'x', 'aria-label': 'Add ' + x.w + ' to my list', onclick: () => { myWords.push(x.w); store.set(K.words, myWords); renderList(); renderHist(); check(); onChange && onChange('words'); } }, '＋'));
        }));
      };
      histWrap.append(
        h('div', { class: 'label-sm' }, 'History',
          h('button', { class: 'linkish', style: 'float:right;font-size:12px;text-transform:none;letter-spacing:0', onclick: () => { myHistory = []; store.set(K.history, myHistory); renderHist(); onChange && onChange('words'); } }, 'Clear')),
        h('div', { style: 'max-height:22dvh;overflow-y:auto' }, histBox));
      renderList();
      renderHist();
      return [
        h('h2', {}, 'You', h('button', { class: 'iconbtn', onclick: close, 'aria-label': 'Close' }, icon('x'))),
        h('div', { class: 'label-sm', style: 'margin-top:0' }, 'Name'),
        h('div', { class: 'field' }, nameIn),
        h('div', { class: 'label-sm' }, 'My words ', count),
        h('div', { class: 'join', style: 'margin:0' }, addIn, addBtn),
        msg,
        h('div', { style: 'margin-top:10px;max-height:24dvh;overflow-y:auto' }, listBox),
        histWrap,
      ];
    });
  }

  /* ================= confetti ================= */
  const cv = $('#confetti');
  const cx = cv.getContext('2d');
  let parts = [];
  let raf = 0;
  function confetti() {
    cv.width = innerWidth * devicePixelRatio;
    cv.height = innerHeight * devicePixelRatio;
    const colors = ['#8b5cf6', '#ec4899', '#2fbf71', '#f5b82e', '#38bdf8', '#ffffff'];
    for (let i = 0; i < 160; i++) {
      parts.push({
        x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.55,
        vx: (Math.random() - 0.5) * 16, vy: -8 - Math.random() * 12,
        s: 5 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        c: colors[(Math.random() * colors.length) | 0], life: 0,
      });
    }
    if (!raf) raf = requestAnimationFrame(tickConfetti);
  }
  function tickConfetti() {
    cx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    cx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.y < innerHeight + 30 && p.life < 240);
    for (const p of parts) {
      p.life++; p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c;
      cx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.6); cx.restore();
    }
    raf = parts.length ? requestAnimationFrame(tickConfetti) : 0;
    if (!parts.length) cx.clearRect(0, 0, innerWidth, innerHeight);
  }

  /* ================= home ================= */
  async function home() {
    document.title = 'RachelHaydenWordle';
    if (!myName) await askName({ first: true });
    const codeIn = h('input', { class: 'input code-in', placeholder: 'CODE', maxlength: 8, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
    const go = () => {
      const c = codeIn.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (c.length < 4) return toast('Enter the 4-letter game code');
      location.href = '/r/' + c;
    };
    codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    const start = async (btn, bot) => {
      btn.disabled = true;
      try {
        const r = await fetch('/api/rooms' + (bot ? '?bot=1' : ''), { method: 'POST' });
        const { code } = await r.json();
        if (!code) throw 0;
        location.href = '/r/' + code;
      } catch { toast('Could not create a game, try again'); btn.disabled = false; }
    };
    const logoRows = [['rachel', 'cpacap'], ['hayden', 'apcpca'], ['wordle', 'cacpac']];
    const startBtn = h('button', { class: 'btn primary block', style: 'height:54px;font-size:18px', onclick: () => start(startBtn) }, 'Start a game');
    const botBtn = h('button', { class: 'btn block', style: 'margin-top:8px', onclick: () => start(botBtn, true) }, '🤖 Play the bot');
    app.replaceChildren(
      h('div', { class: 'shell' },
        h('div', { class: 'top' },
          h('a', { class: 'brand', href: '/', 'aria-label': 'Home' }, h('span', { class: 'mark' }, 'R')),
          h('div', { class: 'spacer' }),
          h('button', { class: 'iconbtn', 'aria-label': 'Your name and word list', onclick: () => openProfile() }, icon('user'))),
        h('div', { class: 'home' },
          h('div', { class: 'logo', 'aria-label': 'RachelHaydenWordle' }, logoRows.map(([word, marks], r) =>
            h('div', { class: 'logo-row' }, [...word].map((l, i) => h('div', { class: 'tile ' + marks[i], style: `--i:${r * 2 + i}` }, l))))),
          h('div', { class: 'card' },
            startBtn,
            botBtn,
            h('div', { class: 'label-sm', style: 'text-align:center' }, 'or join a friend'),
            h('div', { class: 'join', style: 'margin:0' }, codeIn, h('button', { class: 'btn', style: 'height:46px', onclick: go }, 'Join'))
          )
        )
      )
    );
    loadWords().catch(() => toast('Could not load the word list. Check your connection.'));
  }

  /* ================= room ================= */
  async function room(code) {
    document.title = `RachelHaydenWordle · ${code}`;
    if (!myName) await askName({ first: true });
    try { await loadWords(); } catch { app.replaceChildren(h('div', { class: 'shell' }, h('div', { class: 'stage' }, h('div', { class: 'card' }, h('h2', {}, 'Could not load the word list'), h('p', {}, 'Please check your connection and reload.'))))); return; }

    const link = `${location.origin}/r/${code}`;
    const MIN_ROWS = 6; // rows shown before the board starts to grow and scroll
    let S = null; // latest server state
    let offset = 0; // serverNow - clientNow
    let ws = null;
    let retry = 0;
    let full = false;
    let lastPhase = null;
    let confettiGame = null;
    const ui = { cur: '', draft: '', pop: -1, reveal: {}, firstState: true, sending: 0, autoSent: 0, tab: null, stick: true, scrollTop: 0 };
    const usedKey = 'duelle.used.' + code;
    const REVEAL_MS = 1700;

    /* ----- shell (persistent bits) ----- */
    const headerEl = h('div', { class: 'top' });
    const stageEl = h('div', { class: 'stage' });
    const kbEl = h('div', { class: 'kb', hidden: true });
    const connEl = h('div', { class: 'conn', hidden: true }, 'Reconnecting…');
    const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    const keyEls = {};
    const allKeys = {};
    const mkKey = (k, label, cls = '') => {
      const b = h('button', { class: 'key ' + cls, 'data-k': k, 'aria-label': k === 'back' ? 'Delete' : k }, label);
      if (/^[a-z]$/.test(k)) keyEls[k] = b;
      allKeys[k] = b;
      return b;
    };
    // a physical key press darkens its on-screen key, which fades back over 200ms
    const flashKey = (k) => {
      const el = allKeys[k];
      if (el && el.animate) el.animate([{ backgroundColor: '#0c0a1f', offset: 0 }], { duration: 200, easing: 'ease-out' });
    };
    const enterKey = mkKey('enter', 'Enter', 'wide');
    kbEl.append(
      h('div', { class: 'kr' }, [...ROWS[0]].map((c) => mkKey(c, c))),
      h('div', { class: 'kr' }, h('div', { class: 'half' }), [...ROWS[1]].map((c) => mkKey(c, c)), h('div', { class: 'half' })),
      h('div', { class: 'kr' }, enterKey, [...ROWS[2]].map((c) => mkKey(c, c)), mkKey('back', h('span', { html: ICONS.back }), 'wide'))
    );
    kbEl.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      press(b.dataset.k);
    });
    app.replaceChildren(h('div', { class: 'shell' }, headerEl, stageEl, kbEl), connEl);

    /* ----- sizing ----- */
    function size() {
      const W = Math.min(innerWidth, 620) - 28;
      const H = innerHeight;
      const g = 5;
      const byW = (W - 8 * g - 24 - 22) / 8.5; // my 5 tiles + their 5 tiles at 0.7
      const byH = (H - 450 - 5 * g) / 6;
      const t = Math.max(24, Math.min(64, Math.floor(Math.min(byW, byH))));
      document.documentElement.style.setProperty('--t', t + 'px');
      document.documentElement.style.setProperty('--t2', Math.max(20, Math.floor(t * 0.7)) + 'px');
    }
    addEventListener('resize', size);
    size();

    /* ----- websocket ----- */
    const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
    function connect() {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 0; connEl.hidden = true;
        send({ type: 'join', room: code, id: myId, name: myName });
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'state') onState(m);
        else if (m.type === 'full') { full = true; renderFull(); }
        else if (m.type === 'error') {
          ui.sending = 0;
          if (m.code === 'invalid_word' || m.code === 'invalid_guess') { toast('Not in word list'); shake(); }
          else if (m.code === 'invalid_target') { toast('Plurals can’t be secret words'); shake(); }
          else if (m.code === 'repeat_guess') { toast('You already guessed that'); shake(); }
          else if (m.code === 'busy') toast('Server is busy, try again soon');
        }
      };
      ws.onclose = () => {
        if (full) return;
        connEl.hidden = false;
        setTimeout(connect, Math.min(4000, 400 * 2 ** retry++));
      };
      ws.onerror = () => ws.close();
    }
    setInterval(() => send({ type: 'ping' }), 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && ws && ws.readyState > 1) connect(); });

    function renderFull() {
      app.replaceChildren(h('div', { class: 'shell' }, h('div', { class: 'stage' }, h('div', { class: 'card', style: 'text-align:center' }, h('h2', {}, 'This game is full'), h('p', {}, 'Two players are already in this room.'), h('a', { class: 'btn primary', href: '/', style: 'margin-top:16px;text-decoration:none' }, 'Start your own')))));
    }

    /* ----- state handling ----- */
    function onState(m) {
      const now = Date.now();
      offset = m.serverNow - now;
      const prev = S;
      S = m;
      if (ui.firstState) {
        // rounds that already exist on load are shown flat (no replayed animation)
        m.myGuesses.forEach((g, i) => (ui.reveal['my:' + i] = 0));
        m.oppGuesses.forEach((g, i) => (ui.reveal['opp:' + i] = 0));
        ui.firstState = false;
      }
      if (m.phase !== lastPhase) {
        if (m.phase === 'lobby') { ui.cur = ''; ui.draft = ''; ui.reveal = {}; }
        if (m.phase === 'playing') { ui.cur = ''; ui.stick = true; }
        lastPhase = m.phase;
      }
      if (m.you.locked || (prev && prev.round !== m.round)) { ui.cur = ''; ui.sending = 0; }
      if (m.phase === 'lobby' && !m.you.hasWord && prev && prev.you.hasWord) ui.draft = prev.you.word || '';
      // newly revealed rounds get a timestamp so they flip once
      m.myGuesses.forEach((g, i) => { if (!(('my:' + i) in ui.reveal)) ui.reveal['my:' + i] = now; });
      m.oppGuesses.forEach((g, i) => { if (!(('opp:' + i) in ui.reveal)) ui.reveal['opp:' + i] = now; });
      render();
      const pend = revealPending();
      if (pend > 0) setTimeout(render, pend + 30);
    }

    // time (ms) until the newest revealed row has finished flipping
    function revealPending() {
      const now = Date.now();
      let wait = 0;
      for (const k in ui.reveal) {
        const t = ui.reveal[k];
        if (t && now - t < REVEAL_MS) wait = Math.max(wait, REVEAL_MS - (now - t));
      }
      return wait;
    }

    const serverNow = () => Date.now() + offset;

    /* ----- input ----- */
    function mode() {
      if (!S) return null;
      if (S.phase === 'lobby' && !S.you.hasWord) return 'draft';
      if (S.phase === 'playing' && !S.you.locked && ui.sending !== S.round) return 'guess';
      return null;
    }

    function shake() {
      const el = stageEl.querySelector('.rr.active .cells.my, .draft');
      if (!el) return;
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
    }

    function lockGuess(w) {
      send({ type: 'guess', word: w });
      ui.sending = S.round; // blocks typing until the server confirms the lock
    }

    function press(k) {
      const md = mode();
      if (!md) return;
      const f = md === 'draft' ? 'draft' : 'cur';
      if (/^[a-z]$/.test(k)) {
        if (ui[f].length < 5) { ui[f] += k; ui.pop = ui[f].length - 1; renderStage(); }
      } else if (k === 'back') {
        ui[f] = ui[f].slice(0, -1); ui.pop = -1; renderStage();
      } else if (k === 'enter') {
        const w = ui[f];
        if (w.length < 5) { toast('Not enough letters'); return shake(); }
        if (!WORDS.has(w)) { toast('Not in word list'); return shake(); }
        if (md === 'draft' && !TARGETS.has(w)) { toast('Plurals can’t be secret words'); return shake(); }
        if (md === 'guess') {
          if (S.myGuesses.some((g) => g.w === w)) { toast('You already guessed that'); return shake(); }
          lockGuess(w);
        } else lockWord(w);
      }
    }

    function lockWord(w) {
      send({ type: 'setWord', word: w });
      recordHistory(w);
      const used = session.get(usedKey, []);
      if (!used.includes(w)) { used.push(w); session.set(usedKey, used); }
    }

    document.addEventListener('keydown', (e) => {
      if (modalOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      let k = null;
      if (/^[a-zA-Z]$/.test(e.key)) k = e.key.toLowerCase();
      else if (e.key === 'Backspace') k = 'back';
      else if (e.key === 'Enter') k = 'enter';
      if (!k || !mode()) return;
      e.preventDefault();
      if (!e.repeat) flashKey(k);
      press(k);
    });

    /* ----- keyboard colouring (from every revealed guess, yours and theirs) ----- */
    function renderKeyboard() {
      const now = Date.now();
      const rank = { a: 1, p: 2, c: 3 };
      const best = {};
      if (S) {
        const eat = (list, kind) =>
          list.forEach((g, i) => {
            if (!g.w) return; // skipped turn
            const t = ui.reveal[kind + ':' + i];
            if (t && now - t < REVEAL_MS) return; // still flipping, don't spoil it
            for (let j = 0; j < 5; j++) {
              const l = g.w[j], m = g.m[j];
              if (!best[l] || rank[m] > rank[best[l]]) best[l] = m;
            }
          });
        eat(S.myGuesses, 'my');
        eat(S.oppGuesses, 'opp');
      }
      for (const l in keyEls) keyEls[l].className = 'key' + (best[l] ? ' ' + best[l] : '');
      const playing = !!S && S.phase === 'playing';
      enterKey.textContent = playing ? 'Lock in' : 'Enter';
      kbEl.hidden = !(mode() || playing);
      kbEl.classList.toggle('dim', playing && !mode());
    }

    /* ----- header ----- */
    function renderHeader() {
      const s = S;
      const bits = [h('a', { class: 'brand', href: '/', 'aria-label': 'Home' }, h('span', { class: 'mark' }, 'R'))];
      bits.push(h('div', { class: 'spacer' }));
      if (s && s.opp) {
        bits.push(h('div', { class: 'score', title: 'Score' },
          h('span', { class: 'nm' }, 'You'), h('span', { class: 'n' }, s.scores.you), h('span', { class: 'sep' }, '–'), h('span', { class: 'n' }, s.scores.opp), h('span', { class: 'nm' }, s.opp.name)));
        bits.push(h('div', { class: 'spacer' }));
      }
      bits.push(h('button', { class: 'iconbtn', title: 'Copy invite link', onclick: async () => { toast((await copyText(link)) ? 'Link copied' : link); } }, icon('copy'), h('span', { class: 'code' }, code)));
      bits.push(h('button', { class: 'iconbtn', 'aria-label': 'Your name, word list and history', onclick: () => openProfile(() => { send({ type: 'setName', name: myName }); render(); }) }, icon('user')));
      headerEl.replaceChildren(...bits);
    }

    /* ----- stage renderers ----- */
    function oppName() { return S && S.opp ? S.opp.name : 'your opponent'; }

    function wordTiles(word, cls = '') {
      return [...(word + '     ').slice(0, 5)].map((ch) => h('div', { class: 'tile ' + (ch.trim() ? 'filled ' : '') + cls }, ch.trim()));
    }

    function renderLobby() {
      const s = S;
      const wrap = h('div', { class: 'lobby' });

      if (!s.opp) {
        const doCopy = async () => toast((await copyText(link)) ? 'Link copied' : link);
        wrap.append(
          h('div', { class: 'card', style: 'padding:14px 16px' },
            h('h2', { style: 'font-size:17px' }, 'Invite your opponent'),
            h('div', { class: 'linkbox' }, h('span', {}, link.replace(/^https?:\/\//, '')),
              h('button', { class: 'btn small primary', onclick: doCopy }, icon('copy'), 'Copy'),
              navigator.share ? h('button', { class: 'btn small', 'aria-label': 'Share', onclick: () => navigator.share({ title: 'RachelHaydenWordle', text: `${myName} challenges you to a word duel!`, url: link }).catch(() => {}) }, icon('share')) : null
            )
          )
        );
      }

      const oppOn = s.opp && s.opp.online;
      const used = session.get(usedKey, []);
      const wordCard = h('div', { class: 'card' });
      if (!s.you.hasWord) {
        const inGuessList = ui.draft.length === 5 && WORDS.has(ui.draft);
        const valid = inGuessList && TARGETS.has(ui.draft);
        const bad = ui.draft.length === 5 && !valid;
        const surprise = () => {
          const fresh = ANSWERS.filter((w) => !used.includes(w));
          const src = fresh.length ? fresh : ANSWERS;
          ui.draft = src[Math.floor(Math.random() * src.length)];
          renderStage();
        };
        wordCard.append(
          h('h2', {}, `Choose a word for ${oppName()}`),
          h('div', { class: 'draft' },
            h('button', { class: 'dice', 'aria-label': 'Surprise me', title: 'Surprise me', onclick: surprise }, icon('dice')),
            [...Array(5)].map((_, i) => h('div', { class: 'tile ' + (ui.draft[i] ? 'filled ' : '') + (ui.pop === i ? 'pop' : '') }, ui.draft[i] || ''))),
          h('div', { class: 'hint bad' }, bad ? (inGuessList ? 'No plurals' : 'Not in word list') : ''),
          h('button', { class: 'btn primary block', disabled: !valid, onclick: () => lockWord(ui.draft) }, 'Lock it in'),
          ...(myWords.length
            ? [h('div', { class: 'chips pick' }, myWords.map((w) => h('button', { class: 'chip' + (used.includes(w) ? ' used' : '') + (ui.draft === w ? ' on' : ''), onclick: () => { ui.draft = w; renderStage(); } }, w)))]
            : [])
        );
      } else {
        const inList = myWords.includes(s.you.word);
        wordCard.append(
          h('h2', {}, 'Your word is locked in 🔒'),
          h('div', { class: 'draft' }, wordTiles(s.you.word, 'locked')),
          h('div', { class: 'row-btns' },
            h('button', { class: 'btn small', onclick: () => send({ type: 'clearWord' }) }, 'Change word'),
            h('button', { class: 'btn small', disabled: inList, onclick: () => { myWords.push(s.you.word); store.set(K.words, myWords); toast('Saved to your list'); renderStage(); } }, inList ? '★ In my list' : '☆ Save to my list')
          ),
          h('div', { class: 'status' }, h('div', { class: 'spin' }), !s.opp ? 'Waiting for your opponent to join…' : !oppOn ? `${s.opp.name} stepped away. They can rejoin with the link.` : s.opp.hasWord ? 'Starting…' : `Waiting for ${s.opp.name} to pick a word…`)
        );
      }
      wrap.append(wordCard);

      if (s.opp && !s.you.hasWord) {
        wrap.append(h('div', { class: 'status', style: 'margin-top:0' }, h('span', { class: 'dot' + (oppOn ? ' on' : '') }), oppOn ? (s.opp.hasWord ? `${s.opp.name} has picked a word for you` : `${s.opp.name} is choosing a word…`) : `${s.opp.name} stepped away`));
      }

      // time per round
      const opts = [60, 90, 120, 180, 300, 0];
      wrap.append(
        h('div', { class: 'card', style: 'padding:12px 14px' },
          h('div', { class: 'label-sm', style: 'margin:0 0 8px' }, '⏱ Time per round'),
          h('div', { class: 'chips', style: 'flex-wrap:nowrap' }, opts.map((t) => h('button', { class: 'chip' + (s.settings.timer === t ? ' on' : ''), style: 'text-transform:none;flex:1;padding:6px 0;text-align:center', onclick: () => send({ type: 'setTimer', timer: t }) }, t === 0 ? '∞' : t + 's')))
        )
      );
      return wrap;
    }

    function renderCountdown() {
      return h('div', { class: 'cd' },
        h('div', { class: 'big', id: 'cd' }, Math.max(1, Math.ceil((S.startsAt - serverNow()) / 1000)))
      );
    }

    /* One row = one round: your guess on the left, theirs on the right. */
    function tilesFor(kind, g, r, extra) {
      const now = Date.now();
      const at = ui.reveal[kind + ':' + r];
      const age = at ? now - at : Infinity;
      const animating = age < REVEAL_MS && g.w;
      return [0, 1, 2, 3, 4].map((c) =>
        g.w
          ? h('div', { class: 'tile ' + g.m[c] + (animating ? ' flip' : ''), style: animating ? `animation-delay:${c * 250 - age}ms` : null }, g.w[c])
          : h('div', { class: 'tile skip' }, c === 2 ? '–' : '')
      );
    }

    function roundRow(r, activeRow) {
      const s = S;
      const mine = s.myGuesses[r], theirs = s.oppGuesses[r];
      const L = h('div', { class: 'cells my' + (mine && mine.solved ? ' solvedrow' : '') });
      const R = h('div', { class: 'cells opp' + (theirs && theirs.solved ? ' solvedrow' : '') });
      if (mine) {
        L.append(...tilesFor('my', mine, r));
        R.append(...tilesFor('opp', theirs, r));
      } else if (activeRow) {
        // my side: typing, or locked and held
        if (s.you.locked) L.append(...[...s.you.pending].map((ch) => h('div', { class: 'tile held' }, ch)));
        else for (let c = 0; c < 5; c++) { const ch = ui.cur[c]; L.append(h('div', { class: 'tile' + (ch ? ' filled' : '') + (ch && ui.pop === c ? ' pop' : '') }, ch || '')); }
        // their side: never shows letters, only whether they have locked in
        for (let c = 0; c < 5; c++) R.append(h('div', { class: 'tile ' + (s.opp.locked ? 'held' : 'waiting') }, ''));
      } else {
        for (let c = 0; c < 5; c++) { L.append(h('div', { class: 'tile' })); R.append(h('div', { class: 'tile' })); }
      }
      return h('div', { class: 'rr' + (activeRow ? ' active' : '') }, L, R);
    }

    function statusLine() {
      const s = S, op = s.opp;
      if (s.phase !== 'playing') return null;
      if (s.you.locked && !op.locked) return h('div', { class: 'status' }, h('div', { class: 'spin' }), op.online ? `Locked in. Waiting for ${op.name}…` : `Locked in. ${op.name} is offline…`);
      if (op.locked && !s.you.locked) return h('div', { class: 'status ok' }, h('span', { class: 'dot on' }), `${op.name} has locked in. Your move!`);
      return h('div', { class: 'status' }, h('span', { class: 'dot' + (op.online ? ' on' : '') }), op.online ? `${op.name} is thinking…` : `${op.name} is offline`);
    }

    function renderPlay() {
      const s = S;
      const frag = [];
      const playing = s.phase === 'playing';
      const op = s.opp;
      if (playing) {
        frag.push(h('div', { class: 'strip' },
          s.endsAt
            ? h('div', { class: 'timer', id: 'timer' }, h('div', { class: 'fill', id: 'tfill', style: `width:${Math.max(0, Math.min(100, (Math.min(s.endsAt - serverNow(), s.settings.timer * 1000) / (s.settings.timer * 1000)) * 100))}%` }), h('span', { id: 'ttext' }, fmt(Math.min(s.endsAt - serverNow(), s.settings.timer * 1000))))
            : h('div', { class: 'timer none' }, 'No time limit')));
        frag.push(statusLine());
      }
      const rows = Math.max(MIN_ROWS, s.myGuesses.length + (playing ? 1 : 0));
      const list = h('div', { class: 'rounds' });
      for (let r = 0; r < rows; r++) list.append(roundRow(r, playing && r === s.myGuesses.length));
      frag.push(
        h('div', { class: 'boards' },
          h('div', { class: 'heads' },
            h('div', { class: 'who my' }, h('span', { class: 'nm' }, 'You')),
            h('div', { class: 'who opp' }, h('span', { class: 'dot' + (op.online ? ' on' : '') }), h('span', { class: 'nm' }, op.name))),
          list,
          myWordRow())
      );
      if (s.phase === 'finished' && revealPending() === 0) frag.push(renderResult());
      return frag;
    }

    // the word I set for my opponent, under their board, with a privacy toggle
    function myWordRow() {
      const hidden = store.get(K.hideMine, false);
      const w = S.you.word || '';
      return h('div', { class: 'heads mine-row' },
        h('div', { class: 'who my' }),
        h('div', { class: 'mine-wrap' },
          h('div', { class: 'mine' + (hidden ? ' hid' : '') }, [...Array(5)].map((_, i) => h('div', { class: 'tile' }, hidden ? '' : w[i] || ''))),
          h('button', { class: 'eye', 'aria-label': hidden ? 'Show my word' : 'Hide my word', 'aria-pressed': hidden ? 'true' : 'false',
            onclick: () => { store.set(K.hideMine, !hidden); renderStage(); } }, icon(hidden ? 'eyeOff' : 'eye'))));
    }

    function renderResult() {
      const s = S, r = s.result;
      const won = r.winner === 'you', lost = r.winner === 'opp';
      const title = won ? 'You win!' : lost ? `${s.opp.name} wins!` : 'It’s a draw!';
      const asked = s.rematch.you, theyAsked = s.rematch.opp;
      const btn = h('button', { class: 'btn primary block', disabled: asked, onclick: () => send({ type: 'rematch' }) },
        asked ? `Waiting for ${s.opp.name}…` : theyAsked ? `Accept ${s.opp.name}’s rematch` : '↻ Play again');
      const word = r.yourTarget || '';
      return h('div', { class: 'card result' },
        h('h2', {}, title),
        h('div', { class: 'words' },
          lost
            ? h('div', {}, 'You had to guess', h('div', { class: 'w' }, wordTiles(word, 'a')))
            : h('div', {}, h('div', { class: 'w' }, wordTiles(word, 'c')))),
        btn
      );
    }

    /* ----- main render ----- */
    function renderStage() {
      if (!S) { stageEl.replaceChildren(h('div', { class: 'status' }, h('div', { class: 'spin' }), 'Joining game…')); return; }
      // remember scroll position of the rounds list across rebuilds
      const old = stageEl.querySelector('.rounds');
      if (old) { ui.stick = old.scrollHeight - old.scrollTop - old.clientHeight < 10; ui.scrollTop = old.scrollTop; }
      let content;
      if (S.phase === 'lobby') content = renderLobby();
      else if (S.phase === 'countdown') content = renderCountdown();
      else content = renderPlay();
      stageEl.replaceChildren(...[].concat(content).filter(Boolean));
      const list = stageEl.querySelector('.rounds');
      if (list) list.scrollTop = ui.stick ? list.scrollHeight : ui.scrollTop;
      ui.pop = -1; // pop only animates the render right after typing
      tick();
    }
    function render() {
      renderHeader();
      renderStage();
      renderKeyboard();
      if (S && S.phase === 'finished' && S.result && S.result.winner === 'you' && S.result.reason !== 'idle' && revealPending() === 0 && confettiGame !== S.startsAt) {
        confettiGame = S.startsAt;
        confetti();
      }
      if (S && S.phase === 'playing') size();
    }

    /* ----- ticking (timer / countdown / auto-lock) ----- */
    function tick() {
      if (!S) return;
      if (S.phase === 'countdown') {
        const el = $('#cd');
        if (el) {
          const n = Math.max(1, Math.ceil((S.startsAt - serverNow()) / 1000));
          if (el.textContent !== String(n)) {
            el.textContent = n;
            el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
          }
        }
      } else if (S.phase === 'playing' && S.endsAt) {
        const total = S.settings.timer * 1000;
        const left = Math.min(S.endsAt - serverNow(), total); // the clock waits out the reveal animation
        const t = $('#ttext');
        if (t) {
          t.textContent = fmt(left);
          $('#tfill').style.width = Math.max(0, Math.min(100, (left / total) * 100)) + '%';
          $('#timer').classList.toggle('low', left <= 10000 && left > 0);
        }
        // at the buzzer, lock in whatever valid word is on the board
        if (left <= 350 && mode() === 'guess' && ui.autoSent !== S.round && ui.cur.length === 5 && WORDS.has(ui.cur) && !S.myGuesses.some((g) => g.w === ui.cur)) {
          ui.autoSent = S.round;
          lockGuess(ui.cur);
        }
      }
    }
    setInterval(tick, 200);
    // after a reveal finishes, colour the keyboard
    setInterval(() => { if (S && S.phase !== 'lobby') renderKeyboard(); }, 400);

    renderHeader();
    renderStage();
    connect();
  }

  /* ================= boot ================= */
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{4,8})\/?$/);
  if (m) room(m[1].toUpperCase());
  else home();
})();
