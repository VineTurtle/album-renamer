/* 图册批量重命名 — 前端逻辑 */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const enc = encodeURIComponent;
const LS = 'album-renamer-v1';

const state = {
  dir: '',
  items: [],
  byId: new Map(),
  nodes: new Map(),
  plan: [],
  diskNames: new Set(),
  selection: new Set(),
  lastClicked: null,
  dragIds: null,
  templates: [],
  activeTpl: null,
  activeSeg: -1,
  tplMode: 'seg',
  sort: 'name-asc',
  onlyImages: true,
  lowerExt: false,
  thumb: 180,
  mode: 'rename',
  destDir: '',
  lastLog: '',
  lastLogDir: '',
  theme: 'light',
  pickerPath: '',
  pickerScroll: new Map(),
  pickerFiltering: false,
  pickerFilterScroll: 0,
  viewerId: null,
  viewerScale: 1,
  viewerX: 0,
  viewerY: 0
};

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ------------------------------- 基础工具 ------------------------------- */

async function api(url, opts = {}) {
  const init = { method: opts.method || 'GET' };
  if (opts.body !== undefined) {
    init.method = 'POST';
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('服务返回异常');
  }
  return data;
}

let toastTimer = 0;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + type; }, 2600);
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function fmtTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const stripExt = (name) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
};
const extOf = (name) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
};
const baseNameOfDir = (dir) => String(dir || '').split(/[\\/]/).filter(Boolean).pop() || '';

function lastDigits(name) {
  const groups = String(name).match(/\d+/g);
  return groups && groups.length ? groups[groups.length - 1] : null;
}

function alphaSeq(n) {
  n = Math.max(1, Math.trunc(n));
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

const CN_DIGITS = '零一二三四五六七八九';
function cnNum(n) {
  n = Math.max(0, Math.trunc(n));
  if (n === 0) return '零';
  if (n >= 10000) return String(n);
  const units = ['', '十', '百', '千'];
  const str = String(n);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const d = Number(str[i]);
    const pos = str.length - 1 - i;
    if (d === 0) {
      if (!out.endsWith('零') && i < str.length - 1) out += '零';
    } else {
      if (!(d === 1 && pos === 1 && out === '')) out += CN_DIGITS[d];
      out += units[pos];
    }
  }
  return out.replace(/零+$/, '');
}

function formatNum(n, tpl) {
  if (tpl.style === 'alpha') return alphaSeq(n);
  if (tpl.style === 'ALPHA') return alphaSeq(n).toUpperCase();
  if (tpl.style === 'cn') return cnNum(n);
  const v = Math.max(0, Math.trunc(n));
  const s = String(v);
  return tpl.pad > 0 ? s.padStart(tpl.pad, '0') : s;
}

function formatDate(ms, fmt) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const map = {
    YYYY: String(d.getFullYear()),
    MM: p(d.getMonth() + 1),
    DD: p(d.getDate()),
    HH: p(d.getHours()),
    mm: p(d.getMinutes()),
    ss: p(d.getSeconds())
  };
  return String(fmt || 'YYYYMMDD').replace(/YYYY|MM|DD|HH|mm|ss/g, (m) => map[m]);
}

/* ------------------------------- 模板 ------------------------------- */

function newTemplate(index = 0) {
  return {
    id: uid(),
    name: index === 0 ? '正文' : '模板' + (index + 1),
    segments: [
      { type: 'text', value: 'IMG' },
      { type: 'text', value: '_' },
      { type: 'num', prefix: '', suffix: '', offset: 0 }
    ],
    start: 1,
    step: 1,
    pad: 4,
    style: 'dec',
    source: 'seq'
  };
}

function normalizeTpl(t, i) {
  const base = newTemplate(i);
  const out = Object.assign(base, t || {});
  out.id = (t && t.id) || uid();
  out.name = (t && t.name) || base.name;
  out.segments = Array.isArray(t && t.segments) && t.segments.length
    ? t.segments.map((s) => Object.assign({ type: 'text', value: '' }, s))
    : base.segments;
  out.start = Number.isFinite(+out.start) ? +out.start : 1;
  out.step = Number.isFinite(+out.step) && +out.step > 0 ? +out.step : 1;
  out.pad = Number.isFinite(+out.pad) ? Math.max(0, Math.min(10, +out.pad)) : 4;
  out.style = ['dec', 'alpha', 'ALPHA', 'cn'].includes(out.style) ? out.style : 'dec';
  out.source = out.source === 'digits' ? 'digits' : 'seq';
  return out;
}

const activeTpl = () => state.templates.find((t) => t.id === state.activeTpl) || state.templates[0];

function buildName(tpl, item, n, folder) {
  let out = '';
  for (const seg of tpl.segments) {
    switch (seg.type) {
      case 'text':
        out += seg.value || '';
        break;
      case 'num':
        out += (seg.prefix || '') + formatNum(n + (Number(seg.offset) || 0), tpl) + (seg.suffix || '');
        break;
      case 'orig':
        out += stripExt(item.name);
        break;
      case 'digits':
        out += lastDigits(item.name) || '';
        break;
      case 'date':
        out += formatDate(item.mtime, seg.fmt || 'YYYYMMDD');
        break;
      case 'folder':
        out += baseNameOfDir(state.dir);
        break;
      default:
        break;
    }
  }
  return out;
}

/* ------------------------------- 预览计算 ------------------------------- */

function computePlan() {
  const tpls = state.templates;
  if (!tpls.length) return [];
  const first = tpls[0];
  const counters = new Map();
  const folder = baseNameOfDir(state.dir);
  const rows = [];

  for (const it of state.items) {
    const tpl = tpls.find((t) => t.id === it.tplId) || first;
    let base = '';
    let num = null;
    let status = 'ok';
    let reason = '';

    if (it.excluded) {
      status = 'excluded';
      base = stripExt(it.name);
    } else if (it.customName) {
      base = it.customName;
    } else {
      if (it.startAt != null) counters.set(tpl.id, it.startAt);
      let n = counters.has(tpl.id) ? counters.get(tpl.id) : tpl.start;
      if (tpl.source === 'digits') {
        const d = lastDigits(it.name);
        if (d !== null) n = Number(d);
      }
      num = n;
      base = buildName(tpl, it, n, folder);
      counters.set(tpl.id, n + (tpl.step || 1));
    }

    base = String(base || '').replace(/[ \t]+$/g, '');

    const ext = state.lowerExt ? extOf(it.name).toLowerCase() : extOf(it.name);
    let newName = status === 'excluded' ? it.name : base + ext;

    if (status !== 'excluded') {
      if (!base) {
        status = 'error';
        reason = '名称为空';
      } else {
        const bad = /[<>:"/\\|?*\u0000-\u001f]/.exec(newName);
        if (bad) {
          status = 'error';
          reason = '含非法字符 ' + bad[0];
        } else if (/[. ]$/.test(newName)) {
          status = 'error';
          reason = '不能以空格或点结尾';
        } else if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(newName)) {
          status = 'error';
          reason = 'Windows 保留名称';
        } else if (newName.length > 180) {
          status = 'error';
          reason = '文件名过长';
        }
      }
    }

    if (status === 'ok' && newName === it.name) status = 'same';

    rows.push({
      id: it.id,
      oldName: it.name,
      newName,
      base,
      status,
      reason,
      num,
      tplId: tpl.id
    });
  }

  const seen = new Map();
  for (const r of rows) {
    if (r.status === 'excluded') continue;
    const k = r.newName.toLowerCase();
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(r);
  }
  for (const list of seen.values()) {
    if (list.length > 1) {
      for (const r of list) {
        if (r.status === 'ok' || r.status === 'same') {
          r.status = 'dup';
          r.reason = '新名称重复';
        }
      }
    }
  }

  // 只有真正会被改名的那批文件才会腾出原名；排除 / 保持原名的文件仍占着位置
  const vacating = new Set(
    rows.filter((r) => r.status === 'ok').map((r) => r.oldName.toLowerCase())
  );
  for (const r of rows) {
    if (r.status !== 'ok') continue;
    const k = r.newName.toLowerCase();
    if (k !== r.oldName.toLowerCase() && state.diskNames.has(k) && !vacating.has(k)) {
      r.status = 'conflict';
      r.reason = '目标文件名已存在';
    }
  }

  return rows;
}

/* ------------------------------- 设置持久化 ------------------------------- */

function saveSettings() {
  try {
    localStorage.setItem(LS, JSON.stringify({
      templates: state.templates,
      activeTpl: state.activeTpl,
      sort: state.sort === 'manual' ? 'name-asc' : state.sort,
      onlyImages: state.onlyImages,
      lowerExt: state.lowerExt,
      thumb: state.thumb,
      mode: state.mode,
      destDir: state.destDir,
      lastLog: state.lastLog,
      lastLogDir: state.lastLogDir,
      theme: state.theme,
      dir: state.dir,
      tplMode: state.tplMode
    }));
  } catch { /* ignore */ }
}

function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(LS) || '{}');
  } catch { s = {}; }

  if (Array.isArray(s.templates) && s.templates.length) {
    state.templates = s.templates.map(normalizeTpl);
  } else {
    state.templates = [newTemplate(0)];
  }
  state.activeTpl = state.templates.some((t) => t.id === s.activeTpl) ? s.activeTpl : state.templates[0].id;
  state.sort = s.sort && s.sort !== 'manual' ? s.sort : 'name-asc';
  state.onlyImages = s.onlyImages !== false;
  state.lowerExt = !!s.lowerExt;
  state.thumb = Number(s.thumb) || 180;
  state.mode = ['rename', 'copy', 'move'].includes(s.mode) ? s.mode : 'rename';
  state.destDir = s.destDir || '';
  state.lastLog = s.lastLog || '';
  state.lastLogDir = s.lastLogDir || '';
  state.theme = s.theme === 'dark' ? 'dark' : 'light';
  state.tplMode = s.tplMode === 'raw' ? 'raw' : 'seg';
  state.dir = s.dir || '';

  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.setProperty('--thumb', state.thumb + 'px');
  $('#sortSelect').value = state.sort;
  $('#onlyImages').checked = state.onlyImages;
  $('#lowerExt').checked = state.lowerExt;
  $('#thumbRange').value = state.thumb;
  $('#destInput').value = state.destDir;
  const radio = $(`input[name="mode"][value="${state.mode}"]`);
  if (radio) radio.checked = true;
  $('#destRow').hidden = state.mode === 'rename';
}

/* ------------------------------- 缩略图 ------------------------------- */

let thumbQueue = [];
let thumbActive = 0;
let thumbGen = 0;
let io = null;
const thumbCache = new Map();

function clearThumbs() {
  for (const url of thumbCache.values()) URL.revokeObjectURL(url);
  thumbCache.clear();
  thumbQueue = [];
  thumbGen++;
}

function applyThumb(card, url) {
  const img = card.querySelector('.thumb img');
  if (!img) return;
  img.src = url;
  img.classList.add('ready');
  const ph = card.querySelector('.ph');
  if (ph) ph.remove();
}

function queueThumb(item, card) {
  const hit = thumbCache.get(item.path);
  if (hit) {
    applyThumb(card, hit);
    return;
  }
  thumbQueue.push({ item, card, gen: thumbGen });
  pumpThumbs();
}

function pumpThumbs() {
  while (thumbActive < 2 && thumbQueue.length) {
    const task = thumbQueue.shift();
    if (task.gen !== thumbGen || !state.byId.has(task.item.id)) continue;
    thumbActive++;
    makeThumb(task.item)
      .then((url) => {
        if (task.gen !== thumbGen) {
          URL.revokeObjectURL(url);
          return;
        }
        thumbCache.set(task.item.path, url);
        applyThumb(task.card, url);
      })
      .catch(() => {
        const ph = task.card.querySelector('.ph');
        if (ph) ph.textContent = '无法预览';
      })
      .finally(() => {
        thumbActive--;
        pumpThumbs();
      });
  }
}

async function makeThumb(item) {
  const res = await fetch('/api/raw?path=' + enc(item.path));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: 760, resizeQuality: 'medium' });
  } catch {
    bmp = await createImageBitmap(blob);
  }
  const scale = Math.min(1, 760 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  return URL.createObjectURL(out || blob);
}

/* ------------------------------- 网格渲染 ------------------------------- */

const sortCompare = () => {
  switch (state.sort) {
    case 'name-asc': return (a, b) => collator.compare(a.name, b.name);
    case 'name-desc': return (a, b) => collator.compare(b.name, a.name);
    case 'mtime-asc': return (a, b) => a.mtime - b.mtime;
    case 'mtime-desc': return (a, b) => b.mtime - a.mtime;
    case 'size-asc': return (a, b) => a.size - b.size;
    case 'size-desc': return (a, b) => b.size - a.size;
    default: return null;
  }
};

function applyOrder() {
  const cmp = sortCompare();
  if (cmp) state.items.sort(cmp);
  const grid = $('#grid');
  for (const it of state.items) {
    const node = state.nodes.get(it.id);
    if (node) grid.appendChild(node);
  }
}

function renderGrid() {
  const grid = $('#grid');
  const empty = $('#empty');
  grid.innerHTML = '';
  state.nodes.clear();
  state.byId.clear();

  empty.style.display = state.items.length ? 'none' : 'flex';
  grid.style.display = state.items.length ? 'grid' : 'none';

  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const id = en.target.dataset.id;
      const it = state.byId.get(id);
      if (it) queueThumb(it, en.target);
      io.unobserve(en.target);
    }
  }, { root: $('#gridWrap'), rootMargin: '700px' });

  const frag = document.createDocumentFragment();
  for (const it of state.items) {
    state.byId.set(it.id, it);
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = it.id;
    card.draggable = true;
    card.innerHTML =
      '<div class="thumb"><div class="ph"></div><img alt="" draggable="false">' +
      '<span class="idx"></span><span class="flag"></span></div>' +
      '<div class="meta"><div class="old"></div><div class="new"></div></div>';

    card.addEventListener('click', (e) => onCardClick(it.id, e));
    card.addEventListener('dblclick', () => openViewer(it.id));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!state.selection.has(it.id)) {
        state.selection.clear();
        state.selection.add(it.id);
        updateSelectionUI();
      }
      askCustomName();
    });
    bindDrag(card, it);

    state.nodes.set(it.id, card);
    frag.appendChild(card);
    io.observe(card);
  }
  grid.appendChild(frag);
}

function updateCards() {
  const indexOf = new Map(state.items.map((it, i) => [it.id, i + 1]));
  for (const row of state.plan) {
    const card = state.nodes.get(row.id);
    if (!card) continue;
    const it = state.byId.get(row.id);
    const oldEl = card.querySelector('.old');
    const newEl = card.querySelector('.new');
    const idxEl = card.querySelector('.idx');
    const flagEl = card.querySelector('.flag');

    idxEl.textContent = indexOf.get(row.id) || '';
    oldEl.textContent = row.oldName;
    oldEl.title = row.oldName;

    let newText = row.newName;
    let cls = 'new';
    if (row.status === 'excluded') {
      newText = '保持原名';
      cls += ' same';
    } else if (row.status === 'same') {
      cls += ' same';
    } else if (row.status === 'error' || row.status === 'conflict' || row.status === 'dup') {
      cls += ' bad';
    }
    newEl.className = cls;
    newEl.textContent = newText;
    newEl.title = row.reason ? row.newName + ' — ' + row.reason : row.newName;

    let flag = '';
    if (it && it.customName) flag = '🔒';
    else if (row.status === 'excluded') flag = '⛔';
    else if (row.status === 'error' || row.status === 'conflict' || row.status === 'dup') flag = '⚠️';
    flagEl.textContent = flag;

    card.classList.toggle('excluded', row.status === 'excluded');
    card.classList.toggle('bad', row.status === 'error' || row.status === 'conflict' || row.status === 'dup');
    card.classList.toggle('selected', state.selection.has(row.id));
  }
}

function updateStats() {
  const rows = state.plan || [];
  const numbered = rows.filter((r) =>
    !['excluded', 'same'].includes(r.status) && !(state.byId.get(r.id) || {}).customName
  ).length;
  const locked = state.items.filter((i) => i.customName).length;
  const excluded = rows.filter((r) => r.status === 'excluded').length;
  const bad = rows.filter((r) => ['error', 'conflict', 'dup'].includes(r.status)).length;

  $('#statTotal').textContent = `共 ${state.items.length} 张`;
  $('#statNumbered').textContent = `参与编号 ${numbered}`;
  $('#statLocked').textContent = `锁定 ${locked}`;
  $('#statExcluded').textContent = `排除 ${excluded}`;

  const conflictEl = $('#statConflict');
  if (bad) {
    conflictEl.className = 'bad';
    conflictEl.textContent = `${bad} 个冲突需处理`;
  } else {
    conflictEl.className = 'ok';
    conflictEl.textContent = '无冲突';
  }

  const todo = rows.filter((r) => r.status === 'ok' && r.newName !== r.oldName).length;
  $('#execCount').textContent = todo;
  $('#btnExec').disabled = !state.items.length || bad > 0;
}

function updateSample() {
  const tpl = activeTpl();
  const firstId = state.templates[0].id;
  const used = state.items.filter((i) => (i.tplId || firstId) === tpl.id && !i.excluded).length;
  $('#tplUsage').textContent = `当前模板 ${used} 张`;

  let row = (state.plan || []).find((r) => r.tplId === tpl.id && r.status !== 'excluded' && r.status !== 'error');
  if (row) {
    $('#sampleName').textContent = row.newName;
    return;
  }
  const it = state.items.find((i) => !i.excluded);
  if (!it) {
    $('#sampleName').textContent = '—';
    return;
  }
  const ext = state.lowerExt ? extOf(it.name).toLowerCase() : extOf(it.name);
  $('#sampleName').textContent = buildName(tpl, it, tpl.start, baseNameOfDir(state.dir)) + ext;
}

function refresh(reorder = false) {
  if (reorder) applyOrder();
  state.plan = computePlan();
  if (!state.nodes.size && state.items.length) renderGrid();
  updateCards();
  updateStats();
  updateSample();
  applySearch();
}

/* ------------------------------- 模板界面 ------------------------------- */

function serializeTpl(t) {
  return t.segments.map((s) => {
    if (s.type === 'text') return s.value || '';
    if (s.type === 'num') return `{num:${t.pad}}`;
    if (s.type === 'orig') return '{orig}';
    if (s.type === 'digits') return '{digits}';
    if (s.type === 'date') return `{date:${s.fmt || 'YYYYMMDD'}}`;
    if (s.type === 'folder') return '{folder}';
    return '';
  }).join('');
}

function parseToken(tok) {
  const t = tok.trim();
  if (/^\d+$/.test(t)) return { type: 'num', prefix: '', suffix: '', offset: 0 };
  if (t === 'num' || t.startsWith('num:')) return { type: 'num', prefix: '', suffix: '', offset: 0 };
  if (t === 'orig') return { type: 'orig' };
  if (t === 'digits') return { type: 'digits' };
  if (t === 'folder') return { type: 'folder' };
  if (t === 'date') return { type: 'date', fmt: 'YYYYMMDD' };
  if (t.startsWith('date:')) return { type: 'date', fmt: t.slice(5) || 'YYYYMMDD' };
  return { type: 'text', value: '{' + tok + '}' };
}

function parseSyntax(str) {
  const segs = [];
  const re = /\{([^{}]*)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(str))) {
    if (m.index > last) segs.push({ type: 'text', value: str.slice(last, m.index) });
    segs.push(parseToken(m[1]));
    last = re.lastIndex;
  }
  if (last < str.length) segs.push({ type: 'text', value: str.slice(last) });
  return segs.length ? segs : [{ type: 'text', value: '' }];
}

function renderTabs() {
  const box = $('#tplTabs');
  box.innerHTML = '';
  state.templates.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'tpl-tab' + (t.id === state.activeTpl ? ' active' : '');
    b.title = '单击切换 · 双击重命名 · 右键删除';
    const span = document.createElement('span');
    span.textContent = t.name;
    b.appendChild(span);
    b.onclick = () => {
      state.activeTpl = t.id;
      state.activeSeg = -1;
      renderTabs();
      renderTemplateEditor();
      updateSample();
      saveSettings();
    };
    b.ondblclick = async () => {
      const v = await askText('重命名模板', t.name);
      if (v) {
        t.name = v;
        renderTabs();
        saveSettings();
      }
    };
    b.oncontextmenu = (e) => {
      e.preventDefault();
      if (state.templates.length <= 1) {
        toast('至少保留一个模板', 'error');
        return;
      }
      confirmDialog('删除模板', `确定删除“${esc(t.name)}”吗？使用它的图片会回到默认模板。`, () => {
        state.templates = state.templates.filter((x) => x.id !== t.id);
        state.items.forEach((it) => {
          if (it.tplId === t.id) it.tplId = null;
        });
        if (state.activeTpl === t.id) state.activeTpl = state.templates[0].id;
        renderTabs();
        renderTemplateEditor();
        refresh();
        saveSettings();
      });
    };
    box.appendChild(b);
  });

  const add = document.createElement('button');
  add.className = 'tpl-tab add';
  add.textContent = '+ 新模板';
  add.title = '新建一个独立计数的模板（例如 封面 / 封底）';
  add.onclick = async () => {
    const t = newTemplate(state.templates.length);
    const name = await askText('新模板名称', t.name);
    t.name = name || t.name;
    state.templates.push(t);
    state.activeTpl = t.id;
    renderTabs();
    renderTemplateEditor();
    saveSettings();
  };
  box.appendChild(add);

  const sel = $('#selTpl');
  const prev = sel.value;
  sel.innerHTML = '';
  state.templates.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name;
    sel.appendChild(o);
  });
  if (state.templates.some((t) => t.id === prev)) sel.value = prev;
}

function renderTemplateEditor() {
  const t = activeTpl();
  if (!t) return;
  $('#segView').hidden = state.tplMode !== 'seg';
  $('#rawView').hidden = state.tplMode !== 'raw';
  $$('#tplModeTabs button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.tplMode));

  $('#numStart').value = t.start;
  $('#numStep').value = t.step;
  $('#numPad').value = t.pad;
  $('#numStyle').value = t.style;
  $('#numSource').value = t.source;

  if (state.tplMode === 'raw') {
    $('#rawInput').value = serializeTpl(t);
    return;
  }

  const list = $('#segList');
  list.innerHTML = '';
  t.segments.forEach((seg, i) => {
    const el = document.createElement('div');
    el.className = 'seg ' + (seg.type === 'num' ? 'num' : seg.type === 'text' ? 'text' : 'special') +
      (i === state.activeSeg ? ' active' : '');
    el.draggable = true;
    el.dataset.i = i;

    let label;
    if (seg.type === 'text') label = seg.value === ' ' ? '␣' : (seg.value || '空文本');
    else if (seg.type === 'num') label = formatNum(t.start, t);
    else if (seg.type === 'orig') label = '原文件名';
    else if (seg.type === 'digits') label = '原数字';
    else if (seg.type === 'date') label = '日期';
    else label = '文件夹名';

    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = label;
    el.appendChild(val);

    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '×';
    del.title = '删除此段';
    del.onclick = (ev) => {
      ev.stopPropagation();
      t.segments.splice(i, 1);
      if (!t.segments.length) t.segments.push({ type: 'text', value: '' });
      state.activeSeg = Math.min(state.activeSeg, t.segments.length - 1);
      renderTemplateEditor();
      refresh();
      saveSettings();
    };
    el.appendChild(del);

    el.onclick = () => {
      state.activeSeg = i;
      renderTemplateEditor();
    };
    el.addEventListener('dragstart', (ev) => {
      state.dragSeg = i;
      el.classList.add('dragging');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(i));
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (ev) => {
      if (state.dragSeg == null) return;
      ev.preventDefault();
      el.classList.add('active');
    });
    el.addEventListener('dragleave', () => el.classList.remove('active'));
    el.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const from = state.dragSeg;
      state.dragSeg = null;
      if (from == null || from === i) return;
      const [moved] = t.segments.splice(from, 1);
      t.segments.splice(i, 0, moved);
      state.activeSeg = i;
      renderTemplateEditor();
      refresh();
      saveSettings();
    });

    list.appendChild(el);
  });

  renderSegEditor();
}

function renderSegEditor() {
  const t = activeTpl();
  const box = $('#segEditor');
  const seg = t.segments[state.activeSeg];
  if (!seg) {
    box.innerHTML = '<div class="hint">点击上方任意一段进行编辑</div>';
    return;
  }

  let html = '';
  if (seg.type === 'text') {
    html += `<label class="fld">文本内容<input id="fldText" value="${esc(seg.value || '')}" placeholder="例如 aaa 或 _"></label>`;
  } else if (seg.type === 'num') {
    html += '<div class="grid3">' +
      `<label class="fld">前缀<input id="fldPrefix" value="${esc(seg.prefix || '')}" placeholder="第"></label>` +
      `<label class="fld">后缀<input id="fldSuffix" value="${esc(seg.suffix || '')}" placeholder="页"></label>` +
      `<label class="fld">偏移<input type="number" id="fldOffset" value="${Number(seg.offset) || 0}"></label>` +
      '</div><div class="hint" style="margin-top:6px">编号的补零、步长在下方“编号规则”里设置，所有序号段共用同一个计数。</div>';
  } else if (seg.type === 'date') {
    const fmts = ['YYYYMMDD', 'YYYY-MM-DD', 'YYYYMMDD_HHmmss', 'YYYY年MM月DD日'];
    html += '<label class="fld">日期格式<select id="fldFmt">' +
      fmts.map((f) => `<option value="${f}" ${f === (seg.fmt || 'YYYYMMDD') ? 'selected' : ''}>${f}</option>`).join('') +
      '</select></label><div class="hint" style="margin-top:6px">取文件的修改时间。</div>';
  } else if (seg.type === 'orig') {
    html += '<div class="hint">插入原文件名（不含扩展名）。</div>';
  } else if (seg.type === 'digits') {
    html += '<div class="hint">提取原文件名里最后一段连续数字，例如 IMG_0007 → 0007。</div>';
  } else if (seg.type === 'folder') {
    html += `<div class="hint">插入当前文件夹名：<code>${esc(baseNameOfDir(state.dir) || '（未选择）')}</code></div>`;
  }

  html += '<div class="seg-actions">' +
    '<button id="segLeft">← 左移</button>' +
    '<button id="segRight">右移 →</button>' +
    '<button id="segDelete" class="danger">删除此段</button>' +
    '</div>';
  box.innerHTML = html;

  const commit = () => {
    renderTemplateEditorPills();
    refresh();
    saveSettings();
  };

  const textEl = $('#fldText');
  if (textEl) {
    textEl.oninput = () => {
      seg.value = textEl.value;
      renderTemplateEditorPills();
      refresh();
      saveSettings();
    };
  }
  const prefixEl = $('#fldPrefix');
  if (prefixEl) {
    prefixEl.oninput = () => { seg.prefix = prefixEl.value; commit(); };
  }
  const suffixEl = $('#fldSuffix');
  if (suffixEl) {
    suffixEl.oninput = () => { seg.suffix = suffixEl.value; commit(); };
  }
  const offsetEl = $('#fldOffset');
  if (offsetEl) {
    offsetEl.oninput = () => { seg.offset = Number(offsetEl.value) || 0; commit(); };
  }
  const fmtEl = $('#fldFmt');
  if (fmtEl) {
    fmtEl.onchange = () => { seg.fmt = fmtEl.value; commit(); };
  }

  $('#segLeft').onclick = () => {
    const i = state.activeSeg;
    if (i <= 0) return;
    [t.segments[i - 1], t.segments[i]] = [t.segments[i], t.segments[i - 1]];
    state.activeSeg = i - 1;
    renderTemplateEditor();
    refresh();
    saveSettings();
  };
  $('#segRight').onclick = () => {
    const i = state.activeSeg;
    if (i >= t.segments.length - 1) return;
    [t.segments[i + 1], t.segments[i]] = [t.segments[i], t.segments[i + 1]];
    state.activeSeg = i + 1;
    renderTemplateEditor();
    refresh();
    saveSettings();
  };
  $('#segDelete').onclick = () => {
    t.segments.splice(state.activeSeg, 1);
    if (!t.segments.length) t.segments.push({ type: 'text', value: '' });
    state.activeSeg = Math.min(state.activeSeg, t.segments.length - 1);
    renderTemplateEditor();
    refresh();
    saveSettings();
  };
}

/** 只刷新药丸外观，不重建编辑区（避免输入框失焦） */
function renderTemplateEditorPills() {
  const t = activeTpl();
  const pills = $$('#segList .seg');
  if (pills.length !== t.segments.length) {
    renderTemplateEditor();
    return;
  }
  pills.forEach((el, i) => {
    const seg = t.segments[i];
    let label;
    if (seg.type === 'text') label = seg.value === ' ' ? '␣' : (seg.value || '空文本');
    else if (seg.type === 'num') label = formatNum(t.start, t);
    else if (seg.type === 'orig') label = '原文件名';
    else if (seg.type === 'digits') label = '原数字';
    else if (seg.type === 'date') label = '日期';
    else label = '文件夹名';
    const val = el.querySelector('.val');
    if (val && val.textContent !== label) val.textContent = label;
  });
}

function setTplMode(mode) {
  state.tplMode = mode;
  state.activeSeg = -1;
  renderTemplateEditor();
  saveSettings();
}

function syncRawPad() {
  if (state.tplMode !== 'raw') return;
  const el = $('#rawInput');
  if (el && document.activeElement !== el) el.value = serializeTpl(activeTpl());
}

/* ------------------------------- 选择 ------------------------------- */

function onCardClick(id, e) {
  if (e.shiftKey && state.lastClicked) {
    const order = state.items.map((i) => i.id);
    const a = order.indexOf(state.lastClicked);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      state.selection.clear();
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) state.selection.add(order[i]);
    }
  } else if (e.ctrlKey || e.metaKey) {
    if (state.selection.has(id)) state.selection.delete(id);
    else state.selection.add(id);
    state.lastClicked = id;
  } else {
    state.selection.clear();
    state.selection.add(id);
    state.lastClicked = id;
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  $('#selCount').textContent = state.selection.size;
  const n = state.selection.size;
  $('#selCustom').disabled = n !== 1;
  $('#selExclude').disabled = n === 0;
  $('#selRenum').disabled = n === 0;
  $('#selTpl').disabled = n === 0;
  for (const [id, card] of state.nodes) card.classList.toggle('selected', state.selection.has(id));
}

function selectAll() {
  state.items.forEach((i) => state.selection.add(i.id));
  updateSelectionUI();
}

function invertSelection() {
  const next = new Set();
  state.items.forEach((i) => {
    if (!state.selection.has(i.id)) next.add(i.id);
  });
  state.selection = next;
  updateSelectionUI();
}

function applyTemplateToSelection() {
  const tplId = $('#selTpl').value;
  if (!tplId || !state.selection.size) return;
  for (const id of state.selection) {
    const it = state.byId.get(id);
    if (!it) continue;
    it.tplId = tplId;
    it.customName = null;
    it.excluded = false;
  }
  refresh();
  saveSettings();
  toast(`已套用到 ${state.selection.size} 张`, 'ok');
}

function askCustomName() {
  if (state.selection.size !== 1) {
    toast('请选择单张图片后再命名', 'warn');
    return;
  }
  const id = [...state.selection][0];
  const it = state.byId.get(id);
  if (!it) return;

  openDialog({
    title: '自定义名称 · ' + it.name,
    body: `<input class="dlg-input" id="dlgName" value="${esc(it.customName || '')}" placeholder="例如 封面（不用写扩展名）">
      <div class="dlg-note">留空 = 恢复使用当前模板；填写后这张会被锁定，<b>不占用编号</b>，后面的页码仍然从 0001 开始。</div>`,
    okText: '保存',
    onOk: () => {
      let v = $('#dlgName').value.trim();
      v = v.replace(/\.(jpe?g|png|webp|bmp|tiff?|gif|avif|heic)$/i, '');
      if (/[<>:"/\\|?*]/.test(v)) {
        toast('名称含有 Windows 非法字符', 'error');
        return false;
      }
      it.customName = v || null;
      it.excluded = false;
      refresh();
      saveSettings();
      return true;
    }
  });
}

function toggleExclude() {
  if (!state.selection.size) return;
  const ids = [...state.selection];
  const anyActive = ids.some((id) => {
    const row = state.plan.find((r) => r.id === id);
    return row && row.status !== 'excluded';
  });
  for (const id of ids) {
    const it = state.byId.get(id);
    if (it) it.excluded = anyActive;
  }
  refresh();
  saveSettings();
}

async function renumberSelected() {
  if (!state.selection.size) return;
  const first = state.items.find((i) => state.selection.has(i.id));
  if (!first) return;
  const tpl = state.templates.find((t) => t.id === (first.tplId || state.templates[0].id));
  const v = await askText(`从这一张重新编号（${tpl ? tpl.name : ''}）`, '1');
  if (!v) return;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    toast('请输入有效数字', 'error');
    return;
  }
  for (const id of state.selection) {
    const it = state.byId.get(id);
    if (it) it.startAt = null;
  }
  first.startAt = n;
  refresh();
  saveSettings();
  toast(`已从第 ${n} 张开始重新编号`, 'ok');
}

/* ------------------------------- 拖拽排序 ------------------------------- */

function bindDrag(card, it) {
  card.addEventListener('dragstart', (e) => {
    if (!state.selection.has(it.id)) {
      state.selection.clear();
      state.selection.add(it.id);
      state.lastClicked = it.id;
      updateSelectionUI();
    }
    state.dragIds = state.items.filter((x) => state.selection.has(x.id)).map((x) => x.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', it.id);
    card.classList.add('dragging');
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    state.dragIds = null;
    $$('.card.drop-marker').forEach((c) => c.classList.remove('drop-marker'));
  });

  card.addEventListener('dragover', (e) => {
    if (!state.dragIds) return;
    e.preventDefault();
    const r = card.getBoundingClientRect();
    const before = e.clientX < r.left + r.width / 2;
    $$('.card.drop-marker').forEach((c) => c.classList.remove('drop-marker'));
    if (!before) card.classList.add('drop-marker');
  });

  card.addEventListener('dragleave', () => card.classList.remove('drop-marker'));

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    const ids = new Set(state.dragIds || []);
    state.dragIds = null;
    $$('.card.drop-marker').forEach((c) => c.classList.remove('drop-marker'));
    if (!ids.size) return;
    const r = card.getBoundingClientRect();
    const before = e.clientX < r.left + r.width / 2;
    const moving = state.items.filter((x) => ids.has(x.id));
    if (!moving.length) return;
    const wasManual = state.sort === 'manual';
    const rest = state.items.filter((x) => !ids.has(x.id));
    let idx = rest.findIndex((x) => x.id === it.id);
    if (idx < 0) idx = rest.length;
    if (!before) idx += 1;
    rest.splice(idx, 0, ...moving);
    state.items = rest;
    state.sort = 'manual';
    $('#sortSelect').value = 'manual';
    applyOrder();
    refresh();
    saveSettings();
    if (!wasManual) toast('已切换为手动顺序');
  });
}

/* ------------------------------- 搜索 ------------------------------- */

function applySearch() {
  const q = $('#search').value.trim().toLowerCase();
  const planMap = new Map((state.plan || []).map((r) => [r.id, r]));
  for (const [id, node] of state.nodes) {
    const it = state.byId.get(id);
    const row = planMap.get(id);
    const hay = (it.name + ' ' + (row ? row.newName : '')).toLowerCase();
    node.hidden = !!q && !hay.includes(q);
  }
}

/* ------------------------------- 对话框 ------------------------------- */

let dlgResolve = null;

function openDialog({ title, body, okText = '确定', cancelText = '取消', onOk, okClass = 'btn primary' }) {
  $('#dlgTitle').textContent = title;
  $('#dlgBody').innerHTML = body;
  const foot = $('#dlgFoot');
  foot.innerHTML = '';

  const cancel = document.createElement('button');
  cancel.className = 'btn ghost';
  cancel.textContent = cancelText;
  cancel.onclick = () => closeDialog(null);

  const ok = document.createElement('button');
  ok.className = okClass;
  ok.textContent = okText;
  ok.onclick = () => {
    if (onOk) {
      const r = onOk();
      if (r === false) return;
      closeDialog(r === undefined ? true : r);
    } else {
      closeDialog(true);
    }
  };

  foot.append(cancel, ok);
  $('#dlg').classList.add('open');

  const input = $('#dlgBody input, #dlgBody textarea');
  if (input) {
    setTimeout(() => {
      input.focus();
      if (input.select) input.select();
    }, 40);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ok.click();
      }
    });
  }

  return new Promise((resolve) => {
    dlgResolve = resolve;
  });
}

function closeDialog(value) {
  $('#dlg').classList.remove('open');
  const r = dlgResolve;
  dlgResolve = null;
  if (r) r(value);
}

async function askText(title, value = '') {
  const v = await openDialog({
    title,
    body: `<input class="dlg-input" id="dlgName" value="${esc(value)}">`,
    okText: '确定',
    onOk: () => {
      const t = $('#dlgName').value.trim();
      if (!t) return false;
      return t;
    }
  });
  return v || null;
}

function confirmDialog(title, message, onOk) {
  openDialog({
    title,
    body: `<div style="line-height:1.7">${message}</div>`,
    okText: '确定',
    onOk: () => {
      onOk();
      return true;
    }
  });
}

/* ------------------------------- 文件夹选择 ------------------------------- */

const normPath = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase();

async function openPicker(start) {
  $('#picker').classList.add('open');
  await browse(start !== undefined && start !== null ? start : state.dir || '');
}

async function browse(p, opts = {}) {
  let r;
  try {
    r = await api('/api/browse?path=' + enc(p || ''));
  } catch (e) {
    toast('读取失败：' + e.message, 'error');
    return;
  }
  if (!r.ok) {
    toast(r.error || '无法读取该路径', 'error');
    return;
  }

  // 离开前记住当前列表的滚动位置（若正过滤，则记过滤前的位置）
  const list = $('#pickerList');
  if (state.pickerPath) {
    const keep = state.pickerFiltering ? state.pickerFilterScroll : list.scrollTop;
    state.pickerScroll.set(normPath(state.pickerPath), keep || 0);
  }

  state.pickerPath = r.path || '';
  $('#pickerPath').value = r.path || '';
  $('#pickerOk').disabled = !r.path;
  $('#pickerFilter').value = '';
  state.pickerFiltering = false;

  const dr = $('#drives');
  dr.innerHTML = '';
  (r.drives || []).forEach((d) => {
    const b = document.createElement('button');
    b.textContent = d;
    b.onclick = () => browse(d);
    dr.appendChild(b);
  });

  list.innerHTML = '';

  if (r.parent) {
    const el = document.createElement('div');
    el.className = 'picker-item parent';
    el.innerHTML = '<span class="ico">↩</span><span>上级文件夹</span>';
    el.onclick = () => browse(r.parent, { from: r.path });
    list.appendChild(el);
  }

  for (const d of r.dirs || []) {
    const el = document.createElement('div');
    el.className = 'picker-item';
    el.dataset.path = d.path;
    el.dataset.name = d.name;
    el.title = d.path;
    el.innerHTML = '<span class="ico">📁</span>';
    const span = document.createElement('span');
    span.textContent = d.name;
    el.appendChild(span);
    el.onclick = () => browse(d.path);
    list.appendChild(el);
  }

  const empty = document.createElement('div');
  empty.className = 'picker-item parent';
  empty.id = 'pickerEmpty';
  empty.hidden = true;
  empty.textContent = '没有匹配的子文件夹';
  empty.style.cursor = 'default';
  list.appendChild(empty);

  if (!r.path) {
    const hint = document.createElement('div');
    hint.className = 'picker-item parent';
    hint.textContent = '选择上面的磁盘开始浏览';
    hint.style.cursor = 'default';
    list.appendChild(hint);
  } else if (!(r.dirs || []).length) {
    const hint = document.createElement('div');
    hint.className = 'picker-item parent';
    hint.textContent = '（此文件夹下没有子文件夹，可直接使用）';
    hint.style.cursor = 'default';
    list.appendChild(hint);
  }

  applyPickerFilter();
  restorePickerView(opts.from);
}

/** 还原到上次的滚动位置，并把“刚从这里退出来的子文件夹”标出来 */
function restorePickerView(fromPath) {
  const list = $('#pickerList');
  const saved = state.pickerScroll.get(normPath(state.pickerPath)) || 0;
  list.scrollTop = saved;

  if (!fromPath) return;
  const from = normPath(fromPath);
  const hit = Array.from(list.querySelectorAll('.picker-item[data-path]'))
    .find((el) => normPath(el.dataset.path) === from);
  if (!hit) return;

  hit.classList.add('from');
  const lr = list.getBoundingClientRect();
  const hr = hit.getBoundingClientRect();
  if (hr.top < lr.top || hr.bottom > lr.bottom) {
    list.scrollTop += hr.top - lr.top - (lr.height - hr.height) / 2;
  }
}

function applyPickerFilter() {
  const list = $('#pickerList');
  const rows = Array.from(list.querySelectorAll('.picker-item[data-path]'));
  const hint = $('#pickerHint');
  const q = $('#pickerFilter').value.trim().toLowerCase();
  const wasFiltering = state.pickerFiltering;

  // 关键：先记住滚动位置，再隐藏行（隐藏会让内容变短，浏览器会立刻夹住 scrollTop）
  if (q && !wasFiltering) state.pickerFilterScroll = list.scrollTop;
  state.pickerFiltering = !!q;

  let shown = 0;
  for (const el of rows) {
    const hit = !q || el.dataset.name.toLowerCase().includes(q);
    el.hidden = !hit;
    if (hit) shown++;
  }

  const empty = $('#pickerEmpty');
  if (empty) empty.hidden = !(q && shown === 0);

  // 过滤时回到顶部，清空过滤后回到过滤前的位置
  if (q) {
    list.scrollTop = 0;
  } else if (wasFiltering) {
    list.scrollTop = state.pickerFilterScroll || 0;
  } else {
    list.scrollTop = state.pickerScroll.get(normPath(state.pickerPath)) || 0;
  }

  if (!state.pickerPath) {
    hint.textContent = '请选择一个磁盘';
    return;
  }
  if (!rows.length) {
    hint.textContent = '没有子文件夹，可直接使用';
    return;
  }
  hint.textContent = q ? `匹配 ${shown} / 共 ${rows.length} 个子文件夹` : `共 ${rows.length} 个子文件夹`;
}

/* ------------------------------- 载入文件夹 ------------------------------- */

async function loadFolder(dir) {
  if (!dir) return;
  try {
    const r = await api(`/api/list?dir=${enc(dir)}&images=${state.onlyImages ? 1 : 0}`);
    if (!r.ok) throw new Error(r.error || '读取失败');

    const oldDir = state.dir;
    const oldOrder = new Map(state.items.map((it, i) => [it.name.toLowerCase(), i]));
    // 同一文件夹点「刷新」时保留人工标记（自定义名 / 排除 / 模板 / 重新编号起点）
    const oldMeta = new Map(state.items.map((it) => [it.name.toLowerCase(), {
      tplId: it.tplId,
      customName: it.customName,
      excluded: it.excluded,
      startAt: it.startAt
    }]));
    const sameDir = oldDir && oldDir === r.dir;

    clearThumbs();
    state.dir = r.dir;
    state.items = r.entries.map((e) => {
      const m = sameDir ? oldMeta.get(e.name.toLowerCase()) : null;
      return {
        ...e,
        id: uid(),
        tplId: m ? m.tplId : null,
        customName: m ? m.customName : null,
        excluded: m ? !!m.excluded : false,
        startAt: m && m.startAt != null ? m.startAt : null
      };
    });
    state.byId.clear();
    state.nodes.clear();
    state.selection.clear();
    state.lastClicked = null;
    state.diskNames = new Set(r.entries.map((e) => e.name.toLowerCase()));
    state.viewerId = null;

    if (state.sort === 'manual' && oldDir === r.dir && oldOrder.size) {
      // 同一文件夹刷新：保留用户拖拽出来的顺序，新文件排在最后
      state.items.sort((a, b) => {
        const ai = oldOrder.get(a.name.toLowerCase());
        const bi = oldOrder.get(b.name.toLowerCase());
        return (ai === undefined ? 1e9 : ai) - (bi === undefined ? 1e9 : bi);
      });
    } else if (state.sort === 'manual') {
      // 手动顺序只对当前这批文件有意义，换文件夹或重新导入时恢复自然排序
      state.sort = 'name-asc';
      $('#sortSelect').value = 'name-asc';
    }

    saveSettings();
    updateFolderChip();

    renderGrid();
    refresh(true);
    updateSelectionUI();

    if (!state.items.length) {
      toast('这个文件夹里没有找到匹配的文件', 'warn');
    } else {
      toast(`已载入 ${state.items.length} 个文件`, 'ok');
    }
  } catch (e) {
    toast('读取文件夹失败：' + e.message, 'error');
  }
}

function updateFolderChip() {
  const label = $('#folderLabel');
  if (!state.dir) {
    label.textContent = '未选择文件夹';
    $('#folderChip').classList.remove('has-folder');
    return;
  }
  label.textContent = state.dir;
  $('#folderChip').title = state.dir;
}

/* ------------------------------- 执行 ------------------------------- */

const joinPath = (dir, name) => String(dir || '').replace(/[\\/]+$/, '') + (String(dir || '').includes('\\') ? '\\' : '/') + name;

const MODE_TEXT = { rename: '原地重命名', copy: '复制到新文件夹', move: '移动到新文件夹' };
const STATUS_TEXT = {
  ok: '待重命名',
  same: '名称未变化',
  excluded: '保持原名',
  error: '名称有误',
  conflict: '目标已存在',
  dup: '新名重复'
};

function showProblems(list) {
  const rows = list.slice(0, 40).map((r) =>
    `<li><code>${esc(r.oldName)}</code> → <b>${esc(r.newName || '')}</b>　<span class="reason">${esc(r.reason || '冲突')}</span></li>`
  ).join('');
  openDialog({
    title: `发现 ${list.length} 个问题`,
    body: `<div>以下文件不能直接执行，请先调整：</div><ul class="problem-list">${rows}</ul>` +
      (list.length > 40 ? '<div class="dlg-note">仅显示前 40 条</div>' : ''),
    okText: '知道了',
    cancelText: '关闭'
  });
}

async function execute() {
  const rows = state.plan || [];
  const bad = rows.filter((r) => ['error', 'conflict', 'dup'].includes(r.status));
  if (bad.length) {
    showProblems(bad);
    return;
  }
  const todo = rows.filter((r) => r.status === 'ok' && r.newName !== r.oldName);
  if (!todo.length) {
    toast('没有需要改名的文件', 'warn');
    return;
  }
  if (state.mode !== 'rename' && !state.destDir) {
    toast('请先选择目标文件夹', 'warn');
    return;
  }
  if (state.mode !== 'rename' && state.destDir === state.dir) {
    toast('目标文件夹不能和源文件夹相同', 'warn');
    return;
  }

  const preview = todo.slice(0, 6).map((r) =>
    `<div class="map-row"><code>${esc(r.oldName)}</code><span>→</span><code class="to">${esc(r.newName)}</code></div>`
  ).join('');

  const body = `<div class="exec-summary">共 <b>${todo.length}</b> 个文件 · ${MODE_TEXT[state.mode]}` +
    (state.mode === 'rename' ? '' : `<br>目标：<code>${esc(state.destDir)}</code>`) + '</div>' +
    `<div class="map-list">${preview}${todo.length > 6 ? `<div class="more">…还有 ${todo.length - 6} 个</div>` : ''}</div>`;

  const ok = await openDialog({ title: '确认执行', body, okText: '开始执行' });
  if (!ok) return;

  $('#btnExec').disabled = true;
  try {
    const res = await api('/api/rename', {
      body: {
        mode: state.mode,
        srcDir: state.dir,
        destDir: state.destDir,
        items: todo.map((r) => ({ from: r.oldName, to: r.newName }))
      }
    });
    if (!res.ok) {
      openDialog({
        title: '执行失败',
        body: `<div>${esc(res.error || '未知错误')}</div>` +
          (res.details ? `<ul class="problem-list">${res.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''),
        okText: '知道了'
      });
      return;
    }

    state.lastLog = res.logPath || '';
    state.lastLogDir = state.dir;
    saveSettings();

    if (res.mode === 'rename') {
      remapAfterRename(todo);
      refresh();
      toast(`已重命名 ${res.count} 个文件`, 'ok');
    } else if (res.mode === 'move') {
      await loadFolder(state.dir);
      toast(`已移动 ${res.count} 个文件`, 'ok');
    } else {
      toast(`已复制 ${res.count} 个文件到新文件夹`, 'ok');
    }
  } catch (e) {
    toast('执行出错：' + e.message, 'error');
  } finally {
    $('#btnExec').disabled = false;
    updateStats();
  }
}

function remapAfterRename(todo) {
  const map = new Map(todo.map((r) => [r.oldName, r.newName]));
  for (const it of state.items) {
    const nn = map.get(it.name);
    if (!nn) continue;
    const oldPath = it.path;
    it.name = nn;
    it.path = joinPath(state.dir, nn);
    it.ext = extOf(nn).toLowerCase();
    const url = thumbCache.get(oldPath);
    if (url) {
      thumbCache.delete(oldPath);
      thumbCache.set(it.path, url);
    }
  }
  state.diskNames = new Set(state.items.map((i) => i.name.toLowerCase()));
}

/* ------------------------------- 撤销 ------------------------------- */

async function undoLast() {
  let logPath = '';
  if (state.lastLog && (!state.dir || state.lastLogDir === state.dir)) {
    logPath = state.lastLog;
  }
  if (!logPath && state.dir) {
    try {
      const r = await api('/api/logs?dir=' + enc(state.dir));
      logPath = (r.logs || []).find((x) => x !== '') || '';
    } catch { /* ignore */ }
  }
  if (!logPath) logPath = state.lastLog;
  if (!logPath) {
    toast('没有找到可撤销的操作记录', 'warn');
    return;
  }

  confirmDialog('撤销上次操作', '将按上次的执行记录回滚（重命名会改回原名，复制会删除副本，移动会移回原位）。确定继续？', async () => {
    try {
      const res = await api('/api/undo', { body: { logPath } });
      if (!res.ok) {
        toast(res.error || '撤销失败', 'error');
        return;
      }
      state.lastLog = '';
      state.lastLogDir = '';
      saveSettings();
      if (state.dir) await loadFolder(state.dir);
      toast(`已撤销 ${res.count} 个文件`, 'ok');
    } catch (e) {
      toast('撤销出错：' + e.message, 'error');
    }
  });
}

/* ------------------------------- 导出 CSV ------------------------------- */

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCsv() {
  const rows = state.plan || [];
  if (!rows.length) {
    toast('还没有可导出的内容', 'warn');
    return;
  }
  const header = ['序号', '状态', '原文件名', '新文件名', '原路径', '新路径', '模板', '大小(字节)', '修改时间'];
  const lines = [header.join(',')];
  rows.forEach((r, i) => {
    const it = state.byId.get(r.id);
    const tpl = state.templates.find((t) => t.id === r.tplId);
    const targetDir = state.mode === 'rename' ? state.dir : (state.destDir || state.dir);
    lines.push([
      i + 1,
      STATUS_TEXT[r.status] || r.status,
      r.oldName,
      r.newName,
      joinPath(state.dir, r.oldName),
      joinPath(targetDir, r.newName),
      tpl ? tpl.name : '',
      it ? it.size : '',
      it ? fmtTime(it.mtime) : ''
    ].map(csvCell).join(','));
  });

  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  a.download = `重命名清单-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
  toast('清单已导出', 'ok');
}

/* ------------------------------- 大图查看 ------------------------------- */

function applyTransform() {
  const img = $('#vImg');
  img.style.transform = `translate(${state.viewerX}px, ${state.viewerY}px) scale(${state.viewerScale})`;
  $('#vZoom').textContent = Math.round(state.viewerScale * 100) + '%';
}

function resetView() {
  state.viewerScale = 1;
  state.viewerX = 0;
  state.viewerY = 0;
  applyTransform();
}

function openViewer(id) {
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx < 0) return;
  state.viewerId = id;
  const it = state.items[idx];

  $('#vName').textContent = it.name;
  $('#vInfo').textContent = `${idx + 1} / ${state.items.length}　${fmtBytes(it.size)}　${fmtTime(it.mtime)}`;
  $('#vFoot').textContent = it.path;

  const img = $('#vImg');
  img.classList.remove('ready');
  $('#vLoading').style.display = 'block';
  img.onload = () => {
    img.classList.add('ready');
    $('#vLoading').style.display = 'none';
  };
  img.onerror = () => {
    $('#vLoading').textContent = '无法显示这张图片';
  };
  img.src = '/api/raw?path=' + enc(it.path) + '&v=' + Date.now();

  resetView();
  $('#viewer').classList.add('open');
}

function closeViewer() {
  $('#viewer').classList.remove('open');
  $('#vImg').src = '';
  state.viewerId = null;
}

function viewerStep(delta) {
  if (!state.viewerId) return;
  const idx = state.items.findIndex((i) => i.id === state.viewerId);
  const next = idx + delta;
  if (next < 0 || next >= state.items.length) return;
  openViewer(state.items[next].id);
}

function viewerZoom(factor, clientX, clientY) {
  const old = state.viewerScale;
  const next = Math.min(8, Math.max(0.1, old * factor));
  if (next === old) return;

  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    // 以鼠标位置为中心缩放
    const rect = $('#vStage').getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    const px = (cx - state.viewerX) / old;
    const py = (cy - state.viewerY) / old;
    state.viewerX = cx - px * next;
    state.viewerY = cy - py * next;
  }

  state.viewerScale = next;
  applyTransform();
}

/* ------------------------------- 事件绑定 ------------------------------- */

let pickerTarget = 'src';

function addSegment(type) {
  const t = activeTpl();
  let seg;
  if (type === 'text') seg = { type: 'text', value: '' };
  else if (type === 'sep') seg = { type: 'text', value: $('#sepQuick').value };
  else if (type === 'num') seg = { type: 'num', prefix: '', suffix: '', offset: 0 };
  else if (type === 'orig') seg = { type: 'orig' };
  else if (type === 'digits') seg = { type: 'digits' };
  else if (type === 'date') seg = { type: 'date', fmt: 'YYYYMMDD' };
  else seg = { type: 'folder' };
  t.segments.push(seg);
  state.activeSeg = t.segments.length - 1;
  renderTemplateEditor();
  refresh();
  saveSettings();
}

function bindEvents() {
  $('#folderChip').onclick = () => { pickerTarget = 'src'; openPicker(state.dir); };
  $('#btnEmptyPick').onclick = () => { pickerTarget = 'src'; openPicker(state.dir); };
  $('#btnPickDest').onclick = () => { pickerTarget = 'dest'; openPicker(state.destDir || state.dir); };
  $('#btnReload').onclick = () => { if (state.dir) loadFolder(state.dir); else toast('请先选择文件夹', 'warn'); };

  $('#btnReveal').onclick = async () => {
    if (!state.dir) return toast('请先选择文件夹', 'warn');
    await api('/api/open', { body: { dir: state.dir } });
  };

  $('#btnUndo').onclick = undoLast;
  $('#btnCsv').onclick = exportCsv;
  $('#btnExec').onclick = execute;

  $('#btnTheme').onclick = () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    saveSettings();
  };

  $('#btnSelectAll').onclick = selectAll;
  $('#btnInvert').onclick = invertSelection;
  $('#selClear').onclick = () => {
    state.selection.clear();
    updateSelectionUI();
  };
  $('#selTpl').onchange = applyTemplateToSelection;
  $('#selCustom').onclick = askCustomName;
  $('#selExclude').onclick = toggleExclude;
  $('#selRenum').onclick = renumberSelected;

  $('#search').oninput = applySearch;

  $('#sortSelect').onchange = (e) => {
    state.sort = e.target.value;
    refresh(true);
    saveSettings();
  };

  $('#thumbRange').oninput = (e) => {
    state.thumb = Number(e.target.value) || 180;
    document.documentElement.style.setProperty('--thumb', state.thumb + 'px');
    saveSettings();
  };

  $('#onlyImages').onchange = (e) => {
    state.onlyImages = e.target.checked;
    saveSettings();
    if (state.dir) loadFolder(state.dir);
  };

  $('#lowerExt').onchange = (e) => {
    state.lowerExt = e.target.checked;
    refresh();
    saveSettings();
  };

  $$('input[name="mode"]').forEach((r) => {
    r.onchange = () => {
      if (!r.checked) return;
      state.mode = r.value;
      $('#destRow').hidden = state.mode === 'rename';
      saveSettings();
    };
  });

  $('#destInput').onchange = (e) => {
    state.destDir = e.target.value.trim();
    saveSettings();
  };

  $$('#tplModeTabs button').forEach((b) => {
    b.onclick = () => setTplMode(b.dataset.mode);
  });

  $$('#segAdd [data-add]').forEach((b) => {
    b.onclick = () => addSegment(b.dataset.add);
  });

  $('#numStart').oninput = (e) => {
    activeTpl().start = Math.max(0, Number(e.target.value) || 0);
    renderTemplateEditorPills();
    syncRawPad();
    refresh();
    saveSettings();
  };
  $('#numStep').oninput = (e) => {
    activeTpl().step = Math.max(1, Number(e.target.value) || 1);
    syncRawPad();
    refresh();
    saveSettings();
  };
  $('#numPad').oninput = (e) => {
    activeTpl().pad = Math.max(0, Math.min(10, Number(e.target.value) || 0));
    renderTemplateEditorPills();
    syncRawPad();
    refresh();
    saveSettings();
  };
  $('#numStyle').onchange = (e) => {
    activeTpl().style = e.target.value;
    renderTemplateEditorPills();
    refresh();
    saveSettings();
  };
  $('#numSource').onchange = (e) => {
    activeTpl().source = e.target.value;
    refresh();
    saveSettings();
  };

  $('#rawInput').oninput = (e) => {
    const t = activeTpl();
    const val = e.target.value;
    const m = val.match(/\{num:(\d+)\}|\{(\d+)\}/);
    if (m) {
      const pad = m[1] !== undefined ? Number(m[1]) : m[2].length;
      if (Number.isFinite(pad) && pad >= 0 && pad <= 10) {
        t.pad = pad;
        $('#numPad').value = pad;
      }
    }
    t.segments = parseSyntax(val);
    refresh();
    saveSettings();
  };

  // 文件夹选择
  $('#pickerGo').onclick = () => {
    const v = $('#pickerPath').value.trim().replace(/^["']|["']$/g, '');
    browse(v);
  };
  $('#pickerPath').onkeydown = (e) => {
    if (e.key === 'Enter') $('#pickerGo').click();
  };
  $('#pickerFilter').oninput = applyPickerFilter;
  $('#pickerFilter').onkeydown = (e) => {
    if (e.key === 'Enter') {
      const first = $('#pickerList').querySelector('.picker-item[data-path]:not([hidden])');
      if (first) first.click();
    }
  };
  $('#pickerOk').onclick = async () => {
    const p = state.pickerPath;
    if (!p) return;
    $('#picker').classList.remove('open');
    if (pickerTarget === 'dest') {
      state.destDir = p;
      $('#destInput').value = p;
      saveSettings();
    } else {
      await loadFolder(p);
    }
  };

  $$('[data-close]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.close;
      $('#' + id).classList.remove('open');
      if (id === 'dlg') closeDialog(null);
    };
  });

  // 大图查看
  $('#vClose').onclick = closeViewer;
  $('#vPrev').onclick = () => viewerStep(-1);
  $('#vNext').onclick = () => viewerStep(1);
  $('#vZoomIn').onclick = () => viewerZoom(1.2);
  $('#vZoomOut').onclick = () => viewerZoom(1 / 1.2);
  $('#vFit').onclick = resetView;

  const stage = $('#vStage');
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    viewerZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }, { passive: false });

  let panning = false;
  let px = 0;
  let py = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    panning = true;
    px = e.clientX;
    py = e.clientY;
    stage.classList.add('dragging');
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!panning) return;
    state.viewerX += e.clientX - px;
    state.viewerY += e.clientY - py;
    px = e.clientX;
    py = e.clientY;
    applyTransform();
  });
  const endPan = () => {
    panning = false;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);
  stage.addEventListener('dblclick', () => {
    if (state.viewerScale > 1) resetView();
    else {
      state.viewerScale = 2;
      applyTransform();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ($('#viewer').classList.contains('open')) {
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowLeft') viewerStep(-1);
      else if (e.key === 'ArrowRight') viewerStep(1);
      else if (e.key === '+' || e.key === '=') viewerZoom(1.2);
      else if (e.key === '-') viewerZoom(1 / 1.2);
      return;
    }

    if ($('#dlg').classList.contains('open')) return;

    if ($('#picker').classList.contains('open')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        const f = $('#pickerFilter');
        if (f.value) {
          f.value = '';
          applyPickerFilter();
        } else {
          $('#picker').classList.remove('open');
        }
      }
      return;
    }

    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (e.key === 'Escape') {
      if ($('#search').value) {
        $('#search').value = '';
        applySearch();
      } else if (state.selection.size) {
        state.selection.clear();
        updateSelectionUI();
      }
      return;
    }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('#search').focus();
      $('#search').select();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
    } else if (e.key === 'F2') {
      e.preventDefault();
      askCustomName();
    }
  });
}

/* ------------------------------- 启动 ------------------------------- */

async function init() {
  loadSettings();
  renderTabs();
  renderTemplateEditor();
  updateFolderChip();
  updateSelectionUI();
  $('#pickerOk').disabled = true;
  bindEvents();

  let start = state.dir;
  try {
    const info = await api('/api/info');
    if (info.initialPath) start = info.initialPath;
  } catch { /* ignore */ }

  if (start) await loadFolder(start);
  else refresh();
}

init();

})();
