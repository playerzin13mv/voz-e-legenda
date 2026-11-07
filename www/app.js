/* Voz e Legenda — vídeo de fundo + voz + legendas -> .mp4 */
(() => {
'use strict';

const N = window.Native;
const Store = window.Store;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const bg = $('#bg');
const voice = $('#voice');
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');

/* =====================================================================
   Utilidades
   ===================================================================== */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeName = (s) => (String(s).replace(/[^\p{L}\p{N}\-_ ]+/gu, '_').trim().slice(0, 40) || 'video');

const fmt = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
};
const fmtDur = (t) => {
  t = Math.round(t || 0);
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
};
const fmtSize = (b) => {
  b = b || 0;
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  return Math.max(1, Math.round(b / 1e3)) + ' KB';
};
const ago = (t) => {
  const s = (Date.now() - (t || 0)) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return 'há ' + Math.floor(s / 60) + ' min';
  if (s < 86400) return 'há ' + Math.floor(s / 3600) + ' h';
  return 'há ' + Math.floor(s / 86400) + ' d';
};

let toastT = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 3400);
}
function showBusy(msg) { $('#busy-msg').textContent = msg || 'Aguarde…'; $('#busy').hidden = false; }
function hideBusy() { $('#busy').hidden = true; }

/* ---------- diálogo genérico ---------- */
let dlgResolve = null;
function dialog({ title, text, input, buttons }) {
  return new Promise((res) => {
    $('#dlg-title').textContent = title || '';
    const t = $('#dlg-text');
    t.hidden = !text; t.textContent = text || '';
    const inp = $('#dlg-input');
    inp.hidden = input == null;
    if (input != null) inp.value = input;
    const box = $('#dlg-buttons');
    box.innerHTML = '';
    (buttons || [{ label: 'OK', value: true, kind: 'primary' }]).forEach((b) => {
      const el = document.createElement('button');
      el.className = 'btn' + (b.kind ? ' ' + b.kind : '');
      el.textContent = b.label;
      el.addEventListener('click', () => closeDialog(b.value));
      box.appendChild(el);
    });
    dlgResolve = (v) => res({ value: v, input: inp.value });
    $('#dialog').hidden = false;
    if (input != null) setTimeout(() => { inp.focus(); inp.select(); }, 60);
  });
}
function closeDialog(v) {
  $('#dialog').hidden = true;
  const r = dlgResolve; dlgResolve = null;
  if (r) r(v === undefined ? null : v);
}
async function askText(title, value) {
  const r = await dialog({ title, input: value || '', buttons: [{ label: 'Salvar', value: 'ok', kind: 'primary' }, { label: 'Cancelar', value: null }] });
  return r.value === 'ok' ? r.input.trim() : null;
}
async function askConfirm(title, text, okLabel) {
  const r = await dialog({ title, text, buttons: [{ label: okLabel || 'Sim', value: true, kind: 'danger' }, { label: 'Cancelar', value: false }] });
  return r.value === true;
}
async function askChoice(title, options) {
  const r = await dialog({ title, buttons: options.concat([{ label: 'Cancelar', value: null }]) });
  return r.value;
}

/* =====================================================================
   Ajustes
   ===================================================================== */
const DEFAULTS = {
  format: 'vertical', burn: true, showEditor: true, volBg: 0.4, volVoice: 1,
  subSize: 'media', subPos: 'baixo', subColor: '#ffffff', subBox: false,
  quality: 'media', fps: 30, keepAwake: true,
};
let S = Object.assign({}, DEFAULTS, Store.get('settings', {}));
const saveSettings = () => Store.set('settings', S);

const SCHEMA = [
  { h: 'Novos vídeos' },
  { k: 'format', t: 'select', l: 'Formato do vídeo', o: [['vertical', 'Vertical 9:16'], ['horizontal', 'Horizontal 16:9']] },
  { k: 'burn', t: 'toggle', l: 'Legendas no vídeo exportado' },
  { k: 'showEditor', t: 'toggle', l: 'Mostrar legendas no editor' },
  { k: 'volBg', t: 'range', l: 'Volume do fundo' },
  { k: 'volVoice', t: 'range', l: 'Volume da voz' },
  { h: 'Aparência da legenda' },
  { k: 'subSize', t: 'select', l: 'Tamanho', o: [['pequena', 'Pequena'], ['media', 'Média'], ['grande', 'Grande']] },
  { k: 'subPos', t: 'select', l: 'Posição', o: [['baixo', 'Embaixo'], ['meio', 'No meio'], ['cima', 'Em cima']] },
  { k: 'subColor', t: 'select', l: 'Cor', o: [['#ffffff', 'Branco'], ['#ffe14d', 'Amarelo'], ['#5eead4', 'Ciano'], ['#f9a8d4', 'Rosa'], ['#86efac', 'Verde']] },
  { k: 'subBox', t: 'toggle', l: 'Caixa escura atrás do texto' },
  { h: 'Exportação' },
  { k: 'quality', t: 'select', l: 'Qualidade', o: [['baixa', 'Baixa (540p, menor)'], ['media', 'Média (720p)'], ['alta', 'Alta (1080p, maior)']] },
  { k: 'fps', t: 'select', l: 'Quadros por segundo', num: true, o: [[24, '24'], [30, '30']] },
  { k: 'keepAwake', t: 'toggle', l: 'Manter a tela ligada ao exportar' },
];

function renderSettings() {
  const box = $('#settings-body');
  box.innerHTML = '';
  let group = null;
  SCHEMA.forEach((it) => {
    if (it.h) {
      group = document.createElement('div');
      group.className = 'sgroup';
      group.innerHTML = '<h3>' + esc(it.h) + '</h3>';
      box.appendChild(group);
      return;
    }
    const row = document.createElement('div');
    row.className = 'srow';
    row.innerHTML = '<span>' + esc(it.l) + '</span>';
    let ctl;
    if (it.t === 'toggle') {
      ctl = document.createElement('label');
      ctl.className = 'switch';
      ctl.innerHTML = '<input type="checkbox"><i></i>';
      const inp = ctl.querySelector('input');
      inp.checked = !!S[it.k];
      inp.addEventListener('change', () => { S[it.k] = inp.checked; saveSettings(); draw(); });
    } else if (it.t === 'range') {
      ctl = document.createElement('input');
      ctl.type = 'range'; ctl.min = 0; ctl.max = 1; ctl.step = 0.01; ctl.value = S[it.k];
      ctl.addEventListener('input', () => { S[it.k] = parseFloat(ctl.value); saveSettings(); });
    } else {
      ctl = document.createElement('select');
      it.o.forEach(([v, name]) => {
        const op = document.createElement('option');
        op.value = v; op.textContent = name;
        if (String(S[it.k]) === String(v)) op.selected = true;
        ctl.appendChild(op);
      });
      ctl.addEventListener('change', () => { S[it.k] = it.num ? Number(ctl.value) : ctl.value; saveSettings(); draw(); });
    }
    row.appendChild(ctl);
    group.appendChild(row);
  });

  // armazenamento
  const st = document.createElement('div');
  st.className = 'sgroup';
  st.innerHTML = '<h3>Armazenamento</h3><div class="sinfo" id="st-info">Calculando…</div>' +
    '<div class="col"><button class="btn small" id="st-unused">🧹 Remover arquivos sem uso</button>' +
    '<button class="btn small" id="st-cache">🗑 Limpar vídeos exportados temporários</button></div>';
  box.appendChild(st);
  $('#st-unused').addEventListener('click', async () => {
    const freed = await removeUnusedMedia();
    toast(freed > 0 ? 'Liberei ' + fmtSize(freed) : 'Nada sem uso para remover.');
    refreshStorage();
  });
  $('#st-cache').addEventListener('click', async () => {
    if (N.MediaLib && N.paths.cache) { try { await N.MediaLib.remove({ path: N.paths.cache + '/exports' }); } catch (e) { /* ignora */ } }
    toast('Cache limpo.');
    refreshStorage();
  });

  const ab = document.createElement('div');
  ab.className = 'sgroup';
  ab.innerHTML = '<h3>Sobre</h3><div class="sinfo">Voz e Legenda 2.1<br>Seus projetos ficam salvos no aparelho e continuam aí mesmo se o app fechar. ' +
    'Vídeos exportados vão para <b>Filmes/VozELegenda</b> na galeria.</div>';
  box.appendChild(ab);
  refreshStorage();
}

async function refreshStorage() {
  const el = $('#st-info');
  if (!el) return;
  if (!N.MediaLib || !N.paths.files) { el.textContent = 'Disponível no aplicativo instalado.'; return; }
  const size = async (p) => { try { return (await N.MediaLib.listDir({ path: p })).size || 0; } catch (e) { return 0; } };
  const [m, mods, cache] = await Promise.all([
    size(N.paths.files + '/media'), size(N.paths.files + '/mods'), size(N.paths.cache + '/exports'),
  ]);
  el.innerHTML = 'Vídeos e áudios dos projetos: <b>' + fmtSize(m) + '</b><br>Mods: <b>' + fmtSize(mods) + '</b><br>Exportações temporárias: <b>' + fmtSize(cache) + '</b>';
}

/* =====================================================================
   Navegação
   ===================================================================== */
const stack = ['home'];
let currentTab = 'videos';

function showScreen(id) {
  $$('.screen').forEach((e) => e.classList.toggle('active', e.id === 'screen-' + id));
  window.scrollTo(0, 0);
}
function saveUi() {
  Store.set('ui', { stack: stack.slice(), projectId: cur ? cur.id : null, modId: curMod ? curMod.id : null, tab: currentTab });
}
function push(id) { stack.push(id); showScreen(id); saveUi(); }
function pop() {
  if (stack.length <= 1) return;
  const leaving = stack.pop();
  if (leaving === 'editor') leaveEditor();
  if (leaving === 'mod') { stopPreview(); curMod = null; }
  showScreen(stack[stack.length - 1]);
  saveUi();
}
function setTab(t) {
  currentTab = t;
  $$('.tab').forEach((e) => e.classList.toggle('active', e.id === 'tab-' + t));
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  if (t === 'settings') renderSettings();
  window.scrollTo(0, 0);
  saveUi();
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$$('[data-back]').forEach((b) => b.addEventListener('click', () => handleBack()));

function handleBack() {
  if (!$('#dialog').hidden) { closeDialog(null); return; }
  if (!$('#busy').hidden) return;
  if (!$('#browser').hidden) { Browser.cancel(); return; }
  if (!$('#overlay').hidden) {
    if (X.running) { toast('Toque em Cancelar para parar a exportação.'); return; }
    $('#overlay').hidden = true; return;
  }
  if (stack.length > 1) { pop(); return; }
  if (currentTab !== 'videos') { setTab('videos'); return; }
  if (N.App && N.App.minimizeApp) N.App.minimizeApp();
}
if (N.App) {
  N.App.addListener('backButton', handleBack);
  N.App.addListener('appStateChange', (s) => { if (!s.isActive) onHide(); });
}
function onHide() {
  if (X.running) return;
  if (playing) pause();
  flush(false);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); });
window.addEventListener('pagehide', () => { if (!X.running) flush(false); });

/* =====================================================================
   Projetos (lista)
   ===================================================================== */
const projIds = () => Store.get('projects', []);
const getProject = (id) => Store.get('p.' + id, null);
function saveProject(p) {
  const ok = Store.set('p.' + p.id, p);
  const ids = projIds();
  if (!ids.includes(p.id)) { ids.unshift(p.id); Store.set('projects', ids); }
  if (!ok) toast('Sem espaço para salvar o projeto.');
}
function deleteProject(id) {
  Store.del('p.' + id);
  Store.set('projects', projIds().filter((x) => x !== id));
}

function renderVideos() {
  const list = projIds().map(getProject).filter(Boolean).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const box = $('#list-videos');
  box.innerHTML = '';
  $('#empty-videos').hidden = list.length > 0;
  list.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'pcard';
    el.dataset.id = p.id;
    el.tabIndex = 0;
    const n = (p.segs || []).length;
    el.innerHTML =
      '<div class="pthumb' + (p.format === 'horizontal' ? ' h' : '') + '"' + (p.thumb ? " style=\"background-image:url('" + p.thumb + "')\"" : '') + '>' + (p.thumb ? '' : '🎬') + '</div>' +
      '<div class="pinfo"><b>' + esc(p.name) + '</b>' +
      '<span>' + (p.format === 'horizontal' ? '16:9' : '9:16') + ' · ' + (p.duration ? fmtDur(p.duration) : '—') + ' · ' + n + ' legenda' + (n === 1 ? '' : 's') + '</span>' +
      '<span>editado ' + ago(p.updated) + '</span></div>' +
      '<button class="pmenu" aria-label="Opções">⋮</button>';
    el.addEventListener('click', (e) => {
      if (e.target.closest('.pmenu')) { projectMenu(p); return; }
      openEditor(p);
    });
    box.appendChild(el);
  });
}

async function projectMenu(p) {
  const act = await askChoice(p.name, [
    { label: '✏️ Renomear', value: 'ren' },
    { label: '📄 Duplicar', value: 'dup' },
    { label: '🗑 Apagar', value: 'del', kind: 'danger' },
  ]);
  if (act === 'ren') {
    const nm = await askText('Novo nome', p.name);
    if (nm) { p.name = nm; p.updated = Date.now(); saveProject(p); renderVideos(); }
  } else if (act === 'dup') {
    const c = JSON.parse(JSON.stringify(p));
    c.id = uid(); c.name = p.name + ' (cópia)'; c.created = c.updated = Date.now();
    saveProject(c); renderVideos(); toast('Projeto duplicado.');
  } else if (act === 'del') {
    if (await askConfirm('Apagar “' + p.name + '”?', 'As legendas deste projeto serão apagadas.', 'Apagar')) {
      deleteProject(p.id); renderVideos(); removeUnusedMedia();
    }
  }
}

async function removeUnusedMedia() {
  if (!N.MediaLib || !N.paths.files) return 0;
  try {
    const used = new Set();
    projIds().map(getProject).filter(Boolean).forEach((p) => {
      if (p.bg && p.bg.path) used.add(p.bg.path);
      if (p.voice && p.voice.path) used.add(p.voice.path);
    });
    const r = await N.MediaLib.listDir({ path: N.paths.files + '/media' });
    let freed = 0;
    for (const f of r.files || []) {
      if (!used.has(f.path)) { await N.MediaLib.remove({ path: f.path }); freed += f.size || 0; }
    }
    return freed;
  } catch (e) { return 0; }
}

/* =====================================================================
   Navegador de arquivos do app (galeria do telefone por álbuns)
   ===================================================================== */
const AUDIO_RE = /\.(wav|mp3|ogg|oga|m4a|aac|flac|opus)$/i;
const VIDEO_RE = /\.(mp4|webm|ogv|mkv|mov|3gp|m4v)$/i;
const IMG_RE = /\.(png|jpe?g|webp)$/i;

const modFilesCache = new Map();

const Browser = (() => {
  const el = $('#browser');
  let st = null;
  const thumbCache = new Map();
  const thumbQ = [];
  let thumbBusy = 0;
  let io = null;

  const isOpen = () => !el.hidden;

  function webPick(opts) {
    return new Promise((res) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = !!opts.multi;
      inp.accept = opts.types.map((t) => t + '/*').join(',');
      inp.onchange = () => {
        const fs = Array.from(inp.files || []);
        res(fs.length ? fs.map((f) => ({ path: URL.createObjectURL(f), name: f.name, size: f.size })) : null);
      };
      inp.click();
    });
  }

  function open(opts) {
    if (!N.MediaLib) return webPick(opts);
    return new Promise((resolve) => {
      st = {
        opts, resolve, type: opts.types[0], albums: [], albumId: '__recent', files: [], total: 0,
        sel: new Map(), gen: 0, permOk: false,
      };
      el.hidden = false;
      $('#br-title').textContent = opts.title || 'Escolher';
      $('#br-types').hidden = opts.types.length < 2;
      $('#br-ok').hidden = !opts.multi;
      updateTypeButtons();
      updateOk();
      loadAlbums();
    });
  }

  function finish(result) {
    if (!st) return;
    el.hidden = true;
    const r = st.resolve;
    st = null;
    r(result);
  }
  function cancel() { finish(null); }

  function setMsg(html, withPerm) {
    const m = $('#br-msg');
    if (!html) { m.hidden = true; m.innerHTML = ''; return; }
    m.hidden = false;
    m.innerHTML = '<span>' + html + '</span>' + (withPerm ? '<button class="btn primary small" id="br-perm">Permitir acesso</button>' : '');
    const b = $('#br-perm');
    if (b) b.addEventListener('click', () => loadAlbums());
  }

  function updateTypeButtons() {
    $$('#br-types button').forEach((b) => b.classList.toggle('on', b.dataset.type === st.type));
  }
  function updateOk() {
    const b = $('#br-ok');
    b.textContent = st && st.sel.size ? 'Usar (' + st.sel.size + ')' : 'Usar';
    b.disabled = !st || st.sel.size === 0;
  }

  async function loadAlbums() {
    if (!st) return;
    setMsg('Carregando…');
    $('#br-grid').innerHTML = '';
    if (!st.permOk) {
      let r = { granted: false };
      try { r = await N.MediaLib.ensurePermission(); } catch (e) { /* ignora */ }
      st.permOk = !!r.granted;
    }
    if (!st) return;
    if (!st.permOk) {
      setMsg('Preciso de permissão para ver seus vídeos e áudios.<br><small>Se o Android não perguntar, abra Ajustes › Apps › Voz e Legenda › Permissões.</small>', true);
      $('#br-albums').innerHTML = '';
      return;
    }
    try {
      const r = await N.MediaLib.listAlbums({ type: st.type });
      st.albums = r.albums || [];
      st.total = r.total || 0;
    } catch (e) {
      setMsg('Não consegui ler a galeria: ' + esc(e.message || e));
      return;
    }
    if (!st) return;
    renderAlbums();
    await loadFiles(true);
  }

  function renderAlbums() {
    const box = $('#br-albums');
    box.innerHTML = '';
    const real = st.albums.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt'));
    const dl = real.filter((a) => /^download/i.test(a.name));
    const rest = real.filter((a) => !/^download/i.test(a.name));
    const chips = [{ id: '__recent', name: 'Recentes' }, { id: '__all', name: 'Todos', count: st.total }]
      .concat(dl, rest);
    if (Store.get('mods', []).length) chips.push({ id: '__mods', name: '📦 Mods' });
    chips.forEach((a) => {
      const b = document.createElement('button');
      b.dataset.id = a.id;
      b.classList.toggle('on', a.id === st.albumId);
      b.innerHTML = esc(a.name) + (a.count != null ? '<small>' + a.count + '</small>' : '');
      b.addEventListener('click', () => {
        st.albumId = a.id;
        $$('#br-albums button').forEach((x) => x.classList.toggle('on', x === b));
        loadFiles(true);
      });
      box.appendChild(b);
    });
  }

  async function loadFiles(reset) {
    if (!st) return;
    const gen = ++st.gen;
    if (reset) { st.files = []; $('#br-grid').innerHTML = ''; }
    $('#br-more').hidden = true;
    setMsg('');

    if (st.albumId === '__mods') {
      const list = await allModFiles(st.type);
      if (!st || gen !== st.gen) return;
      st.files = list;
      appendTiles(list);
      if (!list.length) setMsg('Nenhum ' + (st.type === 'audio' ? 'áudio' : 'vídeo') + ' nos seus mods.');
      return;
    }

    const recent = st.albumId === '__recent';
    const args = { type: st.type, offset: st.files.length, limit: recent ? 100 : 150 };
    if (!recent && st.albumId !== '__all') args.bucketId = st.albumId;
    let r;
    try { r = await N.MediaLib.listFiles(args); } catch (e) { setMsg('Não consegui listar: ' + esc(e.message || e)); return; }
    if (!st || gen !== st.gen) return;
    const add = r.files || [];
    st.total = r.total || 0;
    st.files = st.files.concat(add);
    appendTiles(add);
    $('#br-more').hidden = recent || st.files.length >= st.total;
    if (!st.files.length) setMsg('Nada encontrado aqui.');
  }

  function appendTiles(list) {
    const grid = $('#br-grid');
    list.forEach((f) => grid.appendChild(tile(f)));
  }

  function key(f) { return f.uri || f.path; }

  function tile(f) {
    const d = document.createElement('button');
    d.className = 'tile';
    d.dataset.key = key(f);
    const dur = f.duration ? fmtDur(f.duration / 1000) + ' · ' : '';
    d.innerHTML =
      '<div class="tthumb">' + (st.type === 'audio' ? '🎵' : '🎬') + '</div>' +
      '<div class="tname">' + esc(f.name) + '</div>' +
      '<div class="tmeta">' + dur + fmtSize(f.size) + '</div><i class="tcheck">✓</i>';
    if (st.opts.multi && st.sel.has(key(f))) d.classList.add('sel');
    d.addEventListener('click', () => pick(f, d));
    if (st.type === 'video' && f.uri) observe(d, f);
    return d;
  }

  function observe(d, f) {
    if (!('IntersectionObserver' in window)) { queueThumb(d, f); return; }
    if (!io) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            io.unobserve(e.target);
            if (e.target._f) queueThumb(e.target, e.target._f);
          }
        });
      }, { root: $('#br-grid'), rootMargin: '200px' });
    }
    d._f = f;
    io.observe(d);
  }

  function queueThumb(d, f) {
    if (thumbCache.has(f.uri)) { applyThumb(d, thumbCache.get(f.uri)); return; }
    thumbQ.push({ d, f });
    pumpThumbs();
  }
  function applyThumb(d, data) {
    const t = d.querySelector('.tthumb');
    if (t && data) { t.style.backgroundImage = "url('" + data + "')"; t.textContent = ''; }
  }
  function pumpThumbs() {
    while (thumbBusy < 3 && thumbQ.length) {
      const { d, f } = thumbQ.shift();
      if (!d.isConnected) continue;
      thumbBusy++;
      N.MediaLib.thumb({ uri: f.uri, type: 'video', size: 200 })
        .then((r) => { thumbCache.set(f.uri, r && r.data ? r.data : ''); applyThumb(d, r && r.data); })
        .catch(() => { thumbCache.set(f.uri, ''); })
        .finally(() => { thumbBusy--; pumpThumbs(); });
    }
  }

  async function importOne(f, label) {
    if (f.path) return { path: f.path, name: f.name, size: f.size };
    showBusy(label || ('Importando ' + f.name + '…'));
    try {
      const r = await N.MediaLib.copyToApp({ uri: f.uri, name: f.name, subdir: st ? (st.opts.subdir || 'media') : 'media' });
      return { path: r.path, name: f.name, size: r.size };
    } catch (e) {
      toast('Não consegui abrir “' + f.name + '”: ' + (e.message || e));
      return null;
    } finally { hideBusy(); }
  }

  async function pick(f, tileEl) {
    if (!st) return;
    if (st.opts.multi) {
      const k = key(f);
      if (st.sel.has(k)) { st.sel.delete(k); tileEl.classList.remove('sel'); }
      else { st.sel.set(k, f); tileEl.classList.add('sel'); }
      updateOk();
      return;
    }
    const r = await importOne(f);
    if (r) finish([r]);
  }

  async function importMany(files) {
    const out = [];
    for (let i = 0; i < files.length; i++) {
      const r = await importOne(files[i], 'Importando ' + (i + 1) + '/' + files.length + '…');
      if (r) out.push(r);
    }
    return out;
  }

  $('#br-close').addEventListener('click', cancel);
  $('#br-ok').addEventListener('click', async () => {
    if (!st || !st.sel.size) return;
    const out = await importMany(Array.from(st.sel.values()));
    if (out.length) finish(out);
  });
  $('#br-more').addEventListener('click', () => loadFiles(false));
  $$('#br-types button').forEach((b) => b.addEventListener('click', () => {
    if (!st || st.type === b.dataset.type) return;
    st.type = b.dataset.type;
    st.albumId = '__recent';
    updateTypeButtons();
    loadAlbums();
  }));
  $('#br-other').addEventListener('click', async () => {
    if (!st) return;
    const mimes = st.opts.types.map((t) => t + '/*');
    let r;
    try { r = await N.MediaLib.pickDocument({ types: mimes, multiple: !!st.opts.multi }); }
    catch (e) { toast('Não consegui abrir o seletor: ' + (e.message || e)); return; }
    const files = (r && r.files) || [];
    if (!files.length) return;
    const out = await importMany(files);
    if (out.length) finish(out);
  });

  return { open, cancel, isOpen };
})();

/* =====================================================================
   Mods
   ===================================================================== */
const KIND_LABEL = { dub: 'Pacote de dublagem', voice: 'Pacote de voz', studio: 'Pacote de estúdio', clips: 'Clipes', other: 'Mod' };
const KIND_ICON = { dub: '🎤', voice: '🎙️', studio: '🎬', clips: '🎞️', other: '📦' };
let curMod = null;

const getMods = () => Store.get('mods', []);
const saveMods = (m) => Store.set('mods', m);

async function scanMod(dir) {
  const r = await N.MediaLib.listDir({ path: dir });
  const files = r.files || [];
  const audio = files.filter((f) => AUDIO_RE.test(f.name)).length;
  const video = files.filter((f) => VIDEO_RE.test(f.name)).length;
  const studio = files.some((f) => /^(model|music_studio|screen|absolute_image)\./i.test(f.name));
  // pacote de dublagem do Choicer Voicer: dub_video + _backing_track (instrumental) + uma fala por arquivo
  const dub = files.some((f) => /^(dub_video|_backing_track)\./i.test(f.name));
  const kind = dub ? 'dub' : studio ? 'studio' : audio ? 'voice' : video ? 'clips' : 'other';
  const icon = files.find((f) => /^(_icon|icon|_pack_filler_image)\.(png|jpe?g|webp)$/i.test(f.name));
  return { files, kind, audio, video, icon: icon ? icon.path : null, size: r.size || 0 };
}

async function registerMod(dir, name) {
  const info = await scanMod(dir);
  const mods = getMods();
  const prev = mods.find((m) => m.dir === dir);
  const mod = prev || { id: uid(), dir, added: Date.now() };
  Object.assign(mod, { name: prev ? prev.name : name, kind: info.kind, audio: info.audio, video: info.video, icon: info.icon, size: info.size });
  if (!prev) mods.unshift(mod);
  saveMods(mods);
  modFilesCache.delete(mod.id);
  return mod;
}

function renderMods() {
  const mods = getMods();
  const box = $('#list-mods');
  box.innerHTML = '';
  $('#empty-mods').hidden = mods.length > 0;
  mods.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'pcard';
    el.tabIndex = 0;
    const th = m.icon ? " style=\"background-image:url('" + N.fileUrl(m.icon) + "')\"" : '';
    const parts = [];
    if (m.audio) parts.push(m.audio + ' áudio' + (m.audio === 1 ? '' : 's'));
    if (m.video) parts.push(m.video + ' vídeo' + (m.video === 1 ? '' : 's'));
    el.innerHTML =
      '<div class="pthumb"' + th + '>' + (m.icon ? '' : KIND_ICON[m.kind] || '📦') + '</div>' +
      '<div class="pinfo"><b>' + esc(m.name) + '</b><span>' + KIND_LABEL[m.kind] + (parts.length ? ' · ' + parts.join(', ') : '') + '</span>' +
      '<span>' + fmtSize(m.size) + '</span></div><button class="pmenu" aria-label="Opções">⋮</button>';
    el.addEventListener('click', (e) => {
      if (e.target.closest('.pmenu')) { modMenu(m); return; }
      openMod(m);
    });
    box.appendChild(el);
  });
}

async function modMenu(m) {
  const act = await askChoice(m.name, [
    { label: '✏️ Renomear', value: 'ren' },
    { label: '🔄 Reescanear pasta', value: 'scan' },
    { label: '🗑 Apagar mod', value: 'del', kind: 'danger' },
  ]);
  if (act === 'ren') {
    const nm = await askText('Novo nome', m.name);
    if (nm) { const mods = getMods(); const x = mods.find((y) => y.id === m.id); if (x) { x.name = nm; saveMods(mods); renderMods(); } }
  } else if (act === 'scan') {
    try { await registerMod(m.dir, m.name); renderMods(); toast('Mod atualizado.'); } catch (e) { toast('Não consegui reescanear.'); }
  } else if (act === 'del') {
    if (await askConfirm('Apagar mod “' + m.name + '”?', 'Os arquivos do mod serão removidos do app.', 'Apagar')) {
      try { await N.MediaLib.remove({ path: m.dir }); } catch (e) { /* ignora */ }
      saveMods(getMods().filter((x) => x.id !== m.id));
      modFilesCache.delete(m.id);
      renderMods();
    }
  }
}

async function modFiles(m) {
  if (modFilesCache.has(m.id)) return modFilesCache.get(m.id);
  const r = await N.MediaLib.listDir({ path: m.dir });
  const list = (r.files || []).sort((a, b) => a.rel.localeCompare(b.rel, 'pt', { numeric: true }));
  modFilesCache.set(m.id, list);
  return list;
}
async function allModFiles(type) {
  if (!N.MediaLib) return [];
  const re = type === 'audio' ? AUDIO_RE : VIDEO_RE;
  const out = [];
  for (const m of getMods()) {
    try { (await modFiles(m)).filter((f) => re.test(f.name)).forEach((f) => out.push({ path: f.path, name: f.name, size: f.size })); } catch (e) { /* ignora */ }
  }
  return out;
}

/** Mostra um erro que fica na tela (o aviso rápido some antes de dar tempo de ler). */
function showError(title, err) {
  const msg = err && err.message ? err.message : String(err || '');
  return dialog({ title, text: msg, buttons: [{ label: 'OK', value: true, kind: 'primary' }] });
}

async function addModZip() {
  if (!N.MediaLib) { toast('Importar mods funciona no aplicativo instalado.'); return; }
  // se o Android fechar o app enquanto o seletor está aberto, o resultado volta em "appRestoredResult"
  Store.set('pendingPick', { purpose: 'modzip', at: Date.now() });
  let r;
  try {
    // sem filtro de tipo: muitos aparelhos classificam .zip de formas diferentes e escondem o arquivo
    r = await N.MediaLib.pickDocument({ types: ['*/*'], multiple: false });
  } catch (e) {
    Store.del('pendingPick');
    await showError('Não consegui abrir o seletor de arquivos', e);
    return;
  }
  Store.del('pendingPick');
  const f = r && r.files && r.files[0];
  if (f) await importZipFile(f);
}

async function importZipFile(f) {
  const base = f.name.replace(/\.zip$/i, '');
  if (!/\.zip$/i.test(f.name)) {
    if (!(await askConfirm('Esse arquivo não termina em .zip', '“' + f.name + '” pode não ser um pacote de mod. Tentar importar mesmo assim?', 'Tentar'))) return;
  }
  const name = await askText('Nome do mod', base);
  if (!name) return;
  showBusy('Importando mod… (pode levar um tempo em pacotes grandes)');
  let u = null;
  try {
    u = await N.MediaLib.unzip({ uri: f.uri, name });
    if (!u.files) {
      try { await N.MediaLib.remove({ path: u.path }); } catch (e) { /* ignora */ }
      hideBusy();
      await showError('Zip vazio', 'Não encontrei arquivos dentro de “' + f.name + '”.');
      return;
    }
    await registerMod(u.path, name);
    renderMods();
    hideBusy();
    toast('Mod “' + name + '” importado (' + u.files + ' arquivos).');
  } catch (e) {
    hideBusy();
    if (u && u.path) { try { await N.MediaLib.remove({ path: u.path }); } catch (e2) { /* ignora */ } }
    await showError('Não consegui importar “' + f.name + '”', e);
  }
}

// retoma a importação se o app foi fechado pelo Android enquanto o seletor estava aberto
if (N.App) {
  N.App.addListener('appRestoredResult', async (ev) => {
    try {
      if (!ev || ev.pluginId !== 'MediaLib' || ev.methodName !== 'pickDocument') return;
      const pend = Store.get('pendingPick', null);
      Store.del('pendingPick');
      const files = (ev.data && ev.data.files) || [];
      if (ev.success && pend && pend.purpose === 'modzip' && files[0]) { setTab('mods'); await importZipFile(files[0]); }
    } catch (e) { /* ignora */ }
  });
}

async function addModFiles() {
  if (!N.MediaLib) { toast('Importar mods funciona no aplicativo instalado.'); return; }
  const name = await askText('Nome do mod', 'Meu mod');
  if (!name) return;
  const sub = 'mods/' + safeName(name);
  const picked = await Browser.open({ title: 'Escolher clipes do mod', types: ['audio', 'video'], multi: true, subdir: sub });
  if (!picked || !picked.length) return;
  showBusy('Criando mod…');
  try {
    await registerMod(N.paths.files + '/' + sub, name);
    renderMods();
    toast('Mod criado.');
  } catch (e) { toast('Não consegui criar o mod: ' + (e.message || e)); }
  finally { hideBusy(); }
}

$('#btn-mod-zip').addEventListener('click', addModZip);
$('#btn-mod-files').addEventListener('click', addModFiles);

/* ---------- detalhe do mod ---------- */
const preview = $('#preview');
let previewPath = null;
function stopPreview() { preview.pause(); previewPath = null; $$('.mrow .pv').forEach((b) => { b.textContent = '▶'; }); }

async function openMod(m) {
  curMod = m;
  $('#mod-title').textContent = m.name;
  $('#mod-sub').textContent = KIND_LABEL[m.kind] + ' — toque em ▶ para ouvir e use os clipes nos seus vídeos.';
  const box = $('#mod-files');
  box.innerHTML = '';
  push('mod');
  let files = [];
  try { files = await modFiles(m); } catch (e) { toast('Não consegui ler o mod.'); }
  const media = files.filter((f) => AUDIO_RE.test(f.name) || VIDEO_RE.test(f.name));
  $('#mod-empty').hidden = media.length > 0;
  media.forEach((f) => {
    const isAudio = AUDIO_RE.test(f.name);
    const row = document.createElement('div');
    row.className = 'mrow';
    row.innerHTML =
      '<button class="mini pv" aria-label="Ouvir">▶</button>' +
      '<div class="mname">' + (isAudio ? '🎵 ' : '🎬 ') + esc(f.name) + '<small>' + esc(f.rel.includes('/') ? f.rel : '') + ' ' + fmtSize(f.size) + '</small></div>' +
      '<button class="btn use">' + (isAudio ? '🎙 Voz' : '🎬 Fundo') + '</button>';
    const pv = row.querySelector('.pv');
    pv.addEventListener('click', () => togglePreview(f, pv, isAudio));
    row.querySelector('.use').addEventListener('click', () => {
      stopPreview();
      startDraft(isAudio ? { voice: { path: f.path, name: f.name } } : { bg: { path: f.path, name: f.name } });
    });
    box.appendChild(row);
  });
}

function togglePreview(f, btn, isAudio) {
  if (previewPath === f.path && !preview.paused) { stopPreview(); return; }
  stopPreview();
  if (!isAudio) { toast('Prévia de vídeo: use “Fundo” e veja no editor.'); return; }
  previewPath = f.path;
  preview.src = N.fileUrl(f.path);
  preview.play().then(() => { btn.textContent = '⏸'; }).catch(() => toast('Não consegui tocar esse áudio.'));
  preview.onended = () => stopPreview();
}

/* =====================================================================
   Novo projeto
   ===================================================================== */
let draft = null;

function startDraft(pre) {
  draft = Object.assign({ name: '', format: S.format, bg: null, voice: null }, pre || {});
  renderSetup();
  push('setup');
}
function renderSetup() {
  $('#su-name').value = draft.name;
  $('#su-name').placeholder = 'Projeto ' + (projIds().length + 1);
  const set = (id, textId, f, icon) => {
    $(id).classList.toggle('done', !!f);
    $(textId).textContent = f ? '✔ ' + f.name : icon;
  };
  set('#su-bg', '#su-bg-text', draft.bg, 'Escolher vídeo');
  set('#su-voice', '#su-voice-text', draft.voice, 'Escolher áudio');
  $$('#su-format .chip').forEach((c) => c.classList.toggle('on', c.dataset.format === draft.format));
  $('#su-create').disabled = !(draft.bg && draft.voice);
}
$('#su-name').addEventListener('input', (e) => { draft.name = e.target.value; });
$('#fab-new').addEventListener('click', () => startDraft());
$('#su-bg').addEventListener('click', async () => {
  const r = await Browser.open({ title: 'Vídeo de fundo', types: ['video'] });
  if (r && r[0]) { draft.bg = r[0]; renderSetup(); }
});
$('#su-voice').addEventListener('click', async () => {
  const r = await Browser.open({ title: 'Áudio da voz', types: ['audio', 'video'] });
  if (r && r[0]) { draft.voice = r[0]; renderSetup(); }
});
$$('#su-format .chip').forEach((c) => c.addEventListener('click', () => { draft.format = c.dataset.format; renderSetup(); }));
$('#su-create').addEventListener('click', () => {
  if (!draft || !draft.bg || !draft.voice) return;
  const now = Date.now();
  const p = {
    id: uid(),
    name: (draft.name || '').trim() || 'Projeto ' + (projIds().length + 1),
    created: now, updated: now,
    format: draft.format,
    bg: draft.bg, voice: draft.voice,
    segs: [], duration: 0, pos: 0, thumb: null,
    opts: { burn: S.burn, showEditor: S.showEditor, volBg: S.volBg, volVoice: S.volVoice },
  };
  saveProject(p);
  draft = null;
  stack.pop(); // sai do "novo projeto"
  renderVideos();
  openEditor(p);
});

/* =====================================================================
   Editor
   ===================================================================== */
let cur = null;
let nextId = 1;
const DIMS = {
  baixa: { vertical: [540, 960], horizontal: [960, 540] },
  media: { vertical: [720, 1280], horizontal: [1280, 720] },
  alta: { vertical: [1080, 1920], horizontal: [1920, 1080] },
};
const dur = () => (isFinite(voice.duration) ? voice.duration : 0);

function setCanvasSize(w, h) { canvas.width = w; canvas.height = h; }
function editorDims() { return DIMS.media[cur ? cur.format : 'vertical']; }

/* ---------- áudio: fundo + voz ---------- */
let AC = null, gBg, gVoice, gMon, dest;
function initAudio() {
  if (AC) { AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  const sBg = AC.createMediaElementSource(bg);
  const sVoice = AC.createMediaElementSource(voice);
  gBg = AC.createGain(); gVoice = AC.createGain(); gMon = AC.createGain();
  dest = AC.createMediaStreamDestination();
  sBg.connect(gBg); sVoice.connect(gVoice);
  gBg.connect(dest); gVoice.connect(dest);
  gBg.connect(gMon); gVoice.connect(gMon);
  gMon.connect(AC.destination);
  applyVolumes();
  AC.resume();
}
function applyVolumes() {
  if (!AC || !cur) return;
  gBg.gain.value = cur.opts.volBg;
  gVoice.gain.value = cur.opts.volVoice;
}

/* ---------- salvar ---------- */
let saveT = 0;
function touch() {
  if (!cur) return;
  cur.updated = Date.now();
  clearTimeout(saveT);
  saveT = setTimeout(() => saveProject(cur), 500);
}
function makeThumb() {
  try {
    if (bg.readyState < 2) return null;
    const w = 160, h = Math.round(160 * canvas.height / canvas.width);
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    const c = t.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    const vw = bg.videoWidth, vh = bg.videoHeight;
    if (!vw || !vh) return null;
    const s = Math.max(w / vw, h / vh);
    c.drawImage(bg, (w - vw * s) / 2, (h - vh * s) / 2, vw * s, vh * s);
    return t.toDataURL('image/jpeg', 0.6);
  } catch (e) { return null; }
}
function flush(withThumb) {
  clearTimeout(saveT);
  if (!cur) return;
  cur.pos = voice.currentTime || 0;
  if (dur()) cur.duration = dur();
  if (withThumb) { const t = makeThumb(); if (t) cur.thumb = t; }
  saveProject(cur);
}

/* ---------- abrir / fechar ---------- */
function whenReady(el, ms) {
  return new Promise((res, rej) => {
    if (el.readyState >= 1) return res();
    const timer = setTimeout(() => { cleanup(); rej(new Error('tempo esgotado')); }, ms || 12000);
    const ok = () => { cleanup(); res(); };
    const bad = () => { cleanup(); rej(new Error('erro')); };
    const cleanup = () => { clearTimeout(timer); el.removeEventListener('loadedmetadata', ok); el.removeEventListener('error', bad); };
    el.addEventListener('loadedmetadata', ok);
    el.addEventListener('error', bad);
    el.load();
  });
}

/** Texto curto explicando por que um vídeo/áudio não abriu (ajuda a achar o problema). */
async function mediaDiag(el, path) {
  const names = { 1: 'cancelado', 2: 'erro de leitura', 3: 'erro ao decodificar', 4: 'formato não suportado' };
  const code = el.error ? el.error.code : 0;
  let srv = '';
  try {
    const r = await fetch(N.fileUrl(path), { headers: { Range: 'bytes=0-1' } });
    srv = 'arquivo ' + r.status + (r.headers.get('content-range') ? ' (' + r.headers.get('content-range') + ')' : '');
  } catch (e) { srv = 'arquivo inacessível (' + (e.message || e) + ')'; }
  return (names[code] || (code ? 'erro ' + code : 'sem resposta')) + ' · ' + srv + ' · ' + String(path).split('/').pop();
}

async function loadMedia() {
  const warn = $('#ed-warn');
  warn.hidden = true;
  bg.src = N.fileUrl(cur.bg.path);
  voice.src = N.fileUrl(cur.voice.path);
  const rs = await Promise.allSettled([whenReady(bg), whenReady(voice)]);
  const miss = [];
  const diag = [];
  if (rs[0].status === 'rejected') { miss.push('o vídeo de fundo'); diag.push('Fundo: ' + await mediaDiag(bg, cur.bg.path)); }
  if (rs[1].status === 'rejected') { miss.push('o áudio da voz'); diag.push('Voz: ' + await mediaDiag(voice, cur.voice.path)); }
  if (miss.length) {
    warn.hidden = false;
    warn.innerHTML = 'Não consegui abrir ' + miss.join(' e ') + '. Use “Trocar fundo” / “Trocar voz” nos ajustes abaixo.' +
      '<br><small>' + diag.map(esc).join('<br>') + '</small>';
  }
  initAudio();
  applyVolumes();
  $('#seek').max = dur() || 1;
}

async function openEditor(p) {
  cur = p;
  if (!cur.opts) cur.opts = { burn: S.burn, showEditor: S.showEditor, volBg: S.volBg, volVoice: S.volVoice };
  push('editor');
  $('#ed-name').value = cur.name;
  $('#opt-editor').checked = cur.opts.showEditor;
  $('#opt-burn').checked = cur.opts.burn;
  $('#vol-bg').value = cur.opts.volBg;
  $('#vol-voice').value = cur.opts.volVoice;
  $$('#ed-format .chip').forEach((c) => c.classList.toggle('on', c.dataset.format === cur.format));
  const [w, h] = editorDims();
  setCanvasSize(w, h);
  nextId = Math.max(1, ...(cur.segs || []).map((s) => s.id + 1));
  renderSegs();
  showBusy('Abrindo projeto…');
  try { await loadMedia(); } finally { hideBusy(); }
  if (!cur) return;
  seekTo(cur.pos || 0);
}

function leaveEditor() {
  pause();
  sync.active = false;
  $('#sync-live').hidden = true;
  $('#sync-box').hidden = true;
  if (cur) { flush(true); }
  cur = null;
  bg.removeAttribute('src'); bg.load();
  voice.removeAttribute('src'); voice.load();
  renderVideos();
}

$('#ed-name').addEventListener('change', (e) => {
  if (!cur) return;
  cur.name = e.target.value.trim() || cur.name;
  e.target.value = cur.name;
  touch();
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
  try { bg.currentTime = bgTimeFor(t); } catch (e) { /* ignora */ }
  updateUI();
  setTimeout(draw, 80);
}
async function play() {
  if (!dur()) return;
  initAudio();
  if (voice.currentTime >= dur() - 0.05) seekTo(0);
  try { bg.currentTime = bgTimeFor(voice.currentTime); } catch (e) { /* ignora */ }
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
    const want = bgTimeFor(voice.currentTime);
    if (Math.abs(bg.currentTime - want) > 0.4 && want > 0.3 && bg.duration - want > 0.6) {
      try { bg.currentTime = want; } catch (e) { /* ignora */ }
    }
    updateUI(); draw();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
voice.addEventListener('ended', () => {
  if (X.running) return;
  if (sync.active) finishSync(dur());
  pause();
});
$('#btn-play').addEventListener('click', () => (playing ? pause() : play()));
$('#seek').addEventListener('input', (e) => seekTo(parseFloat(e.target.value)));

function updateUI() {
  const t = voice.currentTime || 0;
  $('#time').textContent = fmt(t);
  if (document.activeElement !== $('#seek')) $('#seek').value = t;
  if (!cur) return;
  $$('.seg').forEach((el) => {
    const s = cur.segs.find((x) => x.id === +el.dataset.id);
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
  ctx.drawImage(v, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
}
function wrapText(text, maxW) {
  const out = [];
  text.split('\n').forEach((para) => {
    let line = '';
    para.split(/\s+/).filter(Boolean).forEach((w) => {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
    });
    if (line) out.push(line);
  });
  return out;
}
const SUB_SIZE = { pequena: 0.05, media: 0.065, grande: 0.085 };
function drawSubtitle(text) {
  const W = canvas.width, H = canvas.height;
  const vert = H > W;
  const size = Math.round(W * SUB_SIZE[S.subSize] * (vert ? 1 : 0.7));
  ctx.font = '800 ' + size + 'px system-ui, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  const lines = wrapText(text, W * 0.86);
  const lh = size * 1.25;
  let y;
  if (S.subPos === 'cima') y = H * 0.1 + size;
  else if (S.subPos === 'meio') y = H / 2 - ((lines.length - 1) * lh) / 2 + size * 0.35;
  else y = H - H * (vert ? 0.14 : 0.08) - (lines.length - 1) * lh;
  if (S.subBox) {
    const mw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 0.8;
    const top = y - size * 0.95, hh = lines.length * lh + size * 0.2;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(W / 2 - mw / 2, top, mw, hh, size * 0.3); else ctx.rect(W / 2 - mw / 2, top, mw, hh);
    ctx.fill();
  }
  ctx.lineWidth = size * 0.2;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = S.subColor;
  lines.forEach((l) => {
    if (!S.subBox) ctx.strokeText(l, W / 2, y);
    ctx.fillText(l, W / 2, y);
    y += lh;
  });
}
function draw() {
  if (!cur) return;
  drawCover(bg);
  const showSubs = X.running ? cur.opts.burn : cur.opts.showEditor;
  if (showSubs) {
    const t = voice.currentTime || 0;
    const seg = cur.segs.find((s) => t >= s.start && t < s.end && s.text.trim());
    if (seg) drawSubtitle(seg.text.trim());
  }
}
bg.addEventListener('seeked', () => { if (!playing) draw(); });
bg.addEventListener('loadeddata', draw);

/* ---------- legendas ---------- */
function renderSegs() {
  if (!cur) return;
  cur.segs.sort((a, b) => a.start - b.start);
  const box = $('#seg-list');
  box.innerHTML = '';
  $('#seg-empty').hidden = cur.segs.length > 0;
  cur.segs.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'seg';
    el.dataset.id = s.id;
    el.innerHTML =
      '<div class="seg-times">' +
      '<div><label>Início (s)</label><input type="number" step="0.1" min="0" data-k="start"></div>' +
      '<div><label>Fim (s)</label><input type="number" step="0.1" min="0" data-k="end"></div>' +
      '<button class="mini" data-act="go" title="Ir para o início">▶</button>' +
      '<button class="mini" data-act="del" title="Apagar">🗑</button></div>' +
      '<textarea rows="2" placeholder="Texto da legenda"></textarea>';
    const ins = el.querySelectorAll('input');
    ins[0].value = s.start.toFixed(1);
    ins[1].value = s.end.toFixed(1);
    const ta = el.querySelector('textarea');
    ta.value = s.text;
    ins.forEach((inp) => inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (isFinite(v)) s[inp.dataset.k] = clamp(v, 0, dur() || v);
      if (s.end <= s.start) s.end = Math.min(dur() || s.start + 0.5, s.start + 0.5);
      touch(); renderSegs();
    }));
    ta.addEventListener('input', () => { s.text = ta.value; touch(); if (!playing) draw(); });
    el.querySelector('[data-act=go]').addEventListener('click', () => { pause(); seekTo(s.start); });
    el.querySelector('[data-act=del]').addEventListener('click', () => {
      cur.segs = cur.segs.filter((x) => x.id !== s.id);
      touch(); renderSegs(); draw();
    });
    box.appendChild(el);
  });
  updateUI();
}

$('#btn-add-seg').addEventListener('click', () => {
  if (!cur) return;
  const t = voice.currentTime || 0;
  const next = cur.segs.filter((s) => s.start > t).sort((a, b) => a.start - b.start)[0];
  const end = Math.min(dur() || t + 2.5, next ? next.start : t + 2.5);
  const id = nextId++;
  cur.segs.push({ id, start: t, end: Math.max(end, t + 0.3), text: '' });
  touch(); renderSegs();
  const ta = $('.seg[data-id="' + id + '"] textarea');
  if (ta) ta.focus();
});

/* ---------- sincronização rápida ---------- */
const sync = { active: false, lines: [], i: 0 };
$('#btn-sync-open').addEventListener('click', () => { $('#sync-box').hidden = !$('#sync-box').hidden; });
$('#btn-sync-cancel').addEventListener('click', () => { $('#sync-box').hidden = true; });
$('#btn-sync-start').addEventListener('click', async () => {
  if (!cur) return;
  const lines = $('#sync-text').value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  if (cur.segs.length && !(await askConfirm('Substituir as legendas atuais?', 'As legendas que já existem serão trocadas pelas novas.', 'Substituir'))) return;
  cur.segs = [];
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
  if (!sync.active || !cur) return;
  const t = voice.currentTime;
  const prev = cur.segs[cur.segs.length - 1];
  if (prev) prev.end = Math.max(t, prev.start + 0.2);
  if (sync.i < sync.lines.length) {
    cur.segs.push({ id: nextId++, start: t, end: Math.min(dur(), t + 3), text: sync.lines[sync.i] });
    sync.i++;
    updateSyncLabel();
  } else finishSync(t);
});
$('#btn-sync-stop').addEventListener('click', () => finishSync(voice.currentTime));
function finishSync(t) {
  if (!sync.active || !cur) return;
  sync.active = false;
  const last = cur.segs[cur.segs.length - 1];
  if (last && last.end > t) last.end = Math.max(t, last.start + 0.2);
  $('#sync-live').hidden = true;
  pause();
  touch(); renderSegs();
}

/* ---------- ajustes do vídeo ---------- */
$('#opt-editor').addEventListener('change', (e) => { if (!cur) return; cur.opts.showEditor = e.target.checked; touch(); draw(); });
$('#opt-burn').addEventListener('change', (e) => { if (!cur) return; cur.opts.burn = e.target.checked; touch(); });
$('#vol-bg').addEventListener('input', (e) => { if (!cur) return; cur.opts.volBg = parseFloat(e.target.value); applyVolumes(); touch(); });
$('#vol-voice').addEventListener('input', (e) => { if (!cur) return; cur.opts.volVoice = parseFloat(e.target.value); applyVolumes(); touch(); });
$$('#ed-format .chip').forEach((c) => c.addEventListener('click', () => {
  if (!cur) return;
  cur.format = c.dataset.format;
  $$('#ed-format .chip').forEach((x) => x.classList.toggle('on', x === c));
  const [w, h] = editorDims();
  setCanvasSize(w, h);
  touch(); draw();
}));
async function swapMedia(which) {
  if (!cur) return;
  pause();
  const r = await Browser.open(which === 'bg'
    ? { title: 'Vídeo de fundo', types: ['video'] }
    : { title: 'Áudio da voz', types: ['audio', 'video'] });
  if (!r || !r[0]) return;
  cur[which === 'bg' ? 'bg' : 'voice'] = r[0];
  touch();
  showBusy('Carregando…');
  try { await loadMedia(); } finally { hideBusy(); }
  seekTo(0);
}
$('#btn-swap-bg').addEventListener('click', () => swapMedia('bg'));
$('#btn-swap-voice').addEventListener('click', () => swapMedia('voice'));

/* =====================================================================
   Exportação
   ===================================================================== */
const X = { running: false, cancel: false, last: null };
const BPS = { baixa: 2000000, media: 4000000, alta: 8000000 };
const ov = { box: $('#overlay'), title: $('#ov-title'), msg: $('#ov-msg'), bar: $('#ov-bar'), actions: $('#ov-actions'), cancel: $('#ov-cancel') };

function ovProgress(p, msg) {
  ov.bar.style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
  if (msg) ov.msg.textContent = msg;
}
function pickMime() {
  const list = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
  ];
  return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}
function blobToBase64(b) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    // o tipo do blob pode ter vírgula (codecs=avc1,opus), então corta no ";base64,"
    r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(';base64,') + 8)); };
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}
async function writeBlobNative(blob, name) {
  const CH = 1024 * 1024;
  let off = 0, first = true, path = '';
  while (off < blob.size) {
    const b64 = await blobToBase64(blob.slice(off, off + CH));
    const r = await N.MediaLib.appendChunk({ name, data: b64, reset: first });
    path = r.path; first = false; off += CH;
  }
  return path;
}

$('#btn-export').addEventListener('click', exportVideo);
ov.cancel.addEventListener('click', () => { X.cancel = true; });
$('#ov-close').addEventListener('click', () => { ov.box.hidden = true; });
$('#ov-gallery').addEventListener('click', () => saveGallery());
$('#ov-share').addEventListener('click', () => shareVideo());

async function exportVideo() {
  if (X.running || !cur) return;
  if (!dur()) { toast('O vídeo e a voz ainda não carregaram.'); return; }
  if (!window.MediaRecorder) { toast('Este aparelho não consegue exportar vídeo.'); return; }
  pause();
  initAudio();
  X.running = true; X.cancel = false; X.last = null;
  ov.box.hidden = false; ov.actions.hidden = true; ov.cancel.hidden = false;
  ov.title.textContent = 'Exportando…';
  ovProgress(0, 'Deixe o app aberto e a tela ligada. Leva o tempo do áudio.');

  const useNative = !!(N.isNative && N.MediaLib);
  const prevW = canvas.width, prevH = canvas.height;
  let wake = null;
  try {
    const [w, h] = DIMS[S.quality][cur.format];
    setCanvasSize(w, h);
    if (S.keepAwake) { try { wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; } }
    gMon.gain.value = 0;
    seekTo(0);
    await sleep(500);

    const mime = pickMime();
    const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const fileName = safeName(cur.name) + '-' + stamp + '.' + ext;
    if (useNative && N.paths.cache) { try { await N.MediaLib.remove({ path: N.paths.cache + '/exports' }); } catch (e) { /* ignora */ } }

    const stream = canvas.captureStream(S.fps);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, Object.assign(mime ? { mimeType: mime } : {}, { videoBitsPerSecond: BPS[S.quality], audioBitsPerSecond: 128000 }));

    const chunks = [];
    let writeChain = Promise.resolve();
    let first = true, savedPath = '', writeErr = null;
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      if (useNative) {
        const part = e.data;
        writeChain = writeChain.then(async () => {
          if (writeErr) return;
          try {
            const r = await N.MediaLib.appendChunk({ name: fileName, data: await blobToBase64(part), reset: first });
            first = false; savedPath = r.path;
          } catch (err) { writeErr = err; }
        });
      } else chunks.push(e.data);
    };
    const stopped = new Promise((r) => { rec.onstop = r; });

    rec.start(1000);
    try { await Promise.all([voice.play(), bg.play()]); } catch (e) { rec.stop(); throw new Error('não consegui tocar a mídia'); }
    playing = true;
    const total = dur();

    await new Promise((resolve) => {
      const tick = () => {
        const t = voice.currentTime;
        draw();
        ovProgress((t / total) * 0.85, 'Gravando… ' + fmt(t) + ' / ' + fmt(total));
        if (X.cancel || voice.ended || t >= total - 0.03) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    });

    draw();
    await sleep(250);
    rec.stop();
    voice.pause(); bg.pause(); playing = false;
    await stopped;
    await writeChain;

    if (X.cancel) { ov.box.hidden = true; return; }
    if (writeErr) throw writeErr;

    let isMp4 = ext === 'mp4';
    let outName = fileName;
    let outPath = savedPath;
    let outBlob = useNative ? null : new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' });

    if (!isMp4) {
      ovProgress(0.85, 'Convertendo para .mp4… (pode demorar)');
      try {
        const src = useNative ? await (await fetch(N.fileUrl(savedPath))).blob() : outBlob;
        const mp4 = await webmToMp4(src, (p) => ovProgress(0.85 + p * 0.15, 'Convertendo para .mp4… ' + Math.round(p * 100) + '%'));
        outName = fileName.replace(/\.webm$/, '.mp4');
        if (useNative) outPath = await writeBlobNative(mp4, outName); else outBlob = mp4;
        isMp4 = true;
      } catch (e) { console.warn('conversão falhou', e); }
    }

    X.last = { path: outPath, name: outName, blob: outBlob, mp4: isMp4 };
    ovProgress(1);
    ov.title.textContent = isMp4 ? 'Pronto! ✔' : 'Pronto (em .webm)';
    ov.msg.textContent = isMp4 ? outName : 'Este aparelho não grava .mp4 direto e a conversão não ficou disponível; o vídeo foi salvo em .webm.';
    ov.actions.hidden = false; ov.cancel.hidden = true;
  } catch (err) {
    console.error(err);
    ov.box.hidden = true;
    toast('Falha ao exportar: ' + (err && err.message ? err.message : err));
  } finally {
    X.running = false;
    try { voice.pause(); bg.pause(); } catch (e) { /* ignora */ }
    playing = false;
    if (gMon) gMon.gain.value = 1;
    try { wake && wake.release(); } catch (e) { /* ignora */ }
    setCanvasSize(prevW, prevH);
    $('#btn-play').textContent = '▶';
    if (cur) seekTo(0);
  }
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
  await ff.load({ coreURL: abs('vendor/ffmpeg/core/ffmpeg-core.js'), wasmURL: abs('vendor/ffmpeg/core/ffmpeg-core.wasm') });
  await ff.writeFile('in.webm', new Uint8Array(await blob.arrayBuffer()));
  const code = await ff.exec(['-i', 'in.webm', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'out.mp4']);
  if (code !== 0) throw new Error('ffmpeg ' + code);
  const data = await ff.readFile('out.mp4');
  ff.terminate();
  return new Blob([data.buffer], { type: 'video/mp4' });
}

/* ---------- salvar / compartilhar ---------- */
function downloadWeb(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
async function saveGallery() {
  const f = X.last;
  if (!f) return;
  if (!N.isNative || !N.MediaLib) { if (f.blob) downloadWeb(f.blob, f.name); return; }
  showBusy('Salvando na galeria…');
  try {
    const r = await N.MediaLib.saveToGallery({ path: f.path, name: f.name, mime: f.mp4 ? 'video/mp4' : 'video/webm' });
    toast('Salvo em ' + (r.where || 'Filmes') + ' ✔');
  } catch (e) {
    toast('Não consegui salvar na galeria. Tente “Compartilhar”. (' + (e.message || e) + ')');
  } finally { hideBusy(); }
}
async function shareVideo() {
  const f = X.last;
  if (!f) return;
  if (!N.isNative || !N.Share) { if (f.blob) downloadWeb(f.blob, f.name); return; }
  try { await N.Share.share({ title: f.name, url: 'file://' + f.path, dialogTitle: 'Compartilhar o vídeo' }); }
  catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('Não deu pra compartilhar: ' + (e.message || e)); }
}

/* =====================================================================
   Início
   ===================================================================== */
(async function boot() {
  if (N.MediaLib) {
    try { N.paths = await N.MediaLib.getPaths(); } catch (e) { /* ignora */ }
  }
  renderVideos();
  renderMods();
  const ui = Store.get('ui', null);
  if (ui && ui.tab) setTab(ui.tab);
  // se o app foi fechado pelo sistema, volta para onde a pessoa estava
  if (ui && Array.isArray(ui.stack)) {
    if (ui.stack.includes('editor') && ui.projectId) {
      const p = getProject(ui.projectId);
      if (p) { await openEditor(p); return; }
    }
    if (ui.stack.includes('mod') && ui.modId) {
      const m = getMods().find((x) => x.id === ui.modId);
      if (m) { await openMod(m); return; }
    }
  }
  saveUi();
})();

})();
