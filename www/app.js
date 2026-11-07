/* Voz e Legenda — vídeo de fundo + voz + legendas -> .mp4 */
(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const bg = $('#bg');
const voice = $('#voice');
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');

const Cap = window.Capacitor;
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

const S = {
  bgFile: null, voiceFile: null,
  bgURL: null, voiceURL: null,
  format: 'vertical',
  burn: true,          // legendas no vídeo exportado
  showEditor: true,    // legendas só no editor
  segs: [],            // {id,start,end,text}
  exporting: false,
  cancel: false,
  lastBlob: null, lastName: '',
};

let nextId = 1;
const DIMS = { vertical: [720, 1280], horizontal: [1280, 720] };

/* ---------- util ---------- */
const fmt = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dur = () => (isFinite(voice.duration) ? voice.duration : 0);

function show(id) {
  document.querySelectorAll('.screen').forEach((e) => e.classList.remove('active'));
  $('#' + id).classList.add('active');
  window.scrollTo(0, 0);
}

/* ---------- tela 1: escolher arquivos ---------- */
function setPicked(boxId, textId, file) {
  $(boxId).classList.add('done');
  $(textId).textContent = '✔ ' + file.name;
}
function checkReady() {
  $('#btn-continue').disabled = !(S.bgFile && S.voiceFile);
}

$('#file-bg').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  S.bgFile = f;
  if (S.bgURL) URL.revokeObjectURL(S.bgURL);
  S.bgURL = URL.createObjectURL(f);
  setPicked('#pick-bg', '#pick-bg-text', f);
  checkReady();
});
$('#file-voice').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  S.voiceFile = f;
  if (S.voiceURL) URL.revokeObjectURL(S.voiceURL);
  S.voiceURL = URL.createObjectURL(f);
  setPicked('#pick-voice', '#pick-voice-text', f);
  checkReady();
});

function setFormat(f) {
  S.format = f;
  document.querySelectorAll('.chips .chip').forEach((c) => c.classList.toggle('on', c.dataset.format === f));
  const [w, h] = DIMS[f];
  canvas.width = w; canvas.height = h;
  draw();
}
document.querySelectorAll('.chips .chip').forEach((c) => {
  c.addEventListener('click', () => setFormat(c.dataset.format));
});

/* ---------- áudio: grafo para mixar fundo + voz ---------- */
let AC = null, gBg, gVoice, gMon, dest;
function initAudio() {
  if (AC) { AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  const sBg = AC.createMediaElementSource(bg);
  const sVoice = AC.createMediaElementSource(voice);
  gBg = AC.createGain(); gVoice = AC.createGain(); gMon = AC.createGain();
  dest = AC.createMediaStreamDestination();
  sBg.connect(gBg); sVoice.connect(gVoice);
  gBg.connect(dest); gVoice.connect(dest);     // vai para a gravação
  gBg.connect(gMon); gVoice.connect(gMon);     // vai para o alto-falante
  gMon.connect(AC.destination);
  gBg.gain.value = parseFloat($('#vol-bg').value);
  gVoice.gain.value = parseFloat($('#vol-voice').value);
  AC.resume();
}
$('#vol-bg').addEventListener('input', (e) => { if (gBg) gBg.gain.value = parseFloat(e.target.value); });
$('#vol-voice').addEventListener('input', (e) => { if (gVoice) gVoice.gain.value = parseFloat(e.target.value); });

/* ---------- ir para o editor ---------- */
$('#btn-continue').addEventListener('click', async () => {
  $('#setup-msg').textContent = 'Carregando…';
  bg.src = S.bgURL;
  voice.src = S.voiceURL;
  try {
    await Promise.all([whenReady(bg), whenReady(voice)]);
  } catch (err) {
    $('#setup-msg').textContent = 'Não consegui abrir um dos arquivos. Tente outro formato (mp4 / mp3 / m4a).';
    return;
  }
  $('#setup-msg').textContent = '';
  initAudio();
  $('#seek').max = dur();
  S.segs = [];
  renderSegs();
  setFormat(S.format);
  show('screen-editor');
  seekTo(0);
});

function whenReady(el) {
  return new Promise((res, rej) => {
    if (el.readyState >= 1) return res();
    const ok = () => { cleanup(); res(); };
    const bad = () => { cleanup(); rej(new Error('media')); };
    const cleanup = () => { el.removeEventListener('loadedmetadata', ok); el.removeEventListener('error', bad); };
    el.addEventListener('loadedmetadata', ok);
    el.addEventListener('error', bad);
    el.load();
  });
}

$('#btn-back').addEventListener('click', () => {
  pause();
  show('screen-setup');
});

/* ---------- reprodução ---------- */
let playing = false, raf = 0;

function bgTimeFor(t) {
  const d = bg.duration;
  return isFinite(d) && d > 0 ? t % d : 0;
}
function seekTo(t) {
  t = clamp(t, 0, dur());
  voice.currentTime = t;
  try { bg.currentTime = bgTimeFor(t); } catch (e) { /* ignore */ }
  updateUI();
  setTimeout(draw, 60);
}
async function play() {
  if (!dur()) return;
  initAudio();
  if (voice.currentTime >= dur() - 0.05) seekTo(0);
  bg.currentTime = bgTimeFor(voice.currentTime);
  try { await Promise.all([voice.play(), bg.play()]); } catch (e) { return; }
  playing = true;
  $('#btn-play').textContent = '⏸';
  loop();
}
function pause() {
  voice.pause(); bg.pause();
  playing = false;
  $('#btn-play').textContent = '▶';
  cancelAnimationFrame(raf);
  updateUI(); draw();
}
function loop() {
  cancelAnimationFrame(raf);
  const tick = () => {
    if (!playing) return;
    // mantém o fundo em sincronia com a voz
    const want = bgTimeFor(voice.currentTime);
    if (Math.abs(bg.currentTime - want) > 0.35 && bg.duration - want > 0.5 && want > 0.3) {
      try { bg.currentTime = want; } catch (e) { /* ignore */ }
    }
    updateUI();
    draw();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
voice.addEventListener('ended', () => {
  if (S.exporting) return; // a exportação trata do fim
  if (sync.active) finishSync(dur());
  pause();
});
$('#btn-play').addEventListener('click', () => (playing ? pause() : play()));
$('#seek').addEventListener('input', (e) => seekTo(parseFloat(e.target.value)));

function updateUI() {
  const t = voice.currentTime || 0;
  $('#time').textContent = fmt(t);
  if (document.activeElement !== $('#seek')) $('#seek').value = t;
  document.querySelectorAll('.seg').forEach((el) => {
    const s = S.segs.find((x) => x.id === +el.dataset.id);
    el.classList.toggle('now', !!s && t >= s.start && t < s.end);
  });
}

/* ---------- desenho ---------- */
function drawCover(v) {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return;
  const s = Math.max(W / vw, H / vh);
  const dw = vw * s, dh = vh * s;
  ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
}
function wrap(text, maxW) {
  const out = [];
  text.split('\n').forEach((para) => {
    let cur = '';
    para.split(/\s+/).filter(Boolean).forEach((w) => {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) { out.push(cur); cur = w; } else cur = test;
    });
    if (cur) out.push(cur);
  });
  return out;
}
function currentSeg(t) {
  return S.segs.find((s) => t >= s.start && t < s.end && s.text.trim());
}
function drawSubtitle(text) {
  const W = canvas.width, H = canvas.height;
  const size = Math.round(W * (S.format === 'vertical' ? 0.065 : 0.045));
  ctx.font = '800 ' + size + 'px system-ui, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.2;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#fff';
  const lines = wrap(text, W * 0.86);
  const lh = size * 1.25;
  let y = H - (S.format === 'vertical' ? H * 0.14 : H * 0.08) - (lines.length - 1) * lh;
  lines.forEach((l) => { ctx.strokeText(l, W / 2, y); ctx.fillText(l, W / 2, y); y += lh; });
}
function draw() {
  drawCover(bg);
  const showSubs = S.exporting ? S.burn : S.showEditor;
  if (showSubs) {
    const seg = currentSeg(voice.currentTime || 0);
    if (seg) drawSubtitle(seg.text.trim());
  }
}
bg.addEventListener('seeked', () => { if (!playing) draw(); });
bg.addEventListener('loadeddata', draw);

/* ---------- legendas: lista ---------- */
function sortSegs() { S.segs.sort((a, b) => a.start - b.start); }

function renderSegs() {
  sortSegs();
  const box = $('#seg-list');
  box.innerHTML = '';
  $('#seg-empty').hidden = S.segs.length > 0;
  S.segs.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'seg';
    el.dataset.id = s.id;
    el.innerHTML =
      '<div class="seg-times">' +
      '<div><label>Início (s)</label><input type="number" step="0.1" min="0" data-k="start"></div>' +
      '<div><label>Fim (s)</label><input type="number" step="0.1" min="0" data-k="end"></div>' +
      '<button class="mini" data-act="go" title="Ir para o início">▶</button>' +
      '<button class="mini" data-act="del" title="Apagar">🗑</button>' +
      '</div>' +
      '<textarea rows="2" placeholder="Texto da legenda"></textarea>';
    const ins = el.querySelectorAll('input');
    ins[0].value = s.start.toFixed(1);
    ins[1].value = s.end.toFixed(1);
    const ta = el.querySelector('textarea');
    ta.value = s.text;
    ins.forEach((inp) => inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (isFinite(v)) s[inp.dataset.k] = clamp(v, 0, dur());
      if (s.end <= s.start) s.end = Math.min(dur(), s.start + 0.5);
      renderSegs();
    }));
    ta.addEventListener('input', () => { s.text = ta.value; if (!playing) draw(); });
    el.querySelector('[data-act=go]').addEventListener('click', () => { pause(); seekTo(s.start); });
    el.querySelector('[data-act=del]').addEventListener('click', () => {
      S.segs = S.segs.filter((x) => x.id !== s.id);
      renderSegs(); draw();
    });
    box.appendChild(el);
  });
  updateUI();
}

$('#btn-add-seg').addEventListener('click', () => {
  const t = voice.currentTime || 0;
  const next = S.segs.filter((s) => s.start > t).sort((a, b) => a.start - b.start)[0];
  const end = Math.min(dur(), next ? next.start : t + 2.5);
  S.segs.push({ id: nextId++, start: t, end: Math.max(end, t + 0.3), text: '' });
  renderSegs();
  const last = $('.seg[data-id="' + (nextId - 1) + '"] textarea');
  if (last) last.focus();
});

/* ---------- sincronização rápida ---------- */
const sync = { active: false, lines: [], i: 0 };

$('#btn-sync-open').addEventListener('click', () => { $('#sync-box').hidden = !$('#sync-box').hidden; });
$('#btn-sync-cancel').addEventListener('click', () => { $('#sync-box').hidden = true; });
$('#btn-sync-start').addEventListener('click', async () => {
  const lines = $('#sync-text').value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  if (S.segs.length && !confirm('Isso substitui as legendas atuais. Continuar?')) return;
  S.segs = [];
  sync.lines = lines; sync.i = 0; sync.active = true;
  $('#sync-box').hidden = true;
  $('#sync-live').hidden = false;
  renderSegs();
  seekTo(0);
  await play();
  updateSyncLabel();
});
function updateSyncLabel() {
  $('#sync-next').textContent = sync.i < sync.lines.length ? '“' + sync.lines[sync.i] + '”' : 'Toque para terminar';
  $('#btn-sync-tap').textContent = sync.i < sync.lines.length ? 'Começou! Próxima ▶' : 'Terminar ■';
}
$('#btn-sync-tap').addEventListener('click', () => {
  if (!sync.active) return;
  const t = voice.currentTime;
  const prev = S.segs[S.segs.length - 1];
  if (prev) prev.end = Math.max(t, prev.start + 0.2);
  if (sync.i < sync.lines.length) {
    S.segs.push({ id: nextId++, start: t, end: Math.min(dur(), t + 3), text: sync.lines[sync.i] });
    sync.i++;
    updateSyncLabel();
  } else {
    finishSync(t);
  }
});
$('#btn-sync-stop').addEventListener('click', () => finishSync(voice.currentTime));
function finishSync(t) {
  if (!sync.active) return;
  sync.active = false;
  const last = S.segs[S.segs.length - 1];
  if (last && last.end > t) last.end = Math.max(t, last.start + 0.2);
  $('#sync-live').hidden = true;
  pause();
  renderSegs();
}

/* ---------- ajustes ---------- */
$('#opt-editor').addEventListener('change', (e) => { S.showEditor = e.target.checked; draw(); });
$('#opt-burn').addEventListener('change', (e) => { S.burn = e.target.checked; });

/* ---------- exportação ---------- */
function pickMime() {
  const list = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

const ov = {
  box: $('#overlay'), title: $('#ov-title'), msg: $('#ov-msg'), bar: $('#ov-bar'),
  actions: $('#ov-actions'), cancel: $('#ov-cancel'),
};
function ovProgress(p, msg) {
  ov.bar.style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
  if (msg) ov.msg.textContent = msg;
}

let wakeLock = null;

$('#btn-export').addEventListener('click', exportVideo);
ov.cancel.addEventListener('click', () => { S.cancel = true; });
$('#ov-close').addEventListener('click', () => { ov.box.hidden = true; });
$('#ov-share').addEventListener('click', () => saveShare(S.lastBlob, S.lastName));
$('#ov-docs').addEventListener('click', () => saveDocs(S.lastBlob, S.lastName));

async function exportVideo() {
  if (S.exporting || !dur()) return;
  if (!window.MediaRecorder) { alert('Este aparelho não suporta exportar vídeo.'); return; }
  pause();
  initAudio();
  S.exporting = true; S.cancel = false;
  ov.box.hidden = false; ov.actions.hidden = true; ov.cancel.hidden = false;
  ov.title.textContent = 'Exportando…';
  ovProgress(0, 'Mantenha o app aberto e a tela ligada. Leva o tempo do áudio.');
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) { wakeLock = null; }

  gMon.gain.value = 0; // silencioso durante a gravação
  seekTo(0);
  await new Promise((r) => setTimeout(r, 400));

  const mime = pickMime();
  const stream = canvas.captureStream(30);
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  let rec;
  try {
    rec = new MediaRecorder(stream, Object.assign(
      mime ? { mimeType: mime } : {},
      { videoBitsPerSecond: 4000000, audioBitsPerSecond: 128000 }));
  } catch (e) {
    endExport(); alert('Não consegui iniciar a gravação: ' + e.message); return;
  }
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });

  rec.start(1000);
  try { await Promise.all([voice.play(), bg.play()]); } catch (e) { rec.stop(); endExport(); return; }
  playing = true;
  const total = dur();

  await new Promise((resolve) => {
    const tick = () => {
      const t = voice.currentTime;
      draw();
      ovProgress((t / total) * 0.8, 'Gravando… ' + fmt(t) + ' / ' + fmt(total));
      if (S.cancel || voice.ended || t >= total - 0.03) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });

  draw();
  await new Promise((r) => setTimeout(r, 250));
  rec.stop();
  voice.pause(); bg.pause(); playing = false;
  await stopped;
  gMon.gain.value = 1;

  if (S.cancel) { endExport(); ov.box.hidden = true; return; }

  let blob = new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' });
  let isMp4 = /mp4/.test(blob.type);

  if (!isMp4) {
    ovProgress(0.8, 'Convertendo para .mp4… (pode demorar)');
    try {
      blob = await webmToMp4(blob, (p) => ovProgress(0.8 + p * 0.2, 'Convertendo para .mp4… ' + Math.round(p * 100) + '%'));
      isMp4 = true;
    } catch (e) {
      console.warn('ffmpeg falhou', e);
    }
  }

  S.lastBlob = blob;
  S.lastName = 'video-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + (isMp4 ? '.mp4' : '.webm');
  ovProgress(1);
  ov.title.textContent = isMp4 ? 'Pronto! ✔' : 'Pronto (em .webm)';
  ov.msg.textContent = isMp4
    ? S.lastName
    : 'Este aparelho não gravou direto em .mp4 e a conversão não ficou disponível. O vídeo foi salvo em .webm.';
  ov.actions.hidden = false; ov.cancel.hidden = true;
  endExport();
  seekTo(0);
}

function endExport() {
  S.exporting = false;
  if (gMon) gMon.gain.value = 1;
  try { wakeLock && wakeLock.release(); } catch (e) { /* ignore */ }
  wakeLock = null;
  draw();
}

/* ---------- conversão webm -> mp4 (ffmpeg.wasm, só se faltar suporte nativo) ---------- */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('script ' + src));
    document.head.appendChild(s);
  });
}
async function webmToMp4(blob, onProgress) {
  if (!window.FFmpegWASM) await loadScript('vendor/ffmpeg/ffmpeg.js');
  const abs = (p) => new URL(p, location.href).href;
  const ff = new FFmpegWASM.FFmpeg();
  ff.on('progress', ({ progress }) => onProgress && onProgress(clamp(progress, 0, 1)));
  await ff.load({
    coreURL: abs('vendor/ffmpeg/core/ffmpeg-core.js'),
    wasmURL: abs('vendor/ffmpeg/core/ffmpeg-core.wasm'),
  });
  await ff.writeFile('in.webm', new Uint8Array(await blob.arrayBuffer()));
  const code = await ff.exec([
    '-i', 'in.webm', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'out.mp4',
  ]);
  if (code !== 0) throw new Error('ffmpeg exit ' + code);
  const data = await ff.readFile('out.mp4');
  ff.terminate();
  return new Blob([data.buffer], { type: 'video/mp4' });
}

/* ---------- salvar / compartilhar ---------- */
function blobToBase64(b) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}
function downloadWeb(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
async function saveShare(blob, name) {
  if (!blob) return;
  if (!isNative) return downloadWeb(blob, name);
  try {
    const { Filesystem, Share } = Cap.Plugins;
    const data = await blobToBase64(blob);
    const r = await Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
    await Share.share({ title: name, url: r.uri, dialogTitle: 'Salvar ou compartilhar o vídeo' });
  } catch (e) {
    if (!/cancel/i.test(String(e && e.message))) alert('Não deu pra compartilhar: ' + (e.message || e));
  }
}
async function saveDocs(blob, name) {
  if (!blob) return;
  if (!isNative) return downloadWeb(blob, name);
  try {
    const { Filesystem } = Cap.Plugins;
    try { await Filesystem.requestPermissions(); } catch (e) { /* ignore */ }
    const data = await blobToBase64(blob);
    const r = await Filesystem.writeFile({ path: 'VozELegenda/' + name, data, directory: 'DOCUMENTS', recursive: true });
    ov.msg.textContent = 'Salvo em Documentos/VozELegenda/' + name;
    console.log(r.uri);
  } catch (e) {
    alert('Não consegui salvar em Documentos. Use “Salvar / Compartilhar”.\n' + (e.message || e));
  }
}

})();
