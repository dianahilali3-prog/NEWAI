/* Éclat Ai — interface : écrans, file de générations en parallèle, Studio en lot,
   personnages de référence, agent IA connecté au web (outils), bibliothèque. */
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, cls = '') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const MAX_BATCH = 30;

let toastT;
function toast(msg, type = '', onClick) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + type;
  t.onclick = () => { t.classList.remove('show'); onClick && onClick(); };
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), onClick ? 7000 : 3800);
}

// ════════════════════════════════════════════════════════════════
// Navigation (#home, #item/<id>, #job/<id>, #batch/<id>, #character/<id>…)
// ════════════════════════════════════════════════════════════════
const TAB_OF = { home: 'home', agent: 'agent', 'create-image': 'create', 'create-video': 'create', job: 'create', studio: 'create', batch: 'create',
  item: 'library', library: 'library', characters: 'profile', character: 'profile', profile: 'profile', settings: 'profile', prefs: 'profile', help: 'profile', opensource: 'profile' };
let depth = 0;
function go(screen, param) { depth++; location.hash = param ? `${screen}/${param}` : screen; }
function back() { if (depth > 0) { depth--; history.back(); } else location.hash = 'home'; }
function currentRoute() { const [s, p] = (location.hash.slice(1) || 'home').split('/'); return { screen: s, param: p }; }

function route() {
  const { screen, param } = currentRoute();
  const el = $(`[data-screen="${screen}"]`) ? screen : 'home';
  $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === el));
  $$('.nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === TAB_OF[el]));
  $('#composer').classList.toggle('hidden', el !== 'agent');
  window.scrollTo(0, 0);
  const render = RENDER[el]; render && render(param);
}

// Feuille du bas : liste d'options
function sheet(title, options, current) {
  return new Promise(resolve => {
    const bg = document.createElement('div'); bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet"><div class="grab"></div><h4>${esc(title)}</h4><div class="card opts">${options.map((o, i) =>
      `<button class="opt ${o.value === current ? 'on' : ''}" data-i="${i}">${o.icon ? icon(o.icon) : ''}<span>${esc(o.label)}${o.sub ? `<br><small style="color:var(--faint)">${esc(o.sub)}</small>` : ''}</span><em>${o.value === current ? '✓' : ''}</em></button>`).join('')}</div></div>`;
    const close = v => { bg.remove(); resolve(v); };
    bg.addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('[data-i]'); if (b) close(options[+b.dataset.i].value); else if (e.target === bg) close(undefined); });
    document.body.appendChild(bg);
  });
}
// Feuille du bas : contenu libre
function sheetHTML(title, html, onClick) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet"><div class="grab"></div><h4>${esc(title)}</h4>${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener('click', e => { e.stopPropagation(); if (e.target === bg) return close(); onClick && onClick(e, close, bg); });
  document.body.appendChild(bg);
  return { el: bg, close };
}
function pickFile({ capture } = {}) {
  return new Promise(resolve => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    if (capture) i.setAttribute('capture', capture);
    i.onchange = () => resolve(i.files[0] || null); i.click();
  });
}

// ════════════════════════════════════════════════════════════════
// Personnages (cache mémoire)
// ════════════════════════════════════════════════════════════════
let charList = [];
async function loadChars() { charList = await Chars.all().catch(() => []); refreshPicks(); }
const charById = id => charList.find(c => c.id === id) || null;
function charByName(name) {
  const n = norm(name).replace(/^@/, '');
  return charList.find(c => norm(c.name) === n) || charList.find(c => norm(c.name).split(/\s+/)[0] === n.split(/\s+/)[0]) || null;
}
const charOptions = () => [{ value: '', label: 'Aucun' }, ...charList.map(c => ({ value: c.id, label: c.name, sub: c.description }))];

// ════════════════════════════════════════════════════════════════
// Options des formulaires
// ════════════════════════════════════════════════════════════════
const fmtOptions = Object.entries(FORMATS).map(([v, f]) => ({ value: v, label: f.label }));
const PICKS = {
  'img-format': { title: 'Format', options: () => fmtOptions },
  'img-quality': { title: 'Qualité', options: () => [{ value: 'hd', label: 'HD', sub: 'rapide' }, { value: 'ultra', label: 'Ultra HD', sub: 'plus de détails (avec clé Agnes)' }] },
  'img-count': { title: 'Nombre d\'images (même prompt, variantes)', options: () => [1, 2, 3, 4, 6, 8, 10, 15, 20, 30].map(n => ({ value: n, label: String(n) })) },
  'img-char': { title: 'Personnage', options: charOptions },
  'img-engine': { title: 'Moteur d\'image', options: () => [{ value: 'auto', label: 'Auto', sub: 'Agnes → Qwen → Pollinations' }, { value: 'agnes', label: 'Agnes', sub: 'rapide, haute qualité (clé Agnes)' }, { value: 'qwen', label: 'Qwen-Image (open source)', sub: 'GPU gratuits Hugging Face, quota par personne' }, { value: 'pollinations', label: 'Pollinations', sub: 'gratuit, 1 image / 45 s' }] },
  'vid-char': { title: 'Personnage', options: charOptions },
  'vid-count': { title: 'Nombre de vidéos (variantes)', options: () => [1, 2, 3, 4, 5, 10].map(n => ({ value: n, label: String(n) })) },
  'vid-engine': { title: 'Moteur vidéo', options: () => [
    { value: 'auto', label: 'Auto', sub: 'IA vidéo Agnes, sinon montage animé (recommandé)' },
    { value: 'ai', label: 'IA vidéo uniquement', sub: 'attend qu\'Agnes ait de la place (jusqu\'à 40 min)' },
    { value: 'montage', label: 'Montage animé', sub: 'rapide et toujours disponible' }] },
  'vid-format': { title: 'Format', options: () => fmtOptions },
  'st-format': { title: 'Format du lot', options: () => fmtOptions },
  'vid-music': { title: 'Musique', options: () => [{ value: 'ambient', label: 'Ambiance douce' }, { value: 'dream', label: 'Rêveuse' }, { value: 'pulse', label: 'Pulsée' }, { value: 'none', label: 'Aucune' }] },
  'vid-transition': { title: 'Transitions', options: () => [{ value: 'mix', label: 'Variées' }, { value: 'fade', label: 'Fondu' }, { value: 'zoom', label: 'Zoom' }, { value: 'slide', label: 'Glissement' }, { value: 'flash', label: 'Flash' }] },
};
const form = {
  'img-format': Settings.get('format'), 'img-engine': Settings.get('imgEngine'), 'img-quality': 'hd', 'img-count': 1, 'img-char': '', imgMode: 't2i', imgStyle: 'cinema', imgUpload: null,
  'vid-engine': 'auto', 'vid-format': Settings.get('format'), 'vid-music': Settings.get('music'), 'vid-transition': 'mix', 'vid-char': '', 'vid-count': 1,
  vidMode: 't2v', vidStyle: 'cinema', vidDuration: 10, vidUpload: null, 'st-format': Settings.get('format'),
};
const labelOf = (k, v) => (PICKS[k].options().find(o => o.value === v) || {}).label || (v === '' ? 'Aucun' : v);
function refreshPicks() { $$('[data-show]').forEach(e => e.textContent = labelOf(e.dataset.show, form[e.dataset.show])); }

function renderStyles() {
  $$('[data-styles]').forEach(row => {
    const kind = row.dataset.styles, ex = (row.dataset.exclude || '').split(',');
    const cur = kind === 'img' ? form.imgStyle : form.vidStyle;
    row.innerHTML = Object.entries(STYLES).filter(([k]) => !ex.includes(k)).map(([k, s]) =>
      `<button class="style ${k === cur ? 'on' : ''}" data-style="${k}"><img src="${s.img}" alt="" loading="lazy">${s.label}</button>`).join('');
  });
}
function setUpload(kind, blob) {
  form[kind === 'img' ? 'imgUpload' : 'vidUpload'] = blob;
  const box = $(kind === 'img' ? '#img-upload' : '#vid-upload');
  box.innerHTML = blob ? `<img src="${URL.createObjectURL(blob)}" alt=""><span>Photo choisie — touche pour changer</span>`
    : `<div class="ph">${icon('upload')}</div><span>${kind === 'img' ? 'Choisis une photo à transformer' : 'Choisis l\'image à animer'}</span>`;
}
function setMode(kind, mode) {
  form[kind === 'img' ? 'imgMode' : 'vidMode'] = mode;
  $$(`#${kind}-mode button`).forEach(b => b.classList.toggle('on', b.dataset.v === mode));
  $(`#${kind}-upload`).classList.toggle('hidden', mode === 't2i' || mode === 't2v');
}

// ════════════════════════════════════════════════════════════════
// File de générations : tout tourne en parallèle (limites pour ne pas saturer)
// ════════════════════════════════════════════════════════════════
const Jobs = new Map(), Batches = new Map();
const LIMITS = { image: 10, video: 4 };   // les appels Agnes sont en plus limités à 5 simultanés dans engine.js
const running = { image: 0, video: 0 }, queue = [];

function startJob(type, params, { navigate = true, batch = null } = {}) {
  const job = { id: uid(), type, params, batch, status: 'queued', pct: 0, msg: 'En file d\'attente…', preview: null, canvas: null, ts: Date.now() };
  Jobs.set(job.id, job);
  if (batch) Batches.get(batch).ids.push(job.id);
  queue.push(job); pump();
  if (navigate) go('job', job.id);
  jobUpdate(job);
  return job;
}
function newBatch(label) { const b = { id: uid(), label, ids: [], ts: Date.now() }; Batches.set(b.id, b); return b.id; }
function pump() {
  for (const j of [...queue]) {
    if (running[j.type] >= LIMITS[j.type]) continue;
    queue.splice(queue.indexOf(j), 1); running[j.type]++;
    runJob(j).finally(() => { running[j.type]--; pump(); });
  }
}

async function runJob(job) {
  const p = job.params;
  job.status = 'running'; job.msg = 'Préparation…';
  const set = (msg, pct) => { if (msg) job.msg = msg; if (pct != null) job.pct = Math.max(job.pct, Math.min(1, pct)); jobUpdate(job); };
  try {
    const character = p.characterId ? await Chars.get(p.characterId).catch(() => null) : null;
    let it;
    if (job.type === 'image') {
      const r = await createImage({ prompt: p.prompt, style: p.style, format: p.format, hd: p.quality === 'ultra', image: p.image || null, character, engine: p.engine, onStatus: m => set(m) });
      job.preview = URL.createObjectURL(r.blob);
      it = { id: uid(), type: 'image', blob: r.blob, ext: 'png', prompt: p.prompt, style: p.style, format: p.format, quality: p.quality,
        character: character && character.name, engine: r.engine, fav: false, ts: Date.now() };
    } else {
      const r = await createVideo({ ...p, character }, {
        onStatus: set,
        onPreview: blob => { job.preview = URL.createObjectURL(blob); jobUpdate(job); },
        onCanvas: c => { job.canvas = c; jobUpdate(job); }
      });
      it = { id: uid(), type: 'video', blob: r.blob, url: r.blob ? null : r.url, ext: r.ext || 'mp4', prompt: p.prompt, style: p.style, format: p.format,
        duration: p.duration, character: character && character.name, engine: r.engine, notes: r.notes || [],
        params: { ...p, image: undefined }, fav: false, ts: Date.now() };
    }
    await DB.put(it);
    job.status = 'done'; job.pct = 1; job.result = it.id; job.canvas = null; job.msg = 'Terminé'; job.doneAt = Date.now(); jobUpdate(job);
    if (job.batch) { batchCheck(job.batch); return; }
    if (job.chat) return;   // l'agent affiche lui-même le résultat
    const msg = job.type === 'image' ? '✨ Ton image est prête' : '🎬 Ta vidéo est prête';
    if (location.hash === `#job/${job.id}`) { location.replace(`#item/${it.id}`); toast(msg); }
    else toast(msg + ' — touche pour voir', '', () => go('item', it.id));
  } catch (e) {
    job.status = 'error'; job.msg = e.message; job.canvas = null; job.doneAt = Date.now(); jobUpdate(job);
    if (job.batch) batchCheck(job.batch); else if (!job.chat) toast('Échec : ' + e.message, 'err');
  }
}
function batchCheck(id) {
  const b = Batches.get(id); if (!b) return;
  const js = b.ids.map(i => Jobs.get(i)).filter(Boolean);
  if (js.every(j => j.status === 'done' || j.status === 'error') && !b.notified) {
    b.notified = true; const ok = js.filter(j => j.status === 'done').length;
    const msg = `✨ Lot terminé : ${ok}/${js.length} créations prêtes`;
    if (location.hash === `#batch/${id}`) toast(msg); else toast(msg + ' — touche pour voir', '', () => go('batch', id));
  }
}

function jobUpdate(job) {
  const { screen, param } = currentRoute();
  if (screen === 'home') renderHomeJobs();
  if (screen === 'job' && param === job.id) renderJob(job.id);
  if (screen === 'batch' && param === job.batch) renderBatch(job.batch);
  $$(`[data-jc="${job.id}"]`).forEach(el => el.outerHTML = jobCard(job));
  const nav = $('#nav [data-tab="create"]'); nav.querySelector('.dot')?.remove();
  if ([...Jobs.values()].some(j => j.status === 'running' || j.status === 'queued')) nav.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
}
const activeJobs = () => [...Jobs.values()].filter(j => j.status === 'running' || j.status === 'queued' || (j.doneAt && Date.now() - j.doneAt < 8000));

function renderHomeJobs() {
  const js = activeJobs(), box = $('#home-jobs');
  if (js.length > 3) {
    const run = js.filter(j => j.status === 'running' || j.status === 'queued').length;
    const pct = js.reduce((a, j) => a + j.pct, 0) / js.length;
    const b = js.find(j => j.batch)?.batch;
    box.innerHTML = `<button class="card job-mini" style="width:100%" ${b ? `data-gob="${b}"` : ''}>${run ? '<div class="spin"></div>' : '✨'}<span>${js.length} créations — ${run} en cours</span><b>${Math.round(pct * 100)}%</b></button>`;
    return;
  }
  box.innerHTML = js.map(j => `<button class="card job-mini" style="width:100%" data-job="${j.id}">
    ${j.status === 'running' || j.status === 'queued' ? '<div class="spin"></div>' : j.status === 'done' ? '✨' : '⚠️'}
    <span>${j.type === 'video' ? 'Vidéo' : 'Image'} — ${esc(j.msg)}</span><b>${Math.round(j.pct * 100)}%</b></button>`).join('');
}

function paramRows(rows) {
  return rows.filter(r => r[2]).map(([ic, label, val]) => `<div class="opt">${icon(ic)}<span>${label}</span><em>${esc(val)}</em></div>`).join('');
}
function renderJob(id) {
  const j = Jobs.get(id);
  if (!j) { $('#job-status').textContent = 'Cette génération est terminée.'; $('#job-pct').textContent = '✓'; $('#job-params').innerHTML = ''; return; }
  if (j.status === 'done' && j.result) { location.replace(`#item/${j.result}`); return; }
  const p = j.params, hero = $('#job-hero');
  $('#job-pct').textContent = j.status === 'error' ? '!' : Math.round(j.pct * 100) + '%';
  $('#job-ring').style.strokeDashoffset = 276.5 * (1 - j.pct);
  $('#job-title').textContent = j.status === 'error' ? 'La création a échoué' : j.type === 'video' ? 'Création de votre vidéo…' : 'Création de votre image…';
  $('#job-status').textContent = j.msg;
  $('#job-status').style.color = j.status === 'error' ? 'var(--err)' : '';
  const cur = hero.querySelector('canvas,img');
  if (j.canvas && cur !== j.canvas) { cur && cur.remove(); hero.prepend(j.canvas); }
  else if (!j.canvas && j.preview && (!cur || cur.tagName !== 'IMG' || cur.dataset.src !== j.preview)) {
    cur && cur.remove(); const im = new Image(); im.src = j.preview; im.dataset.src = j.preview; hero.prepend(im);
  } else if (!j.canvas && !j.preview && cur) cur.remove();
  const ch = p.characterId && charById(p.characterId);
  $('#job-params').innerHTML = `<h5 style="margin-bottom:4px">Prompt</h5><p style="font-size:12.5px;color:var(--dim);margin-bottom:8px">${esc(p.prompt)}</p>` +
    paramRows([['clock', 'Durée', p.duration ? p.duration + ' secondes' : ''], ['palette', 'Style', STYLES[p.style]?.label], ['people', 'Personnage', ch && ch.name],
      ['format', 'Format', p.format], ['hd', 'Qualité', p.quality === 'ultra' ? 'Ultra HD' : p.quality ? 'HD' : '']]) +
    (j.status === 'error' ? `<button class="btn btn-pink btn-lg" data-retry="${j.id}">Réessayer</button>` : '');
}

function jobCard(j) {
  const thumb = j.status === 'done' && j.result ? `data-thumb-item="${j.result}"` : '';
  const bg = j.preview ? `style="background-image:url('${j.preview}')"` : '';
  return `<div class="card bt-item ${j.status === 'error' ? 'err' : ''}" data-jc="${j.id}" ${j.status === 'done' ? `data-item="${j.result}"` : `data-job="${j.id}"`}>
    <div class="bt-thumb" ${bg} ${thumb}></div>
    <div class="bt-body"><div class="bt-title">${j.type === 'video' ? '🎬' : '🖼️'} ${esc(j.params.prompt)}</div><div class="bt-msg">${esc(j.msg)}</div>
      ${j.status === 'running' || j.status === 'queued' ? `<div class="progress"><div style="width:${Math.round(j.pct * 100)}%"></div></div>` : ''}</div>
    <span class="bt-pct">${j.status === 'done' ? '✓' : j.status === 'error' ? '✕' : Math.round(j.pct * 100) + '%'}</span></div>`;
}
function renderBatch(id) {
  const b = Batches.get(id);
  if (!b) { $('#bt-summary').textContent = 'Lot terminé — tout est dans la bibliothèque.'; $('#bt-list').innerHTML = ''; return; }
  const js = b.ids.map(i => Jobs.get(i)).filter(Boolean);
  const done = js.filter(j => j.status === 'done').length, err = js.filter(j => j.status === 'error').length;
  $('#bt-summary').textContent = `${done}/${js.length} prêtes${err ? ` · ${err} en échec` : ''} — ${js.filter(j => j.status === 'running').length} en cours`;
  $('#bt-bar').style.width = Math.round(100 * js.reduce((a, j) => a + j.pct, 0) / Math.max(1, js.length)) + '%';
  $('#bt-list').innerHTML = js.map(jobCard).join('') + (err ? `<button class="btn btn-ghost btn-lg" data-retry-batch="${id}">Relancer les échecs</button>` : '');
}

// ════════════════════════════════════════════════════════════════
// Écrans : accueil, résultat, bibliothèque, profil
// ════════════════════════════════════════════════════════════════
async function renderHome() {
  $$('[data-name]').forEach(e => e.textContent = Settings.get('name') || 'ma belle');
  renderHomeJobs();
  const items = (await DB.all().catch(() => [])).slice(0, 12);
  $('#recent').innerHTML = items.length ? items.map(it => `<button class="thumb" data-item="${it.id}">${it.type === 'image'
    ? `<img src="${itemUrl(it)}" alt="" loading="lazy">` : `<video src="${itemUrl(it)}#t=0.5" muted playsinline preload="metadata"></video><span class="badge-play">${icon('play')}</span>`}</button>`).join('')
    : Object.entries(STYLES).map(([k, s]) => `<button class="thumb" data-inspire="${k}" title="Inspiration ${s.label}"><img src="${s.img}" alt=""></button>`).join('');
}

async function renderItem(id) {
  const it = await DB.get(id).catch(() => null);
  if (!it) { $('#item-media').innerHTML = '<p class="empty">Création introuvable.</p>'; return; }
  const url = itemUrl(it);
  $('#item-title').textContent = it.type === 'image' ? 'Résultat - Image' : 'Détail vidéo';
  $('#item-media').innerHTML = it.type === 'image' ? `<img src="${url}" alt="">` : `<video src="${url}" controls playsinline loop autoplay></video>`;
  $('#item-prompt').textContent = it.prompt;
  $('#item-note').classList.toggle('hidden', !(it.notes && it.notes.length));
  $('#item-note').textContent = (it.notes || []).join(' · ');
  $('#item-fav').classList.toggle('on', !!it.fav);
  $('#item-params').innerHTML = `<h5 style="margin-bottom:2px">Paramètres</h5>` + paramRows([
    ['clock', 'Durée', it.duration ? it.duration + ' secondes' : ''], ['palette', 'Style', STYLES[it.style]?.label], ['people', 'Personnage', it.character],
    ['format', 'Format', it.format], ['hd', 'Qualité', it.type === 'image' ? (it.quality === 'ultra' ? 'Ultra HD' : 'HD') : '720p'],
    ['engine', 'Moteur', it.engine], ['history', 'Créée le', new Date(it.ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })]]);
  const act = $('#item-action');
  act.innerHTML = it.type === 'image' ? `Générer une vidéo avec cette image <svg width="16" height="16"><use href="#i-sparkle"/></svg>` : `Regénérer la vidéo <svg width="16" height="16"><use href="#i-redo"/></svg>`;
  act.onclick = () => {
    if (it.type === 'image') { setMode('vid', 'i2v'); setUpload('vid', it.blob); $('#vid-prompt').value = it.prompt; form.vidStyle = it.style || 'cinema'; renderStyles(); go('create-video'); }
    else startJob('video', { ...it.params, prompt: it.prompt });
  };
  $('#item-dl').onclick = () => {
    const a = document.createElement('a'); a.href = url; a.download = `eclat-ai-${it.type}-${it.ts}.${it.ext}`; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  };
  $('#item-share').onclick = async () => {
    try {
      if (it.blob && navigator.canShare) {
        const f = new File([it.blob], `eclat-ai.${it.ext}`, { type: it.blob.type });
        if (navigator.canShare({ files: [f] })) return await navigator.share({ files: [f], title: 'Éclat Ai' });
      }
      if (navigator.share && it.url) return await navigator.share({ url: it.url, title: 'Éclat Ai' });
      toast('Partage non disponible ici : utilise Télécharger', 'err');
    } catch (e) {}
  };
  $('#item-fav').onclick = async () => { it.fav = !it.fav; await DB.put(it); $('#item-fav').classList.toggle('on', it.fav); toast(it.fav ? '💖 Ajouté aux favoris' : 'Retiré des favoris'); };
  $('#item-more').onclick = async () => {
    const opts = [{ value: 'copy', label: 'Copier le prompt', icon: 'text' }, { value: 'reuse', label: 'Réutiliser ce prompt', icon: 'redo' }];
    if (it.type === 'image') opts.push({ value: 'char', label: 'Créer un personnage avec cette image', icon: 'people' });
    opts.push({ value: 'del', label: 'Supprimer', icon: 'trash' });
    const v = await sheet('Plus', opts);
    if (v === 'copy') { navigator.clipboard?.writeText(it.prompt); toast('Prompt copié'); }
    if (v === 'reuse') { const k = it.type === 'image' ? 'img' : 'vid'; $(`#${k}-prompt`).value = it.prompt; go(it.type === 'image' ? 'create-image' : 'create-video'); }
    if (v === 'char') { ce = { id: null, photos: [it.blob], name: '', desc: '' }; go('character', 'new'); }
    if (v === 'del' && confirm('Supprimer cette création ?')) { await DB.del(it.id); toast('Supprimée'); back(); }
  };
}

let libTab = 'image';
async function renderLibrary() {
  const q = norm($('#lib-search').value);
  const items = (await DB.all().catch(() => [])).filter(it => (libTab === 'fav' ? it.fav : it.type === libTab) && (!q || norm(it.prompt + ' ' + (it.character || '')).includes(q)));
  $('#lib-empty').classList.toggle('hidden', items.length > 0);
  $('#lib-grid').innerHTML = items.map(it => `<div class="tile" data-item="${it.id}">${it.type === 'image'
    ? `<img src="${itemUrl(it)}" alt="" loading="lazy">` : `<video src="${itemUrl(it)}#t=0.5" muted playsinline preload="metadata"></video><span class="kind">▶ ${it.duration || ''}s</span>`}
    <button class="fav ${it.fav ? 'on' : ''}" data-fav="${it.id}" aria-label="Favori"><svg fill="none"><use href="#i-heart"/></svg></button></div>`).join('');
}
function renderProfile() {
  $('[data-name-full]').textContent = (Settings.get('name') || 'ma belle') + ' · créations sur cet appareil';
  $('#ai-state').textContent = [serverBase() && 'Serveur', hasAgnes() && 'Agnes', hasQwen() && 'Qwen'].filter(Boolean).join(' + ') || 'Gratuit';
}
function renderSettings() {
  $('#set-key').value = Settings.get('agnesKey'); $('#set-server').value = Settings.get('serverUrl');
  $('#set-token').value = Settings.get('serverToken'); $('#set-patience').value = String(Settings.get('patience'));
  $('#set-hf').value = Settings.get('hfToken'); $('#set-imgengine').value = Settings.get('imgEngine');
}
function renderPrefs() {
  $('#pref-name').value = Settings.get('name'); $('#pref-format').value = Settings.get('format');
  $('#pref-music').value = Settings.get('music'); $('#pref-cinema').value = Settings.get('cinema') ? '1' : '0';
}

// ════════════════════════════════════════════════════════════════
// Personnages : liste + éditeur
// ════════════════════════════════════════════════════════════════
let ce = { id: null, photos: [], name: '', desc: '' };
const photoUrls = new WeakMap();
const blobUrl = b => { if (!photoUrls.has(b)) photoUrls.set(b, URL.createObjectURL(b)); return photoUrls.get(b); };

async function renderCharacters() {
  await loadChars();
  $('#ch-grid').innerHTML = charList.length ? charList.map(c => `<div class="ch-card" data-char="${c.id}">
      ${c.photos && c.photos[0] ? `<img src="${blobUrl(c.photos[0])}" alt="">` : ''}
      <div class="ch-name">${esc(c.name)}<small>${esc(c.description || '')}</small></div></div>`).join('')
    : `<p class="empty ch-empty">Aucun personnage pour l'instant. Crée le premier : importe une photo, prends-en une, cherche sur le web ou génère-le avec l'IA.</p>`;
}
async function renderCharacter(id) {
  if (id && id !== 'new' && ce.id !== id) {
    const c = await Chars.get(id); if (c) ce = { id: c.id, photos: [...(c.photos || [])], name: c.name, desc: c.description || '' };
  } else if (!id && ce.id) ce = { id: null, photos: [], name: '', desc: '' };
  $('#ce-title').textContent = ce.id ? ce.name || 'Personnage' : 'Nouveau personnage';
  $('#ce-name').value = ce.name; $('#ce-desc').value = ce.desc;
  $('#ce-del').classList.toggle('hidden', !ce.id); $('#ce-actions').classList.toggle('hidden', !ce.id);
  renderCePhotos();
}
function renderCePhotos() {
  $('#ce-photos').innerHTML = ce.photos.map((b, i) => `<div class="ph-item"><img src="${blobUrl(b)}" alt=""><button data-ce-rm="${i}" aria-label="Retirer">✕</button></div>`).join('')
    + (ce.photos.length < 4 ? `<button class="ph-add" id="ce-add" aria-label="Ajouter une photo">${icon('plus')}</button>` : '');
}
async function addCharacterPhoto() {
  const v = await sheet('Ajouter une photo', [
    { value: 'file', label: 'Importer une photo', icon: 'upload' }, { value: 'cam', label: 'Prendre une photo', icon: 'camera' },
    { value: 'lib', label: 'Depuis ma bibliothèque', icon: 'lib' }, { value: 'web', label: 'Chercher sur le web', icon: 'globe' },
    { value: 'ai', label: 'Générer avec l\'IA (depuis la description)', icon: 'sparkle' }]);
  let blob = null;
  if (v === 'file') blob = await pickFile();
  if (v === 'cam') blob = await pickFile({ capture: 'user' });
  if (v === 'lib') blob = await pickFromLibrary();
  if (v === 'web') blob = await pickFromWeb($('#ce-name').value || $('#ce-desc').value);
  if (v === 'ai') {
    const desc = $('#ce-desc').value.trim() || $('#ce-name').value.trim();
    if (!desc) return toast('Écris d\'abord une description ✍️', 'err');
    toast('L\'IA crée le portrait…');
    try {
      const r = await createImage({ prompt: `portrait photo of ${desc}, looking at camera, upper body, soft studio light, neutral background, high detail`, style: 'realiste', format: '9:16' });
      blob = r.blob;
    } catch (e) { return toast(e.message, 'err'); }
  }
  if (blob) { ce.photos.push(await shrinkImage(blob, 1344)); renderCePhotos(); }
}
async function pickFromLibrary() {
  const items = (await DB.all()).filter(i => i.type === 'image' && i.blob).slice(0, 60);
  if (!items.length) { toast('Ta bibliothèque ne contient pas encore d\'image'); return null; }
  return new Promise(resolve => {
    sheetHTML('Choisir dans ma bibliothèque', `<div class="web-imgs">${items.map((it, i) => `<div class="wi" data-pick-i="${i}"><img src="${itemUrl(it)}" alt=""></div>`).join('')}</div>`,
      (e, close) => { const t = e.target.closest('[data-pick-i]'); if (t) { close(); resolve(items[+t.dataset.pickI].blob); } });
  });
}
function pickFromWeb(q = '') {
  return new Promise(resolve => {
    let results = [];
    const s = sheetHTML('Photos libres du web (Wikimedia Commons)', `<label class="search">${icon('search')}<input id="wq" placeholder="Rechercher une photo…" value="${esc(q)}"></label>
      <p class="help" style="margin:0">Photos sous licence libre. Pour une vraie personne, utilise des photos dont tu as le droit.</p><div class="web-imgs" id="wr"></div>`,
      async (e, close) => {
        const t = e.target.closest('[data-wi]'); if (!t) return;
        try { toast('Téléchargement…'); const b = await fetchImageBlob(results[+t.dataset.wi].thumb); close(); resolve(b); }
        catch (err) { toast(err.message, 'err'); }
      });
    const run = async () => {
      const v = s.el.querySelector('#wq').value.trim(); if (!v) return;
      s.el.querySelector('#wr').innerHTML = '<p class="empty">Recherche…</p>';
      try { results = await searchImages(v, 12); s.el.querySelector('#wr').innerHTML = results.length ? results.map((r, i) => `<div class="wi" data-wi="${i}"><img src="${r.thumb}" alt="" loading="lazy"></div>`).join('') : '<p class="empty">Aucun résultat.</p>'; }
      catch (err) { s.el.querySelector('#wr').innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
    };
    s.el.querySelector('#wq').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    if (q) run(); else s.el.querySelector('#wq').focus();
  });
}
async function saveCharacter() {
  const name = $('#ce-name').value.trim(), desc = $('#ce-desc').value.trim();
  if (!name) return toast('Donne un prénom à ton personnage', 'err');
  if (!ce.photos.length && !desc) return toast('Ajoute une photo ou une description', 'err');
  const c = { id: ce.id || uid(), name, description: desc, photos: ce.photos, ts: Date.now() };
  await Chars.put(c); ce = { ...ce, id: c.id, name, desc }; await loadChars();
  toast(`👑 ${name} est enregistré(e)`); renderCharacter(c.id);
}
async function autoDescribe() {
  if (!ce.photos.length) return toast('Ajoute d\'abord une photo', 'err');
  if (!hasAgnes()) return toast('La description automatique utilise ta clé Agnes', 'err');
  const btn = $('#ce-auto'); btn.classList.add('busy');
  try {
    const img = await blobToDataURL(await shrinkImage(ce.photos[0], 768));
    const d = await agnesFetch('/v1/chat/completions', { model: 'agnes-3.0-flash', max_tokens: 200, messages: [{ role: 'user', content: [
      { type: 'text', text: 'Décris l\'apparence physique de cette personne pour qu\'une IA la redessine à l\'identique : âge approximatif, cheveux, yeux, teint, traits, style vestimentaire. Une seule phrase, sans préambule.' },
      { type: 'image_url', image_url: { url: img } }] }] });
    $('#ce-desc').value = (d.choices[0].message.content || '').trim();
  } catch (e) { toast(e.message, 'err'); }
  btn.classList.remove('busy');
}

// ════════════════════════════════════════════════════════════════
// Studio en lot : jusqu'à 30 créations, chacune son prompt, en parallèle
// ════════════════════════════════════════════════════════════════
let studio = [];
try { studio = JSON.parse(localStorage.getItem('eclat_studio') || '[]'); } catch (e) {}
const saveStudio = () => { try { localStorage.setItem('eclat_studio', JSON.stringify(studio)); } catch (e) {} };
const newRow = (o = {}) => ({ id: uid(), type: 'image', prompt: '', style: 'cinema', char: '', duration: 10, ...o });

function parseLine(line) {
  let type = 'image', text = line.trim();
  const m = text.match(/^(vid[ée]o|image|img)\s*[:\-–]\s*/i);
  if (m) { type = /vid/i.test(m[1]) ? 'video' : 'image'; text = text.slice(m[0].length); }
  let char = '';
  text = text.replace(/@([\p{L}\p{N}_-]+)/gu, (all, name) => { const c = charByName(name); if (c) { char = c.id; return c.name; } return all; });
  return newRow({ type, prompt: text.trim(), char });
}
function renderStudio() {
  const styleOpts = k => Object.entries(STYLES).map(([v, s]) => `<option value="${v}" ${v === k ? 'selected' : ''}>${s.label}</option>`).join('');
  const charOpts = id => `<option value="">Sans personnage</option>` + charList.map(c => `<option value="${c.id}" ${c.id === id ? 'selected' : ''}>👑 ${esc(c.name)}</option>`).join('');
  $('#st-rows').innerHTML = studio.length ? studio.map((r, i) => `<div class="card st-row" data-row="${r.id}">
    <div class="st-head"><span class="st-num">${i + 1}</span>
      <div class="mini-seg"><button data-rt="image" class="${r.type === 'image' ? 'on' : ''}">🖼️ Image</button><button data-rt="video" class="${r.type === 'video' ? 'on' : ''}">🎬 Vidéo</button></div>
      <button class="del" data-rdel aria-label="Retirer">${icon('trash')}</button></div>
    <textarea data-rf="prompt" placeholder="Décris cette création…">${esc(r.prompt)}</textarea>
    <div class="st-opts"><select data-rf="style">${styleOpts(r.style)}</select><select data-rf="char">${charOpts(r.char)}</select>
      ${r.type === 'video' ? `<select data-rf="duration">${[5, 10, 15, 30].map(d => `<option value="${d}" ${d === r.duration ? 'selected' : ''}>${d} s</option>`).join('')}</select>` : ''}</div>
  </div>`).join('') : `<p class="empty">Ajoute des créations ci-dessus ou avec le bouton ＋.</p>`;
  const nI = studio.filter(r => r.type === 'image').length, nV = studio.length - nI;
  $('#st-count').textContent = `${studio.length}/${MAX_BATCH}` + (studio.length ? ` · ${nI} image${nI > 1 ? 's' : ''}, ${nV} vidéo${nV > 1 ? 's' : ''}` : '');
  $('#st-go').disabled = !studio.length;
  $('#st-add').disabled = studio.length >= MAX_BATCH;
}
function addRows(rows) {
  const room = MAX_BATCH - studio.length;
  if (rows.length > room) toast(`Maximum ${MAX_BATCH} créations par lot : ${rows.length - room} ignorée(s)`, 'err');
  studio.push(...rows.slice(0, Math.max(0, room))); saveStudio(); renderStudio();
}
async function studioIdeas() {
  if (!hasAgnes()) return toast('Les idées par l\'IA utilisent ta clé Agnes', 'err');
  const theme = $('#st-paste').value.trim();
  if (!theme) return toast('Écris un thème dans « Ajouter vite » (ex : collection été à Saint-Tropez)', 'err');
  const n = await sheet('Combien d\'idées ?', [5, 10, 20, 30].map(v => ({ value: v, label: `${v} idées` })));
  if (!n) return;
  const btn = $('#st-ideas'); btn.disabled = true; btn.textContent = '✨ L\'IA réfléchit…';
  try {
    const out = await agnesChat([{ role: 'system', content: 'Tu crées des listes de prompts pour un générateur d\'images et de vidéos. Réponds uniquement par la liste, une idée par ligne, sans numérotation. Chaque ligne : une description visuelle riche en français (20 à 40 mots). Préfixe environ un tiers des lignes par « vidéo: » quand une scène en mouvement s\'y prête. Garde les @Prénom fournis. Contenu élégant, jamais explicite.' },
      { role: 'user', content: `Thème : ${theme}\nNombre d'idées : ${n}` }]);
    const rows = out.split('\n').map(l => l.replace(/^\s*(\d+[\.\)]|[-*•])\s*/, '').trim()).filter(l => l.length > 8).slice(0, n).map(parseLine);
    $('#st-paste').value = ''; addRows(rows); toast(`✨ ${rows.length} idées ajoutées`);
  } catch (e) { toast(e.message, 'err'); }
  btn.disabled = false; btn.textContent = '✨ Idées par l\'IA';
}
function studioGo() {
  const rows = studio.filter(r => r.prompt.trim().length >= 3);
  if (!rows.length) return toast('Écris au moins un prompt', 'err');
  if (rows.some(r => r.type === 'video') && !pickMime()) return toast('Ce navigateur ne peut pas enregistrer de vidéo : essaie Chrome ou Safari récent', 'err');
  const b = newBatch('Studio');
  rows.forEach(r => startJob(r.type, r.type === 'image'
    ? { prompt: r.prompt, style: r.style, format: form['st-format'], quality: 'hd', characterId: r.char || null }
    : { prompt: r.prompt, style: r.style, format: form['st-format'], duration: r.duration, engine: 'auto', music: Settings.get('music'),
        transition: 'mix', cinema: !!Settings.get('cinema'), characterId: r.char || null }, { navigate: false, batch: b }));
  go('batch', b);
}

// ════════════════════════════════════════════════════════════════
// Agent IA connecté au web (outils Agnes : recherche, lecture, photos, créations, personnages)
// ════════════════════════════════════════════════════════════════
const AGENT_SYSTEM = () => `Tu es Éclat, l'agent IA créatif de l'application Éclat Ai. Nous sommes le ${new Date().toLocaleDateString('fr-FR', { dateStyle: 'full' })}.
Tu tutoies l'utilisatrice, ton ton est chaleureux, élégant et un peu glamour (emoji avec parcimonie : 💖 ✨ 👑). Tu réponds en français, de façon concise.
Tu as de vrais outils :
- web_search : chercher sur internet (actualité, tendances, lieux, mode, infos récentes). Utilise-le dès qu'une info peut être récente ou que tu n'es pas sûre. Requête simple, en français de préférence, sans guillemets ni « site: ». En général UNE recherche suffit. Cite les sources avec leurs liens.
- read_webpage : lire une page web précise, UNIQUEMENT un lien présent dans les résultats de recherche ou donné par l'utilisatrice (jamais un lien deviné). Au plus 2 pages par demande. Tu peux appeler plusieurs outils en même temps.
- search_images : trouver des photos libres sur le web (Wikimedia Commons) ; elles s'affichent dans le chat et peuvent servir de référence (« web:N »).
- create_images / create_videos : lancer de vraies créations (jusqu'à 30 à la fois, chacune avec son propre prompt). Écris des prompts détaillés en anglais (sujet, tenue, décor, lumière, ambiance, cadrage ; pour une vidéo : action et mouvement de caméra). Lance directement quand la demande est claire.
- list_characters / save_character : personnages de référence de l'utilisatrice (même visage d'une création à l'autre). Pour utiliser un personnage, passe son nom dans "character".
Les photos envoyées par l'utilisatrice sont nommées « photo:N » ; tu peux les voir. RÈGLE : dès qu'on te demande de transformer, modifier, styliser, animer ou t'inspirer d'une photo (envoyée « photo:N » ou trouvée sur le web « web:N »), passe OBLIGATOIREMENT cette référence dans le champ "reference" de create_images / create_videos (choisis la photo web la plus adaptée).
Après une création, dis brièvement ce qui est lancé (les résultats s'affichent tout seuls). N'invente jamais de lien ni de fait : vérifie avec les outils.
Contenu toujours élégant : jamais de nudité ni de contenu explicite, pas de deepfake d'une personne réelle sans son accord.`;

const STYLE_KEYS = Object.keys(STYLES);
const TOOLS = [
  { type: 'function', function: { name: 'web_search', description: 'Recherche sur internet (résultats web + Wikipédia).', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'read_webpage', description: 'Lit le contenu texte d\'une page web.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'search_images', description: 'Cherche des photos libres de droits sur le web (Wikimedia Commons). Les résultats sont affichés et référencés web:N.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'mots-clés, de préférence en anglais' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'create_images', description: 'Crée une ou plusieurs images en parallèle (30 max au total).', parameters: { type: 'object', properties: { items: { type: 'array', maxItems: 30, items: { type: 'object', properties: {
    prompt: { type: 'string', description: 'prompt détaillé en anglais' }, style: { type: 'string', enum: STYLE_KEYS }, character: { type: 'string', description: 'nom d\'un personnage enregistré' },
    reference: { type: 'string', description: 'image de référence : photo:N ou web:N' }, count: { type: 'integer', minimum: 1, maximum: 30 }, format: { type: 'string', enum: Object.keys(FORMATS) } }, required: ['prompt'] } } }, required: ['items'] } } },
  { type: 'function', function: { name: 'create_videos', description: 'Crée une ou plusieurs vidéos en parallèle (30 max).', parameters: { type: 'object', properties: { items: { type: 'array', maxItems: 30, items: { type: 'object', properties: {
    prompt: { type: 'string', description: 'prompt détaillé en anglais avec action et mouvement de caméra' }, duration: { type: 'integer', enum: [5, 10, 15, 30] }, style: { type: 'string', enum: STYLE_KEYS },
    character: { type: 'string' }, reference: { type: 'string', description: 'image de départ : photo:N ou web:N' }, format: { type: 'string', enum: Object.keys(FORMATS) } }, required: ['prompt'] } } }, required: ['items'] } } },
  { type: 'function', function: { name: 'list_characters', description: 'Liste les personnages de référence enregistrés.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'save_character', description: 'Enregistre un personnage de référence (avec une photo de référence, ou un portrait généré par l\'IA).', parameters: { type: 'object', properties: {
    name: { type: 'string' }, description: { type: 'string', description: 'apparence physique détaillée' }, reference: { type: 'string', description: 'photo:N ou web:N' }, generate_portrait: { type: 'boolean' } }, required: ['name', 'description'] } } },
];

let chat = { view: [], api: [] };
try { const c = JSON.parse(localStorage.getItem('eclat_chat2') || 'null'); if (c && c.view) chat = c; } catch (e) {}
const attachments = new Map();   // photo:N → Blob (session)
let webImgs = [];                // web:N → {thumb,…} (dernières recherches)
let pendingPhoto = null, chatBusy = false;

function saveChat() {
  const api = chat.api.slice(-40); while (api.length && api[0].role !== 'user') api.shift();
  const light = api.map(m => m.role === 'tool' ? { ...m, content: String(m.content).slice(0, 2500) }
    : Array.isArray(m.content) ? { ...m, content: m.content.filter(p => p.type === 'text').map(p => p.text).join(' ') } : m);
  try { localStorage.setItem('eclat_chat2', JSON.stringify({ view: chat.view.slice(-80), api: light, webImgs: webImgs.slice(-30) })); } catch (e) {}
}
try { webImgs = JSON.parse(localStorage.getItem('eclat_chat2') || '{}').webImgs || []; } catch (e) {}

function md(text) {   // mini-markdown : liens, gras, retours à la ligne
  let h = esc(text);
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return h;
}
const AV = '<img class="avatar" src="assets/splash.jpg" alt="">';

function renderChat() {
  let html = `<div class="msg bot">${AV}<div class="bubble">${esc(hasAgnes()
    ? `Salut, je suis Éclat Ai 💖\nJe suis ton agent IA connecté au web : je peux chercher des infos et des photos sur internet, lire des pages, créer des images et des vidéos (jusqu'à 30 d'un coup) et utiliser tes personnages.\nQue veux-tu faire ?`
    : `Salut, je suis Éclat Ai 💖\nPour discuter avec moi et utiliser le web, ajoute ta clé Agnes dans Profil → Paramètres de l'IA.\nEn attendant, décris-moi ce que tu veux : je peux le créer directement.`)}</div></div>
    <div class="quick">
      <button data-quick="Quelles sont les tendances mode du moment ? Cherche sur le web et propose-moi 3 images.">${icon('globe')}Tendances du web</button>
      <button data-quick="Crée 4 images différentes d'une même femme élégante dans 4 villes du monde.">${icon('grid')}4 images d'un coup</button>
      <button data-quick="Je veux créer une vidéo">${icon('video')}Créer une vidéo</button>
      <button data-go="characters">${icon('people')}Mes personnages</button>
    </div>`;
  for (const v of chat.view) {
    if (v.k === 'user') html += `<div class="msg me"><div class="bubble">${v.photo ? `<img src="${v.photo}" alt="">` : ''}${esc(v.text)}</div></div>`;
    else if (v.k === 'bot') html += `<div class="msg bot">${AV}<div class="bubble">${md(v.text)}</div></div>`;
    else if (v.k === 'tool') html += `<div class="tool-line">${icon(v.icon || 'globe')}${esc(v.text)}</div>`;
    else if (v.k === 'web') html += `<div class="web-results">${v.results.slice(0, 5).map(r => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}<small>${esc(r.url)}</small></a>`).join('')}</div>`;
    else if (v.k === 'imgs') html += `<div class="web-imgs">${v.images.map(im => `<div class="wi" data-webimg="${esc(im.ref)}"><img src="${esc(im.thumb)}" alt="" loading="lazy"><span>${esc(im.ref)}</span></div>`).join('')}</div>`;
    else if (v.k === 'jobs') html += `<div class="chat-jobs">${v.ids.map(id => { const j = Jobs.get(id); if (j) return jobCard(j);
      const itemId = v.done && v.done[id]; return itemId ? `<div class="card bt-item" data-item="${itemId}"><div class="bt-thumb" data-thumb-item="${itemId}"></div><div class="bt-body"><div class="bt-title">✨ Création terminée</div><div class="bt-msg">Touche pour voir</div></div><span class="bt-pct">✓</span></div>` : ''; }).join('')}</div>`;
    else if (v.k === 'offer') html += `<div class="proposal"><div class="pv"></div><button class="btn btn-pink btn-sm go" data-offer='${esc(JSON.stringify({ kind: v.kind, prompt: v.prompt }))}'>${v.kind === 'video' ? 'Générer la vidéo' : 'Générer l\'image'}</button></div>`;
  }
  if (chatBusy) html += `<div class="msg bot">${AV}<div class="bubble typing"><span></span><span></span><span></span></div></div>`;
  $('#chat').innerHTML = html;
  fillThumbs($('#chat'));
  requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
}
async function fillThumbs(root) {
  for (const el of root.querySelectorAll('[data-thumb-item]')) {
    const it = await DB.get(el.dataset.thumbItem).catch(() => null); if (!it) continue;
    el.innerHTML = it.type === 'image' ? `<img src="${itemUrl(it)}" alt="">` : `<video src="${itemUrl(it)}#t=0.5" muted playsinline preload="metadata"></video>`;
  }
}

async function resolveRef(ref) {
  if (!ref) return null;
  const r = String(ref).trim().toLowerCase();
  if (r.startsWith('photo:')) return attachments.get(r) || null;
  if (r.startsWith('web:')) { const w = webImgs.find(x => x.ref === r); return w ? fetchImageBlob(w.thumb).catch(() => null) : null; }
  return null;
}

async function runTool(name, args, ctx) {
  switch (name) {
    case 'web_search': {
      chat.view.push({ k: 'tool', icon: 'search', text: `Recherche web : « ${args.query} »` }); renderChat();
      const r = await webSearch(args.query);
      if (r.results.length) chat.view.push({ k: 'web', results: r.results });
      return { results: r.results.slice(0, 8), wikipedia: r.wikipedia.slice(0, 3), raw: r.raw ? r.raw.slice(0, 2500) : undefined };
    }
    case 'read_webpage': {
      chat.view.push({ k: 'tool', icon: 'globe', text: `Lecture : ${args.url}` }); renderChat();
      return { url: args.url, content: await readPage(args.url) };
    }
    case 'search_images': {
      chat.view.push({ k: 'tool', icon: 'image', text: `Photos du web : « ${args.query} »` }); renderChat();
      const imgs = await searchImages(args.query, 6);
      const base = webImgs.length;
      const list = imgs.map((im, i) => ({ ref: `web:${base + i + 1}`, thumb: im.thumb, title: im.title, license: im.license, author: im.author, page: im.url }));
      webImgs.push(...list);
      if (list.length) chat.view.push({ k: 'imgs', images: list });
      return { images: list.map(({ ref, title, license, author, page }) => ({ ref, title, license, author, page })) };
    }
    case 'create_images': case 'create_videos': {
      const type = name === 'create_images' ? 'image' : 'video';
      const items = (args.items || []).slice(0, MAX_BATCH);
      const expanded = [];
      for (const it of items) for (let k = 0; k < Math.min(MAX_BATCH, it.count || 1); k++) expanded.push(it);
      const list = expanded.slice(0, MAX_BATCH);
      const ids = [], unknown = [];
      for (const it of list) {
        const ch = it.character ? charByName(it.character) : null;
        if (it.character && !ch) unknown.push(it.character);
        const image = await resolveRef(it.reference);
        const params = type === 'image'
          ? { prompt: it.prompt, style: STYLES[it.style] ? it.style : 'cinema', format: it.format || Settings.get('format'), quality: 'hd', characterId: ch ? ch.id : null, image }
          : { prompt: it.prompt, style: STYLES[it.style] ? it.style : 'cinema', format: it.format || Settings.get('format'), duration: [5, 10, 15, 30].includes(it.duration) ? it.duration : 10,
              engine: 'auto', music: Settings.get('music'), transition: 'mix', cinema: !!Settings.get('cinema'), characterId: ch ? ch.id : null, image };
        const job = startJob(type, params, { navigate: false, batch: ctx.batch() });
        job.chat = true; ids.push(job.id);
      }
      const entry = { k: 'jobs', ids, done: {} }; chat.view.push(entry); ctx.jobEntries.push(entry);
      return { started: ids.length, type, note: 'Les créations tournent en parallèle et s\'affichent dans le chat.', unknown_characters: unknown.length ? unknown : undefined };
    }
    case 'list_characters':
      await loadChars();
      return { characters: charList.map(c => ({ name: c.name, description: c.description, photos: (c.photos || []).length })) };
    case 'save_character': {
      let photo = await resolveRef(args.reference);
      if (!photo && args.generate_portrait) {
        chat.view.push({ k: 'tool', icon: 'sparkle', text: `Portrait de ${args.name} en cours…` }); renderChat();
        photo = (await createImage({ prompt: `portrait photo of ${args.description}, looking at camera, upper body, soft studio light, neutral background`, style: 'realiste', format: '9:16' })).blob;
      }
      const c = { id: uid(), name: args.name, description: args.description || '', photos: photo ? [await shrinkImage(photo, 1344)] : [], ts: Date.now() };
      await Chars.put(c); await loadChars();
      chat.view.push({ k: 'tool', icon: 'people', text: `Personnage enregistré : ${c.name}` });
      return { saved: c.name, with_photo: !!photo };
    }
  }
  return { error: 'outil inconnu' };
}

async function sendChat(text) {
  text = (text || '').trim();
  if ((!text && !pendingPhoto) || chatBusy) return;
  let photoRef = null, thumb = null, dataUrl = null;
  if (pendingPhoto) {
    photoRef = `photo:${attachments.size + 1}`; attachments.set(photoRef, pendingPhoto);
    thumb = await blobToDataURL(await shrinkImage(pendingPhoto, 320)); dataUrl = await blobToDataURL(await shrinkImage(pendingPhoto, 768));
    pendingPhoto = null; $('#chat-attach-pv').classList.add('hidden');
  }
  chat.view.push({ k: 'user', text: text || '(photo)', photo: thumb });
  if (!hasAgnes()) {
    const isImg = /image|photo|portrait/i.test(text) && !/vid[ée]o/i.test(text);
    chat.view.push({ k: 'bot', text: 'Je peux le créer pour toi tout de suite ✨ (ajoute une clé Agnes pour discuter et chercher sur le web).' });
    chat.view.push({ k: 'offer', kind: isImg ? 'image' : 'video', prompt: text });
    saveChat(); renderChat(); return;
  }
  const userText = text + (photoRef ? `\n[photo jointe : ${photoRef}]` : '');
  chat.api.push({ role: 'user', content: dataUrl ? [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: dataUrl } }] : userText });
  chatBusy = true; renderChat();
  let batchId = null;
  const ctx = { jobEntries: [], batch: () => batchId || (batchId = newBatch('Agent')) };
  try {
    for (let step = 0; step < 7; step++) {
      // Contexte : les ~10 derniers échanges (on coupe toujours au début d'un message utilisateur)
      let start = 0, users = 0;
      for (let i = chat.api.length - 1; i >= 0; i--) if (chat.api[i].role === 'user' && ++users === 10) { start = i; break; }
      const m = await agnesChatTools([{ role: 'system', content: AGENT_SYSTEM() }, ...chat.api.slice(start)], TOOLS);
      const calls = (m.tool_calls || []).filter(c => c.function && c.function.name);
      chat.api.push({ role: 'assistant', content: m.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
      const say = (m.content || '').trim();
      if (say) chat.view.push({ k: 'bot', text: say });
      if (!calls.length) break;
      // Les outils demandés dans la même étape tournent en parallèle
      const results = await Promise.all(calls.map(async c => {
        let args = {}; try { args = JSON.parse(c.function.arguments || '{}'); } catch (e) {}
        try { return await runTool(c.function.name, args, ctx); }
        catch (e) { chat.view.push({ k: 'tool', icon: 'help', text: `${c.function.name} : ${e.message}` }); return { error: e.message }; }
      }));
      calls.forEach((c, i) => chat.api.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(results[i]).slice(0, 7000) }));
      renderChat();
      if (step === 6) chat.view.push({ k: 'bot', text: 'J\'ai fait le maximum d\'étapes pour cette demande ✨ Dis-moi si je continue.' });
    }
  } catch (e) {
    chat.view.push({ k: 'bot', text: `Oups, je n'arrive pas à joindre l'IA (${e.message}). Réessaie dans un instant 💖` });
    if (chat.api.length && chat.api[chat.api.length - 1].role === 'user') chat.api.pop();
  }
  chatBusy = false; saveChat(); renderChat();
  // Quand les créations lancées par l'agent sont finies : on garde le lien vers le résultat
  ctx.jobEntries.forEach(entry => entry.ids.forEach(id => {
    const watch = setInterval(() => { const j = Jobs.get(id); if (!j || j.status === 'running' || j.status === 'queued') return;
      clearInterval(watch); if (j.result) { entry.done[id] = j.result; saveChat(); } }, 1500);
  }));
}

async function webImageAction(ref) {
  const w = webImgs.find(x => x.ref === ref); if (!w) return;
  const v = await sheet(w.title || ref, [{ value: 'char', label: 'Créer un personnage avec cette photo', icon: 'people' }, { value: 'i2i', label: 'Transformer cette image', icon: 'image' },
    { value: 'i2v', label: 'Animer cette image', icon: 'video' }, { value: 'open', label: 'Voir la source', icon: 'globe' }]);
  if (!v) return;
  if (v === 'open') return window.open(w.page || w.thumb, '_blank', 'noopener');
  try {
    const blob = await fetchImageBlob(w.thumb);
    if (v === 'char') { ce = { id: null, photos: [await shrinkImage(blob, 1344)], name: '', desc: '' }; go('character', 'new'); }
    if (v === 'i2i') { setMode('img', 'i2i'); setUpload('img', blob); go('create-image'); }
    if (v === 'i2v') { setMode('vid', 'i2v'); setUpload('vid', blob); go('create-video'); }
  } catch (e) { toast(e.message, 'err'); }
}

// ════════════════════════════════════════════════════════════════
// Open source : projets qui renforcent l'app (vérifiés, liens officiels)
// ════════════════════════════════════════════════════════════════
const OPEN_SOURCE = [
  ['Déjà utilisés dans Éclat Ai', [
    ['Jina Reader', 'https://github.com/jina-ai/reader', 'Lit n\'importe quelle page web pour l\'Agent IA (recherche et lecture).', true],
    ['Wikimedia Commons / Wikipédia', 'https://commons.wikimedia.org', 'Photos libres et connaissances pour l\'Agent IA.', true],
    ['LTX-Video (Lightricks)', 'https://github.com/Lightricks/LTX-Video', 'Modèle vidéo rapide utilisé par le serveur GPU gratuit (notebook Colab/Kaggle).', true],
    ['Wan 2.x (Alibaba)', 'https://github.com/Wan-Video/Wan2.2', 'Modèle vidéo de haute qualité (Apache 2.0), option du serveur GPU.', true],
    ['Pollinations', 'https://github.com/pollinations/pollinations', 'Images gratuites sans clé (secours).', true],
    ['Qwen-Image / Qwen-Image-Edit (Alibaba)', 'https://huggingface.co/spaces/Qwen/Qwen-Image-2512', 'Images et retouches open source (Apache 2.0) sur les GPU gratuits de Hugging Face.', true],
    ['wsrv.nl', 'https://github.com/weserv/images', 'Proxy d\'images open source pour récupérer les photos du web.', true]]],
  ['Vidéo IA à faire tourner gratuitement (Colab / Kaggle / PC)', [
    ['FramePack', 'https://github.com/lllyasviel/FramePack', 'Anime une image en vidéo longue même avec 6 Go de VRAM : idéal pour « Image → Vidéo ».'],
    ['HunyuanVideo (Tencent)', 'https://github.com/Tencent/HunyuanVideo', 'Vidéos très réalistes ; demande un gros GPU.'],
    ['CogVideoX', 'https://github.com/THUDM/CogVideoX', 'Alternative open source texte/image → vidéo.'],
    ['ComfyUI', 'https://github.com/comfyanonymous/ComfyUI', 'Atelier visuel qui fait tourner tous ces modèles (et les enchaîne).']]],
  ['Même visage partout (personnages)', [
    ['PuLID', 'https://github.com/ToTheBeginning/PuLID', 'Garde l\'identité d\'un visage à partir d\'une seule photo.'],
    ['InstantID', 'https://github.com/instantX-research/InstantID', 'Identité constante en une photo, sans entraînement.']]],
  ['Qualité & finition', [
    ['Real-ESRGAN', 'https://github.com/xinntao/Real-ESRGAN', 'Agrandit et rend plus nettes images et vidéos.'],
    ['RIFE', 'https://github.com/hzwer/ECCV2022-RIFE', 'Ajoute des images intermédiaires : vidéos plus fluides (60 i/s).'],
    ['ffmpeg.wasm', 'https://github.com/ffmpegwasm/ffmpeg.wasm', 'Montage, conversion MP4 et assemblage de clips directement dans le navigateur.']]],
  ['IA dans le navigateur (gratuit, illimité, hors ligne)', [
    ['WebLLM', 'https://github.com/mlc-ai/web-llm', 'Fait tourner un modèle de chat dans le navigateur (WebGPU), sans serveur ni clé.'],
    ['Transformers.js', 'https://github.com/huggingface/transformers.js', 'Détourage, reconnaissance vocale, vision… directement sur le téléphone.']]],
  ['Recherche web auto-hébergée', [
    ['SearXNG', 'https://github.com/searxng/searxng', 'Ton propre moteur de recherche sans pub ni limite pour l\'Agent IA.']]],
];
function renderOpenSource() {
  $('#os-list').innerHTML = `<p class="help" style="margin:-4px 0 6px">Projets open source qui peuvent rendre l'app encore plus forte. Ceux marqués « utilisé » sont déjà branchés.</p>` +
    OPEN_SOURCE.map(([cat, items]) => `<div class="os-cat">${esc(cat)}</div>` + items.map(([n, u, d, used]) =>
      `<a class="card os-item" href="${u}" target="_blank" rel="noopener"><b>${esc(n)}</b>${used ? '<span class="tag used">utilisé</span>' : ''}<p>${esc(d)}</p><small>${esc(u)}</small></a>`).join('')).join('');
}

// ════════════════════════════════════════════════════════════════
// Actions
// ════════════════════════════════════════════════════════════════
async function enhance(btn) {
  const ta = $('#' + btn.dataset.enhance), txt = ta.value.trim();
  if (!txt) return toast('Écris d\'abord une idée ✍️');
  if (!hasAgnes()) return toast('L\'amélioration utilise l\'IA Agnes : ajoute ta clé dans Profil', 'err');
  btn.classList.add('busy');
  try {
    const out = await agnesChat([{ role: 'system', content: 'Tu réécris des idées en prompts de génération d\'images/vidéos. Réponds uniquement par le prompt, en français, 40 à 70 mots, riche en détails visuels (sujet, tenue, décor, lumière, ambiance, cadrage). Contenu élégant, jamais explicite.' },
      { role: 'user', content: txt }]);
    ta.value = out.replace(/^["«\s]+|["»\s]+$/g, '');
  } catch (e) { toast(e.message, 'err'); }
  btn.classList.remove('busy');
}

function createImageNow() {
  const prompt = $('#img-prompt').value.trim();
  if (prompt.length < 3) return toast('Décris ton image ✍️', 'err');
  if (form.imgMode === 'i2i' && !form.imgUpload) return toast('Choisis d\'abord une photo', 'err');
  const params = { prompt, style: form.imgStyle, format: form['img-format'], quality: form['img-quality'], engine: form['img-engine'], characterId: form['img-char'] || null,
    image: form.imgMode === 'i2i' ? form.imgUpload : null };
  const n = form['img-count'];
  if (n === 1) return startJob('image', params);
  const b = newBatch('Images');
  for (let i = 0; i < n; i++) startJob('image', params, { navigate: false, batch: b });
  go('batch', b);
}
function createVideoNow() {
  const prompt = $('#vid-prompt').value.trim();
  if (prompt.length < 3) return toast('Décris ta vidéo ✍️', 'err');
  if (form.vidMode === 'i2v' && !form.vidUpload) return toast('Choisis d\'abord une image', 'err');
  if (!pickMime() && form['vid-engine'] !== 'ai') return toast('Ce navigateur ne peut pas enregistrer de vidéo : essaie Chrome ou Safari récent', 'err');
  const params = { prompt, style: form.vidStyle, format: form['vid-format'], duration: form.vidDuration, engine: form['vid-engine'],
    music: form['vid-music'], transition: form['vid-transition'], caption: $('#vid-caption').value.trim(), cinema: !!Settings.get('cinema'),
    characterId: form['vid-char'] || null, image: form.vidMode === 'i2v' ? form.vidUpload : null };
  const n = form['vid-count'];
  if (n === 1) return startJob('video', params);
  const b = newBatch('Vidéos');
  for (let i = 0; i < n; i++) startJob('video', params, { navigate: false, batch: b });
  go('batch', b);
}

async function saveSettings() {
  Settings.set('agnesKey', $('#set-key').value.trim()); Settings.set('serverUrl', $('#set-server').value.trim());
  Settings.set('serverToken', $('#set-token').value.trim()); Settings.set('patience', +$('#set-patience').value);
  Settings.set('hfToken', $('#set-hf').value.trim()); Settings.set('imgEngine', $('#set-imgengine').value); form['img-engine'] = Settings.get('imgEngine'); refreshPicks();
  const st = $('#set-status'); st.className = 'status-line'; st.textContent = 'Test en cours…';
  const out = []; let ok = true;
  if (hasAgnes()) {
    try { await agnesChat([{ role: 'user', content: 'Réponds juste: OK' }]); out.push('✓ Clé Agnes valide'); }
    catch (e) { ok = false; out.push('✕ Agnes : ' + e.message); }
  } else out.push('Pas de clé Agnes : mode gratuit Pollinations');
  if (hasQwen()) {
    try {
      const r = await fetchWithTimeout('https://huggingface.co/api/whoami-v2', 15000, { headers: { Authorization: 'Bearer ' + Settings.get('hfToken').trim() } });
      if (!r.ok) throw new Error('token refusé');
      const d = await r.json(); out.push(`✓ Hugging Face : ${d.name}`);
    } catch (e) { ok = false; out.push('✕ Hugging Face : ' + e.message); }
  }
  if (serverBase()) {
    try { const d = await checkServer(); out.push(`✓ Serveur connecté (${d.backends.join(' → ') || 'aucun moteur'})`); }
    catch (e) { ok = false; out.push('✕ Serveur : ' + (e.name === 'AbortError' ? 'délai dépassé' : e.message)); }
  }
  st.className = 'status-line ' + (ok ? 'ok' : 'err'); st.textContent = out.join(' · ');
}

// ════════════════════════════════════════════════════════════════
// Démarrage & événements
// ════════════════════════════════════════════════════════════════
const RENDER = { home: renderHome, agent: renderChat, job: renderJob, batch: renderBatch, item: renderItem, library: renderLibrary,
  profile: renderProfile, settings: renderSettings, prefs: renderPrefs, characters: renderCharacters, character: renderCharacter,
  studio: () => { loadChars().then(renderStudio); refreshPicks(); }, opensource: renderOpenSource,
  'create-image': () => loadChars(), 'create-video': () => loadChars() };

document.addEventListener('click', async e => {
  const t = e.target.closest('button,[data-item],[data-go],[data-char],[data-webimg],[data-job],.upload');
  if (!t || t.closest('.sheet-bg')) return;
  if (t.dataset.go) { if (t.dataset.go === 'character') ce = { id: null, photos: [], name: '', desc: '' }; return go(t.dataset.go, t.dataset.go === 'character' ? 'new' : undefined); }
  if (t.hasAttribute('data-back')) return back();
  if (t.dataset.tab) {
    if (t.dataset.tab !== 'create') return go(t.dataset.tab);
    const v = await sheet('Que veux-tu créer ?', [{ value: 'create-image', label: 'Une image', icon: 'image' }, { value: 'create-video', label: 'Une vidéo', icon: 'video' },
      { value: 'studio', label: 'Studio en lot (jusqu\'à 30)', sub: 'images et vidéos, chacune son prompt', icon: 'grid' }, { value: 'characters', label: 'Mes personnages', icon: 'people' },
      ...[...Jobs.values()].filter(j => j.status === 'running' || j.status === 'queued').slice(0, 5).map(j => ({ value: 'job/' + j.id, label: `En cours : ${j.type} ${Math.round(j.pct * 100)}%`, icon: 'clock' }))]);
    if (v) { const [s, p] = v.split('/'); go(s, p); }
    return;
  }
  if (t.dataset.fav) { e.stopPropagation(); const it = await DB.get(t.dataset.fav); it.fav = !it.fav; await DB.put(it); t.classList.toggle('on', it.fav); return; }
  if (t.dataset.item) return go('item', t.dataset.item);
  if (t.dataset.job) return go('job', t.dataset.job);
  if (t.dataset.gob) return go('batch', t.dataset.gob);
  if (t.dataset.char) { ce = { id: null }; return go('character', t.dataset.char); }
  if (t.dataset.webimg) return webImageAction(t.dataset.webimg);
  if (t.dataset.retry) { const j = Jobs.get(t.dataset.retry); Jobs.delete(j.id); return startJob(j.type, j.params, { navigate: !j.batch, batch: j.batch }); }
  if (t.dataset.retryBatch) { const b = Batches.get(t.dataset.retryBatch); b.notified = false;
    b.ids.filter(id => Jobs.get(id)?.status === 'error').forEach(id => { const j = Jobs.get(id); b.ids.splice(b.ids.indexOf(id), 1); Jobs.delete(id); startJob(j.type, j.params, { navigate: false, batch: b.id }); });
    return renderBatch(b.id); }
  if (t.dataset.inspire) { form.imgStyle = t.dataset.inspire; renderStyles(); return go('create-image'); }
  if (t.dataset.style) {
    const row = t.closest('[data-styles]'); form[row.dataset.styles === 'img' ? 'imgStyle' : 'vidStyle'] = t.dataset.style;
    row.querySelectorAll('.style').forEach(s => s.classList.toggle('on', s === t)); return;
  }
  if (t.dataset.pick) {
    const k = t.dataset.pick, v = await sheet(PICKS[k].title, PICKS[k].options(), form[k]);
    if (v !== undefined) { form[k] = v; refreshPicks(); } return;
  }
  if (t.dataset.enhance) return enhance(t);
  if (t.dataset.quick) return sendChat(t.dataset.quick);
  if (t.dataset.offer) { const o = JSON.parse(t.dataset.offer); return o.kind === 'image'
    ? startJob('image', { prompt: o.prompt, style: 'cinema', format: Settings.get('format'), quality: 'hd' })
    : startJob('video', { prompt: o.prompt, style: 'cinema', format: Settings.get('format'), duration: 10, engine: 'auto', music: Settings.get('music'), transition: 'mix', cinema: !!Settings.get('cinema') }); }
  if (t.dataset.ceRm) { ce.photos.splice(+t.dataset.ceRm, 1); return renderCePhotos(); }
  if (t.dataset.rt) { const r = studio.find(x => x.id === t.closest('[data-row]').dataset.row); r.type = t.dataset.rt; saveStudio(); return renderStudio(); }
  if (t.hasAttribute('data-rdel')) { studio = studio.filter(x => x.id !== t.closest('[data-row]').dataset.row); saveStudio(); return renderStudio(); }
  if (t.parentElement && t.parentElement.id === 'img-mode') return setMode('img', t.dataset.v);
  if (t.parentElement && t.parentElement.id === 'vid-mode') return setMode('vid', t.dataset.v);
  if (t.parentElement && t.parentElement.id === 'vid-duration') { form.vidDuration = +t.dataset.v; t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t)); return; }
  if (t.parentElement && t.parentElement.id === 'lib-tab') { libTab = t.dataset.v; t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t)); return renderLibrary(); }
  if (t.classList.contains('upload')) { const f = await pickFile(); if (f) setUpload(t.id === 'img-upload' ? 'img' : 'vid', f); return; }
  switch (t.id) {
    case 'img-go': return createImageNow();
    case 'vid-go': return createVideoNow();
    case 'vid-adv-h': t.classList.toggle('open'); return $('#vid-adv').classList.toggle('hidden');
    case 'set-save': return saveSettings();
    case 'pref-save':
      Settings.set('name', $('#pref-name').value.trim() || 'ma belle'); Settings.set('format', $('#pref-format').value);
      Settings.set('music', $('#pref-music').value); Settings.set('cinema', $('#pref-cinema').value === '1');
      form['vid-music'] = Settings.get('music'); form['vid-format'] = form['img-format'] = form['st-format'] = Settings.get('format');
      toast('Préférences enregistrées ✨'); return back();
    case 'chat-reset': chat = { view: [], api: [] }; webImgs = []; attachments.clear(); saveChat(); return renderChat();
    case 'chat-attach': {
      const v = await sheet('Joindre une photo', [{ value: 'file', label: 'Importer une photo', icon: 'upload' }, { value: 'cam', label: 'Prendre une photo', icon: 'camera' }, { value: 'lib', label: 'Depuis ma bibliothèque', icon: 'lib' }]);
      const f = v === 'file' ? await pickFile() : v === 'cam' ? await pickFile({ capture: 'environment' }) : v === 'lib' ? await pickFromLibrary() : null;
      if (f) { pendingPhoto = f; const pv = $('#chat-attach-pv'); pv.src = URL.createObjectURL(f); pv.classList.remove('hidden'); $('#chat-input').focus(); }
      return;
    }
    case 'sub-btn': return toast('Éclat Ai est gratuit 💖 — seule ta clé Agnes peut avoir des limites');
    case 'logout':
      if (confirm('Retirer ta clé Agnes, le serveur et la conversation de cet appareil ? (Tes créations et personnages restent.)')) {
        Settings.clearKeys(); chat = { view: [], api: [] }; saveChat(); toast('Déconnectée'); location.hash = 'home';
      } return;
    case 'ce-add': return addCharacterPhoto();
    case 'ce-save': return saveCharacter();
    case 'ce-auto': return autoDescribe();
    case 'ce-del': if (ce.id && confirm(`Supprimer ${ce.name} ?`)) { await Chars.del(ce.id); await loadChars(); ce = { id: null, photos: [], name: '', desc: '' }; toast('Personnage supprimé'); back(); } return;
    case 'ce-img': form['img-char'] = ce.id; refreshPicks(); return go('create-image');
    case 'ce-vid': form['vid-char'] = ce.id; refreshPicks(); return go('create-video');
    case 'st-add': return addRows([newRow()]);
    case 'st-add-lines': {
      await loadChars();
      const rows = $('#st-paste').value.split('\n').filter(l => l.trim().length > 2).map(parseLine);
      if (!rows.length) return toast('Écris une idée par ligne', 'err');
      $('#st-paste').value = ''; return addRows(rows);
    }
    case 'st-ideas': return studioIdeas();
    case 'st-clear': if (studio.length && confirm('Effacer toutes les lignes du Studio ?')) { studio = []; saveStudio(); renderStudio(); } return;
    case 'st-go': return studioGo();
  }
});
// Saisie dans le Studio
document.addEventListener('input', e => {
  const row = e.target.closest('[data-row]'); if (!row || !e.target.dataset.rf) return;
  const r = studio.find(x => x.id === row.dataset.row); if (!r) return;
  const f = e.target.dataset.rf; r[f] = f === 'duration' ? +e.target.value : e.target.value; saveStudio();
});
document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.rf) e.target.dispatchEvent(new Event('input', { bubbles: true })); });
$('#chat-attach-pv').addEventListener('click', () => { pendingPhoto = null; $('#chat-attach-pv').classList.add('hidden'); });
$('#composer').addEventListener('submit', e => { e.preventDefault(); const i = $('#chat-input'); sendChat(i.value); i.value = ''; });
$('#lib-search').addEventListener('input', renderLibrary);
$('#ce-name').addEventListener('input', e => ce.name = e.target.value);
$('#ce-desc').addEventListener('input', e => ce.desc = e.target.value);
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', e => { if ([...Jobs.values()].some(j => j.status === 'running' || j.status === 'queued')) { e.preventDefault(); e.returnValue = ''; } });

(function init() {
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get('server')) { Settings.set('serverUrl', hp.get('server')); Settings.set('serverToken', hp.get('token') || ''); location.replace('#settings'); }
  renderStyles(); refreshPicks(); setUpload('img', null); setUpload('vid', null); loadChars();
  const splash = $('#splash');
  const show = () => { splash.classList.add('gone'); $('#nav').classList.remove('hidden'); setTimeout(() => splash.remove(), 700); };
  let seen = false; try { seen = sessionStorage.getItem('eclat_splash') === '1'; sessionStorage.setItem('eclat_splash', '1'); } catch (e) {}
  if (seen) show(); else setTimeout(show, 1600);
  route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
