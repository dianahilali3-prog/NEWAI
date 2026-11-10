/* ════════════════════════════════════════════════════════════════
   Éclat Ai — moteurs de génération
   - Agnes AI (clé de l'utilisatrice) : chat, images, image→image, vidéo
   - Pollinations (gratuit, sans clé) : images de secours
   - Serveur Éclat/DianaLuxe (optionnel) : Agnes + modèle open-source sur GPU
   - Montage dans le navigateur : vidéo garantie, illimitée
   Tous les formats d'API ci-dessous ont été vérifiés en direct (novembre 2026).
   ════════════════════════════════════════════════════════════════ */
'use strict';

// ── Utilitaires ──────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const clamp01 = t => Math.max(0, Math.min(1, t));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const FPS = 30;

async function fetchWithTimeout(url, ms, opts = {}) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
function b64ToBlob(b64, type = 'image/png') {
  const bin = atob(b64.split(',').pop()); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
// Réduit une image (photo importée) pour l'envoyer à l'API sans dépasser les limites de taille
async function shrinkImage(blob, maxSide = 1344) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
  return new Promise(r => c.toBlob(r, 'image/jpeg', .9));
}

// ── Réglages (stockés sur l'appareil) ────────────────────────────
const Settings = {
  _d: { agnesKey: '', serverUrl: '', serverToken: '', name: 'ma belle', patience: 3, music: 'ambient', cinema: true, format: '9:16' },
  get(k) { try { const s = JSON.parse(localStorage.getItem('eclat_settings') || '{}'); return k in s ? s[k] : this._d[k]; } catch (e) { return this._d[k]; } },
  set(k, v) { try { const s = JSON.parse(localStorage.getItem('eclat_settings') || '{}'); s[k] = v; localStorage.setItem('eclat_settings', JSON.stringify(s)); } catch (e) {} },
  clearKeys() { ['agnesKey', 'serverUrl', 'serverToken'].forEach(k => this.set(k, '')); }
};
const hasAgnes = () => !!Settings.get('agnesKey').trim();
function serverBase() {
  let u = (Settings.get('serverUrl') || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

// ── Styles & formats ─────────────────────────────────────────────
const STYLES = {
  realiste:    { label: 'Réaliste',    img: 'assets/style-realiste.jpg',    p: 'photorealistic, ultra detailed, natural skin texture, 85mm photography, sharp focus' },
  cinema:      { label: 'Cinéma',      img: 'assets/style-cinema.jpg',      p: 'cinematic film still, dramatic moody lighting, shallow depth of field, anamorphic, film grain' },
  anime:       { label: 'Anime',       img: 'assets/style-anime.jpg',       p: 'anime style illustration, vibrant colors, clean line art, japanese animation' },
  fantastique: { label: 'Fantastique', img: 'assets/style-fantastique.jpg', p: 'fantasy art, magical glowing atmosphere, epic, highly detailed' },
  minimaliste: { label: 'Minimaliste', img: 'assets/style-minimaliste.jpg', p: 'minimalist composition, clean background, negative space, elegant' },
  vhs:         { label: 'VHS',         img: 'assets/style-vhs.jpg',         p: 'retro 1980s VHS aesthetic, neon colors, scanlines, analog film grain' },
};
const withStyle = (p, s) => STYLES[s] ? `${p}, ${STYLES[s].p}` : p;
// Tailles Agnes (multiples de 64) et taille de la vidéo
const FORMATS = {
  '9:16': { label: '9:16 (vertical)',   ag: '768x1344', agHD: '1024x1792', vw: 720,  vh: 1280, pw: 864,  ph: 1536 },
  '16:9': { label: '16:9 (horizontal)', ag: '1344x768', agHD: '1792x1024', vw: 1280, vh: 720,  pw: 1536, ph: 864 },
  '1:1':  { label: '1:1 (carré)',       ag: '1024x1024', agHD: '1024x1024', vw: 1080, vh: 1080, pw: 1280, ph: 1280 },
};

/* ════════════════════════════════════════════════════════════════
   AGNES AI — https://apihub.agnes-ai.com (CORS ouvert : appel direct depuis le navigateur)
   ════════════════════════════════════════════════════════════════ */
const AGNES = 'https://apihub.agnes-ai.com';

async function agnesFetch(path, body, { timeout = 90000, tries = 3 } = {}) {
  const key = Settings.get('agnesKey').trim();
  if (!key) throw new Error('Ajoute ta clé Agnes dans Profil → Paramètres de l\'IA');
  let last;
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetchWithTimeout(AGNES + path, timeout, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) { last = new Error(e.name === 'AbortError' ? 'Agnes : délai dépassé' : 'Agnes injoignable (réseau)'); await sleep(1500 * (i + 1)); continue; }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (e) {}
    if (res.ok) return data;
    const msg = (data && (data.message || (data.error && data.error.message))) || text.slice(0, 160);
    const err = new Error(msg); err.status = res.status; err.code = (data && (data.code || (data.error && data.error.code))) || '';
    if (res.status === 401) err.message = 'Clé Agnes refusée — vérifie-la dans Profil → Paramètres de l\'IA';
    last = err;
    // 401 parfois renvoyé à tort par la passerelle : 1 nouvel essai ; erreurs passagères : nouvel essai
    if ((res.status === 401 && i === 0) || [408, 429, 500, 502, 504, 520, 522, 524].includes(res.status)) { await sleep(2000 * (i + 1)); continue; }
    throw err;
  }
  throw last;
}

// Chat (Agent IA)
async function agnesChat(messages) {
  let lastErr;
  for (const model of ['agnes-3.0-flash', 'agnes-2.5-flash']) {
    try {
      const d = await agnesFetch('/v1/chat/completions', { model, messages, max_tokens: 700, temperature: .8 }, { timeout: 60000 });
      const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      if (txt) return txt.trim();
    } catch (e) { lastErr = e; if (e.status === 401) throw e; }
  }
  throw lastErr || new Error('réponse vide');
}

// Image (texte → image, ou image → image si `image` est fourni). Réponse en base64 : pas de souci de CORS.
async function agnesImage({ prompt, size, image }) {
  const models = image ? ['agnes-image-2.1-flash', 'agnes-image-2.5-flash'] : ['agnes-image-2.5-flash', 'agnes-image-2.1-flash', 'agnes-image-2.0-flash'];
  let lastErr;
  for (const model of models) {
    try {
      const body = { model, prompt, size, response_format: 'b64_json' };
      if (image) body.image = await blobToDataURL(await shrinkImage(image));
      const d = await agnesFetch('/v1/images/generations', body, { timeout: 120000 });
      const x = d && d.data && d.data[0];
      if (x && x.b64_json) return b64ToBlob(x.b64_json, 'image/png');
      if (x && x.url) { const r = await fetch(x.url).catch(() => null); if (r && r.ok) return await r.blob(); }
      throw new Error('image vide');
    } catch (e) { lastErr = e; if (e.status === 401) throw e; }
  }
  throw lastErr;
}

/* ════════════════════════════════════════════════════════════════
   POLLINATIONS — secours gratuit (1 image / 45 s par adresse IP)
   ════════════════════════════════════════════════════════════════ */
const POLL_GAP = 46000;
let pollNextFree = 0;
try { pollNextFree = +localStorage.getItem('eclat_poll_next') || 0; } catch (e) {}
function setPollNext(ms) { pollNextFree = Math.max(pollNextFree, Date.now() + ms); try { localStorage.setItem('eclat_poll_next', pollNextFree); } catch (e) {} }

async function pollinationsImage(prompt, w, h, seed, onWait) {
  const deadline = Date.now() + 8 * 60 * 1000; let lastErr = '';
  while (Date.now() < deadline) {
    const wait = pollNextFree - Date.now();
    if (wait > 0) for (let s = Math.ceil(wait / 1000); s > 0; s--) { onWait && onWait(s); await sleep(1000); }
    let res;
    try { res = await fetchWithTimeout(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true&private=true`, 120000); }
    catch (e) { lastErr = 'réseau'; await sleep(5000); continue; }
    if (res.ok) { const b = await res.blob(); setPollNext(POLL_GAP); if (b.type.startsWith('image/') && b.size > 1000) return b; lastErr = 'réponse invalide'; continue; }
    let after = res.status === 503 ? 10 : 45;
    try { const j = await res.json(); const m = ((j.error && j.error.message) || '').match(/retry after (\d+)\s*s/i); if (m) after = +m[1] + 1; } catch (e) {}
    lastErr = 'HTTP ' + res.status;
    if (![402, 429, 500, 502, 503, 504].includes(res.status)) break;
    setPollNext(after * 1000);
  }
  throw new Error('Pollinations indisponible (' + lastErr + ')');
}

/* Image : Agnes d'abord (≈10 s, haute qualité), Pollinations en secours */
async function createImage({ prompt, style, format = '9:16', hd = false, image = null, seed, onStatus = () => {} }) {
  const f = FORMATS[format] || FORMATS['9:16'];
  const full = withStyle(prompt, style);
  if (hasAgnes()) {
    try {
      onStatus(image ? 'Agnes transforme ton image…' : 'Agnes crée ton image…');
      return { blob: await agnesImage({ prompt: full, size: hd ? f.agHD : f.ag, image }), engine: 'Agnes' };
    } catch (e) {
      if (hd) { try { return { blob: await agnesImage({ prompt: full, size: f.ag, image }), engine: 'Agnes' }; } catch (e2) {} }
      if (e.status === 401) throw e;
      onStatus('Agnes indisponible, passage à Pollinations…');
    }
  } else if (image) {
    throw new Error('Image → Image nécessite une clé Agnes (Profil → Paramètres de l\'IA)');
  }
  const blob = await pollinationsImage(full, f.pw, f.ph, seed ?? Math.floor(Math.random() * 1e9), s => onStatus(`Pollinations gratuit : 1 image / 45 s — encore ${s} s`));
  return { blob, engine: 'Pollinations' };
}

/* Découpage d'une idée en plans (Agent Agnes si dispo, sinon plans prédéfinis) */
const SHOTS = ['wide establishing shot', 'medium shot', 'close-up, detailed', 'low angle hero shot', 'side profile shot',
  'detail shot, macro', 'over the shoulder shot', 'slow tracking shot', 'dramatic silhouette, backlight', 'final shot, golden glow'];
async function planScenes(prompt, count) {
  const lines = prompt.split('\n').map(s => s.trim()).filter(s => s.length > 2);
  if (lines.length > 1) return lines.slice(0, 12);
  if (hasAgnes()) {
    try {
      const out = await agnesChat([
        { role: 'system', content: 'You are a film director. Output only shot descriptions, one per line, in English, no numbering.' },
        { role: 'user', content: `Write exactly ${count} short visual shot descriptions (max 30 words each) telling a coherent visual story about: "${prompt}". Keep the same main subject, outfit and setting in every shot; vary the camera angle and action.` }]);
      const sc = out.split('\n').map(s => s.replace(/^\s*(\d+[\.\):-]|[-*•]|shot\s*\d+:?)\s*/i, '').trim()).filter(s => s.length > 8);
      if (sc.length >= Math.min(2, count)) return sc.slice(0, count);
    } catch (e) {}
  }
  return Array.from({ length: count }, (_, i) => `${prompt}, ${SHOTS[i % SHOTS.length]}`);
}

/* ════════════════════════════════════════════════════════════════
   VIDÉO IA — Agnes direct ou serveur (même protocole : POST /v1/videos + GET /agnesapi)
   ════════════════════════════════════════════════════════════════ */
function findVideoUrl(d) {
  if (typeof d === 'string') return /^https?:\/\//.test(d) ? d : null;
  if (d && typeof d === 'object') {
    for (const k of ['url', 'video_url', 'videoUrl', 'output', 'result', 'download_url', 'file_url'])
      if (typeof d[k] === 'string' && /^https?:\/\//.test(d[k])) return d[k];
    for (const v of Object.values(d)) { const u = findVideoUrl(v); if (u) return u; }
  }
  return null;
}

async function aiVideo({ prompt, duration, format, image, deadlineMs, onStatus }) {
  const srv = serverBase(), f = FORMATS[format] || FORMATS['9:16'];
  let base, headers = { 'Content-Type': 'application/json' }, body, modelParam = '';
  if (srv) {
    base = srv; const t = Settings.get('serverToken').trim(); if (t) headers.Authorization = 'Bearer ' + t;
    body = { prompt, width: f.vw, height: f.vh, num_frames: Math.min(duration, 10) * 24 + 1, frame_rate: 24 };
    if (image) body.image = await blobToDataURL(await shrinkImage(image, 1024));
  } else if (hasAgnes()) {
    base = AGNES; headers.Authorization = 'Bearer ' + Settings.get('agnesKey').trim();
    // Format réel d'agnes-video-2.5-flash (gratuit) : mode / seconds / size
    body = { model: 'agnes-video-2.5-flash', prompt, mode: 'text', seconds: duration >= 8 ? '10' : '5', size: '720P' };
    modelParam = '&model_name=agnes-video-2.5-flash';
  } else throw new Error('pas de clé Agnes ni de serveur');

  // 1) Création, en patientant tant que la file d'attente d'Agnes est pleine
  let vid = null, attempt = 0, netFails = 0;
  while (!vid) {
    if (Date.now() > deadlineMs) throw new Error('file Agnes encore pleine');
    attempt++;
    let res, txt = '';
    try { res = await fetchWithTimeout(base + '/v1/videos', 60000, { method: 'POST', headers, body: JSON.stringify(body) }); txt = await res.text(); }
    catch (e) { if (++netFails >= 2) throw new Error(srv ? 'serveur injoignable' : 'Agnes injoignable'); await sleep(5000); continue; }
    if (res.ok) { const d = JSON.parse(txt); vid = d.video_id || d.id || (d.data || {}).video_id; if (!vid) throw new Error('réponse sans video_id'); break; }
    if (/queue_full|queue is full/i.test(txt) || [429, 502, 503, 504].includes(res.status)) {
      for (let s = 30; s > 0 && Date.now() < deadlineMs; s--) { onStatus(`Agnes est saturée — essai ${attempt}, nouvel essai dans ${s} s`); await sleep(1000); }
      continue;
    }
    if (res.status === 401 && attempt < 2) { await sleep(2000); continue; }
    throw new Error(/insufficient_user_quota/.test(txt) ? 'quota vidéo Agnes épuisé' : `refus (HTTP ${res.status}) ${txt.slice(0, 100)}`);
  }

  // 2) Suivi jusqu'au résultat
  const pollHeaders = headers.Authorization ? { Authorization: headers.Authorization } : {};
  const t0 = Date.now();
  while (Date.now() - t0 < 30 * 60 * 1000) {
    await sleep(5000);
    let d;
    try {
      const r = await fetchWithTimeout(`${base}/agnesapi?video_id=${encodeURIComponent(vid)}${modelParam}`, 30000, { headers: pollHeaders });
      if (!r.ok) continue; d = await r.json();
    } catch (e) { continue; }
    const st = String(d.status || (d.data || {}).status || '').toLowerCase();
    let p = typeof d.progress === 'number' ? d.progress : null; if (p !== null && p > 1) p /= 100;
    onStatus(d.queue_position ? `File d'attente : position ${d.queue_position}` : (d.message || 'Agnes anime ta vidéo…'), p);
    if (['completed', 'succeeded', 'success', 'done', 'finished'].includes(st)) {
      const url = findVideoUrl(d); if (!url) throw new Error('vidéo terminée mais lien introuvable');
      let blob = null; try { const vr = await fetchWithTimeout(url, 300000); if (vr.ok) blob = await vr.blob(); } catch (e) {}
      return { url, blob, ext: 'mp4', engine: d.backend ? 'Serveur ' + d.backend : 'Agnes Vidéo' };
    }
    if (['failed', 'error', 'cancelled', 'canceled'].includes(st)) throw new Error(d.error || d.message || 'génération échouée');
  }
  throw new Error('délai dépassé');
}

async function checkServer() {
  const srv = serverBase(); if (!srv) return null;
  const r = await fetchWithTimeout(srv + '/health', 15000); const d = await r.json();
  if (d.service !== 'dianaluxe') throw new Error('ce n\'est pas un serveur Éclat');
  return d;
}

/* ════════════════════════════════════════════════════════════════
   MONTAGE DANS LE NAVIGATEUR (repris de la version testée)
   ════════════════════════════════════════════════════════════════ */
// ════════════════════════════════════════════════════════════════
// MUSIQUE — synthétisée en direct (WebAudio), libre de droits
// ════════════════════════════════════════════════════════════════
const PROGRESSIONS = {
  ambient:[[57,60,64,67],[53,57,60,64],[48,52,55,59],[55,59,62,65]],
  dream:[[62,66,69,73],[59,62,66,69],[55,59,62,66],[57,61,64,69]],
  pulse:[[45,57,60,64],[41,53,57,60],[43,55,59,62],[40,52,55,59]]
};
const midiHz = m => 440*Math.pow(2,(m-69)/12);

function createMusic(ctx, kind, duration, sceneLen){
  const dest = ctx.createMediaStreamDestination();
  const master = ctx.createGain(); master.gain.value = 0;
  const filter = ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value = kind==='pulse'?1400:900; filter.Q.value=.7;
  // Réverbération simple
  const conv = ctx.createConvolver(); const len = ctx.sampleRate*2.5;
  const ir = ctx.createBuffer(2,len,ctx.sampleRate);
  for(let c=0;c<2;c++){const d=ir.getChannelData(c);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.5)}
  conv.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value=.55;
  filter.connect(master); filter.connect(conv); conv.connect(wet); wet.connect(master);
  master.connect(dest);

  const t0 = ctx.currentTime + .05, prog = PROGRESSIONS[kind];
  const chordLen = Math.max(2, sceneLen);
  for(let t=0, ci=0; t<duration; t+=chordLen, ci++){
    const chord = prog[ci % prog.length], start=t0+t, end=Math.min(t0+duration, start+chordLen+1.2);
    chord.forEach((m,k)=>{
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = k===0 ? 'sine' : (kind==='dream'?'triangle':'sine');
      o.frequency.value = midiHz(m); o.detune.value = rand(-6,6);
      g.gain.setValueAtTime(0,start); g.gain.linearRampToValueAtTime(k===0?.16:.08,start+1);
      g.gain.setValueAtTime(k===0?.16:.08,Math.max(start+1,end-1.2)); g.gain.linearRampToValueAtTime(0,end);
      o.connect(g); g.connect(filter); o.start(start); o.stop(end+.1);
    });
    if(kind==='pulse'){ // battement doux
      for(let b=0;b<chordLen;b+=.5){
        const s=start+b; if(s>t0+duration-.3)break;
        const o=ctx.createOscillator(),g=ctx.createGain();
        o.type='sine'; o.frequency.setValueAtTime(110,s); o.frequency.exponentialRampToValueAtTime(45,s+.18);
        g.gain.setValueAtTime(b%1===0?.35:.15,s); g.gain.exponentialRampToValueAtTime(.001,s+.25);
        o.connect(g); g.connect(master); o.start(s); o.stop(s+.3);
      }
    }
    if(kind==='dream'){ // arpège scintillant
      for(let b=0;b<chordLen;b+=.25){
        const s=start+b; if(s>t0+duration-.3)break;
        const o=ctx.createOscillator(),g=ctx.createGain();
        o.type='sine'; o.frequency.value=midiHz(chord[Math.floor(b*4)%chord.length]+12);
        g.gain.setValueAtTime(.035,s); g.gain.exponentialRampToValueAtTime(.001,s+.4);
        o.connect(g); g.connect(filter); o.start(s); o.stop(s+.45);
      }
    }
  }
  master.gain.setValueAtTime(0,t0); master.gain.linearRampToValueAtTime(.8,t0+1.5);
  master.gain.setValueAtTime(.8,t0+Math.max(1.5,duration-2)); master.gain.linearRampToValueAtTime(0,t0+duration);
  return dest.stream;
}

// ════════════════════════════════════════════════════════════════
// MOTEUR VIDÉO — montage dans le navigateur (canvas + MediaRecorder)
// ════════════════════════════════════════════════════════════════
function pickMime(){
  const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1','video/mp4',
                'video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  return list.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

function makeGrain(){
  const c = document.createElement('canvas'); c.width=c.height=256;
  const g = c.getContext('2d'), d = g.createImageData(256,256);
  for(let i=0;i<d.data.length;i+=4){const v=Math.random()*255;d.data[i]=d.data[i+1]=d.data[i+2]=v;d.data[i+3]=255}
  g.putImageData(d,0,0); return c;
}

// Dessine une image en mode "cover" avec zoom/déplacement (effet Ken Burns)
function drawKenBurns(ctx, img, W, H, kb, p, extraScale=1, offX=0, alpha=1){
  const e = ease(p);
  const s = (kb.s0 + (kb.s1-kb.s0)*e) * extraScale;
  const base = Math.max(W/img.width, H/img.height);
  const dw = img.width*base*s, dh = img.height*base*s;
  const mx = (dw-W)/2, my = (dh-H)/2;
  const cl = v => Math.max(-1, Math.min(1, v));
  const px = cl(kb.x0 + (kb.x1-kb.x0)*e), py = cl(kb.y0 + (kb.y1-kb.y0)*e);
  const x = (W-dw)/2 - px*mx + offX, y = (H-dh)/2 - py*my;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x, y, dw, dh);
  ctx.globalAlpha = 1;
}

async function renderVideo({images, duration, transition, motion, caption, cinema, audio, W, H, onFrame, onProgress}){
  const canvas = document.createElement('canvas'); canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext('2d');
  const n = images.length, T = n>1 ? Math.min(1, duration/n*0.3) : 0;
  const sceneLen = (duration + (n-1)*T) / n;
  const transKinds = ['fade','zoom','slide','flash'];
  const scenes = images.map((item,i)=>{
    const img = item.img || item, shot = item.shot || 0;
    const zoomIn = Math.random() < .6;
    // Plan 0 : large. Plans suivants : cadrage serré sur une autre zone de l'image (effet "autre caméra").
    const tight = shot > 0 ? 1.3 + .2*shot : 0;
    const a = (tight||1) + .02*motion, b = (tight||1) + rand(.12,.2)*motion;
    const fx = shot>0 ? rand(-1,1) : rand(-.8,.8), fy = shot>0 ? (shot%2 ? rand(-1,-.2) : rand(.2,1)) : rand(-.8,.8);
    return {
      img, start: i*(sceneLen-T),
      kb:{s0:zoomIn?a:b, s1:zoomIn?b:a, x0:fx, y0:fy, x1:fx+rand(-.3,.3)*motion, y1:fy+rand(-.3,.3)*motion},
      trans: transition==='mix' ? transKinds[Math.floor(Math.random()*transKinds.length)] : transition,
      dir: Math.random()<.5 ? 1 : -1
    };
  });
  const grain = cinema ? makeGrain() : null;
  const vignette = ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.35,W/2,H/2,Math.max(W,H)*.75);
  vignette.addColorStop(0,'rgba(0,0,0,0)'); vignette.addColorStop(1,'rgba(0,0,0,.55)');

  function draw(t){
    ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
    for(let i=0;i<n;i++){
      const s = scenes[i];
      if(t < s.start || t > s.start + sceneLen) continue;
      const p = clamp01((t - s.start)/sceneLen);
      const tin = (i>0 && T>0) ? clamp01((t - s.start)/T) : 1;   // progression de la transition d'entrée
      if(tin >= 1){ drawKenBurns(ctx,s.img,W,H,s.kb,p); continue; }
      const k = ease(tin);
      switch(s.trans){
        case 'zoom':  drawKenBurns(ctx,s.img,W,H,s.kb,p,1+.35*(1-k),0,k); break;
        case 'slide': drawKenBurns(ctx,s.img,W,H,s.kb,p,1,s.dir*W*(1-k)); break;
        case 'flash':
          drawKenBurns(ctx,s.img,W,H,s.kb,p,1,0,k);
          ctx.fillStyle=`rgba(255,240,245,${Math.sin(tin*Math.PI)*.85})`; ctx.fillRect(0,0,W,H); break;
        default:      drawKenBurns(ctx,s.img,W,H,s.kb,p,1,0,k);
      }
    }
    if(cinema){
      ctx.globalAlpha=.06; ctx.globalCompositeOperation='overlay';
      const ox=Math.random()*256, oy=Math.random()*256;
      ctx.fillStyle = ctx.createPattern(grain,'repeat');
      ctx.save(); ctx.translate(-ox,-oy); ctx.fillRect(ox,oy,W,H); ctx.restore();
      ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
      ctx.fillStyle=vignette; ctx.fillRect(0,0,W,H);
    }
    if(caption){
      const a = clamp01(Math.min((t-.6)/1, (duration-t-.3)/1));
      if(a>0){
        const fs = Math.round(Math.min(W,H)*.055);
        ctx.font = `300 ${fs}px Georgia, 'Times New Roman', serif`;
        ctx.textAlign='center'; ctx.textBaseline='alphabetic';
        ctx.globalAlpha=a; ctx.shadowColor='rgba(0,0,0,.8)'; ctx.shadowBlur=fs*.6;
        ctx.fillStyle='#fff'; ctx.fillText(caption, W/2, H - H*.1, W*.9);
        ctx.shadowBlur=0; ctx.globalAlpha=1;
      }
    }
    // Fondu au noir début/fin
    const fade = Math.max(clamp01(1 - t/.5), clamp01(1 - (duration-t)/.6));
    if(fade>0){ctx.fillStyle=`rgba(0,0,0,${fade})`;ctx.fillRect(0,0,W,H)}
  }

  draw(0);
  const stream = canvas.captureStream(FPS);
  let actx = null;
  if(audio !== 'none' && (window.AudioContext||window.webkitAudioContext)){
    try{
      actx = new (window.AudioContext||window.webkitAudioContext)();
      await actx.resume();
      createMusic(actx, audio, duration, sceneLen).getAudioTracks().forEach(tr=>stream.addTrack(tr));
    }catch(e){ actx=null; }
  }
  const mime = pickMime();
  if(!mime) throw new Error("Votre navigateur ne sait pas enregistrer de vidéo (MediaRecorder absent). Essayez Chrome, Edge, Firefox ou Safari récent.");
  const rec = new MediaRecorder(stream,{mimeType:mime, videoBitsPerSecond: 8_000_000});
  const chunks = [];
  rec.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => rec.onstop = r);
  rec.start(250);
  onFrame && onFrame(canvas);

  const t0 = performance.now();
  await new Promise(resolve=>{
    // setInterval continue (au ralenti) si l'onglet passe en arrière-plan ; requestAnimationFrame non.
    const iv = setInterval(()=>{
      const t = (performance.now()-t0)/1000;
      if(t >= duration){ draw(duration); clearInterval(iv); resolve(); return; }
      draw(t); onProgress && onProgress(t/duration);
    }, 1000/FPS);
  });
  await sleep(200);
  rec.stop(); await stopped;
  stream.getTracks().forEach(tr=>tr.stop());
  if(actx) actx.close();
  const type = mime.split(';')[0];
  return { blob: new Blob(chunks,{type}), ext: type.includes('mp4') ? 'mp4' : 'webm' };
}


/* ════════════════════════════════════════════════════════════════
   CRÉATION D'UNE VIDÉO — cascade complète
   auto : Serveur/Agnes Vidéo (patience limitée) → montage d'images Agnes/Pollinations
   ════════════════════════════════════════════════════════════════ */
async function createVideo(o, { onStatus, onPreview, onCanvas }) {
  const f = FORMATS[o.format] || FORMATS['9:16'];
  const full = withStyle(o.prompt, o.style);
  const notes = [];

  // 1) Vraie vidéo IA (mouvements générés par l'IA)
  if (o.engine !== 'montage' && (serverBase() || hasAgnes())) {
    const patience = o.engine === 'ai' ? 40 : (serverBase() ? 30 : +Settings.get('patience') || 3);
    try {
      onStatus('Envoi à l\'IA vidéo…', .02);
      const r = await aiVideo({ prompt: full, duration: o.duration, format: o.format, image: o.image,
        deadlineMs: Date.now() + patience * 60000, onStatus: (m, p) => onStatus(m, p == null ? null : .05 + .93 * p) });
      return { ...r, notes };
    } catch (e) {
      if (o.engine === 'ai') throw new Error('IA vidéo : ' + e.message);
      notes.push(`IA vidéo indisponible (${e.message}) → montage animé`);
      onStatus(`IA vidéo indisponible (${e.message}) — je passe au montage animé`, .05);
      await sleep(1200);
    }
  }

  // 2) Montage : quelques images IA animées (caméra, transitions, musique)
  const nScenes = o.image ? Math.max(2, Math.min(6, Math.round(o.duration / 3))) : Math.max(2, Math.min(10, Math.round(o.duration / 2.5)));
  const fast = hasAgnes();                                       // Agnes : ~10 s / image ; Pollinations : 45 s / image
  const nImages = fast ? nScenes : Math.max(1, Math.ceil(nScenes / 2));
  const bitmaps = [];
  let first = o.image || null;
  onStatus('Écriture du scénario…', .06);
  const scenes = await planScenes(o.prompt, o.image ? Math.max(0, nImages - 1) : nImages);
  if (first) { bitmaps.push(await createImageBitmap(first)); onPreview && onPreview(first); }
  const seed = Math.floor(Math.random() * 1e9);
  for (let i = 0; i < scenes.length; i++) {
    const label = `Image ${bitmaps.length + 1}/${scenes.length + (first ? 1 : 0)}`;
    onStatus(label + '…', .08 + .55 * i / scenes.length);
    let blob;
    try {
      // Avec une image de départ (Image → Vidéo), Agnes crée d'autres plans de la même scène
      const r = await createImage({ prompt: first && fast ? `same person, same outfit and same setting as the reference image. ${scenes[i]}` : scenes[i],
        style: o.style, format: o.format, image: first && fast ? first : null, seed: seed + i, onStatus: m => onStatus(`${label} — ${m}`) });
      blob = r.blob;
    } catch (e) { if (bitmaps.length >= 1 && e.status !== 401) { notes.push(`${label} ignorée (${e.message})`); continue; } throw e; }
    bitmaps.push(await createImageBitmap(blob));
    if (!first || i === 0) onPreview && onPreview(blob);
  }
  if (!bitmaps.length) throw new Error('aucune image n\'a pu être créée');
  const shotsPer = Math.max(1, Math.ceil(nScenes / bitmaps.length));
  const images = []; bitmaps.forEach(img => { for (let k = 0; k < shotsPer; k++) images.push({ img, shot: k }); });

  onStatus('Montage et enregistrement…', .65);
  const out = await renderVideo({ images, duration: o.duration, transition: o.transition || 'mix', motion: o.motion || 1, caption: o.caption || '',
    cinema: o.cinema !== false, audio: o.music || 'ambient', W: f.vw, H: f.vh,
    onFrame: c => onCanvas && onCanvas(c),
    onProgress: p => onStatus(`Enregistrement ${Math.round(p * 100)} %`, .65 + .35 * p) });
  bitmaps.forEach(b => b.close && b.close());
  return { blob: out.blob, ext: out.ext, url: null, engine: 'Montage animé' + (fast ? ' · images Agnes' : ' · images Pollinations'), notes };
}

/* ════════════════════════════════════════════════════════════════
   BIBLIOTHÈQUE — IndexedDB (sur l'appareil)
   ════════════════════════════════════════════════════════════════ */
const DB = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('eclat-ai', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('items', mode), s = t.objectStore('items'); const req = fn(s);
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    });
  },
  put(item) { return this.tx('readwrite', s => s.put(item)); },
  get(id) { return this.tx('readonly', s => s.get(id)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
  async all() { return ((await this.tx('readonly', s => s.getAll())) || []).sort((a, b) => b.ts - a.ts); }
};
const urlCache = new Map();
function itemUrl(it) {
  if (!it) return '';
  if (!it.blob) return it.url || '';
  if (!urlCache.has(it.id)) urlCache.set(it.id, URL.createObjectURL(it.blob));
  return urlCache.get(it.id);
}
