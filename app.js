(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const tpl = $('#rowTpl');
  const sectionTpl = $('#sectionTpl');
  const sections = Array.isArray(window.SECTIONS) ? window.SECTIONS : [];
  // give every problem a unique key across sections (used for remarks, proofs, done flags, rows)
  function attach(p, sec) {
    p.section = sec;
    // page-added problems key by their row id so remarks survive renumbering
    p.key = p.rowId ? sec.key + '-x' + String(p.rowId).slice(0, 8) : sec.key + '-' + p.id;
  }
  sections.forEach(sec => sec.problems.forEach(p => attach(p, sec)));
  let problems = sections.flatMap(sec => sec.problems);
  function refreshProblems() { problems = sections.flatMap(sec => sec.problems); }
  const LS_KEY = 'agent-calling-problems.remarks';
  const LS_DONE = 'agent-calling-problems.done';
  const LS_VIEW = 'agent-calling-problems.view';
  const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|oga|opus|webm|flac)(\?.*)?$/i;
  const IMAGE_RE = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;

  let store = { remarks: {}, proofs: {}, done: {} };
  let mode = 'local';            // 'supabase' | 'server' | 'local'
  let sb = null;                 // Supabase client when mode === 'supabase'
  const TABLE = 'problem_state';
  const PROBLEMS_TABLE = 'problems';   // problems added from the page
  const BUCKET = 'proofs';             // their uploaded recordings / screenshots
  const addedRows = new Map();         // supabase row id -> problem
  let addReady = false;                // problems table reachable
  let addError = '';
  let built = false;                   // sections rendered yet?
  const view = { q: '', status: 'all', section: 'all', proof: 'all', duration: 'all', remark: 'all', sort: 'num' };
  const rows = new Map();        // key -> { el, p }
  const players = new Set();     // every <audio> on the page
  const durations = {};          // audio src -> seconds
  const timers = {};
  let filterTimer = 0;

  /* ---------------- persistence ---------------- */
  // Priority: Supabase (shared, works on Vercel) -> serve.py (shared on a LAN) -> this browser only.
  function applyRow(r) {
    if (!r || !r.key) return;
    if (r.remark && r.remark.trim()) store.remarks[r.key] = { text: r.remark, updated: r.remark_updated };
    else delete store.remarks[r.key];
    if (r.done) store.done[r.key] = { done: true, updated: r.done_updated };
    else delete store.done[r.key];
  }

  async function loadStore() {
    if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase) {
      try {
        sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
        const { data, error } = await sb.from(TABLE).select('*');
        if (error) throw error;
        store = { remarks: {}, proofs: {}, done: {} };
        data.forEach(applyRow);
        mode = 'supabase';
        await loadAdded();
        subscribeLive();
        return;
      } catch (e) {
        console.warn('Supabase not reachable, falling back', e);
        sb = null;
      }
    }
    try {
      const r = await fetch('api/store', { cache: 'no-store' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
        store = await r.json();
        mode = 'server';
      }
    } catch (_) { /* opened as a file or on a static host */ }
    if (mode === 'local') {
      try { store.remarks = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (_) { store.remarks = {}; }
      try { store.done = JSON.parse(localStorage.getItem(LS_DONE) || '{}'); } catch (_) { store.done = {}; }
    }
    store.remarks = store.remarks || {};
    store.proofs = store.proofs || {};
    store.done = store.done || {};
  }

  // Live sync: when someone else saves, update that row here without a reload.
  function subscribeLive() {
    try {
      sb.channel('problem_state_live')
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, payload => {
          const r = payload.new && payload.new.key ? payload.new : null;
          if (!r) return;
          applyRow(r);
          const row = rows.get(r.key);
          if (!row) return;
          paintRemark(row.p);
          paintDone(row.p);
          updateStats();
          applyFilter();
        })
        .subscribe();
    } catch (e) { console.warn('Live updates unavailable', e); }
    if (addReady) subscribeAdded();
  }

  /* ---------------- problems added from the page ---------------- */
  async function loadAdded() {
    try {
      const { data, error } = await sb.from(PROBLEMS_TABLE).select('*').order('created_at');
      if (error) throw error;
      addReady = true;
      data.forEach(r => mergeAdded(r, false));
    } catch (e) {
      addReady = false;
      addError = (e && (e.message || e.code)) || 'unknown error';
      console.warn('problems table not available', e);
    }
  }

  function slug(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'section'; }

  function sectionFor(r) {
    let sec = sections.find(x => x.key === r.section_key);
    if (!sec) {
      sec = { key: r.section_key, title: r.section_title || r.section_key, subtitle: r.section_subtitle || '', problems: [], dynamic: true };
      sections.push(sec);
      if (built) { buildSection(sec); addSectionOption(sec); }
    }
    return sec;
  }

  function fromRow(r, sec) {
    return { id: r.num, title: r.title || '', problem: r.problem || '', expectation: r.expectation || '',
      proof: Array.isArray(r.proof) ? r.proof : [], added: true, rowId: r.id, createdAt: r.created_at, section: sec };
  }

  function mergeAdded(r, live) {
    if (!r || !r.id || addedRows.has(r.id)) return;
    const sec = sectionFor(r);
    const p = fromRow(r, sec);
    attach(p, sec);
    sec.problems.push(p);
    addedRows.set(r.id, p);
    refreshProblems();
    if (live && built) { buildRow(p); updateStats(); applyFilter(); }
    return p;
  }

  function updateAdded(r) {
    const p = addedRows.get(r.id);
    if (!p) return mergeAdded(r, true);
    Object.assign(p, { id: r.num, title: r.title || '', problem: r.problem || '', expectation: r.expectation || '', proof: Array.isArray(r.proof) ? r.proof : [] });
    const row = rows.get(p.key);
    if (!row) return;
    $('.num', row.el).textContent = '#' + p.id;
    $('.title-text', row.el).textContent = p.title;
    $('.desc', row.el).textContent = p.problem;
    $('.expect', row.el).textContent = p.expectation;
    renderProofs(p);
    updateStats(); applyFilter();
  }

  function removeAddedLocal(rowId) {
    const p = addedRows.get(rowId);
    if (!p) return;
    const sec = p.section;
    sec.problems = sec.problems.filter(x => x !== p);
    const row = rows.get(p.key);
    if (row) { row.el.remove(); rows.delete(p.key); }
    addedRows.delete(rowId);
    if (sec.dynamic && !sec.problems.length) {
      if (sec.el) sec.el.remove();
      sections.splice(sections.indexOf(sec), 1);
      const opt = $('#fSection option[value="' + sec.key + '"]');
      if (opt) opt.remove();
      if (view.section === sec.key) view.section = 'all';
    }
    refreshProblems();
    updateStats(); applyFilter();
  }

  async function removeAdded(p) {
    if (!confirm('Remove "' + p.title + '" for everyone? Its uploaded proof files are deleted too.')) return;
    try {
      const paths = (p.proof || []).map(x => x && x.path).filter(Boolean);
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
      const { error } = await sb.from(PROBLEMS_TABLE).delete().eq('id', p.rowId);
      if (error) throw error;
      removeAddedLocal(p.rowId);
    } catch (e) {
      alert('Could not remove the problem: ' + (e.message || e));
    }
  }

  function subscribeAdded() {
    try {
      sb.channel('problems_live')
        .on('postgres_changes', { event: '*', schema: 'public', table: PROBLEMS_TABLE }, payload => {
          if (payload.eventType === 'INSERT') mergeAdded(payload.new, true);
          else if (payload.eventType === 'UPDATE') updateAdded(payload.new);
          else if (payload.eventType === 'DELETE' && payload.old) removeAddedLocal(payload.old.id);
        })
        .subscribe();
    } catch (e) { console.warn('Live problem updates unavailable', e); }
  }

  function persistLocal(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); return true; }
    catch (_) { return false; }
  }
  function loadView() {
    try { Object.assign(view, JSON.parse(localStorage.getItem(LS_VIEW) || '{}')); } catch (_) { /* ignore */ }
  }
  function saveView() { persistLocal(LS_VIEW, view); }

  function queueSave(id, text, statusEl) {
    statusEl.textContent = 'Saving…';
    statusEl.dataset.state = 'saving';
    clearTimeout(timers[id]);
    timers[id] = setTimeout(() => saveRemark(id, text, statusEl), 500);
  }

  async function saveRemark(id, text, statusEl) {
    const cleared = !text.trim();
    if (mode === 'supabase') {
      try {
        const updated = new Date().toISOString();
        const { error } = await sb.from(TABLE).upsert({ key: id, remark: text, remark_updated: updated }, { onConflict: 'key' });
        if (error) throw error;
        if (cleared) delete store.remarks[id]; else store.remarks[id] = { text, updated };
      } catch (_) {
        statusEl.textContent = 'Not saved – Supabase unreachable';
        statusEl.dataset.state = 'error';
        return;
      }
    } else if (mode === 'server') {
      try {
        const r = await fetch('api/remark', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, text })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const entry = await r.json();
        if (cleared) delete store.remarks[id]; else store.remarks[id] = entry;
      } catch (_) {
        statusEl.textContent = 'Not saved – server unreachable';
        statusEl.dataset.state = 'error';
        return;
      }
    } else {
      if (cleared) delete store.remarks[id];
      else store.remarks[id] = { text, updated: new Date().toISOString() };
      if (!persistLocal(LS_KEY, store.remarks)) {
        statusEl.textContent = 'Not saved – browser storage blocked';
        statusEl.dataset.state = 'error';
        return;
      }
    }
    statusEl.textContent = cleared ? 'Remark cleared' : 'Saved ' + fmtWhen(store.remarks[id].updated);
    statusEl.dataset.state = 'saved';
    rows.get(id).el.classList.toggle('remarked', !cleared);
    updateStats();
    applyFilter();
  }

  async function toggleDone(p) {
    const next = !isDone(p);
    const btn = $('.done-btn', rows.get(p.key).el);
    btn.disabled = true;
    try {
      if (mode === 'supabase') {
        const updated = new Date().toISOString();
        const { error } = await sb.from(TABLE).upsert({ key: p.key, done: next, done_updated: updated }, { onConflict: 'key' });
        if (error) throw error;
        if (next) store.done[p.key] = { done: true, updated }; else delete store.done[p.key];
      } else if (mode === 'server') {
        const r = await fetch('api/done', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: p.key, done: next })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const entry = await r.json();
        if (next) store.done[p.key] = entry; else delete store.done[p.key];
      } else {
        if (next) store.done[p.key] = { done: true, updated: new Date().toISOString() }; else delete store.done[p.key];
        if (!persistLocal(LS_DONE, store.done)) throw new Error('storage blocked');
      }
    } catch (_) {
      alert('Could not save the completion state. ' + (mode === 'local' ? 'Browser storage is blocked.' : 'Is the storage reachable?'));
    }
    btn.disabled = false;
    paintDone(p);
    updateStats();
    applyFilter();
  }

  /* ---------------- helpers ---------------- */
  function isDone(p) { const d = store.done[p.key]; return !!(d && d.done); }
  function hasRemark(p) { const r = store.remarks[p.key]; return !!(r && r.text && r.text.trim()); }
  function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return '–:––';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }
  function driveId(url) {
    const m = String(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]+)/);
    return m ? m[1] : null;
  }
  function basename(src) {
    try { return decodeURIComponent(src.split('?')[0].split('/').pop()); } catch (_) { return src; }
  }
  function svg(path) {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + path + '</svg>';
  }
  const IC_PLAY = svg('<path d="M8 5v14l11-7z"/>');
  const IC_PAUSE = svg('<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>');
  const IC_DL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';

  /* ---------------- proof rendering ---------------- */
  function normalise(e) {
    if (!e) return null;
    if (typeof e === 'string') return { kind: kindOf(e), src: e, name: basename(e) };
    if (e.note) return { kind: 'note', text: e.note };
    if (e.text) return { kind: 'text', text: e.text, name: e.name || 'Text proof' };
    if (e.link) return { kind: 'link', src: e.link, name: e.name || e.link };
    const src = e.file || e.src || '';
    return src ? { kind: kindOf(src), src, name: e.name || basename(src) } : null;
  }
  function kindOf(src) {
    if (driveId(src)) return 'drive';
    if (IMAGE_RE.test(src)) return 'image';
    if (AUDIO_RE.test(src) || src.startsWith('audio/')) return 'audio';
    return 'link';
  }
  function proofsFor(p) {
    const own = [].concat(p.proof || []).map(normalise).filter(Boolean);
    const uploaded = (store.proofs[p.key] || []).map(x => ({ kind: kindOf(x.file), src: x.file, name: x.name || basename(x.file), removable: true }));
    return own.concat(uploaded);
  }
  function realProofs(p) { return proofsFor(p).filter(x => x.kind !== 'note'); }
  function hasRealProof(p) { return realProofs(p).length > 0; }
  function audioSrcs(p) { return realProofs(p).filter(x => x.kind === 'audio').map(x => x.src); }
  // longest recording attached to the problem, or null when none (or not loaded yet)
  function durationOf(p) {
    let max = null;
    for (const src of audioSrcs(p)) {
      const d = durations[src];
      if (isFinite(d) && (max === null || d > max)) max = d;
    }
    return max;
  }
  function durationBucket(p) {
    if (!audioSrcs(p).length) return 'none';
    const d = durationOf(p);
    if (d === null) return 'loading';
    if (d < 45) return 'u45';
    if (d < 60) return '45-60';
    if (d < 120) return '1-2';
    return 'o2';
  }

  // src -> list of problems that use it (so shared recordings can be labelled)
  function sharedUsers(src, except) {
    const out = [];
    for (const q of problems) {
      if (q === except) continue;
      if (proofsFor(q).some(x => x.src === src && x.kind !== 'note')) out.push(q);
    }
    return out;
  }
  function refLabel(q, from) {
    const same = q.section === from.section;
    return (same ? '#' + q.id : q.section.title + ' #' + q.id) + ' ' + q.title;
  }

  function noteDuration(src, secs) {
    if (!isFinite(secs) || secs <= 0) return;
    const changed = durations[src] !== secs;
    durations[src] = secs;
    if (!changed) return;
    for (const q of problems) if (audioSrcs(q).includes(src)) paintTags(q);
    // the duration filter / sort may now have new information
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyFilter, 120);
  }

  function card(kind, name, title) {
    const wrap = document.createElement('div');
    wrap.className = 'pcard ' + kind;
    const head = document.createElement('div');
    head.className = 'pcard-head';
    const k = document.createElement('span');
    k.className = 'pkind';
    k.textContent = kind === 'audio' ? 'Recording' : kind === 'image' ? 'Screenshot' : kind === 'text' ? 'Transcript' : kind === 'drive' ? 'Drive recording' : 'Link';
    const n = document.createElement('span');
    n.className = 'pname';
    n.textContent = name || '';
    if (title) n.title = title;
    head.append(k, n);
    wrap.append(head);
    return wrap;
  }

  function buildPlayer(item) {
    const wrap = card('audio', item.name, item.src);
    const el = document.createElement('div');
    el.className = 'player';
    el.innerHTML =
      '<button type="button" class="pp" aria-label="Play"><span class="ic-play">' + IC_PLAY + '</span><span class="ic-pause">' + IC_PAUSE + '</span></button>' +
      '<div class="track"><input type="range" min="0" max="1000" value="0" aria-label="Seek">' +
      '<div class="times"><span class="cur">0:00</span><span class="dur">–:––</span></div></div>' +
      '<button type="button" class="speed" title="Playback speed">1×</button>' +
      '<a class="dl" title="Download" download></a>';
    const dl = $('.dl', el);
    dl.href = item.src;
    dl.innerHTML = IC_DL;

    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = item.src;
    players.add(audio);

    const pp = $('.pp', el), seek = $('input', el), cur = $('.cur', el), dur = $('.dur', el), speed = $('.speed', el);
    const speeds = [1, 1.25, 1.5, 2];
    let seeking = false;

    pp.addEventListener('click', () => {
      if (audio.paused) {
        players.forEach(a => { if (a !== audio) a.pause(); });
        audio.play().catch(() => showErr('Could not play this file.'));
      } else audio.pause();
    });
    audio.addEventListener('play', () => { el.classList.add('playing'); pp.setAttribute('aria-label', 'Pause'); });
    audio.addEventListener('pause', () => { el.classList.remove('playing'); pp.setAttribute('aria-label', 'Play'); });
    audio.addEventListener('ended', () => { audio.currentTime = 0; });
    const onMeta = () => { dur.textContent = fmtTime(audio.duration); noteDuration(item.src, audio.duration); };
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    if (isFinite(durations[item.src])) dur.textContent = fmtTime(durations[item.src]);
    audio.addEventListener('timeupdate', () => {
      cur.textContent = fmtTime(audio.currentTime);
      if (!seeking && isFinite(audio.duration) && audio.duration > 0) seek.value = Math.round(audio.currentTime / audio.duration * 1000);
    });
    seek.addEventListener('input', () => {
      seeking = true;
      if (isFinite(audio.duration)) cur.textContent = fmtTime(seek.value / 1000 * audio.duration);
    });
    seek.addEventListener('change', () => {
      seeking = false;
      if (isFinite(audio.duration)) audio.currentTime = seek.value / 1000 * audio.duration;
    });
    speed.addEventListener('click', () => {
      const next = speeds[(speeds.indexOf(audio.playbackRate) + 1) % speeds.length] || 1;
      audio.playbackRate = next;
      speed.textContent = next + '×';
    });
    audio.addEventListener('error', () => showErr('File not found or not playable: ' + item.name));

    wrap.append(el);

    function showErr(msg) {
      el.classList.add('err');
      let e = $('.perr', wrap);
      if (!e) { e = document.createElement('div'); e.className = 'perr'; wrap.append(e); }
      e.textContent = msg;
    }
    return wrap;
  }

  function buildDrive(item, id) {
    const wrap = card('drive', item.name && item.name !== item.src ? item.name : '');
    const f = document.createElement('iframe');
    f.src = 'https://drive.google.com/file/d/' + id + '/preview';
    f.allow = 'autoplay';
    f.loading = 'lazy';
    f.title = 'Proof recording (Google Drive)';
    wrap.append(f);
    return wrap;
  }

  function buildNote(item) {
    const n = document.createElement('div');
    n.className = 'pnote';
    n.textContent = item.text;
    return n;
  }

  function buildText(item) {
    const wrap = card('text', item.name);
    const q = document.createElement('blockquote');
    q.className = 'ptext';
    q.textContent = item.text;
    wrap.append(q);
    return wrap;
  }

  function buildImage(item) {
    const wrap = card('image', item.name);
    const a = document.createElement('a');
    a.className = 'pimg';
    a.href = item.src;
    a.title = 'Click to view full size';
    const img = document.createElement('img');
    img.src = item.src; img.alt = item.name; img.loading = 'lazy';
    a.append(img);
    a.addEventListener('click', e => { e.preventDefault(); openLightbox(item.src, item.name); });
    wrap.append(a);
    return wrap;
  }

  /* ---------------- lightbox ---------------- */
  const lb = $('#lightbox');
  let lbReturn = null;
  function openLightbox(src, caption) {
    lbReturn = document.activeElement;
    $('.lb-img', lb).src = src;
    $('.lb-img', lb).alt = caption || '';
    $('.lb-cap', lb).textContent = caption || '';
    lb.hidden = false;
    document.body.classList.add('no-scroll');
    $('.lb-close', lb).focus();
  }
  function closeLightbox() {
    if (lb.hidden) return;
    lb.hidden = true;
    $('.lb-img', lb).src = '';
    document.body.classList.remove('no-scroll');
    if (lbReturn && lbReturn.focus) lbReturn.focus();
  }
  $('.lb-close', lb).addEventListener('click', closeLightbox);
  lb.addEventListener('click', e => { if (!e.target.closest('.lb-img')) closeLightbox(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

  function buildLink(item) {
    const wrap = card('link', '');
    const a = document.createElement('a');
    a.className = 'plink';
    a.href = item.src; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = (item.name || item.src) + ' ↗';
    wrap.append(a);
    return wrap;
  }

  function renderProofs(p) {
    const box = $('.proofs', rows.get(p.key).el);
    box.replaceChildren();
    const items = proofsFor(p);
    for (const item of items) {
      let node;
      if (item.kind === 'note') node = buildNote(item);
      else if (item.kind === 'text') node = buildText(item);
      else if (item.kind === 'drive') node = buildDrive(item, driveId(item.src));
      else if (item.kind === 'image') node = buildImage(item);
      else if (item.kind === 'audio') node = buildPlayer(item);
      else node = buildLink(item);
      if (item.src && item.kind !== 'link') {
        const others = sharedUsers(item.src, p);
        if (others.length) {
          const sh = document.createElement('div');
          sh.className = 'pshared';
          sh.textContent = 'Same recording also used for ' + others.map(q => refLabel(q, p)).join(', ');
          node.append(sh);
        }
      }
      box.append(node);
    }
    // no proof: show the expectation in the proof column instead of an empty placeholder
    const rowEl = rows.get(p.key).el;
    const expect = $('.expect-box', rowEl);
    if (!items.some(x => x.kind !== 'note')) {
      box.append(expect);
      expect.classList.add('in-proof');
    } else if (expect.parentElement === box) {
      $('.c-main', rowEl).append(expect);
      expect.classList.remove('in-proof');
    }
    paintTags(p);
  }

  /* ---------------- rows ---------------- */
  function buildSection(sec) {
    const el = sectionTpl.content.firstElementChild.cloneNode(true);
    el.classList.add(sec.key);
    el.dataset.key = sec.key;
    $('.block-title', el).textContent = sec.title;
    $('.block-sub', el).textContent = sec.subtitle || '';
    $('#sections').append(el);
    sec.el = el;
    sec.problems.forEach(buildRow);
  }

  function buildRow(p) {
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.dataset.key = p.key;
    $('.num', el).textContent = '#' + p.id;
    $('.title-text', el).textContent = p.title;
    $('.desc', el).textContent = p.problem;
    $('.expect', el).textContent = p.expectation;
    const ta = $('.remark', el), status = $('.status', el);
    const saved = store.remarks[p.key];
    if (saved && saved.text) {
      ta.value = saved.text;
      status.textContent = 'Saved ' + fmtWhen(saved.updated);
      status.dataset.state = 'saved';
      el.classList.add('remarked');
    }
    ta.addEventListener('input', () => { autogrow(ta); queueSave(p.key, ta.value, status); });
    $('.done-btn', el).addEventListener('click', () => toggleDone(p));
    if (p.added) {
      $('.t-added', el).hidden = false;
      const rm = $('.rm-btn', el);
      rm.hidden = mode !== 'supabase';
      rm.addEventListener('click', () => removeAdded(p));
    }
    rows.set(p.key, { el, p });
    $('.list', p.section.el).append(el);
    renderProofs(p);
    paintDone(p);
    autogrow(ta);
  }

  function paintRemark(p) {
    const el = rows.get(p.key).el, ta = $('.remark', el), status = $('.status', el);
    if (document.activeElement === ta) return;      // never overwrite what someone is typing
    const saved = store.remarks[p.key];
    ta.value = saved ? saved.text : '';
    status.textContent = saved ? 'Saved ' + fmtWhen(saved.updated) : '';
    status.dataset.state = saved ? 'saved' : '';
    el.classList.toggle('remarked', !!saved);
    autogrow(ta);
  }

  function paintDone(p) {
    const el = rows.get(p.key).el;
    const done = isDone(p);
    el.classList.toggle('done', done);
    const btn = $('.done-btn', el);
    btn.setAttribute('aria-pressed', String(done));
    btn.title = done ? 'Completed – click to mark as pending' : 'Mark as complete';
    $('.done-label', btn).textContent = done ? 'Completed' : 'Mark as complete';
    const t = $('.t-done', el);
    const d = store.done[p.key];
    t.hidden = !done;
    t.textContent = done && d && d.updated ? 'Done ' + fmtWhen(d.updated) : 'Done';
  }

  function paintTags() { /* nothing to show on the title line for now */ }

  function autogrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(110, ta.scrollHeight + 2) + 'px';
  }

  /* ---------------- filtering & sorting ---------------- */
  function matches(p) {
    if (view.status === 'pending' && isDone(p)) return false;
    if (view.status === 'done' && !isDone(p)) return false;
    if (view.section !== 'all' && p.section.key !== view.section) return false;
    if (view.remark === 'none' && hasRemark(p)) return false;
    if (view.remark === 'has' && !hasRemark(p)) return false;
    const real = realProofs(p);
    if (view.proof === 'has' && !real.length) return false;
    if (view.proof === 'none' && real.length) return false;
    if (view.proof === 'audio' && !real.some(x => x.kind === 'audio' || x.kind === 'drive')) return false;
    if (view.proof === 'image' && !real.some(x => x.kind === 'image')) return false;
    if (view.proof === 'text' && !real.some(x => x.kind === 'text')) return false;
    if (view.proof === 'multi' && real.length < 2) return false;
    if (view.duration !== 'all') {
      const b = durationBucket(p);
      if (b !== view.duration && b !== 'loading') return false;
    }
    if (!view.q) return true;
    const r = store.remarks[p.key];
    const hay = [p.id, p.title, p.problem, p.expectation, p.section.title, hasRemark(p) ? r.text : '', isDone(p) ? 'complete done' : 'pending']
      .join(' ').toLowerCase();
    return view.q.split(/\s+/).every(w => hay.includes(w));
  }

  function updatedAt(p) {
    const a = store.remarks[p.key], b = store.done[p.key];
    return Math.max(a && a.updated ? Date.parse(a.updated) || 0 : 0, b && b.updated ? Date.parse(b.updated) || 0 : 0);
  }
  function compare(a, b) {
    const byNum = (a.id - b.id) || a.title.localeCompare(b.title);
    switch (view.sort) {
      case 'pending': return (isDone(a) - isDone(b)) || byNum;
      case 'done': return (isDone(b) - isDone(a)) || byNum;
      case 'dur-desc': return ((durationOf(b) ?? -1) - (durationOf(a) ?? -1)) || byNum;
      case 'dur-asc': return ((durationOf(a) ?? Infinity) - (durationOf(b) ?? Infinity)) || byNum;
      case 'updated': return (updatedAt(b) - updatedAt(a)) || byNum;
      case 'title': return a.title.localeCompare(b.title) || byNum;
      default: return byNum;
    }
  }

  function applyFilter() {
    let shown = 0;
    for (const sec of sections) {
      const list = $('.list', sec.el);
      const ordered = sec.problems.slice().sort(compare);
      // only move rows when the order really changed, so a focused remark box keeps its focus
      const current = $$('.row.item', list).map(r => r.dataset.key);
      if (ordered.some((p, i) => p.key !== current[i])) ordered.forEach(p => list.append(rows.get(p.key).el));
      let inSec = 0;
      for (const p of ordered) {
        const ok = matches(p);
        rows.get(p.key).el.hidden = !ok;
        if (ok) inSec++;
      }
      sec.el.hidden = inSec === 0;
      const doneN = sec.problems.filter(isDone).length;
      $('.block-count', sec.el).textContent =
        (inSec === sec.problems.length ? sec.problems.length + (sec.problems.length === 1 ? ' problem' : ' problems') : inSec + ' of ' + sec.problems.length + ' shown') +
        ' · ' + doneN + ' complete';
      const bar = $('.block-progress i', sec.el);
      bar.style.width = Math.round(doneN / sec.problems.length * 100) + '%';
      shown += inSec;
    }
    $('#empty').hidden = shown > 0;
    $('#showing').textContent = shown === problems.length ? 'Showing all ' + problems.length : 'Showing ' + shown + ' of ' + problems.length;
    const active = view.q || view.status !== 'all' || view.section !== 'all' || view.proof !== 'all' || view.duration !== 'all' || view.remark !== 'all' || view.sort !== 'num';
    $('#clear').hidden = !active;
    saveView();
  }

  function updateStats() {
    const done = problems.filter(isDone).length;
    const total = problems.length;
    $('#statTotal').textContent = total;
    $('#statDone').textContent = done;
    $('#statPending').textContent = total - done;
    $('#statProof').textContent = problems.filter(hasRealProof).length;
    $('#statRemark').textContent = problems.filter(hasRemark).length;
    $('#cntPending').textContent = total - done;
    $('#cntDone').textContent = done;
    const pct = total ? Math.round(done / total * 100) : 0;
    const bar = $('#bar');
    bar.setAttribute('aria-valuenow', pct);
    $('i', bar).style.width = pct + '%';
    bar.classList.toggle('full', pct === 100);
  }

  /* ---------------- init ---------------- */
  function bindControls() {
    const q = $('#q');
    q.value = view.q;
    q.addEventListener('input', e => { view.q = e.target.value.trim().toLowerCase(); applyFilter(); });

    const segBtns = $$('.seg button');
    const paintSeg = () => segBtns.forEach(b => b.classList.toggle('on', b.dataset.status === view.status));
    segBtns.forEach(b => b.addEventListener('click', () => { view.status = b.dataset.status; paintSeg(); applyFilter(); }));
    paintSeg();

    const secSel = $('#fSection');
    sections.forEach(addSectionOption);
    const selects = { section: secSel, proof: $('#fProof'), duration: $('#fDuration'), remark: $('#fRemark'), sort: $('#fSort') };
    for (const [k, sel] of Object.entries(selects)) {
      if ([...sel.options].some(o => o.value === view[k])) sel.value = view[k]; else view[k] = sel.value;
      sel.addEventListener('change', () => { view[k] = sel.value; applyFilter(); });
    }
    $('#clear').addEventListener('click', () => {
      Object.assign(view, { q: '', status: 'all', section: 'all', proof: 'all', duration: 'all', remark: 'all', sort: 'num' });
      q.value = '';
      for (const [k, sel] of Object.entries(selects)) sel.value = view[k];
      paintSeg();
      applyFilter();
    });
  }

  function addSectionOption(sec) {
    const secSel = $('#fSection');
    if ($('option[value="' + sec.key + '"]', secSel)) return;
    const o = document.createElement('option');
    o.value = sec.key; o.textContent = sec.title;
    secSel.append(o);
  }

  /* ---------------- add-problem dialog ---------------- */
  function bindAddDialog() {
    const dlg = $('#addDlg'), form = $('#addForm'), secSel = $('#addSection'), newSec = $('#newSec');
    const err = $('#addErr'), note = $('#addNote'), save = $('#addSave'), files = $('#addFiles'), info = $('#addFilesInfo');
    const infoDefault = info.textContent;

    function fillSections() {
      secSel.replaceChildren();
      for (const sec of sections) {
        const o = document.createElement('option');
        o.value = sec.key; o.textContent = sec.title;
        secSel.append(o);
      }
      const o = document.createElement('option');
      o.value = '__new'; o.textContent = '+ New section…';
      secSel.append(o);
      // default to the section currently filtered, else the last one
      secSel.value = sections.some(x => x.key === view.section) ? view.section : sections[sections.length - 1].key;
      newSec.hidden = secSel.value !== '__new';
    }
    function showErr(msg) { err.textContent = msg; err.hidden = !msg; }

    function open() {
      fillSections();
      showErr('');
      info.textContent = infoDefault;
      if (mode !== 'supabase') {
        note.textContent = 'Adding problems from the page needs the shared storage. Open the hosted page, or fill in config.js with the Supabase project.';
        note.hidden = false; save.disabled = true;
      } else if (!addReady) {
        note.innerHTML = 'The shared storage is missing the table for page-added problems. Run <code>supabase/problems.sql</code> once in the Supabase SQL editor, then reload this page. (' + addError.replace(/</g, '&lt;') + ')';
        note.hidden = false; save.disabled = true;
      } else {
        note.hidden = true; save.disabled = false;
      }
      dlg.showModal();
      $('[name=title]', form).focus();
    }
    function close() { dlg.close(); }

    $('#addBtn').addEventListener('click', open);
    $('#addClose').addEventListener('click', close);
    $('#addCancel').addEventListener('click', close);
    dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
    secSel.addEventListener('change', () => { newSec.hidden = secSel.value !== '__new'; if (!newSec.hidden) $('[name=sectionTitle]', form).focus(); });
    files.addEventListener('change', () => {
      const list = Array.from(files.files);
      info.textContent = list.length ? list.map(f => f.name + ' (' + (f.size / 1048576).toFixed(1) + ' MB)').join(', ') : infoDefault;
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      showErr('');
      const fd = new FormData(form);
      const title = String(fd.get('title') || '').trim();
      const problem = String(fd.get('problem') || '').trim();
      const expectation = String(fd.get('expectation') || '').trim();
      const text = String(fd.get('text') || '').trim();
      const link = String(fd.get('link') || '').trim();
      const fileList = Array.from(files.files);
      if (!title) return showErr('Give the problem a title.');
      if (!problem) return showErr('Describe the problem.');

      let sec, isNew = false;
      if (secSel.value === '__new') {
        const st = String(fd.get('sectionTitle') || '').trim();
        if (!st) return showErr('Name the new section.');
        const key = slug(st);
        sec = sections.find(x => x.key === key);
        if (!sec) { isNew = true; sec = { key, title: st, subtitle: String(fd.get('sectionSub') || '').trim() }; }
      } else {
        sec = sections.find(x => x.key === secSel.value);
        if (!sec) return showErr('Pick a section.');
      }
      if (link && !/^https?:\/\//i.test(link)) return showErr('The link must start with http:// or https://');

      save.disabled = true;
      const proof = [];
      try {
        for (let i = 0; i < fileList.length; i++) {
          const f = fileList[i];
          save.textContent = 'Uploading ' + (i + 1) + ' of ' + fileList.length + '…';
          const path = sec.key + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '-' + f.name.replace(/[^\w.-]+/g, '-');
          const { error: upErr } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
          if (upErr) throw new Error('Upload of ' + f.name + ' failed: ' + upErr.message);
          const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
          proof.push({ file: url, name: f.name, path });
        }
        if (text) proof.push({ text, name: 'Text proof' });
        if (link) proof.push({ link, name: link.replace(/^https?:\/\//, '').slice(0, 60) });

        save.textContent = 'Saving…';
        const num = isNew ? 1 : Math.max(0, ...sec.problems.map(x => Number(x.id) || 0)) + 1;
        const row = { section_key: sec.key, section_title: sec.title, section_subtitle: sec.subtitle || '', num, title, problem, expectation, proof };
        const { data, error } = await sb.from(PROBLEMS_TABLE).insert(row).select().single();
        if (error) throw new Error(error.message);
        const p = mergeAdded(data, true) || addedRows.get(data.id);
        close();
        form.reset();
        info.textContent = infoDefault;
        if (p) {
          view.section = 'all'; $('#fSection').value = 'all'; applyFilter();
          const el = rows.get(p.key).el;
          el.classList.add('flash');
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => el.classList.remove('flash'), 2000);
        }
      } catch (e2) {
        showErr(e2.message || String(e2));
      } finally {
        save.disabled = false;
        save.textContent = 'Add problem';
      }
    });
  }

  async function init() {
    await loadStore();
    loadView();
    const chip = $('#mode');
    if (mode === 'supabase') { chip.textContent = 'Shared · live'; chip.className = 'chip ok'; chip.title = 'Remarks and ticks are saved in Supabase and sync live'; }
    else if (mode === 'server') { chip.textContent = 'Shared · local server'; chip.className = 'chip ok'; chip.title = 'Saved by serve.py on this machine'; }
    else { chip.textContent = 'This browser only'; chip.className = 'chip warn'; chip.title = 'Fill in config.js with your Supabase project to share remarks with everyone'; }

    sections.forEach(buildSection);
    built = true;
    bindControls();
    bindAddDialog();
    updateStats();
    applyFilter();
  }

  init();
})();
