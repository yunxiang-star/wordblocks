/* =========================================================
   词块 WordBlocks — 前端逻辑
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  const IS_APP = (typeof Android !== 'undefined' && Android && typeof Android.lookup === 'function');

  function uid() {
    return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  /** 新词占比：0 ~ 1，默认一半 */
  function normShare(v) {
    const n = Number(v);
    if (!isFinite(n)) return 0.5;
    return clamp(n, 0, 1);
  }
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function nowStr() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* =========================================================
     记忆曲线（SRS）—— 2.0 核心，2.1 起一天只涨一档
     ========================================================= */
  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

  // 每个台阶对应的复习间隔。台阶越高，下次见面的间隔越长。
  const STAGE_GAP = [
    10 * MIN,   // 0 刚学 / 忘了 → 本轮结束时再来一遍
    1 * DAY,    // 1
    2 * DAY,    // 2
    4 * DAY,    // 3
    7 * DAY,    // 4  ← 到这一档算「已掌握」
    15 * DAY,   // 5
    30 * DAY,   // 6
    60 * DAY,   // 7
    120 * DAY   // 8
  ];
  const MASTER_STAGE = 4;

  function dateKey(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function stageOf(w) { return clamp(Math.round(Number(w.stage) || 0), 0, STAGE_GAP.length - 1); }
  function dueOf(w) { return Number(w.dueAt) || 0; }
  function isMastered(w) { return stageOf(w) >= MASTER_STAGE; }
  /** 从没进过背诵流程（或上次直接判「不认识」且还没学会）的词 */
  function isNewWord(w) { return !w.learnedAt; }
  /** 学过、且已经到复习时间的词 */
  function isDue(w, now) {
    if (isNewWord(w)) return false;
    return dueOf(w) <= (now || Date.now());
  }
  function overdueDays(w, now) {
    const t = dueOf(w);
    if (!t) return 0;
    return Math.max(0, ((now || Date.now()) - t) / DAY);
  }
  /** 越该先背分数越高：拖得久、忘得多、台阶低 → 优先 */
  function urgency(w, now) {
    const over = Math.min(overdueDays(w, now), 60);
    const lapse = Number(w.lapses) || 0;
    return over * 2 + lapse * 12 - stageOf(w) * 6;
  }
  function nextDueText(w) {
    if (isNewWord(w)) return '还没背过';
    const t = dueOf(w);
    if (!t) return '待复习';
    const d = t - Date.now();
    if (d <= 0) return '现在该复习了';
    if (d < HOUR) return '约 ' + Math.max(1, Math.round(d / MIN)) + ' 分钟后';
    if (d < DAY) return '约 ' + Math.round(d / HOUR) + ' 小时后';
    return '约 ' + Math.round(d / DAY) + ' 天后';
  }

  /**
   * 答题后推进记忆状态。
   * grade: 'good' 认识 / 'hard' 模糊 / 'again' 不认识
   *
   * 2.1：同一天只涨一档。一天里想多背几轮随时都能背，
   * 但多出来的轮次算「加练巩固」，不会把复习间隔一天拉长好几次。
   */
  function reviewWord(w, grade) {
    const st = stageOf(w);
    const tk = todayKey();
    w.reviews = (Number(w.reviews) || 0) + 1;
    w.lastReviewAt = Date.now();
    w.lastReview = nowStr();
    if (grade === 'good') {
      // 还没到期（或没学过时 dueAt=0）→ 只有「到期 / 新词」才推进台阶。
      // 已经排在以后的老词再答对，只是加练巩固：台阶、间隔都不动。
      if (isNewWord(w) || dueOf(w) <= Date.now()) {
        if (w.goodDay !== tk) {
          w.stage = Math.min(st + 1, STAGE_GAP.length - 1);
          w.goodDay = tk;
        }
        w.dueAt = Date.now() + STAGE_GAP[w.stage];
      }
    } else if (grade === 'hard') {
      // 模糊：台阶不涨，间隔砍半，半天后再来
      w.stage = Math.max(st, 1);
      w.dueAt = Date.now() + Math.max(STAGE_GAP[w.stage] / 2, 4 * HOUR);
    } else {
      // 不认识：打回起点，本轮结束时重新出现
      w.stage = 0;
      w.goodDay = '';
      w.lapses = (Number(w.lapses) || 0) + 1;
      w.dueAt = Date.now() + STAGE_GAP[0];
    }
    w.learnedAt = w.learnedAt || Date.now();
    w.known = isMastered(w);
    return w;
  }

  /** 某个区块的今日待办 */
  function deckStats(d) {
    const now = Date.now();
    let due = 0, fresh = 0, mastered = 0, extra = 0;
    (d.words || []).forEach(w => {
      if (isNewWord(w)) fresh++;
      else if (isDue(w, now)) due++;
      else extra++;
      if (isMastered(w)) mastered++;
    });
    return { due: due, fresh: fresh, extra: extra, mastered: mastered, total: (d.words || []).length };
  }

  /** 所有区块合计 */
  function globalStats() {
    const now = Date.now();
    const dayStart = new Date(todayKey() + 'T00:00:00').getTime();
    let due = 0, fresh = 0, total = 0, mastered = 0, doneToday = 0, extra = 0;
    S.decks.forEach(d => {
      d.words.forEach(w => {
        total++;
        if (isNewWord(w)) fresh++;
        else if (isDue(w, now)) due++;
        else extra++;
        if (isMastered(w)) mastered++;
        if (Number(w.lastReviewAt) >= dayStart) doneToday++;
      });
    });
    return { due: due, fresh: fresh, total: total, mastered: mastered,
             doneToday: doneToday, extra: extra };
  }

  /**
   * 从新词里挑 n 个：一半挑最早加的、一半挑最近加的，
   * 让「新加入的」和「旧加入的」自然混在一批里（2.1）。
   */
  function pickFresh(fresh, n) {
    if (n <= 0) return [];
    if (n >= fresh.length) return fresh.slice();
    const out = [];
    let lo = 0, hi = fresh.length - 1, fromOld = true;
    while (out.length < n) {
      out.push(fromOld ? fresh[lo++] : fresh[hi--]);
      fromOld = !fromOld;
    }
    return out;
  }

  /**
   * 组合一次背诵：到期复习 与 新词 并行。
   * 智能模式默认把一半名额留给新词，复习词不够时空位让给新词；
   * 新词和到期词都不够时，用「今天已经过一遍、下次复习排在以后」的老词补满，
   * 所以只要区块里有词，任何时候都背得下去（2.1 修的正是这一点）。
   */
  function planSession(deck, opts) {
    const o = opts || {};
    const now = Date.now();
    const mode = o.mode || 'smart';
    const limit = Math.max(1, Number(o.size) || 20);
    const newShare = typeof o.newShare === 'number'
      ? o.newShare
      : (S.settings && typeof S.settings.newShare === 'number' ? S.settings.newShare : 0.5);
    const fillLater = o.fillLater !== false;

    const words = (deck.words || []).slice();
    const due = words.filter(w => isDue(w, now))
      .sort((a, b) => urgency(b, now) - urgency(a, now));
    const fresh = words.filter(isNewWord);            // 保持录入顺序
    const later = words.filter(w => !isNewWord(w) && !isDue(w, now))
      .sort((a, b) => dueOf(a) - dueOf(b));           // 越快到期的越先加练

    let picks = [];
    let newCount = 0, reviewCount = 0, extraCount = 0;

    function tail(list, seat) {
      if (!fillLater || seat <= 0) return [];
      const extra = list.slice(0, seat);
      extraCount = extra.length;
      return extra;
    }

    if (mode === 'review') {
      // 只复习：先到期词，不够时补「已排到以后」的老词
      const duePick = due.slice(0, limit);
      reviewCount = duePick.length;
      picks = duePick.concat(tail(later, limit - duePick.length));
    } else if (mode === 'new') {
      // 只学新词：新词背完那天还能继续，自动用老词兜底
      const newPick = pickFresh(fresh, limit);
      newCount = newPick.length;
      picks = newPick.concat(tail(later, limit - newPick.length));
    } else {
      const wantNew = newShare > 0 ? Math.min(Math.round(limit * newShare), fresh.length) : 0;
      const duePick = due.slice(0, Math.max(0, limit - wantNew));
      // 到期词不够，空位让给新词（新词占比为 0 时不补新词）
      const newSeat = newShare > 0
        ? Math.min(fresh.length, wantNew + Math.max(0, limit - wantNew - duePick.length))
        : 0;
      const newPick = pickFresh(fresh, newSeat);
      const spare = limit - duePick.length - newPick.length;
      picks = duePick.concat(newPick, tail(later, spare));
      reviewCount = duePick.length;
      newCount = newPick.length;
    }

    return { picks: picks, due: due, fresh: fresh, later: later,
             newCount: newCount, reviewCount: reviewCount, extraCount: extraCount };
  }

  /** 连续打卡：同一天只记一次，断档则重来 */
  function touchStreak() {
    const t = todayKey();
    if (S.stats.lastDay === t) return false;
    const y = dateKey(new Date(Date.now() - DAY));
    S.stats.streak = (S.stats.lastDay === y) ? (Number(S.stats.streak) || 0) + 1 : 1;
    S.stats.lastDay = t;
    save();
    return true;
  }

  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('on'), ms || 1900);
  }
  function loading(on, text) {
    const l = $('#loading');
    if (on) { $('#loadingText').textContent = text || '处理中…'; l.classList.add('on'); }
    else l.classList.remove('on');
  }

  /* ---------------- 内置词库 ---------------- */
  const GLOSSARY = (window.GLOSSARY || []);
  const GMAP = {};
  GLOSSARY.forEach(g => { GMAP[g.en.toLowerCase()] = g; });

  function localLookup(word) {
    const g = GMAP[String(word).trim().toLowerCase()];
    if (!g) return null;
    return {
      ok: true,
      word: g.en,
      ukphone: g.ipa || null,
      usphone: null,
      defs: [(g.pos ? g.pos + ' ' : '') + g.zh],
      examples: (g.ex ? [{ en: g.ex, zh: g.exZh || '' }] : []),
      source: 'builtin',
      subject: g.subject || '',
      extraDefs: g.also || null
    };
  }

  /* ---------------- 数据层 ---------------- */
  const VERSION = 3;

  const COLORS = ['#3B82F6', '#C0504A', '#3F9469', '#6366CB', '#C9A04B', '#5B9BB5', '#B85A72', '#8E8E93'];
  const EMOJIS = ['📘', '🎯', '📐', '🧮', '🔬', '🌍', '💼', '🎓', '🧠', '✏️', '📗', '🛠️'];

  /* ---------- 3.1 手绘小插画（纯 SVG，离线可用） ---------- */
  const ILL_EMPTY =
    '<svg class="illus" viewBox="0 0 120 120" aria-hidden="true">' +
    '<defs><linearGradient id="wbG1" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#5B8FD6"/><stop offset="1" stop-color="#3B6DB5"/></linearGradient></defs>' +
    '<ellipse cx="60" cy="99" rx="30" ry="5" fill="rgba(19,19,22,.07)"/>' +
    '<rect x="26" y="44" width="68" height="42" rx="10" fill="#F1F2F7" stroke="rgba(19,19,22,.08)" transform="rotate(-9 60 65)"/>' +
    '<rect x="28" y="41" width="68" height="43" rx="10" fill="#FFFFFF" stroke="rgba(19,19,22,.1)" transform="rotate(-4 62 62)"/>' +
    '<rect x="30" y="38" width="68" height="44" rx="10" fill="#FFFFFF" stroke="rgba(19,19,22,.12)" stroke-width="1.6"/>' +
    '<rect x="41" y="52" width="30" height="5" rx="2.5" fill="#C9CCD6"/>' +
    '<rect x="41" y="63" width="43" height="4" rx="2" fill="#E3E5EC"/>' +
    '<rect x="41" y="71" width="24" height="4" rx="2" fill="#EDEFF4"/>' +
    '<circle cx="95" cy="33" r="13" fill="url(#wbG1)"/>' +
    '<path d="M95 27v12M89 33h12" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>' +
    '</svg>';

  const ILL_SEARCH =
    '<svg class="illus" viewBox="0 0 120 120" aria-hidden="true">' +
    '<circle cx="55" cy="50" r="25" fill="#FFFFFF" stroke="rgba(19,19,22,.12)" stroke-width="3.4"/>' +
    '<path d="M74 69l14 14" stroke="#C7CAD4" stroke-width="8" stroke-linecap="round"/>' +
    '<rect x="44" y="43" width="22" height="4.6" rx="2.3" fill="#D5D8E0"/>' +
    '<rect x="44" y="53" width="14" height="4.6" rx="2.3" fill="#E6E8EE"/>' +
    '<circle cx="85" cy="34" r="3" fill="rgba(19,19,22,.1)"/><circle cx="32" cy="82" r="2.4" fill="rgba(19,19,22,.08)"/>' +
    '</svg>';

  const ILL_MEDAL =
    '<svg class="medal" viewBox="0 0 120 120" aria-hidden="true">' +
    '<defs><linearGradient id="wbG2" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#FFD87A"/><stop offset="1" stop-color="#FF9F43"/></linearGradient>' +
    '<linearGradient id="wbG3" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#9DB4FF"/><stop offset="1" stop-color="#7B5CFF"/></linearGradient></defs>' +
    '<path d="M43 16l11 32M77 16L66 48" stroke="url(#wbG3)" stroke-width="10" stroke-linecap="round"/>' +
    '<circle cx="60" cy="72" r="29" fill="url(#wbG2)" stroke="#FFE7B8" stroke-width="2"/>' +
    '<circle cx="60" cy="72" r="21.5" fill="none" stroke="#FFF8E4" stroke-width="2" opacity=".8"/>' +
    '<path d="M60 58l4.9 10 11 1.6-8 7.8 1.9 11-9.8-5.2-9.8 5.2 1.9-11-8-7.8 11-1.6z" fill="#fff"/>' +
    '</svg>';

  function defaultDecks() {
    return [
      {
        id: 'deck_ielts', name: '雅思生词本', emoji: '🎯', color: '#C0504A',
        desc: '雅思阅读 / 听力 / 写作高频生词', builtin: true, createdAt: Date.now(), words: []
      },
      {
        id: 'deck_math', name: '线代 & 微积分', emoji: '📐', color: '#3B82F6',
        desc: '用英语学线性代数与微积分', builtin: true, createdAt: Date.now(), words: []
      }
    ];
  }

  let S = {
    version: VERSION,
    decks: [],
    settings: { ipa: true, example: true, shuffle: false, lastDeck: null, planSize: 20, newShare: 0.5 },
    stats: { streak: 0, lastDay: '', sessions: 0, answers: 0 }
  };

  const store = {
    read() {
      try {
        if (IS_APP) {
          const raw = Android.loadData();
          if (raw && raw.length > 2) return JSON.parse(raw);
        } else {
          const raw = localStorage.getItem('wordblocks');
          if (raw) return JSON.parse(raw);
        }
      } catch (e) { console.warn('load failed', e); }
      return null;
    },
    write(obj) {
      const raw = JSON.stringify(obj);
      try {
        if (IS_APP) return Android.saveData(raw);
        localStorage.setItem('wordblocks', raw);
        return true;
      } catch (e) { return false; }
    }
  };

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { store.write(S); }, 60);
  }
  function saveNow() { clearTimeout(saveTimer); return store.write(S); }

  function deckById(id) { return S.decks.find(d => d.id === id) || null; }

  /* ---------------- 路由状态 ---------------- */
  let route = { view: 'home', deckId: null };
  let deckFilter = 'all';
  let deckQuery = '';

  /* ---------------- 查询（本地优先 → 在线） ---------------- */
  let _lid = 0;
  const _pending = {};
  const _cache = {};

  window.wbLookupDone = function (id, jsonStr) {
    const p = _pending[id];
    if (!p) return;
    delete _pending[id];
    clearTimeout(p.timer);
    let data;
    try { data = JSON.parse(jsonStr); } catch (e) { data = { ok: false, error: '结果解析失败' }; }
    p.resolve(data);
  };

  function remoteLookup(word) {
    return new Promise(resolve => {
      if (!IS_APP) {
        fetch('https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(word))
          .then(r => r.json())
          .then(j => {
            const ec = j && j.ec && j.ec.word && j.ec.word[0];
            if (ec) {
              const defs = [];
              (ec.trs || []).forEach(t => (t.tr || []).forEach(x => {
                ((x.l || {}).i || []).forEach(s => defs.push(s));
              }));
              const exs = [];
              const sp = j.blng_sents_part && j.blng_sents_part['sentence-pair'];
              (Array.isArray(sp) ? sp : (sp ? [sp] : [])).slice(0, 3).forEach(p => {
                if (p.sentence) exs.push({ en: p.sentence, zh: p['sentence-translation'] || '' });
              });
              resolve({ ok: true, word, ukphone: ec.ukphone || ec.usphone, defs, examples: exs, source: 'youdao' });
            } else resolve({ ok: false, error: '没查到' });
          })
          .catch(() => resolve({ ok: false, error: '浏览器环境无法直连词典，请在 App 内使用' }));
        return;
      }
      const id = 'q' + (++_lid);
      const timer = setTimeout(() => {
        if (_pending[id]) { delete _pending[id]; resolve({ ok: false, error: '网络超时，请检查网络' }); }
      }, 17000);
      _pending[id] = { resolve, timer };
      try { Android.lookup(id, word); }
      catch (e) { clearTimeout(timer); delete _pending[id]; resolve({ ok: false, error: '查询调用失败' }); }
    });
  }

  async function smartLookup(word) {
    const key = String(word).trim().toLowerCase();
    if (!key) return { ok: false, error: '请输入单词' };
    if (_cache[key]) return _cache[key];
    let data = localLookup(key);
    if (!data) data = await remoteLookup(word);
    data.query = word;
    _cache[key] = data;
    return data;
  }

  /* ---------------- 底部面板 ---------------- */
  let sheetEl = null;

  function openSheet(title, bodyHtml, opts) {
    opts = opts || {};
    closeSheet(true);
    const mask = $('#sheetMask');
    const root = $('#sheetRoot');
    root.innerHTML =
      '<div class="sheet" id="theSheet">' +
      '<div class="sheet-grip"><i></i></div>' +
      '<div class="sheet-head"><h2>' + esc(title) + '</h2>' +
      '<button class="sheet-close" id="sheetClose">✕</button></div>' +
      '<div class="sheet-body">' + bodyHtml + '</div>' +
      '</div>';
    sheetEl = $('#theSheet');
    mask.classList.add('on');
    requestAnimationFrame(() => sheetEl.classList.add('on'));
    $('#sheetClose').onclick = closeSheet;
    mask.onclick = closeSheet;
    if (opts.onMount) opts.onMount(sheetEl);
    return sheetEl;
  }

  function closeSheet(instant) {
    const mask = $('#sheetMask');
    mask.classList.remove('on');
    mask.onclick = null;
    if (sheetEl) {
      const s = sheetEl;
      sheetEl = null;
      if (instant) { $('#sheetRoot').innerHTML = ''; }
      else {
        s.classList.remove('on');
        setTimeout(() => { if ($('#sheetRoot').firstChild === s) $('#sheetRoot').innerHTML = ''; }, 320);
      }
    }
  }

  function confirmDialog(title, msg, okText, onOk, danger) {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-mask';
    wrap.innerHTML =
      '<div class="dialog"><h3>' + esc(title) + '</h3><p>' + msg + '</p>' +
      '<div class="btn-row"><button class="btn ghost" data-c="0">取消</button>' +
      '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-c="1">' + esc(okText || '确定') + '</button></div></div>';
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('on'));
    const done = ok => {
      wrap.classList.remove('on');
      setTimeout(() => wrap.remove(), 220);
      if (ok && onOk) onOk();
    };
    wrap.querySelector('[data-c="0"]').onclick = () => done(false);
    wrap.querySelector('[data-c="1"]').onclick = () => done(true);
    wrap.onclick = e => { if (e.target === wrap) done(false); };
    confirmDialog._open = wrap;
    return wrap;
  }

  /* ---------------- 顶部栏 ---------------- */
  function setTop(title, sub, showBack) {
    $('#tbTitle').textContent = title;
    $('#tbSub').textContent = sub || '';
    $('#btnBack').classList.toggle('hidden', !showBack);
  }
  function setFab(label, show) {
    const f = $('#fab');
    if (!show) { f.classList.add('hidden'); return; }
    f.classList.remove('hidden');
    f.innerHTML = '<span>＋</span>' + esc(label);
  }

  /* =========================================================
     渲染 —— 3.1：路由切换带方向感的转场
     ========================================================= */
  let lastViewKey = '';

  function render() {
    const v = $('#view');
    const key = route.view + ':' + (route.deckId || '');
    const from = lastViewKey.split(':')[0];
    const dir = !lastViewKey ? ''
      : (from === 'home' && route.view === 'deck') ? 'push'
      : (from === 'deck' && route.view === 'home') ? 'back' : '';
    lastViewKey = key;

    v.classList.remove('view-push', 'view-back');
    if (dir) void v.offsetWidth;          // 强制重排，让动画能重播

    if (route.view === 'home') renderHome(v);
    else if (route.view === 'deck') renderDeck(v);

    if (dir) {
      v.classList.add(dir === 'push' ? 'view-push' : 'view-back');
      clearTimeout(render._t);
      render._t = setTimeout(() => v.classList.remove('view-push', 'view-back'), 520);
    }
  }

  /* ---------- 首页 ---------- */
  function renderHome(v) {
    setTop('词块', '', false);
    setFab('', false);                       // 3.1：去掉右下角浮动按钮，改到「我的区块」右侧
    $('#btnMore').onclick = () => globalMenu();
    $('#btnBack').onclick = null;

    let total = 0, today = 0, known = 0;
    S.decks.forEach(d => {
      total += d.words.length;
      d.words.forEach(w => {
        if ((w.createdAt || 0) >= new Date(todayKey() + 'T00:00:00').getTime()) today++;
        if (w.known) known++;
      });
    });

    const g = globalStats();
    const streak = Number(S.stats.streak) || 0;
    const canStudy = (g.due + g.fresh + g.extra) > 0;
    const onlyExtra = (g.due + g.fresh) === 0 && g.extra > 0;

    // 今日进度：已背 / (已背 + 还剩)
    const dayTotal = g.doneToday + g.due + g.fresh;
    const dayPct = dayTotal ? Math.min(100, Math.round(g.doneToday / dayTotal * 100)) : 0;
    const dayLine = dayTotal === 0
      ? '先添加几个单词，今天就能开始'
      : (dayPct >= 100 ? '今天的量已经拿下了 👏' : '今天过了 ' + dayPct + '%，还剩 ' + (g.due + g.fresh) + ' 个');

    let h = '';
    h += '<div class="hero">' +
      '<div class="hero-glow"></div>' +
      '<div class="hero-top"><div class="hero-num">' + total + '</div><div class="hero-unit">个单词</div></div>' +
      '<div class="hero-label">' + (total === 0 ? '开始收集你的第一个单词吧' : '坚持积累，词汇量每天都在长大') + '</div>' +
      '<div class="hero-stats">' +
      '<div class="hero-stat"><b>' + S.decks.length + '</b><span>个区块</span></div>' +
      '<div class="hero-stat"><b>' + today + '</b><span>今日新增</span></div>' +
      '<div class="hero-stat"><b>' + known + '</b><span>已掌握</span></div>' +
      '</div>' +
      '<div class="hero-prog">' +
      '<div class="hp-top"><span>' + dayLine + '</span><b>' + dayPct + '%</b></div>' +
      '<div class="hp-bar"><i style="width:' + dayPct + '%"></i></div>' +
      '</div>' +
      '</div>';

    // —— 今日任务：复习与学新并行，任务过完了还能继续加练 ——
    h += '<div class="today-card">' +
      '<div class="tc-head"><span>今日任务</span>' +
      (streak > 0
        ? '<span class="tc-streak">🔥 连续 ' + streak + ' 天</span>'
        : '<span class="tc-streak off">还没开始</span>') +
      '</div>' +
      '<div class="tc-nums">' +
      '<div class="tc-n"><b>' + g.due + '</b><span>待复习</span></div>' +
      '<div class="tc-n"><b>' + g.fresh + '</b><span>可学新词</span></div>' +
      '<div class="tc-n"><b>' + g.doneToday + '</b><span>今日已背</span></div>' +
      '</div>' +
      (onlyExtra
        ? '<div class="tc-note">今天的任务已经过完一遍了，想再背就继续加练（' + g.extra + ' 词可选）</div>'
        : '') +
      '<button class="btn ' + (canStudy ? 'primary' : 'ghost') + ' block" id="homeGo"' +
      (canStudy ? '' : ' disabled') + '>' +
      (g.due + g.fresh > 0 ? '开始今日背诵'
        : (g.extra > 0 ? '继续背诵 · 加练' : '先去添加单词')) + '</button>' +
      '</div>';

    h += '<div class="sec-title"><span>我的区块</span>' +
      '<button class="sec-add" id="addDeck">＋ 新建区块</button></div>';
    h += '<div class="deck-grid stagger">';
    S.decks.forEach(d => {
      const k = d.words.filter(w => w.known).length;
      const pct = d.words.length ? Math.round(k / d.words.length * 100) : 0;
      h += '<button class="deck-card" data-deck="' + d.id + '" style="--accent:' + esc(d.color) + ';--accent-soft:' + hexSoft(d.color) + '">' +
        '<div class="deck-ico">' + esc(d.emoji || '📘') + '</div>' +
        '<div class="deck-body">' +
        '<div class="deck-name">' + esc(d.name) + '</div>' +
        '<div class="deck-meta"><span>' + d.words.length + ' 个词</span>' +
        (d.words.length ? '<span>· 已掌握 ' + k + '</span>' : '<span>· 还没添加单词</span>') + '</div>' +
        '<div class="deck-bar"><i style="width:' + pct + '%"></i></div>' +
        '</div>' +
        '<svg class="deck-arrow" viewBox="0 0 24 24" width="18" height="18"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>';
    });
    h += '</div>';
    v.innerHTML = h;

    const hg = $('#homeGo', v);
    if (hg) hg.onclick = () => sheetSession(null);

    $$('[data-deck]', v).forEach(b => {
      let timer = null, longPressed = false;
      const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
      b.addEventListener('pointerdown', () => {
        longPressed = false;
        clearTimer();
        timer = setTimeout(() => { timer = null; longPressed = true; sheetDeck(b.dataset.deck); }, 550);
      });
      b.addEventListener('pointerup', clearTimer);
      b.addEventListener('pointerleave', clearTimer);
      b.addEventListener('pointercancel', clearTimer);
      b.addEventListener('contextmenu', e => e.preventDefault());
      b.addEventListener('click', () => {
        clearTimer();
        if (longPressed) { longPressed = false; return; }
        openDeck(b.dataset.deck);
      });
    });
    const ad = $('#addDeck', v); if (ad) ad.onclick = () => sheetDeck(null);
  }

  function hexSoft(hex) {
    try {
      const c = hex.replace('#', '');
      const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',.11)';
    } catch (e) { return '#EDF1FF'; }
  }

  /* ---------- 区块详情 ---------- */
  function openDeck(id) {
    route = { view: 'deck', deckId: id };
    deckFilter = 'all'; deckQuery = '';
    S.settings.lastDeck = id; save();
    render();
  }

  function filteredWords() {
    const d = deckById(route.deckId);
    if (!d) return [];
    let list = d.words.slice();
    if (deckFilter === 'star') list = list.filter(w => w.star);
    else if (deckFilter === 'new') list = list.filter(w => !w.known);
    else if (deckFilter === 'known') list = list.filter(w => w.known);
    if (deckQuery.trim()) {
      const q = deckQuery.trim().toLowerCase();
      list = list.filter(w =>
        (w.en || '').toLowerCase().indexOf(q) >= 0 ||
        (w.zh || '').toLowerCase().indexOf(q) >= 0);
    }
    return list;
  }

  function renderDeck(v) {
    const d = deckById(route.deckId);
    if (!d) { route = { view: 'home', deckId: null }; return renderHome(v); }

    setTop(d.name, d.words.length + ' 个单词 · 已掌握 ' + d.words.filter(w => w.known).length, true);
    setFab('添加单词', true);
    $('#fab').onclick = () => sheetAddWord(d.id);
    $('#btnBack').onclick = () => { route = { view: 'home', deckId: null }; render(); };
    $('#btnMore').onclick = () => sheetDeckMenu(deckById(route.deckId) || d);

    const all = d.words;
    const k = all.filter(w => w.known).length;
    const st = all.filter(w => w.star).length;
    const ds = deckStats(d);

    v.innerHTML =
      '<div class="today-strip">' +
      '<div class="ts-info">' +
      '<span class="ts-item rev"><b>' + ds.due + '</b> 待复习</span>' +
      '<span class="ts-sep">·</span>' +
      '<span class="ts-item new"><b>' + ds.fresh + '</b> 新词</span>' +
      (ds.extra ? '<span class="ts-sep">·</span>' +
        '<span class="ts-item extra"><b>' + ds.extra + '</b> 可加练</span>' : '') +
      '</div>' +
      '<button class="btn primary btn-sm" id="deckGo"' + (all.length ? '' : ' disabled') + '>' +
      ((ds.due + ds.fresh) > 0 ? '开始背诵' : (all.length ? '继续加练' : '开始背诵')) + '</button>' +
      '</div>' +
      '<div class="toolbar">' +
      '<div class="search"><svg viewBox="0 0 24 24" width="17" height="17"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '<input id="q" placeholder="搜索单词或释义" value="' + esc(deckQuery) + '"></div></div>' +
      '<div class="chips">' +
      chip('all', '全部 ' + all.length) +
      chip('new', '未掌握 ' + (all.length - k)) +
      chip('known', '已掌握 ' + k) +
      chip('star', '⭐ ' + st) +
      '</div>' +
      '<div id="listWrap"></div>';

    $('#deckGo', v).onclick = () => sheetSession(d.id);

    // 搜索只刷新列表，不重建输入框（避免打断中文输入法）
    const qi = $('#q', v);
    qi.oninput = () => { deckQuery = qi.value; fillList(); };

    $$('.chip', v).forEach(c => c.onclick = () => {
      deckFilter = c.dataset.f;
      $$('.chip', v).forEach(x => x.classList.toggle('on', x.dataset.f === deckFilter));
      fillList();
    });

    fillList();
  }

  function fillList() {
    const wrap = $('#listWrap');
    if (!wrap) return;
    const d = deckById(route.deckId);
    if (!d) return;

    if (d.words.length === 0) {
      wrap.innerHTML = '<div class="empty fade-in"><div class="illus-wrap">' + ILL_EMPTY + '</div>' +
        '<p>这个区块还没有单词</p>' +
        '<small>点右下角「添加单词」，输入英文单词<br>中文意思和例句会自动填好</small>' +
        '<div style="margin-top:20px;display:flex;gap:10px;justify-content:center">' +
        '<button class="btn primary btn-sm" id="e1">添加单词</button>' +
        '<button class="btn ghost btn-sm" id="e2">批量导入</button></div></div>';
      $('#e1').onclick = () => sheetAddWord(d.id);
      $('#e2').onclick = () => sheetBatch(d.id);
      return;
    }

    const list = filteredWords();
    if (list.length === 0) {
      wrap.innerHTML = '<div class="empty fade-in"><div class="illus-wrap">' + ILL_SEARCH + '</div>' +
        '<p>没有匹配的单词</p><small>换个关键词试试</small></div>';
      return;
    }

    // 只在「刚进入 / 切换筛选」时做逐条入场，敲搜索框时不抖动
    const stagger = !deckQuery.trim();
    let h = '<div class="word-list' + (stagger ? ' stagger' : '') + '">';
    list.forEach(w => { h += wordRow(w, d); });
    h += '</div>';
    h += '<div style="text-align:center;margin-top:20px"><button class="btn ghost btn-sm" id="startStudy">开始背诵</button></div>';
    wrap.innerHTML = h;

    if (stagger) {
      const rows = $$('.word-item', wrap);
      rows.forEach((el, i) => { el.style.animationDelay = Math.min(i, 14) * 26 + 'ms'; });
    }

    $('#startStudy').onclick = () => sheetSession(d.id);

    $$('.word-item[data-word]', wrap).forEach(row => {
      row.onclick = e => {
        if (e.target.closest('[data-act]')) return;
        const w = findWord(d.id, row.dataset.word);
        if (w) sheetWordDetail(w, d.id);
      };
    });
    $$('[data-act]', wrap).forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const word = findWord(d.id, b.dataset.word);
        if (!word) return;
        const act = b.dataset.act;
        if (act === 'star') { word.star = !word.star; save(); fillList(); }
        else if (act === 'del') {
          confirmDialog('删除单词', '确定删除 <b>' + esc(word.en) + '</b> 吗？', '删除', () => {
            const dd = deckById(d.id);
            dd.words = dd.words.filter(x => x.id !== word.id);
            saveNow(); render(); toast('已删除');
          }, true);
        }
      };
    });
  }

  function chip(f, label) {
    return '<button class="chip' + (deckFilter === f ? ' on' : '') + '" data-f="' + f + '">' + esc(label) + '</button>';
  }

  function findWord(deckId, wid) {
    const d = deckById(deckId);
    return d ? d.words.find(w => w.id === wid) : null;
  }

  function wordRow(w, d) {
    let h = '<div class="word-item" data-word="' + w.id + '">';
    h += '<div class="word-main">';
    h += '<div class="word-en">' + esc(w.en);
    if (S.settings.ipa && w.ipa) h += '<span class="word-ipa">/' + esc(w.ipa) + '/</span>';
    h += '</div>';
    h += '<div class="word-zh">' + esc(w.zh || '（暂无释义）') + '</div>';
    let tags = '';
    if (isNewWord(w)) tags += '<span class="mini-tag new">未学</span>';
    else if (isDue(w)) tags += '<span class="mini-tag warn">待复习</span>';
    if (w.known) tags += '<span class="mini-tag ok">已掌握</span>';
    if (w.star) tags += '<span class="mini-tag star">⭐ 重点</span>';
    if (w.builtin) tags += '<span class="mini-tag">内置词库</span>';
    if (w.reviews) tags += '<span class="mini-tag">复习 ' + w.reviews + ' 次</span>';
    if (tags) h += '<div class="word-tags">' + tags + '</div>';
    h += '</div>';
    h += '<div class="word-act">' +
      '<button class="act-btn' + (w.star ? ' on' : '') + '" data-act="star" data-word="' + w.id + '">' +
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3.6l2.6 5.3 5.9.86-4.25 4.14 1 5.87L12 17.04l-5.25 2.76 1-5.87L3.5 9.76l5.9-.86z" fill="' + (w.star ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg></button>' +
      '<button class="act-btn" data-act="del" data-word="' + w.id + '">' +
      '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '</div></div>';
    return h;
  }

  /* =========================================================
     单词详情
     ========================================================= */
  function sheetWordDetail(w, deckId) {
    const d = deckById(deckId);
    let ex = '';
    (w.ex || []).forEach(e => {
      ex += '<div class="ex-row" style="background:#F8FAFC">' +
        '<div style="font-size:14.5px;line-height:1.55;font-style:italic;color:#1F2937">' + esc(e.en) + '</div>' +
        (e.zh ? '<div style="font-size:13px;color:#6B7280;margin-top:5px">' + esc(e.zh) + '</div>' : '') +
        '</div>';
    });
    let body =
      '<div style="display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin-bottom:4px">' +
      '<span style="font-size:26px;font-weight:750;letter-spacing:-.5px">' + esc(w.en) + '</span>' +
      (w.ipa ? '<span style="color:#9AA3B2;font-size:14px">/' + esc(w.ipa) + '/</span>' : '') +
      '</div>' +
      '<div style="color:#6B7280;font-size:12.5px;margin-bottom:6px">加入于 ' + esc(w.addedAt || '—') +
      (w.reviews ? ' · 已复习 ' + w.reviews + ' 次' : '') + '</div>' +
      '<div class="srs-line">' +
      (isNewWord(w)
        ? '还没背过'
        : '记忆档位 ' + (stageOf(w) + 1) + '/' + STAGE_GAP.length +
          (Number(w.lapses) ? ' · 忘记过 ' + w.lapses + ' 次' : '') +
          ' · 下次复习 ' + nextDueText(w)) +
      '</div>' +
      '<div style="font-size:17px;line-height:1.6;margin-bottom:16px;white-space:pre-wrap">' + nl2br(w.zh || '（暂无释义）') + '</div>' +
      (ex ? '<div style="font-size:12.5px;font-weight:600;color:#6B7280;margin-bottom:8px">例句</div>' + ex : '') +
      '<div class="divider-line"></div>' +
      '<div class="btn-row" style="margin-bottom:10px">' +
      '<button class="btn ' + (w.known ? 'primary' : 'ghost') + '" id="dKnown">' + (w.known ? '✓ 已掌握' : '标记掌握') + '</button>' +
      '<button class="btn ' + (w.star ? 'primary' : 'ghost') + '" id="dStar">' + (w.star ? '⭐ 重点' : '标为重点') + '</button>' +
      '</div>' +
      '<div class="btn-row">' +
      '<button class="btn ghost" id="dEdit">编辑</button>' +
      '<button class="btn danger" id="dDel">删除</button>' +
      '</div>';
    openSheet('单词详情', body, {
      onMount() {
        $('#dKnown').onclick = () => {
          if (w.known) {
            // 取消掌握 → 打回复习队列，明天重新出现
            w.stage = 0; w.known = false; w.dueAt = 0;
          } else {
            // 手动标为掌握 → 直接拉到最高档，很久以后才复习
            w.stage = STAGE_GAP.length - 1;
            w.known = true;
            w.learnedAt = w.learnedAt || Date.now();
            w.dueAt = Date.now() + STAGE_GAP[STAGE_GAP.length - 1];
          }
          save(); closeSheet(); render();
          toast(w.known ? '已标记掌握' : '已放回复习队列');
        };
        $('#dStar').onclick = () => { w.star = !w.star; save(); closeSheet(); render(); };
        $('#dDel').onclick = () => {
          closeSheet();
          confirmDialog('删除单词', '确定删除 <b>' + esc(w.en) + '</b> 吗？', '删除', () => {
            d.words = d.words.filter(x => x.id !== w.id);
            save(); render(); toast('已删除');
          }, true);
        };
        $('#dEdit').onclick = () => { closeSheet(); setTimeout(() => sheetEditWord(w, deckId), 220); };
      }
    });
  }

  function sheetEditWord(w, deckId) {
    openSheet('编辑单词', wordFormHtml(w), {
      onMount(el) { bindWordForm(el, w, deckId, true); }
    });
  }

  /* =========================================================
     添加 / 编辑单词表单
     ========================================================= */
  function wordFormHtml(w) {
    w = w || {};
    const exs = (w.ex && w.ex.length) ? w.ex : [];
    let exHtml = '';
    exs.forEach(e => { exHtml += exRowHtml(e.en, e.zh); });
    return '' +
      '<div class="lookup-state" id="lkState" style="display:none"></div>' +
      '<div class="field"><label>英文单词 / 词组</label>' +
      '<div class="row-inline"><input class="input" id="fEn" placeholder="例如 converge" value="' + esc(w.en || '') + '" autocapitalize="off" autocorrect="off" spellcheck="false">' +
      '<button class="btn primary" id="fLookup" style="flex:0 0 auto">查询</button></div></div>' +
      '<div class="field"><label>音标 <span class="hint">自动填充，可修改</span></label>' +
      '<input class="input" id="fIpa" placeholder="kənˈvɜːdʒ" value="' + esc(w.ipa || '') + '" autocapitalize="off" autocorrect="off" spellcheck="false"></div>' +
      '<div class="field"><label>中文释义 <span class="hint">自动填充，可修改</span></label>' +
      '<textarea class="textarea" id="fZh" placeholder="v. 汇聚，集中；（数）收敛">' + esc(w.zh || '') + '</textarea></div>' +
      '<div class="field"><label>例句 <span class="hint">自动填充，可增删改</span></label>' +
      '<div id="fExs">' + exHtml + '</div>' +
      '<button class="btn ghost btn-sm" id="fAddEx" style="margin-top:6px">＋ 添加例句</button></div>' +
      '<div class="field"><label>自定义标签 <span class="hint">可选</span></label>' +
      '<input class="input" id="fTag" placeholder="例如：剑18 T2 / 第5章" value="' + esc(w.tag || '') + '"></div>' +
      '<div class="btn-row" style="margin-top:20px">' +
      (w.id ? '<button class="btn ghost" id="fCancel">取消</button>' : '') +
      '<button class="btn primary" id="fSave" style="flex:2">' + (w.id ? '保存修改' : '保存到区块') + '</button></div>';
  }

  function exRowHtml(en, zh) {
    return '<div class="ex-row">' +
      '<button class="del-x" data-x>✕</button>' +
      '<input class="input en-line" data-en placeholder="English example sentence" value="' + esc(en || '') + '" autocapitalize="off" spellcheck="false">' +
      '<input class="input zh-line" data-zh placeholder="中文翻译" value="' + esc(zh || '') + '">' +
      '</div>';
  }

  function readExs(el) {
    const out = [];
    $$('#fExs .ex-row', el).forEach(r => {
      const en = $('[data-en]', r).value.trim();
      const zh = $('[data-zh]', r).value.trim();
      if (en) out.push({ en: en, zh: zh });
    });
    return out;
  }

  function bindWordForm(el, w, deckId, isEdit) {
    const state = $('#lkState', el);
    const enIn = $('#fEn', el);
    let lastSource = (w && w.builtin) ? 'builtin' : null;

    function setState(kind, html) {
      if (!kind) { state.style.display = 'none'; return; }
      state.style.display = 'flex';
      state.className = 'lookup-state' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
      state.innerHTML = html;
    }

    async function doLookup() {
      const word = enIn.value.trim();
      if (!word) { toast('请先输入单词'); enIn.focus(); return; }
      setState('load', '<div class="mini-spin"></div><span>正在查询「' + esc(word) + '」…</span>');
      const data = await smartLookup(word);
      if (!data.ok) {
        setState('err', '<span>✕ ' + esc(data.error || '没查到') + '，可手动填写</span>');
        return;
      }
      lastSource = data.source || null;
      const fIpa = $('#fIpa', el), fZh = $('#fZh', el), fExs = $('#fExs', el);

      // 只在用户没填过时才覆盖，避免抹掉手改内容
      if (!fIpa.value.trim() && (data.usphone || data.ukphone)) {
        fIpa.value = data.ukphone || data.usphone;
      }
      let newZh = '';
      if (data.defs && data.defs.length) newZh = data.defs.join('\n');
      if (newZh) fZh.value = newZh;
      if (data.extraDefs && data.extraDefs.length) {
        const extra = data.extraDefs.join('\n');
        if (fZh.value.indexOf(extra) < 0) fZh.value = fZh.value + '\n' + extra;
      }
      if (data.examples && data.examples.length) {
        // 清掉空的占位行
        $$('#fExs .ex-row', el).forEach(r => {
          if (!$('[data-en]', r).value.trim()) r.remove();
        });
        data.examples.slice(0, 3).forEach(e => {
          fExs.insertAdjacentHTML('beforeend', exRowHtml(e.en, e.zh));
        });
        bindExDel(el);
      }
      const src = data.source === 'builtin' ? '📚 内置数学词库' : '🌐 在线词典';
      setState('ok', '<span>✓ ' + src + ' · 已自动填入中文释义'
        + (data.examples && data.examples.length ? '和 ' + data.examples.length + ' 条例句' : '')
        + '，可自行修改</span>');
      toast('已自动填写');
    }

    function bindExDel(el2) {
      $$('[data-x]', el2).forEach(b => {
        if (b._bound) return; b._bound = true;
        b.onclick = () => b.closest('.ex-row').remove();
      });
    }

    bindExDel(el);
    $('#fAddEx', el).onclick = () => {
      $('#fExs', el).insertAdjacentHTML('beforeend', exRowHtml('', ''));
      bindExDel(el);
    };
    $('#fLookup', el).onclick = doLookup;
    enIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doLookup(); } });

    if (w && w.source === 'builtin') setState('ok', '<span>📚 来自内置数学词库</span>');

    const cancel = $('#fCancel', el);
    if (cancel) cancel.onclick = () => closeSheet();

    $('#fSave', el).onclick = () => {
      const en = enIn.value.trim();
      if (!en) { toast('请输入单词'); enIn.focus(); return; }
      const d = deckById(deckId);
      if (!d) return;
      const data = {
        en: en,
        ipa: $('#fIpa', el).value.trim(),
        zh: $('#fZh', el).value.trim(),
        ex: readExs(el),
        tag: $('#fTag', el).value.trim()
      };
      if (lastSource === 'builtin') data.builtin = true;
      if (isEdit) {
        Object.assign(w, data);
        toast('已保存');
      } else {
        const dup = d.words.find(x => x.en.toLowerCase() === en.toLowerCase());
        if (dup) {
          Object.assign(dup, data);
          toast('该词已存在，已更新');
        } else {
          d.words.unshift(Object.assign({ id: uid(), addedAt: nowStr(), createdAt: Date.now(), known: false, star: false, reviews: 0 }, data));
          toast('已加入「' + d.name + '」');
        }
      }
      saveNow(); closeSheet(); render();
    };
  }

  function sheetAddWord(deckId) {
    const d = deckById(deckId);
    const h = '<div style="font-size:12.5px;color:#6B7280;margin-bottom:14px">保存到：<b style="color:#141821">' +
      esc(d.emoji + ' ' + d.name) + '</b></div>' + wordFormHtml(null) +
      '<div class="divider-line"></div>' +
      '<button class="btn ghost block btn-sm" id="toBatch">📋 批量导入多个单词</button>';
    openSheet('添加单词', h, {
      onMount(el) {
        bindWordForm(el, null, deckId, false);
        $('#toBatch', el).onclick = () => { closeSheet(); setTimeout(() => sheetBatch(deckId), 230); };
        setTimeout(() => { const i = $('#fEn', el); if (i) i.focus(); }, 380);
      }
    });
  }

  /* =========================================================
     批量导入
     ========================================================= */
  function sheetBatch(deckId) {
    const d = deckById(deckId);
    const h = '<div style="font-size:12.5px;color:#6B7280;margin-bottom:12px">保存到：<b style="color:#141821">' +
      esc(d.emoji + ' ' + d.name) + '</b></div>' +
      '<div class="field"><label>每行一个单词或词组</label>' +
      '<textarea class="textarea" id="bList" style="min-height:180px" placeholder="converge&#10;eigenvalue&#10;monotonic&#10;ubiquitous&#10;..." autocapitalize="off" autocorrect="off" spellcheck="false"></textarea></div>' +
      '<div class="lookup-state" id="bState" style="display:none"></div>' +
      '<div class="btn-row"><button class="btn ghost" id="bPaste">从剪贴板导入</button>' +
      '<button class="btn primary" id="bGo" style="flex:1.6">查询并全部添加</button></div>';
    openSheet('批量添加', h, {
      onMount(el) {
        const ta = $('#bList', el);
        const st = $('#bState', el);
        setTimeout(() => ta.focus(), 360);

        const setSt = (k, html) => {
          st.style.display = 'flex';
          st.className = 'lookup-state' + (k === 'err' ? ' err' : k === 'ok' ? ' ok' : '');
          st.innerHTML = html;
        };

        $('#bPaste', el).onclick = async () => {
          try {
            const t = await navigator.clipboard.readText();
            ta.value = (ta.value ? ta.value + '\n' : '') + t;
            toast('已粘贴');
          } catch (e) {
            ta.focus();
            toast('长按输入框手动粘贴');
          }
        };

        $('#bGo', el).onclick = async () => {
          const words = ta.value.split(/[\n,;，；\t]+/).map(s => s.trim()).filter(Boolean);
          if (!words.length) { toast('请先输入单词'); return; }
          const uniq = [];
          const seen = {};
          words.forEach(w => { const k = w.toLowerCase(); if (!seen[k]) { seen[k] = 1; uniq.push(w); } });

          const btn = $('#bGo', el);
          btn.disabled = true;
          let done = 0, added = 0, failed = [];
          const deck = deckById(deckId);

          setSt('load', '<div class="mini-spin"></div><span>准备中…</span>');

          const CONC = 3;
          let cursor = 0;
          async function worker() {
            while (cursor < uniq.length) {
              const w = uniq[cursor++];
              let data;
              try { data = await smartLookup(w); } catch (e) { data = { ok: false }; }
              const exist = deck.words.find(x => x.en.toLowerCase() === w.toLowerCase());
              const rec = {
                en: w,
                ipa: data.ok ? (data.ukphone || data.usphone || '') : '',
                zh: data.ok && data.defs && data.defs.length ? data.defs.join('\n') : '',
                ex: data.ok && data.examples ? data.examples.slice(0, 2) : [],
                tag: '',
                builtin: data.source === 'builtin' ? true : undefined
              };
              if (exist) Object.assign(exist, rec);
              else { deck.words.unshift(Object.assign({ id: uid(), addedAt: nowStr(), createdAt: Date.now(), known: false, star: false, reviews: 0 }, rec)); added++; }
              if (!data.ok) failed.push(w);
              done++;
              setSt('load', '<div class="mini-spin"></div><span>已处理 ' + done + '/' + uniq.length + ' …</span>');
              save();
            }
          }
          await Promise.all(Array.from({ length: Math.min(CONC, uniq.length) }, worker));

          saveNow();
          btn.disabled = false;
          const msg = '✓ 已添加 ' + added + ' 个'
            + (uniq.length - added > 0 ? '，更新 ' + (uniq.length - added) + ' 个重复项' : '')
            + (failed.length ? '；' + failed.length + ' 个没查到释义，需手动补充' : '');
          setSt(failed.length ? 'err' : 'ok', '<span>' + esc(msg) + '</span>');
          toast('批量添加完成');
          setTimeout(() => { closeSheet(); render(); }, 900);
        };
      }
    });
  }

  /* =========================================================
     区块管理
     ========================================================= */
  function sheetDeck(deckId) {
    const editing = !!deckId;
    const d = deckId ? deckById(deckId) : null;
    let pick = d ? d.emoji : EMOJIS[0];
    let color = d ? d.color : COLORS[0];

    let emoHtml = '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    EMOJIS.forEach(e => {
      emoHtml += '<button class="opt" data-e="' + e + '" style="width:46px;height:46px;padding:0;display:flex;align-items:center;justify-content:center;font-size:21px;border-radius:12px' +
        (e === pick ? ';border-color:#4C6FFF;background:#EDF1FF' : '') + '">' + e + '</button>';
    });
    emoHtml += '</div>';

    let colHtml = '<div style="display:flex;gap:9px;flex-wrap:wrap">';
    COLORS.forEach(c => {
      colHtml += '<button data-c="' + c + '" style="width:34px;height:34px;border-radius:11px;border:2.5px solid ' +
        (c === color ? '#141821' : 'transparent') + ';background:' + c + ';cursor:pointer"></button>';
    });
    colHtml += '</div>';

    const h = '<div class="field"><label>区块名称</label>' +
      '<input class="input" id="dName" placeholder="例如：雅思写作高分词" value="' + esc(d ? d.name : '') + '"></div>' +
      '<div class="field"><label>备注 <span class="hint">可选</span></label>' +
      '<input class="input" id="dDesc" placeholder="例如：剑18 Test2 生词" value="' + esc(d ? (d.desc || '') : '') + '"></div>' +
      '<div class="field"><label>图标</label>' + emoHtml + '</div>' +
      '<div class="field"><label>颜色</label>' + colHtml + '</div>' +
      '<div class="btn-row" style="margin-top:20px">' +
      (editing ? '<button class="btn ghost" id="dDel" style="flex:0 0 auto;padding:12px 16px">删除</button>' : '') +
      '<button class="btn primary" id="dSave" style="flex:1">' + (editing ? '保存' : '创建区块') + '</button></div>';

    openSheet(editing ? '编辑区块' : '新建区块', h, {
      onMount(el) {
        $$('[data-e]', el).forEach(b => b.onclick = () => {
          pick = b.dataset.e;
          $$('[data-e]', el).forEach(x => { x.style.borderColor = '#E8EBF1'; x.style.background = '#fff'; });
          b.style.borderColor = '#4C6FFF'; b.style.background = '#EDF1FF';
        });
        $$('[data-c]', el).forEach(b => b.onclick = () => {
          color = b.dataset.c;
          $$('[data-c]', el).forEach(x => x.style.borderColor = 'transparent');
          b.style.borderColor = '#141821';
        });
        const dbtn = $('#dDel', el);
        if (dbtn) dbtn.onclick = () => {
          closeSheet();
          confirmDialog('删除区块', '将删除「<b>' + esc(d.name) + '</b>」及其中的 ' + d.words.length + ' 个单词，此操作不可恢复。', '删除', () => {
            S.decks = S.decks.filter(x => x.id !== d.id);
            if (route.deckId === d.id) route = { view: 'home', deckId: null };
            saveNow(); render(); toast('已删除区块');
          }, true);
        };
        $('#dSave', el).onclick = () => {
          const name = $('#dName', el).value.trim();
          if (!name) { toast('请输入区块名称'); return; }
          const desc = $('#dDesc', el).value.trim();
          if (editing) { d.name = name; d.desc = desc; d.emoji = pick; d.color = color; }
          else {
            S.decks.push({ id: uid(), name: name, desc: desc, emoji: pick, color: color, createdAt: Date.now(), words: [] });
          }
          saveNow(); closeSheet(); render(); toast(editing ? '已保存' : '区块已创建');
          setTimeout(() => { const i = $('#fEn', document); if (i) i.focus(); }, 200);
        };
        setTimeout(() => { const i = $('#dName', el); if (i && !editing) i.focus(); }, 380);
      }
    });
  }

  function sheetDeckMenu(d) {
    const list = d.words.slice();
    const h = '<div class="pick-list">' +
      pick('🏃', '开始背诵', list.length + ' 个单词', 'study') +
      pick('📄', '导出 PDF 打印', '生成可打印的背诵表', 'pdf') +
      pick('📋', '批量添加单词', '一行一个，自动查询', 'batch') +
      pick('✏️', '编辑区块信息', '名称 / 图标 / 颜色', 'edit') +
      '<div class="divider-line"></div>' +
      pick('📤', '导出全部备份', '生成 JSON 文件', 'backup') +
      pick('📥', '从备份恢复', '选择之前导出的 JSON', 'restore') +
      '<div class="divider-line"></div>' +
      pick('🧹', '清空本区块单词', '保留区块本身', 'clear') +
      '</div>';
    openSheet(d.name, h, {
      onMount(el) {
        $$('[data-a]', el).forEach(b => b.onclick = () => {
          const a = b.dataset.a;
          closeSheet();
          setTimeout(() => {
            if (a === 'study') { if (!list.length) return toast('还没有单词'); sheetSession(d.id); }
            else if (a === 'pdf') sheetExport(d.id);
            else if (a === 'batch') sheetBatch(d.id);
            else if (a === 'edit') sheetDeck(d.id);
            else if (a === 'backup') doExportBackup();
            else if (a === 'restore') doImportBackup();
            else if (a === 'clear') {
              confirmDialog('清空单词', '将删除「' + esc(d.name) + '」中的全部 ' + d.words.length + ' 个单词。', '清空', () => {
                d.words = []; saveNow(); render(); toast('已清空');
              }, true);
            }
          }, 200);
        });
      }
    });
  }

  function pick(icon, title, sub, action) {
    return '<button class="pick" data-a="' + action + '"><span class="pl">' +
      '<span class="pi">' + icon + '</span><span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span>' +
      '</span><svg viewBox="0 0 24 24" width="17" height="17" style="color:#C6CCD8"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
  }

  /* =========================================================
     背单词 · 6.2 引擎
     记忆曲线 + 复习/新词并行 + 巩固测
     ========================================================= */
  let sess = null;
  let sessToken = 0;
  const SESSION_SIZES = [10, 20, 30, 50];

  function shuffleArr(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function sessionWord() {
    if (!sess) return null;
    const d = deckById(sess.deckId);
    if (!d) return null;
    const id = sess.queue[sess.idx];
    return d.words.find(w => w.id === id) || null;
  }

  /* ---------- 开始前的配置面板 ---------- */
  let cfg = { deckId: null, size: 20, mode: 'smart', newShare: 0.5 };

  const SHARE_STEPS = [0, 0.25, 0.5, 0.75];

  function sheetSession(deckId) {
    const usable = S.decks.filter(d => d.words.length > 0);
    if (!usable.length) { toast('先添加一些单词再开始背诵'); return; }

    let pickId = deckId || S.settings.lastDeck || usable[0].id;
    if (!usable.find(d => d.id === pickId)) pickId = usable[0].id;
    cfg = {
      deckId: pickId,
      size: clamp(Number(S.settings.planSize) || 20, 1, 500),
      mode: 'smart',
      newShare: normShare(S.settings.newShare)
    };

    const body =
      '<div class="cfg-lab">背哪个区块</div>' +
      '<div class="cfg-decks" id="cfgDecks">' +
      usable.map(d =>
        '<button class="cfg-deck" data-d="' + d.id + '">' +
        '<span class="cfg-emoji">' + esc(d.emoji || '📘') + '</span>' +
        '<span class="cfg-dname">' + esc(d.name) + '</span>' +
        '</button>').join('') +
      '</div>' +
      '<div class="cfg-lab">每次背多少个</div>' +
      '<div class="seg" id="cfgSize">' +
      SESSION_SIZES.map(n => '<button data-n="' + n + '">' + n + '</button>').join('') +
      '<button data-n="0">全部</button></div>' +
      '<div class="cfg-numrow">' +
      '<span class="cfg-numlab">自定义词数</span>' +
      '<input class="cfg-num" id="cfgNum" type="number" inputmode="numeric" min="1" max="500" step="1">' +
      '<span class="cfg-numunit">个</span>' +
      '</div>' +
      '<div class="cfg-lab">背诵模式</div>' +
      '<div class="seg" id="cfgMode">' +
      '<button data-m="smart">智能混合</button>' +
      '<button data-m="review">只复习</button>' +
      '<button data-m="new">只学新词</button></div>' +
      '<div id="cfgShareWrap">' +
      '<div class="cfg-lab">新词占比 <span class="cfg-lab-note">其余名额给复习和加练</span></div>' +
      '<div class="seg" id="cfgShare">' +
      SHARE_STEPS.map(v => '<button data-s="' + v + '">' +
        (v === 0 ? '不学新词' : Math.round(v * 100) + '%') + '</button>').join('') +
      '</div></div>' +
      '<div class="cfg-preview" id="cfgPrev"></div>' +
      '<button class="btn primary block" id="cfgGo" style="margin-top:16px">开始背诵</button>';

    openSheet('开始背诵', body, {
      onMount(el) {
        const numInput = $('#cfgNum', el);

        function paint() {
          $$('.cfg-deck', el).forEach(b => b.classList.toggle('on', b.dataset.d === cfg.deckId));
          $$('#cfgSize button', el).forEach(b => b.classList.toggle('on', cfg.size === Number(b.dataset.n)));
          $$('#cfgMode button', el).forEach(b => b.classList.toggle('on', b.dataset.m === cfg.mode));
          $$('#cfgShare button', el).forEach(b => b.classList.toggle('on', Math.abs(Number(b.dataset.s) - cfg.newShare) < 0.001));
          const shareWrap = $('#cfgShareWrap', el);
          if (shareWrap) shareWrap.style.display = cfg.mode === 'smart' ? '' : 'none';

          if (numInput && document.activeElement !== numInput) {
            numInput.value = cfg.size > 0 ? String(cfg.size) : '';
            numInput.placeholder = cfg.size > 0 ? '自定义' : '全部';
          }

          const d = deckById(cfg.deckId);
          const prev = $('#cfgPrev', el);
          const go = $('#cfgGo', el);
          if (!d) { prev.innerHTML = ''; return; }

          const size = cfg.size === 0 ? 9999 : cfg.size;
          const plan = planSession(d, { size: size, mode: cfg.mode, newShare: cfg.newShare });
          const st = deckStats(d);

          if (!plan.picks.length) {
            prev.innerHTML = '<div class="cfg-empty">这个区块还没有单词<br>' +
              '<small>先添加几个单词，再回来背诵</small></div>';
            go.disabled = true;
            return;
          }
          go.disabled = false;

          let note = '';
          if (plan.extraCount > 0) {
            note = plan.newCount === 0 && plan.reviewCount === 0
              ? '这些词今天已经过一遍了，再背一遍算加练，不会打乱复习节奏'
              : '其中 ' + plan.extraCount + ' 个是今天背过的老词，提前再过一遍算加练';
          }
          if (plan.picks.length < size) {
            note += (note ? '<br>' : '') + '这个区块一共 ' + st.total + ' 个词，本次能排的都排上了';
          }

          prev.innerHTML =
            '<div class="cfg-total">本次 <b>' + plan.picks.length + '</b> 个词</div>' +
            '<div class="cfg-split">' +
            '<div class="cfg-pill rev"><b>' + plan.reviewCount + '</b><span>复习</span></div>' +
            '<div class="cfg-pill new"><b>' + plan.newCount + '</b><span>新词</span></div>' +
            (plan.extraCount > 0
              ? '<div class="cfg-pill extra"><b>' + plan.extraCount + '</b><span>加练</span></div>' : '') +
            '</div>' +
            (note ? '<div class="cfg-hint">' + note + '</div>' : '') +
            '<div class="cfg-hint">该区块：待复习 ' + st.due + ' · 可学新词 ' + st.fresh +
            ' · 可加练 ' + st.extra + '</div>';
        }

        const goBtn = $('#cfgGo', el);
        $$('.cfg-deck', el).forEach(b => b.onclick = () => { cfg.deckId = b.dataset.d; paint(); });
        $$('#cfgSize button', el).forEach(b => b.onclick = () => {
          cfg.size = Number(b.dataset.n);
          if (cfg.size > 0) { S.settings.planSize = cfg.size; save(); }
          paint();
        });
        $$('#cfgMode button', el).forEach(b => b.onclick = () => { cfg.mode = b.dataset.m; paint(); });
        $$('#cfgShare button', el).forEach(b => b.onclick = () => {
          cfg.newShare = Number(b.dataset.s);
          S.settings.newShare = cfg.newShare; save();
          paint();
        });
        if (numInput) {
          numInput.oninput = () => {
            const v = Math.round(Number(numInput.value));
            if (!numInput.value) { cfg.size = 0; paint(); return; }
            if (!isFinite(v) || v < 1) return;
            cfg.size = clamp(v, 1, 500);
            S.settings.planSize = cfg.size; save();
            paint();
          };
          numInput.onblur = () => paint();
        }
        goBtn.onclick = () => {
          const size = cfg.size === 0 ? 9999 : cfg.size;
          const did = cfg.deckId, mode = cfg.mode, share = cfg.newShare;
          closeSheet();
          setTimeout(() => startSession(did, { size: size, mode: mode, newShare: share }), 180);
        };
        paint();
      }
    });
  }

  /* ---------- 会话 ---------- */
  function startSession(deckId, opts) {
    const d = deckById(deckId);
    if (!d) return;
    const o = opts || {};
    const plan = planSession(d, o);
    if (!plan.picks.length) { toast('这次没有可背的单词'); return; }

    sessToken++;
    sess = {
      deckId: deckId,
      mode: o.mode || 'smart',
      newShare: typeof o.newShare === 'number' ? o.newShare : normShare(S.settings.newShare),
      queue: shuffleArr(plan.picks.map(w => w.id)),
      idx: 0,
      flipped: false,
      requeue: [],
      quizPass: {},
      quizOpts: null,
      picked: -1,
      phase: 'learn',
      size: plan.picks.length,
      newCount: plan.newCount,
      reviewCount: plan.reviewCount,
      extraCount: plan.extraCount,
      stats: { good: 0, hard: 0, again: 0, quizRight: 0, quizWrong: 0 },
      token: sessToken
    };
    renderSession();
  }

  function renderSession() {
    let host = $('#studyRoot');
    if (!host) {
      host = document.createElement('div');
      host.id = 'studyRoot';
      document.body.appendChild(host);
    }
    if (!sess) { host.remove(); return; }
    if (sess.phase === 'quiz') renderQuiz(host);
    else if (sess.phase === 'done') renderDone(host);
    else renderLearn(host);
  }

  /* ---------- 第一阶段：回想 + 自评 ---------- */
  function renderLearn(host) {
    const w = sessionWord();
    if (!w) { finishLearn(); return; }
    const total = sess.queue.length;
    const pct = Math.round(sess.idx / total * 100);
    const isNew = isNewWord(w);
    const isExtra = !isNew && Number(w.lastReviewAt) >= new Date(todayKey() + 'T00:00:00').getTime();
    const badgeText = isNew ? '新词'
      : (isExtra ? '加练 · 第 ' + (stageOf(w) + 1) + ' 档' : '复习 · 第 ' + (stageOf(w) + 1) + ' 档');

    let backEx = '';
    (w.ex || []).slice(0, 2).forEach(e => {
      backEx += '<div class="ex"><div class="en">' + esc(e.en) + '</div>' +
        (e.zh ? '<div class="zh">' + esc(e.zh) + '</div>' : '') + '</div>';
    });

    host.innerHTML =
      '<div class="study fade-in">' +
      '<div class="study-top">' +
      '<button class="icon-btn" id="sClose" style="color:#fff">' +
      '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>' +
      '<div class="study-prog"><i style="width:' + pct + '%"></i></div>' +
      '<div class="study-count">' + (sess.idx + 1) + ' / ' + total + '</div>' +
      '</div>' +
      '<div class="study-toolbar">' +
      '<span class="st-badge ' + (isNew ? 'isnew' : (isExtra ? 'isextra' : 'isrev')) + '">' +
      badgeText + '</span>' +
      '<button class="btn btn-sm ghost" id="sStar" style="background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.14);color:#fff">' +
      (w.star ? '⭐ 已标重点' : '☆ 标为重点') + '</button>' +
      '</div>' +
      '<div class="study-stage"><div class="card-flip' + (sess.flipped ? ' flipped' : '') + '" id="sCard">' +
      '<div class="card-face card-front">' +
      '<div class="w">' + esc(w.en) + '</div>' +
      (w.ipa && S.settings.ipa ? '<div class="p">/' + esc(w.ipa) + '/</div>' : '') +
      '<div class="tip">先回想中文意思，再点开对照</div>' +
      '</div>' +
      '<div class="card-face card-back">' +
      '<div class="w2">' + esc(w.en) + '</div>' +
      (w.ipa && S.settings.ipa ? '<div class="p2">/' + esc(w.ipa) + '/</div>' : '') +
      '<div class="zh">' + nl2br(w.zh || '（暂无释义）') + '</div>' +
      (backEx ? '<div class="divider"></div><div class="exs">' + backEx + '</div>' : '') +
      '</div>' +
      '</div></div>' +
      '<div class="study-actions" id="sActions"></div>' +
      '</div>';

    function paintActions() {
      const box = $('#sActions');
      box.className = 'study-actions' + (sess.flipped ? ' three' : ' two');
      box.innerHTML =
        '<button class="sbtn unknown" id="sAgain">不认识</button>' +
        (sess.flipped ? '<button class="sbtn hard" id="sHard">模糊</button>' : '') +
        '<button class="sbtn known" id="sYes">认识</button>';
      $('#sAgain').onclick = () => {
        if (!sess.flipped) { sess.flipped = true; $('#sCard').classList.add('flipped'); paintActions(); }
        else grade('again');
      };
      const hb = $('#sHard');
      if (hb) hb.onclick = () => grade('hard');
      $('#sYes').onclick = () => grade('good');
    }

    $('#sCard').onclick = () => {
      sess.flipped = !sess.flipped;
      $('#sCard').classList.toggle('flipped', sess.flipped);
      paintActions();
    };
    $('#sClose').onclick = () => closeSession();
    $('#sStar').onclick = () => { w.star = !w.star; save(); renderSession(); };
    paintActions();
  }

  function pushRequeue(id) {
    if (sess.requeue.indexOf(id) < 0) sess.requeue.push(id);
  }

  function grade(g) {
    const w = sessionWord();
    if (!w) return;
    reviewWord(w, g);
    S.stats.answers = (Number(S.stats.answers) || 0) + 1;
    if (g === 'good') sess.stats.good++;
    else if (g === 'hard') { sess.stats.hard++; pushRequeue(w.id); }
    else { sess.stats.again++; pushRequeue(w.id); }
    save();
    sess.idx++;
    sess.flipped = false;
    if (sess.idx >= sess.queue.length) finishLearn();
    else renderSession();
  }

  function finishLearn() {
    if (!sess) return;
    if (sess.requeue.length) {
      sess.phase = 'quiz';
      sess.picked = -1;
      sess.quizOpts = null;
    } else {
      markDone();
    }
    renderSession();
  }

  function markDone() {
    if (!sess || sess.phase === 'done') return;
    sess.phase = 'done';
    touchStreak();
    S.stats.sessions = (Number(S.stats.sessions) || 0) + 1;
    save();
  }

  /* ---------- 第二阶段：巩固测（中 → 英 四选一） ---------- */
  function currentQuizWord() {
    if (!sess || !sess.requeue.length) return null;
    const d = deckById(sess.deckId);
    if (!d) return null;
    return d.words.find(w => w.id === sess.requeue[0]) || null;
  }

  function quizOptions(d, w) {
    const others = d.words.filter(x =>
      x.id !== w.id && x.en && String(x.en).toLowerCase() !== String(w.en || '').toLowerCase());
    shuffleArr(others);
    const opts = [w.en];
    for (let i = 0; i < others.length && opts.length < 4; i++) opts.push(others[i].en);
    return shuffleArr(opts);
  }

  function renderQuiz(host) {
    const d = deckById(sess.deckId);
    const w = currentQuizWord();
    if (!d || !w) { markDone(); renderSession(); return; }

    if (!sess.quizOpts || sess.quizOpts.id !== w.id) {
      sess.quizOpts = { id: w.id, list: quizOptions(d, w) };
    }
    const opts = sess.quizOpts.list;
    const left = sess.requeue.length;
    const answered = sess.picked >= 0;

    host.innerHTML =
      '<div class="study quiz fade-in">' +
      '<div class="study-top">' +
      '<button class="icon-btn" id="sClose" style="color:#fff">' +
      '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>' +
      '<div class="study-prog"><i style="width:' + Math.round((sess.size - left) / Math.max(1, sess.size) * 100) + '%"></i></div>' +
      '<div class="study-count">剩 ' + left + '</div>' +
      '</div>' +
      '<div class="quiz-body">' +
      '<div class="quiz-lab">选出对应的英文单词</div>' +
      '<div class="quiz-zh">' + nl2br(w.zh || '（暂无释义）') + '</div>' +
      '<div class="quiz-opts">' +
      opts.map((o, i) => {
        let cls = 'q-opt';
        if (answered) {
          if (o === w.en) cls += ' right';
          else if (i === sess.picked) cls += ' wrong';
        }
        return '<button class="' + cls + '" data-i="' + i + '">' + esc(o) + '</button>';
      }).join('') +
      '</div>' +
      '<div class="quiz-tip">' + (answered ? '' : '想不起来就随便选，答错会再考一次') + '</div>' +
      '</div>' +
      '</div>';

    $('#sClose').onclick = () => closeSession();
    if (!answered) {
      $$('.q-opt', host).forEach(b => {
        b.onclick = () => answerQuiz(Number(b.dataset.i), opts, w);
      });
    }
  }

  function answerQuiz(i, opts, w) {
    if (!sess || sess.picked >= 0) return;
    sess.picked = i;
    const ok = opts[i] === w.en;
    if (ok) { sess.stats.quizRight++; sess.quizPass[w.id] = 0; }
    else {
      sess.stats.quizWrong++;
      sess.quizPass[w.id] = (Number(sess.quizPass[w.id]) || 0) + 1;
    }
    renderSession();

    const token = sess.token;
    setTimeout(() => {
      if (!sess || sess.token !== token) return;
      const idx = sess.requeue.indexOf(w.id);
      if (idx >= 0) sess.requeue.splice(idx, 1);
      if (!ok && (sess.quizPass[w.id] || 0) < 3) sess.requeue.push(w.id);
      else if (!ok) toast('这个先放着，下次再考');
      sess.picked = -1;
      sess.quizOpts = null;
      if (!sess.requeue.length) markDone();
      renderSession();
    }, ok ? 460 : 950);
  }

  /* ---------- 第三阶段：结算 ---------- */
  function renderDone(host) {
    const st = sess.stats;
    const total = sess.size;
    const goodPct = total ? Math.round(st.good / total * 100) : 0;
    const quizTotal = st.quizRight + st.quizWrong;
    const againSize = sess.size;
    const againMode = sess.mode || 'smart';
    const againShare = typeof sess.newShare === 'number' ? sess.newShare : 0.5;
    const deckId = sess.deckId;
    const extraCount = Number(sess.extraCount) || 0;
    const streak = Number(S.stats.streak) || 0;

    // 情绪价值：按表现给一句话
    const praise = goodPct >= 85 ? '这一轮稳得很，记住的感觉真好'
      : goodPct >= 60 ? '大部分都拿下了，剩下的交给下次'
      : '难词正在往脑子里钻，明天再过一遍就顺了';
    const title = goodPct >= 85 ? '漂亮的一轮' : '本轮完成';

    host.innerHTML =
      '<div class="study done fade-in">' +
      '<div class="done-body">' +
      '<div class="done-emoji">' + ILL_MEDAL +
      '<i class="sp sp1"></i><i class="sp sp2"></i><i class="sp sp3"></i></div>' +
      '<div class="done-title">' + title + '</div>' +
      '<div class="done-praise">' + praise + '</div>' +
      '<div class="done-sub">' + total + ' 个词 · 复习 ' + sess.reviewCount + ' / 新词 ' + sess.newCount +
      (extraCount ? ' / 加练 ' + extraCount : '') + '</div>' +
      '<div class="done-grid">' +
      '<div class="done-cell ok"><b>' + st.good + '</b><span>认识</span></div>' +
      '<div class="done-cell mid"><b>' + st.hard + '</b><span>模糊</span></div>' +
      '<div class="done-cell bad"><b>' + st.again + '</b><span>不认识</span></div>' +
      '</div>' +
      (quizTotal ? '<div class="done-quiz">巩固测 ' + quizTotal + ' 题 · 答对 <b>' + st.quizRight + '</b> · 答错 <b>' + st.quizWrong + '</b></div>' : '') +
      '<div class="done-rate">"认识"占比 ' + goodPct + '%</div>' +
      (streak ? '<div class="done-streak">🔥 连续打卡 ' + streak + ' 天</div>' : '') +
      '<div class="done-hint">按记忆曲线，这些词会在该复习的那天自动出现；' +
      '今天还想背就点「再来一组」，新词老词会重新混一遍</div>' +
      '</div>' +
      '<div class="done-actions">' +
      '<button class="btn ghost" id="doneBack">返回列表</button>' +
      '<button class="btn primary" id="doneAgain" style="flex:1.2">再来一组</button>' +
      '</div>' +
      '</div>';

    $('#doneBack').onclick = () => closeSession();
    $('#doneAgain').onclick = () => {
      closeSession();
      setTimeout(() => {
        startSession(deckId, { size: againSize, mode: againMode, newShare: againShare });
      }, 200);
    };
  }

  function closeSession() {
    sess = null;
    sessToken++;
    const host = $('#studyRoot');
    if (host) host.remove();
    render();
  }

  /* =========================================================
     导出 PDF
     ========================================================= */
  let exportOpts = { mode: 'full', ipa: true, ex: true, onlyNew: false, cols: 1 };

  function sheetExport(deckId) {
    const d = deckById(deckId);
    const h =
      '<div class="field"><label>导出内容</label>' +
      '<div class="grid2">' +
      optCard('mode', 'full', '📋 背诵表', '英文 / 音标 / 中文 / 例句', exportOpts.mode === 'full') +
      optCard('mode', 'compact', '📑 对照表', '英文 + 中文两列，省纸', exportOpts.mode === 'compact') +
      optCard('mode', 'card', '✂️ 卡片模式', '打印后裁剪折叠成卡片', exportOpts.mode === 'card') +
      optCard('mode', 'test', '📝 自测卷', '只印英文，留空默写', exportOpts.mode === 'test') +
      '</div></div>' +
      '<div class="field"><label>包含</label>' +
      toggleRow('ipa', '显示音标', exportOpts.ipa) +
      toggleRow('ex', '显示例句', exportOpts.ex) +
      toggleRow('onlyNew', '只导出未掌握的单词', exportOpts.onlyNew) +
      '</div>' +
      '<div class="field"><label>区块</label>' +
      '<select class="input" id="exDeck">' +
      S.decks.map(x => '<option value="' + x.id + '"' + (x.id === deckId ? ' selected' : '') + '>' + esc(x.emoji + ' ' + x.name + '（' + x.words.length + '）') + '</option>').join('') +
      '<option value="__all__">全部区块合并导出</option>' +
      '</select></div>' +
      '<button class="btn primary block" id="exGo" style="margin-top:18px;padding:15px">生成并导出 PDF</button>' +
      '<div style="font-size:12px;color:#9AA3B2;margin-top:10px;line-height:1.6;text-align:center">' +
      '点击后在系统打印界面选择 <b>「保存为 PDF」</b> 即可存到手机<br>也可以直接选一台打印机打印出来</div>';

    openSheet('导出 PDF', h, {
      onMount(el) {
        $$('[data-t]', el).forEach(b => b.onclick = () => {
          exportOpts[b.dataset.t] = !exportOpts[b.dataset.t];
          const sw = $('.switch', b);
          sw.classList.toggle('on', exportOpts[b.dataset.t]);
        });
        $$('[data-o]', el).forEach(b => b.onclick = () => {
          exportOpts[b.dataset.o] = b.dataset.v;
          $$('[data-o="' + b.dataset.o + '"]', el).forEach(x => x.classList.remove('on'));
          b.classList.add('on');
        });
        $('#exGo', el).onclick = () => {
          const sel = $('#exDeck', el).value;
          let decks;
          if (sel === '__all__') decks = S.decks.slice();
          else decks = [deckById(sel)].filter(Boolean);
          const html = buildPrintHtml(decks);
          closeSheet();
          setTimeout(() => doExportPdf(html, sel === '__all__' ? '全部区块' : (decks[0] ? decks[0].name : '词块')), 220);
        };
      }
    });
  }

  function optCard(key, val, title, sub, on) {
    return '<button class="opt' + (on ? ' on' : '') + '" data-o="' + key + '" data-v="' + val + '" style="width:100%">' +
      '<b>' + esc(title) + '</b><small>' + esc(sub) + '</small></button>';
  }

  function toggleRow(key, label, on) {
    return '<button class="pick" data-t="' + key + '" style="padding:11px 4px"><span class="pl"><b style="font-weight:500">' + esc(label) + '</b></span>' +
      '<span class="switch' + (on ? ' on' : '') + '"></span></button>';
  }

  function buildPrintHtml(decks) {
    const now = new Date();
    const stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
      + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    const sections = decks.map(d => {
      let words = d.words.slice();
      if (exportOpts.onlyNew) words = words.filter(w => !w.known);
      if (!words.length) return '';
      const body = renderPrintBody(words);
      return '<section class="deck-sec">' +
        '<h2 class="deck-h"><span class="dot" style="background:' + esc(d.color || '#4C6FFF') + '"></span>' +
        esc(d.emoji + ' ' + d.name) +
        '<span class="cnt">' + words.length + ' 词</span></h2>' + body + '</section>';
    }).filter(Boolean).join('');

    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>' + printCss() + '</style></head><body>' +
      '<header class="doc-h"><h1>词块 · 背诵表</h1>' +
      '<div class="doc-meta"><span>导出时间：' + esc(stamp) + '</span>' +
      '<span>' + esc(exportOptsTitle()) + '</span></div></header>' +
      (sections || '<p style="color:#999">没有可导出的单词</p>') +
      '<footer class="doc-f">— 词块 WordBlocks —</footer>' +
      '</body></html>';
  }

  function exportOptsTitle() {
    const m = { full: '背诵表', compact: '对照表', card: '卡片模式', test: '自测卷' };
    return (m[exportOpts.mode] || '') + (exportOpts.onlyNew ? ' · 仅未掌握' : '');
  }

  function renderPrintBody(words) {
    if (exportOpts.mode === 'card') {
      let h = '<div class="cards">';
      words.forEach((w, i) => {
        h += '<div class="pcard"><div class="pc-top"><span class="pc-idx">' + (i + 1) + '</span>' +
          '<span class="pc-en">' + esc(w.en) + '</span>' +
          (exportOpts.ipa && w.ipa ? '<span class="pc-ipa">/' + esc(w.ipa) + '/</span>' : '') + '</div>' +
          '<div class="pc-cut"></div>' +
          '<div class="pc-zh">' + nl2br(w.zh || '') + '</div></div>';
      });
      return h + '</div>';
    }

    if (exportOpts.mode === 'compact') {
      let h = '<table class="tb"><thead><tr><th class="c-i">#</th><th class="c-e">English</th><th>中文</th></tr></thead><tbody>';
      words.forEach((w, i) => {
        h += '<tr><td class="c-i">' + (i + 1) + '</td>' +
          '<td class="c-e"><b>' + esc(w.en) + '</b>' +
          (exportOpts.ipa && w.ipa ? '<span class="ipa">/' + esc(w.ipa) + '/</span>' : '') + '</td>' +
          '<td class="c-z">' + nl2br(w.zh || '') + '</td></tr>';
      });
      return h + '</tbody></table>';
    }

    if (exportOpts.mode === 'test') {
      let h = '<table class="tb tb-test"><thead><tr><th class="c-i">#</th><th>English</th><th class="c-w">中文默写</th></tr></thead><tbody>';
      words.forEach((w, i) => {
        h += '<tr><td class="c-i">' + (i + 1) + '</td>' +
          '<td class="c-e"><b>' + esc(w.en) + '</b>' +
          (exportOpts.ipa && w.ipa ? '<span class="ipa">/' + esc(w.ipa) + '/</span>' : '') + '</td>' +
          '<td class="c-w"></td></tr>';
      });
      return h + '</tbody></table>';
    }

    // full
    let h = '<table class="tb"><thead><tr><th class="c-i">#</th><th class="c-e">单词</th><th>释义与例句</th></tr></thead><tbody>';
    words.forEach((w, i) => {
      let ex = '';
      if (exportOpts.ex && w.ex && w.ex.length) {
        w.ex.slice(0, 1).forEach(e => {
          ex += '<div class="ex"><span class="ex-en">' + esc(e.en) + '</span>' +
            (e.zh ? '<span class="ex-zh">' + esc(e.zh) + '</span>' : '') + '</div>';
        });
      }
      h += '<tr><td class="c-i">' + (i + 1) + '</td>' +
        '<td class="c-e"><b>' + esc(w.en) + '</b>' +
        (exportOpts.ipa && w.ipa ? '<span class="ipa">/' + esc(w.ipa) + '/</span>' : '') + '</td>' +
        '<td class="c-z">' + nl2br(w.zh || '') + ex + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  function printCss() {
    return '' +
      '@page { size: A4; margin: 13mm 12mm 12mm; }' +
      '* { box-sizing: border-box; }' +
      'html,body { margin:0; padding:0; }' +
      'body { font-family: "Noto Sans CJK SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif; color:#111826; font-size:10.5pt; line-height:1.5; -webkit-print-color-adjust:exact; print-color-adjust:exact; }' +
      '.doc-h { display:flex; align-items:flex-end; justify-content:space-between; border-bottom:1.4pt solid #111826; padding-bottom:2.5mm; margin-bottom:5mm; }' +
      '.doc-h h1 { margin:0; font-size:17pt; letter-spacing:-.3pt; }' +
      '.doc-meta { font-size:8.5pt; color:#7A8497; text-align:right; line-height:1.5; }' +
      '.deck-sec { margin-bottom:7mm; }' +
      '.deck-h { font-size:12.5pt; margin:0 0 2.5mm; padding-bottom:1.6mm; border-bottom:0.8pt solid #D6DBE4; display:flex; align-items:center; gap:2mm; page-break-after:avoid; }' +
      '.deck-h .dot { width:3mm; height:3mm; border-radius:50%; display:inline-block; }' +
      '.deck-h .cnt { margin-left:auto; font-size:8.5pt; font-weight:400; color:#7A8497; }' +
      'table.tb { width:100%; border-collapse:collapse; table-layout:fixed; }' +
      'table.tb thead th { font-size:8.5pt; color:#7A8497; font-weight:600; text-align:left; padding:0 1.6mm 1.4mm; border-bottom:0.5pt solid #C9D0DC; }' +
      'table.tb td { border-bottom:0.4pt solid #E2E7EF; padding:2.1mm 1.6mm; vertical-align:top; word-break:break-word; }' +
      'table.tb tr { page-break-inside:avoid; }' +
      '.c-i { width:8mm; color:#A0A8B8; font-size:8.5pt; }' +
      '.c-e { width:40mm; }' +
      '.c-e b { font-size:11pt; font-weight:700; }' +
      '.c-w { width:62mm; }' +
      '.ipa { display:block; color:#7A8497; font-size:8.5pt; font-weight:400; margin-top:.4mm; }' +
      '.c-z { }' +
      '.ex { margin-top:1.3mm; font-size:9pt; color:#3D4553; }' +
      '.ex-en { display:block; font-style:italic; }' +
      '.ex-zh { display:block; color:#6B7280; font-style:normal; }' +
      '.tb-test td { height:11mm; }' +
      '.tb-test .c-w { border-left:0.4pt dashed #C9D0DC; }' +
      '.cards { display:grid; grid-template-columns:1fr 1fr; gap:4mm; }' +
      '.pcard { border:0.6pt dashed #AAB3C2; border-radius:2mm; padding:3mm; page-break-inside:avoid; min-height:34mm; display:flex; flex-direction:column; }' +
      '.pc-top { display:flex; align-items:baseline; gap:1.6mm; flex-wrap:wrap; }' +
      '.pc-idx { font-size:7.5pt; color:#A0A8B8; }' +
      '.pc-en { font-size:12pt; font-weight:700; }' +
      '.pc-ipa { font-size:8pt; color:#7A8497; }' +
      '.pc-cut { border-top:0.5pt dashed #C9D0DC; margin:2.5mm 0; }' +
      '.pc-zh { font-size:9.5pt; color:#2A3242; line-height:1.5; }' +
      '.doc-f { margin-top:8mm; text-align:center; font-size:8pt; color:#A0A8B8; }';
  }

  function doExportPdf(html, title) {
    if (IS_APP && Android.printPdf) {
      Android.printPdf(html, title);
      toast('请选择「保存为 PDF」或直接打印');
    } else {
      const w = window.open('', '_blank');
      if (!w) { toast('浏览器阻止了弹窗'); return; }
      w.document.write(html);
      w.document.close();
      setTimeout(() => { try { w.print(); } catch (e) {} }, 500);
    }
  }

  /* =========================================================
     备份 / 恢复
     ========================================================= */
  function doExportBackup() {
    if (IS_APP && Android.exportBackup) { Android.exportBackup(JSON.stringify(S)); return; }
    try {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '词块备份.json';
      a.click();
      toast('备份已下载');
    } catch (e) { toast('导出失败'); }
  }

  function doImportBackup() {
    if (IS_APP && Android.importBackup) { Android.importBackup(); return; }
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = () => {
      const f = i.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => window.wbImportData(r.result);
      r.readAsText(f);
    };
    i.click();
  }

  window.wbBackupResult = function (msg, ok) {
    toast(msg);
    if (ok) render();
  };

  window.wbImportData = function (text) {
    try {
      const obj = typeof text === 'string' ? JSON.parse(text) : text;
      if (!obj || !Array.isArray(obj.decks)) throw new Error('格式不正确');
      confirmDialog('恢复备份',
        '备份包含 <b>' + obj.decks.length + '</b> 个区块、<b>' +
        obj.decks.reduce((s, d) => s + (d.words || []).length, 0) + '</b> 个单词。<br><br>' +
        '选择「合并」会把备份里的单词并入现有区块，「覆盖」会清空当前全部数据。',
        '合并', () => {
          mergeBackup(obj);
          saveNow(); render(); toast('已合并导入');
        });
      const dlg = confirmDialog._open;
      if (dlg) {
        const b = document.createElement('button');
        b.className = 'btn danger';
        b.textContent = '覆盖';
        b.onclick = () => {
          S = normalize(obj);
          saveNow(); render();
          dlg.classList.remove('on'); setTimeout(() => dlg.remove(), 220);
          toast('已覆盖导入');
        };
        const row = dlg.querySelector('.btn-row');
        row.insertBefore(b, row.firstChild);
      }
    } catch (e) {
      toast('导入失败：文件格式不正确');
    }
  };

  function mergeBackup(obj) {
    (obj.decks || []).forEach(d => {
      let target = S.decks.find(x => x.name === d.name);
      if (!target) {
        target = { id: uid(), name: d.name, emoji: d.emoji || '📘', color: d.color || '#4C6FFF', desc: d.desc || '', words: [] };
        S.decks.push(target);
      }
      (d.words || []).forEach(w => {
        if (!target.words.find(x => (x.en || '').toLowerCase() === (w.en || '').toLowerCase())) {
          target.words.push(normalizeWord(w));
        }
      });
    });
  }

  /**
   * 单个单词的兼容处理：缺字段补默认值，1.x 的老词自动接上记忆曲线。
   * 无论哪一版数据进来，单词本身（英文/释义/例句/标签）都不会被改动。
   */
  function normalizeWord(w) {
    w = w || {};
    const hasSrs = (w.stage !== undefined && w.stage !== null);
    const oldKnown = !!w.known;
    const oldReviews = Number(w.reviews) || 0;
    const stage = hasSrs
      ? clamp(Math.round(Number(w.stage) || 0), 0, STAGE_GAP.length - 1)
      : (oldKnown ? MASTER_STAGE : 0);
    const studied = hasSrs ? !!w.learnedAt : (oldKnown || oldReviews > 0);
    const learnedAt = hasSrs
      ? (Number(w.learnedAt) || 0)
      : (studied ? (Number(w.createdAt) || Date.now()) : 0);
    return {
      id: w.id || uid(),
      en: w.en || '',
      ipa: w.ipa || '',
      zh: w.zh || '',
      ex: Array.isArray(w.ex) ? w.ex : [],
      tag: w.tag || '',
      star: !!w.star,
      reviews: oldReviews,
      addedAt: w.addedAt || '',
      createdAt: Number(w.createdAt) || 0,
      builtin: w.builtin,
      /* —— 2.0 记忆状态 —— */
      stage: stage,
      dueAt: Number(w.dueAt) || 0,     // 0 = 立刻到期
      lapses: Number(w.lapses) || 0,
      learnedAt: learnedAt,
      lastReview: w.lastReview || '',
      lastReviewAt: Number(w.lastReviewAt) || 0,
      goodDay: w.goodDay || '',          // 2.1：当天是否已经涨过档
      known: stage >= MASTER_STAGE
    };
  }

  /**
   * 把任意历史版本的数据整理成当前结构。
   * 原则：只补字段、不改单词内容，任何情况下都不丢词。
   * 1.x 的词没有记忆曲线字段 → 背过的当作「已学过、立刻待复习」，
   * 没背过的当作新词，这样升级后既有数据能直接接上 2.0 的复习队列。
   */
  function normalize(obj) {
    const src = obj || {};
    const decks = (src.decks || []).map(d => ({
      id: d.id || uid(),
      name: d.name || '未命名',
      emoji: d.emoji || '📘',
      color: d.color || '#4C6FFF',
      desc: d.desc || '',
      words: (d.words || []).map(normalizeWord)
    }));

    const st = src.settings || {};
    const stats = src.stats || {};
    return {
      version: VERSION,
      decks: decks.length ? decks : defaultDecks(),
      settings: {
        ipa: st.ipa !== false,
        example: st.example !== false,
        shuffle: !!st.shuffle,
        lastDeck: st.lastDeck || null,
        planSize: clamp(Number(st.planSize) || 20, 1, 500),
        newShare: normShare(st.newShare)
      },
      stats: {
        streak: Number(stats.streak) || 0,
        lastDay: stats.lastDay || '',
        sessions: Number(stats.sessions) || 0,
        answers: Number(stats.answers) || 0
      }
    };
  }

  /* =========================================================
     顶部"更多"菜单
     ========================================================= */
  function globalMenu() {
    const h = '<div class="pick-list">' +
      pick('📤', '导出全部备份', 'JSON 文件，可换机恢复', 'backup') +
      pick('📥', '从备份恢复', '选择之前导出的 JSON', 'restore') +
      pick('🆕', '新建区块', '例如：托福 / GRE 生词', 'newdeck') +
      '<div class="divider-line"></div>' +
      pick('📚', '内置数学词库', GLOSSARY.length + ' 个线代 / 微积分英文术语', 'glossary') +
      pick('ℹ️', '关于词块', '版本 6.2', 'about') +
      '</div>';
    openSheet('设置', h, {
      onMount(el) {
        $$('[data-a]', el).forEach(b => b.onclick = () => {
          const a = b.dataset.a;
          closeSheet();
          setTimeout(() => {
            if (a === 'backup') doExportBackup();
            else if (a === 'restore') doImportBackup();
            else if (a === 'newdeck') sheetDeck(null);
            else if (a === 'glossary') sheetGlossary();
            else if (a === 'about') sheetAbout();
          }, 200);
        });
      }
    });
  }

  function sheetGlossary() {
    const groups = {};
    GLOSSARY.forEach(g => {
      const k = g.subject || '其他';
      (groups[k] = groups[k] || []).push(g);
    });
    let h = '<div style="font-size:12.5px;color:#6B7280;margin-bottom:14px">' +
      '这些是内置的数学英语术语，添加单词时会<b>优先离线命中</b>，无需联网、释义更准确。<br>可直接把它们批量加进「线代 &amp; 微积分」区块。</div>';
    Object.keys(groups).forEach(k => {
      h += '<div style="font-size:12.5px;font-weight:600;color:#6B7280;margin:16px 0 8px">' + esc(k) + '（' + groups[k].length + '）</div>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      groups[k].forEach(g => {
        h += '<span style="font-size:12.5px;padding:5px 9px;background:#F4F6FA;border-radius:8px;color:#3D4553">' + esc(g.en) + '</span>';
      });
      h += '</div>';
    });
    h += '<div class="divider-line"></div>' +
      '<button class="btn primary block" id="gImport">把内置词库加入「线代 &amp; 微积分」区块</button>';
    openSheet('内置数学词库', h, {
      onMount(el) {
        $('#gImport', el).onclick = () => {
          let target = S.decks.find(x => x.name.indexOf('线代') >= 0) || S.decks[0];
          if (!target) { toast('请先创建一个区块'); return; }
          let n = 0;
          GLOSSARY.forEach(g => {
            if (!target.words.find(x => x.en.toLowerCase() === g.en.toLowerCase())) {
              target.words.unshift({
                id: uid(), en: g.en, ipa: g.ipa || '', zh: (g.pos ? g.pos + ' ' : '') + g.zh,
                ex: g.ex ? [{ en: g.ex, zh: g.exZh || '' }] : [],
                tag: g.subject || '', known: false, star: false, reviews: 0,
                addedAt: nowStr(), createdAt: Date.now(), builtin: true
              });
              n++;
            }
          });
          saveNow(); closeSheet(); render();
          toast(n ? ('已加入 ' + n + ' 个术语到「' + target.name + '」') : '词库里已全部存在');
        };
      }
    });
  }

  function sheetAbout() {
    let info = {};
    try { if (IS_APP && Android.info) info = JSON.parse(Android.info()); } catch (e) {}
    const h = '<div style="text-align:center;padding:8px 0 20px">' +
      '<div style="width:72px;height:72px;border-radius:22px;margin:0 auto 14px;background:linear-gradient(135deg,#4C6FFF,#6E5BFF);display:flex;align-items:center;justify-content:center;font-size:34px">📚</div>' +
      '<div style="font-size:18px;font-weight:700">词块 WordBlocks</div>' +
      '<div style="font-size:12.5px;color:#9AA3B2;margin-top:4px">版本 6.2 · 记忆曲线背单词</div></div>' +
      '<div class="divider-line"></div>' +
      '<div style="font-size:13.5px;line-height:2;color:#3D4553">' +
      '<div>· 输入英文单词，自动填充<b>音标、中文释义、例句</b></div>' +
      '<div>· <b>复习与学新词并行</b>，每次背多少个自己定</div>' +
      '<div>· 按记忆曲线安排复习，答错的词当场再考一遍</div>' +
      '<div>· 内置 ' + GLOSSARY.length + ' 个线代 / 微积分英文术语，离线可用</div>' +
      '<div>· 支持导出 PDF 打印背诵（4 种版式）</div>' +
      '<div>· 数据只保存在本机，可导出 JSON 备份</div>' +
      '</div>' +
      '<div class="divider-line"></div>' +
      '<div style="font-size:12px;color:#9AA3B2;line-height:1.9">' +
      '词典来源：有道词典公开接口<br>' +
      (info.model ? '运行设备：' + esc(info.model) + '<br>Android ' + esc(info.android || '') : '') +
      '</div>';
    openSheet('关于', h);
  }

  /* =========================================================
     返回键
     ========================================================= */
  window.wbBack = function () {
    const dlg = document.querySelector('.dialog-mask.on');
    if (dlg) { dlg.classList.remove('on'); setTimeout(() => dlg.remove(), 220); return true; }
    if ($('#studyRoot')) { closeSession(); return true; }
    if (sheetEl) { closeSheet(); return true; }
    if (route.view === 'deck') { route = { view: 'home', deckId: null }; render(); return true; }
    return false;
  };

  /* =========================================================
     启动
     ========================================================= */
  function boot() {
    const loaded = store.read();
    let migrated = 0;
    if (loaded && Array.isArray(loaded.decks) && loaded.decks.length) {
      const wasOld = (Number(loaded.version) || 1) < VERSION;
      S = normalize(loaded);
      if (wasOld) {
        // 旧版本 → 2.1：数据原样保留，只补/更新字段，然后立刻落盘
        migrated = S.decks.reduce((n, d) => n + d.words.length, 0);
        saveNow();
      }
    } else {
      S = {
        version: VERSION,
        decks: defaultDecks(),
        settings: { ipa: true, example: true, shuffle: false, lastDeck: null, planSize: 20, newShare: 0.5 },
        stats: { streak: 0, lastDay: '', sessions: 0, answers: 0 }
      };
      saveNow();
    }

    $('#btnMore').onclick = () => globalMenu();
    $('#btnBack').onclick = () => { window.wbBack(); };

    const view = $('#view');
    // 顶栏不是开关式切换，而是跟着滚动距离连续加深（0 → 1 用 36px 走完）
    let tbPending = 0;
    view.addEventListener('scroll', () => {
      if (tbPending) return;
      tbPending = requestAnimationFrame(() => {
        tbPending = 0;
        const p = Math.min(1, Math.max(0, view.scrollTop / 36));
        const bar = $('#topbar');
        bar.style.setProperty('--tb', p.toFixed(3));
        bar.classList.toggle('scrolled', p > .02);
      });
    });

    render();

    // 首次使用引导
    if (migrated > 0) {
      setTimeout(() => {
        confirmDialog('已升级到 6.2 🎉',
          '你的 <b>' + migrated + '</b> 个单词都还在，一个没丢。<br><br>' +
          '界面全面换新：<br>' +
          '· 首页、区块卡片重新排过，更好认<br>' +
          '· 背单词换成<b>深色专注</b>模式<br>' +
          '· 背完今天的量，随时能继续加练',
          '知道了', null);
        const d = confirmDialog._open;
        if (d) d.querySelector('[data-c="0"]').style.display = 'none';
      }, 480);
    } else if (!loaded) {
      setTimeout(() => {
        confirmDialog('欢迎使用词块 👋',
          '已经为你准备了两个区块：<br><br>' +
          '🎯 <b>雅思生词本</b> — 收集雅思阅读听力生词<br>' +
          '📐 <b>线代 &amp; 微积分</b> — 用英语学数学<br><br>' +
          '添加单词时只需输入英文，<b>中文释义和例句会自动填好</b>。',
          '开始使用', null);
        const d = confirmDialog._open;
        if (d) d.querySelector('[data-c="0"]').style.display = 'none';
      }, 420);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
