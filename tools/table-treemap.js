#!/usr/bin/env node
// Build a self-contained HTML treemap viewer from a tabular data file
// (JSONL or CSV). The viewer lets the user pick Size / Color columns and
// an ordered set of Path (group-by) columns — dragging chips reorders
// the hierarchy on the fly. State is persisted in the URL hash.
//
// Usage:
//   node tools/table-treemap.js [flags] <input.(jsonl|csv)> [output.html]
//
// Flags (all optional — defaults inferred from the data):
//   --size=COL          initial size column
//   --color=COL         initial color column
//   --path=A,B,C        initial (ordered) path columns
//   --theme=NAME        initial page theme (e.g. tokyo-night)
//   --palette=NAME      palette override (viridis, plasma, …)
//   --title=STR         header title
//   --show-labels       render labels on leaf cells by default (off by default)
//   --keep-cols=A,B,C   keep only these columns from the input (plus _row)
//   --no-open           don't auto-open the result
//   --max-rows=N        truncate input to N rows (default: unlimited)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import zlib from 'node:zlib';
import { parse as parseCsvSync } from 'csv-parse/sync';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUNDLE_PATH = path.join(ROOT, 'dist', 'gp-treemap.bundle.js');

function parseArgs(argv) {
  const out = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') { out.flags.noOpen = true; continue; }
    if (a === '--show-labels') { out.flags['show-labels'] = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      else out.flags[a.slice(2)] = argv[++i];
      continue;
    }
    out.positional.push(a);
  }
  return out;
}

function loadTable(inputPath, maxRows) {
  const text = fs.readFileSync(inputPath, 'utf8');
  const ext = path.extname(inputPath).toLowerCase();
  let columns, rows;
  if (ext === '.jsonl' || ext === '.ndjson') {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const colSet = new Set();
    rows = [];
    for (const ln of lines) {
      const obj = JSON.parse(ln);
      for (const k of Object.keys(obj)) colSet.add(k);
      rows.push(obj);
      if (maxRows && rows.length >= maxRows) break;
    }
    columns = Array.from(colSet);
  } else if (ext === '.csv' || ext === '.tsv') {
    const records = parseCsvSync(text, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: false,
      delimiter: ext === '.tsv' ? '\t' : ',',
      to: maxRows || undefined,
    });
    if (records.length === 0) throw new Error('empty CSV');
    columns = Object.keys(records[0]).map((s) => s.trim());
    // csv-parse returns objects keyed by untrimmed header — normalize.
    rows = records.map((r) => {
      const o = {};
      for (const k of Object.keys(r)) o[k.trim()] = r[k];
      return o;
    });
  } else if (ext === '.json') {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('expected JSON array');
    rows = maxRows ? arr.slice(0, maxRows) : arr;
    const colSet = new Set();
    for (const r of rows) for (const k of Object.keys(r)) colSet.add(k);
    columns = Array.from(colSet);
  } else {
    throw new Error('unsupported file type: ' + ext + ' (use .jsonl / .csv / .json)');
  }
  // Inject a synthetic _row column so the user can always drill down to
  // individual source rows — handy for datasets like per-employee wages
  // where every row is a distinct entity but there's no natural ID column.
  for (let i = 0; i < rows.length; i++) rows[i]._row = i + 1;
  columns.push('_row');
  return { columns, rows };
}

// --- Column type inference. ---
// numeric: every non-null, non-empty value is a finite number.
// nonNegative: all numeric values are >= 0.
function profileColumns(columns, rows) {
  const info = {};
  for (const c of columns) {
    info[c] = { numeric: true, nonNeg: true, allInt: true, hasValue: false, distinct: new Set(), minV: Infinity, maxV: -Infinity };
  }
  for (const r of rows) {
    for (const c of columns) {
      const v = r[c];
      if (v == null || v === '') continue;
      const ci = info[c];
      ci.hasValue = true;
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && !(typeof v === 'string' && v.trim() === '')) {
        if (n < 0) ci.nonNeg = false;
        if (n < ci.minV) ci.minV = n;
        if (n > ci.maxV) ci.maxV = n;
        if (!Number.isInteger(n)) ci.allInt = false;
      } else {
        ci.numeric = false;
        ci.nonNeg = false;
        ci.allInt = false;
      }
      if (ci.distinct.size < 2000) ci.distinct.add(String(v));
    }
  }
  for (const c of columns) info[c].distinctCount = info[c].distinct.size;
  return info;
}

function pickDefaults(columns, info, flags) {
  // Exclude the synthetic _row column from auto-pick candidates — it's
  // numeric but not meaningful as a size/color/path default.
  const autoCols = columns.filter((c) => c !== '_row');
  const numericNonNeg = autoCols.filter((c) => info[c].numeric && info[c].nonNeg && info[c].hasValue);
  const categorical = autoCols.filter((c) => !info[c].numeric && info[c].distinctCount > 1 && info[c].distinctCount < Math.max(500, columns.length * 50));

  let size = flags.size;
  if (!size || !numericNonNeg.includes(size)) size = numericNonNeg[0] || columns[0];

  let color = flags.color;
  if (!color || !columns.includes(color)) color = numericNonNeg[0] || categorical[0] || columns[0];

  let pathCols;
  if (flags.path) {
    pathCols = flags.path.split(',').map((s) => s.trim()).filter(Boolean).filter((c) => columns.includes(c));
  }
  if (!pathCols || pathCols.length === 0) {
    pathCols = categorical.slice(0, Math.min(3, categorical.length));
    if (pathCols.length === 0) pathCols = [columns[0]];
  }

  return { size, color, pathCols };
}

function humanBytes(v) {
  const units = ['B','KB','MB','GB','TB']; let i = 0, n = v;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function buildHtml(outPath, title, columns, info, rows, defaults, flags) {
  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');

  // Column-oriented binary encoding. Per-column kind:
  //   'rowidx' — synthetic 1..N sequence (no buffer stored)
  //   'i32'   — integer numeric fitting in signed 32-bit (null = INT32_MIN)
  //   'f64'   — floating-point numeric (null = NaN)
  //   'u16' / 'u32' — dict index into `dict` (null = top sentinel)
  // Column-oriented packs like this compress better than row-oriented JSON:
  // each column has one type, and dict-indexed categoricals are tiny.
  const n = rows.length;
  const colOrder = columns;
  const colBuffers = [];
  const I32_NULL = -0x80000000;
  const colInfo = colOrder.map((c) => {
    const ci = info[c];
    const numeric = ci.numeric && ci.hasValue;
    const entry = { name: c, numeric, nonNeg: ci.nonNeg, hasValue: ci.hasValue, distinctCount: ci.distinctCount };
    // _row is synthetic — the client materializes values from the row index.
    if (c === '_row') {
      entry.kind = 'rowidx';
      colBuffers.push(null);
      return entry;
    }
    if (numeric) {
      const fitsI32 = ci.allInt && ci.minV >= I32_NULL + 1 && ci.maxV <= 0x7FFFFFFF;
      if (fitsI32) {
        const buf = new Int32Array(n);
        for (let r = 0; r < n; r++) {
          const v = rows[r][c];
          if (v == null || v === '') { buf[r] = I32_NULL; continue; }
          const num = typeof v === 'number' ? v : Number(v);
          buf[r] = Number.isFinite(num) ? num | 0 : I32_NULL;
        }
        entry.kind = 'i32';
        colBuffers.push(Buffer.from(buf.buffer).toString('base64'));
      } else {
        const buf = new Float64Array(n);
        for (let r = 0; r < n; r++) {
          const v = rows[r][c];
          if (v == null || v === '') { buf[r] = NaN; continue; }
          const num = typeof v === 'number' ? v : Number(v);
          buf[r] = Number.isFinite(num) ? num : NaN;
        }
        entry.kind = 'f64';
        colBuffers.push(Buffer.from(buf.buffer).toString('base64'));
      }
    } else {
      // Build dict (stable order: by first appearance).
      const seen = new Map();
      const dict = [];
      for (let r = 0; r < n; r++) {
        const v = rows[r][c];
        if (v == null || v === '') continue;
        const s = String(v);
        if (!seen.has(s)) { seen.set(s, dict.length); dict.push(s); }
      }
      const cardinality = dict.length;
      const useU32 = cardinality >= 0xFFFF;
      const NULL_IDX = useU32 ? 0xFFFFFFFF : 0xFFFF;
      const buf = useU32 ? new Uint32Array(n) : new Uint16Array(n);
      for (let r = 0; r < n; r++) {
        const v = rows[r][c];
        if (v == null || v === '') { buf[r] = NULL_IDX; continue; }
        buf[r] = seen.get(String(v));
      }
      entry.kind = useU32 ? 'u32' : 'u16';
      entry.dict = dict;
      colBuffers.push(Buffer.from(buf.buffer).toString('base64'));
    }
    return entry;
  });

  const envelope = { cols: colOrder, colInfo, colBuffers, rowCount: n };
  const envJson = JSON.stringify(envelope);
  const envB64 = zlib.deflateRawSync(envJson, { level: 6 }).toString('base64');

  const numericCols = columns.filter((c) => info[c].numeric && info[c].nonNeg && info[c].hasValue);
  const allCols = columns.slice();

  // Theme + palette options copied from gpdu-scan.js for a consistent feel.
  const themes = {
    nord:          { label: 'Nord',             bg: '#2e3440', surface: '#3b4252', border: '#4c566a', fg: '#d8dee9', fgMuted: '#81a1c1', accent: '#88c0d0' },
    solarized:     { label: 'Solarized Dark',    bg: '#002b36', surface: '#073642', border: '#586e75', fg: '#839496', fgMuted: '#657b83', accent: '#268bd2' },
    dracula:       { label: 'Dracula',           bg: '#282a36', surface: '#44475a', border: '#6272a4', fg: '#f8f8f2', fgMuted: '#6272a4', accent: '#bd93f9' },
    catppuccin:    { label: 'Catppuccin Mocha',  bg: '#1e1e2e', surface: '#313244', border: '#45475a', fg: '#cdd6f4', fgMuted: '#a6adc8', accent: '#cba6f7' },
    gruvbox:       { label: 'Gruvbox Dark',      bg: '#282828', surface: '#3c3836', border: '#504945', fg: '#ebdbb2', fgMuted: '#a89984', accent: '#fabd2f' },
    'tokyo-night': { label: 'Tokyo Night',       bg: '#1a1b26', surface: '#16161e', border: '#0f0f14', fg: '#c0caf5', fgMuted: '#787c99', accent: '#7aa2f7' },
    'rose-pine':   { label: 'Rosé Pine',         bg: '#191724', surface: '#1f1d2e', border: '#26233a', fg: '#e0def4', fgMuted: '#908caa', accent: '#c4a7e7' },
    'one-dark':    { label: 'One Dark',          bg: '#282c34', surface: '#2c313a', border: '#3e4452', fg: '#abb2bf', fgMuted: '#828997', accent: '#61afef' },
  };
  const palettes = {
    viridis: 'Viridis', plasma: 'Plasma', inferno: 'Inferno', magma: 'Magma',
    turbo: 'Turbo', heatmap: 'Heatmap', coolwarm: 'Cool–Warm', rainbow: 'Rainbow',
    'gp-default': 'Default 8-hue',
  };
  const themeOptions = Object.entries(themes).map(([k,v])=>`<option value="${k}">${escapeHtml(v.label)}</option>`).join('');
  const paletteOptions = Object.entries(palettes).map(([k,v])=>`<option value="${k}">${escapeHtml(v)}</option>`).join('');

  const DEFAULTS_JS = JSON.stringify({
    size: defaults.size,
    color: defaults.color,
    path: defaults.pathCols,
    theme: flags.theme || 'tokyo-night',
    palette: flags.palette || '',
    colorScale: flags['color-scale'] || 'linear',
    showLabels: !!flags['show-labels'],
  });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>treemap · ${escapeHtml(title)}</title>
<style>
  html, body { margin:0; padding:0; height:100%; font-family: system-ui,-apple-system,Segoe UI,sans-serif;
    background: var(--page-bg, #fafafa); color: var(--page-fg, #111); transition: background .15s, color .15s; }
  body { display:flex; flex-direction:column; }
  header { padding: 8px 14px; border-bottom: 1px solid var(--page-border, #0002);
    display:flex; gap: 12px 18px; align-items:center; flex-wrap:wrap;
    background: var(--page-surface, #fff); transition: background .15s; }
  header h1 { margin:0; font-size:14px; font-weight:600; font-family: ui-monospace, SF Mono, Menlo, monospace;
    color: var(--page-fg, #222); min-width:0; overflow:hidden; text-overflow:ellipsis; }
  .ctl { display:flex; align-items:center; gap:6px; font-size:12px; color: var(--page-fg-muted, #666); }
  .ctl label { color: var(--page-fg-muted, #666); }
  select, button { font-size:12px; padding:2px 6px; border-radius:4px;
    background: var(--page-bg, #fff); color: var(--page-fg, #333);
    border: 1px solid var(--page-border, #ccc); cursor:pointer; }
  gp-treemap { display:flex; flex:1; min-height:0; }
  #bottom-bar { display:flex; align-items:center; gap:16px; padding: 3px 14px;
    font-size:12px; min-height:18px; color: var(--page-fg-muted, #888);
    background: var(--page-surface, #fff); border-top: 1px solid var(--page-border, #0002); }
  #chips-wrap { display:flex; align-items:center; gap:6px; flex-wrap:wrap; position:relative; }
  #chips { display:flex; gap:4px; align-items:center; padding:2px 4px; min-height: 24px;
    border:1px dashed var(--page-border, #ccc); border-radius:6px; min-width: 40px; }
  .chip { display:inline-flex; align-items:center; gap:4px;
    background: var(--page-accent, #3b82f6); color: white;
    padding: 2px 8px; border-radius: 999px; font-size:11px;
    cursor: grab; user-select:none; white-space:nowrap; }
  .chip.dragging { opacity:.4; }
  .chip.drop-before { box-shadow: -3px 0 0 0 var(--page-fg, #fff); }
  .chip.drop-after  { box-shadow:  3px 0 0 0 var(--page-fg, #fff); }
  .chip .x { cursor:pointer; opacity:.6; padding: 0 2px; }
  .chip .x:hover { opacity:1; }
  #path-menu { position: relative; }
  #path-menu-btn { padding: 2px 8px; }
  #path-menu-pop { display:none; position:absolute; z-index:50; top: 100%; left: 0;
    margin-top:4px; max-height: 360px; overflow: auto;
    background: var(--page-surface, #fff); color: var(--page-fg, #222);
    border:1px solid var(--page-border, #ccc); border-radius:6px;
    padding:6px 0; min-width: 220px; box-shadow: 0 2px 12px #0004; }
  #path-menu-pop.open { display:block; }
  #path-menu-pop label { display:flex; align-items:center; gap:8px; padding: 3px 12px;
    font-size:12px; cursor:pointer; white-space:nowrap; }
  #path-menu-pop label:hover { background: var(--page-border, #0001); }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="ctl"><label>Size</label><select id="size-sel"></select></div>
  <div class="ctl"><label>Color</label><select id="color-sel"></select></div>
  <div class="ctl" id="chips-wrap">
    <label>Path</label>
    <div id="chips"></div>
    <div id="path-menu">
      <button id="path-menu-btn">+</button>
      <div id="path-menu-pop"></div>
    </div>
  </div>
  <div class="ctl" style="margin-left:auto;">
    <label>Theme</label>
    <select id="theme-sel">
      <option value="">Default (light)</option>
      ${themeOptions}
    </select>
  </div>
  <div class="ctl">
    <label>Palette</label>
    <select id="palette-sel">
      <option value="">(theme default)</option>
      ${paletteOptions}
    </select>
  </div>
</header>
<gp-treemap id="tm"
  color-mode="categorical"
  palette="tokyo-night"
  gradient-intensity="0.6"
  min-cell-area="0"></gp-treemap>
<div id="bottom-bar">
  <div id="stats-bar"></div>
  <span id="row-count">${rows.length.toLocaleString()} rows</span>
</div>

<script type="application/json" id="tmdata">${envB64}</script>
<script>
${bundle}
</script>
<script>
(function () {
  'use strict';
  var DEFAULTS = ${DEFAULTS_JS};
  var THEMES = ${JSON.stringify(themes)};
  var ALL_COLS = ${JSON.stringify(allCols)};
  var NUMERIC_NONNEG = ${JSON.stringify(numericCols)};

  // ---- Decode the inlined dataset. ----
  function b64ToBytes(b64) {
    var s = atob(b64), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  function inflateRaw(bytes) {
    var ds = new DecompressionStream('deflate-raw');
    var w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Response(ds.readable).text();
  }

  var tm = document.getElementById('tm');
  var sizeSel = document.getElementById('size-sel');
  var colorSel = document.getElementById('color-sel');
  var chipsEl = document.getElementById('chips');
  var pathMenuBtn = document.getElementById('path-menu-btn');
  var pathMenuPop = document.getElementById('path-menu-pop');
  var themeSel = document.getElementById('theme-sel');
  var paletteSel = document.getElementById('palette-sel');
  var statsBar = document.getElementById('stats-bar');

  // Populate size / color dropdowns.
  NUMERIC_NONNEG.forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c;
    sizeSel.appendChild(o);
  });
  ALL_COLS.forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c;
    colorSel.appendChild(o);
  });

  // State — mirrored in URL hash. "viewer" holds the component's
  // viewerState object verbatim; page-level fields (size/color/path/
  // theme/palette/colorScale) sit alongside it.
  var state = {
    size: DEFAULTS.size,
    color: DEFAULTS.color,
    path: DEFAULTS.path.slice(),
    theme: DEFAULTS.theme,
    palette: DEFAULTS.palette,
    colorScale: DEFAULTS.colorScale,
    viewer: {},
  };

  var envelope = null;
  var rowCount = 0;
  var colByName = {};       // colName → { index, kind, dict, buf }

  function renderChips() {
    chipsEl.innerHTML = '';
    state.path.forEach(function (col, i) {
      var c = document.createElement('span');
      c.className = 'chip'; c.draggable = true; c.dataset.col = col; c.dataset.idx = String(i);
      c.textContent = col;
      var x = document.createElement('span'); x.className = 'x'; x.textContent = '×';
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        state.path = state.path.filter(function (_, j) { return j !== i; });
        renderChips(); rebuild(); writeHash();
      });
      c.appendChild(x);
      // Drag reorder.
      c.addEventListener('dragstart', function (e) {
        c.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      });
      c.addEventListener('dragend', function () {
        c.classList.remove('dragging');
        Array.prototype.forEach.call(chipsEl.querySelectorAll('.chip'), function (el) {
          el.classList.remove('drop-before'); el.classList.remove('drop-after');
        });
      });
      c.addEventListener('dragover', function (e) {
        e.preventDefault();
        var r = c.getBoundingClientRect();
        var before = (e.clientX - r.left) < r.width / 2;
        Array.prototype.forEach.call(chipsEl.querySelectorAll('.chip'), function (el) {
          el.classList.remove('drop-before'); el.classList.remove('drop-after');
        });
        c.classList.add(before ? 'drop-before' : 'drop-after');
      });
      c.addEventListener('drop', function (e) {
        e.preventDefault();
        var from = Number(e.dataTransfer.getData('text/plain'));
        var r = c.getBoundingClientRect();
        var before = (e.clientX - r.left) < r.width / 2;
        var to = Number(c.dataset.idx) + (before ? 0 : 1);
        if (from < to) to--;
        if (from === to) return;
        var next = state.path.slice();
        var moved = next.splice(from, 1)[0];
        next.splice(to, 0, moved);
        state.path = next;
        renderChips(); rebuild(); writeHash();
      });
      chipsEl.appendChild(c);
    });
  }

  function renderPathMenu() {
    pathMenuPop.innerHTML = '';
    ALL_COLS.forEach(function (c) {
      var lbl = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.path.indexOf(c) >= 0;
      cb.addEventListener('change', function () {
        if (cb.checked) {
          if (state.path.indexOf(c) < 0) state.path.push(c);
        } else {
          state.path = state.path.filter(function (x) { return x !== c; });
        }
        renderChips(); rebuild(); writeHash();
      });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(' ' + c));
      pathMenuPop.appendChild(lbl);
    });
  }
  pathMenuBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    renderPathMenu();
    pathMenuPop.classList.toggle('open');
  });
  document.addEventListener('click', function (e) {
    if (!pathMenuPop.contains(e.target) && e.target !== pathMenuBtn) pathMenuPop.classList.remove('open');
  });

  // ---- Build the treemap from the current state. ----
  // We produce labels / parents / values / ids / color arrays and hand them
  // to <gp-treemap>. IDs are path-encoded so they are stable across rebuilds.
  var tree = null;

  var I32_NULL = -0x80000000;
  function isNumericKind(k) { return k === 'f64' || k === 'i32' || k === 'rowidx'; }
  function colNumValue(ci, ri) {
    if (ci.kind === 'rowidx') return ri + 1;
    if (ci.kind === 'i32') { var v = ci.buf[ri]; return v === I32_NULL ? NaN : v; }
    return ci.buf[ri]; // f64 — NaN for null
  }
  function colSegValue(ci, ri) {
    if (ci.kind === 'rowidx') return String(ri + 1);
    if (ci.kind === 'f64') { var f = ci.buf[ri]; return Number.isFinite(f) ? String(f) : '(blank)'; }
    if (ci.kind === 'i32') { var n2 = ci.buf[ri]; return n2 === I32_NULL ? '(blank)' : String(n2); }
    var k = ci.buf[ri]; return k === ci.nullIdx ? '(blank)' : ci.dict[k];
  }
  function colorIsNumeric() {
    if (!state.color) return false;
    var ci = colByName[state.color];
    return !!(ci && isNumericKind(ci.kind));
  }

  function rebuild() {
    if (!envelope) return;
    var pathCols = state.path.slice();
    var sizeCol = state.size;
    var colorCol = state.color;
    var cIsNum = colorIsNumeric();

    var ROOT_ID = '__root__';
    var labels = ['All'];
    var parents = [''];          // '' means "no parent" (root)
    var values = [0];
    var ids = [ROOT_ID];
    var colorSum = [0], colorCnt = [0], colorCat = [null];
    var byKey = new Map(); byKey.set(ROOT_ID, 0);

    var sizeCI = colByName[sizeCol] || null;
    var colorCI = colByName[colorCol] || null;
    var pathCI = pathCols.map(function (c) { return colByName[c] || null; });

    for (var ri = 0; ri < rowCount; ri++) {
      var size = sizeCI ? colNumValue(sizeCI, ri) : 0;
      if (!Number.isFinite(size) || size < 0) continue;
      var parentKey = ROOT_ID;
      for (var pcol = 0; pcol < pathCols.length; pcol++) {
        var ci = pathCI[pcol];
        var seg = ci ? colSegValue(ci, ri) : '(blank)';
        if (seg === '' || seg == null) seg = '(blank)';
        seg = seg.replace(/\\x00/g, '_');
        var key = parentKey === ROOT_ID ? seg : parentKey + '\\x00' + seg;
        var idx = byKey.get(key);
        if (idx === undefined) {
          idx = labels.length;
          byKey.set(key, idx);
          labels.push(seg);
          parents.push(parentKey);
          values.push(0);
          ids.push(key);
          colorSum.push(0); colorCnt.push(0); colorCat.push(null);
        }
        values[idx] += size;
        if (colorCI) {
          if (cIsNum) {
            var cn = colNumValue(colorCI, ri);
            if (Number.isFinite(cn)) { colorSum[idx] += cn * size; colorCnt[idx] += size; }
          } else if (colorCat[idx] == null) {
            var ki = colorCI.buf[ri];
            if (ki !== colorCI.nullIdx) colorCat[idx] = colorCI.dict[ki];
          }
        }
        parentKey = key;
      }
      values[0] += size;
    }

    var color = new Array(labels.length);
    for (var i = 0; i < labels.length; i++) {
      if (cIsNum) color[i] = colorCnt[i] ? colorSum[i] / colorCnt[i] : null;
      else color[i] = colorCat[i];
    }

    tree = { labels: labels, parents: parents, values: values, ids: ids, color: color };

    // Adjust color-mode + scale before setting data. For the diverging scale
    // we clip to the 2nd..98th percentile of aggregated color values so a
    // single outlier doesn't compress the useful range into one palette stop.
    tm.setAttribute('color-mode', cIsNum ? 'quantitative' : 'categorical');
    if (cIsNum) {
      var cscale = state.colorScale || DEFAULTS.colorScale || 'linear';
      tm.setAttribute('color-scale', cscale);
      var nums = [];
      for (var j = 0; j < color.length; j++) {
        var v = color[j];
        if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
      }
      nums.sort(function (a, b) { return a - b; });
      if (nums.length === 0) {
        tm.colorDomain = undefined;
      } else if (cscale === 'diverging') {
        var pLo = nums[Math.floor(nums.length * 0.02)];
        var pHi = nums[Math.min(nums.length - 1, Math.floor(nums.length * 0.98))];
        // Center on zero when data straddles it, otherwise on the midpoint.
        var mid = (pLo < 0 && pHi > 0) ? 0 : (pLo + pHi) / 2;
        // Diverging needs [min, mid, max] with min<mid<max.
        if (pLo >= mid) pLo = mid - Math.max(1e-9, Math.abs(mid - pHi));
        if (pHi <= mid) pHi = mid + Math.max(1e-9, Math.abs(mid - pLo));
        tm.colorDomain = [pLo, mid, pHi];
      } else {
        var lo = nums[0], hi = nums[nums.length - 1];
        tm.colorDomain = lo < hi ? [lo, hi] : undefined;
      }
    } else {
      tm.setAttribute('color-scale', 'linear');
      tm.colorDomain = undefined;
    }

    tm.ids = tree.ids;
    tm.labels = tree.labels;
    tm.parents = tree.parents;
    tm.values = tree.values;
    tm.color = tree.color;

    // Re-apply palette if user overrode the theme's default.
    if (state.palette) applyPalette(state.palette);
  }

  function applyPageTheme(name) {
    state.theme = name || '';
    var t = name ? THEMES[name] : null;
    var r = document.documentElement;
    if (t) {
      r.style.setProperty('--page-bg', t.bg);
      r.style.setProperty('--page-surface', t.surface);
      r.style.setProperty('--page-border', t.border);
      r.style.setProperty('--page-fg', t.fg);
      r.style.setProperty('--page-fg-muted', t.fgMuted);
      r.style.setProperty('--page-accent', t.accent);
    } else {
      ['--page-bg','--page-surface','--page-border','--page-fg','--page-fg-muted','--page-accent']
        .forEach(function (v) { r.style.removeProperty(v); });
    }
    tm.setAttribute('theme', name || '');
    // Re-apply palette override since setting theme resets it.
    applyPalette(state.palette);
    themeSel.value = state.theme;
  }
  function applyPalette(name) {
    state.palette = name || '';
    var effective = name || state.theme || 'gp-default';
    tm._props.palette = effective;
    tm.setAttribute('palette', effective);
    tm._queueRender && tm._queueRender();
    paletteSel.value = state.palette;
  }

  themeSel.addEventListener('change', function () { applyPageTheme(themeSel.value); writeHash(); });
  paletteSel.addEventListener('change', function () { applyPalette(paletteSel.value); writeHash(); });
  sizeSel.addEventListener('change', function () { state.size = sizeSel.value; rebuild(); writeHash(); });
  colorSel.addEventListener('change', function () { state.color = colorSel.value; rebuild(); writeHash(); });

  // ---- URL hash sync. ----
  // Format: a single URL-encoded JSON blob under the key "s" (#s={...}).
  // Decoded content is the application state; the component's slice lives
  // under "viewer" and is round-tripped via tm.viewerState.
  function readHash() {
    try {
      if (location.hash.length <= 1) return false;
      var raw = location.hash.slice(1);
      if (!(raw.charAt(0) === 's' && raw.charAt(1) === '=')) return false;
      var obj = JSON.parse(decodeURIComponent(raw.slice(2)));
      if (obj.size) state.size = obj.size;
      if (obj.color) state.color = obj.color;
      if (Array.isArray(obj.path)) state.path = obj.path.slice();
      state.colorScale = 'colorScale' in obj ? (obj.colorScale || DEFAULTS.colorScale) : DEFAULTS.colorScale;
      state.viewer = obj.viewer && typeof obj.viewer === 'object' ? obj.viewer : {};
      state.theme = 'theme' in state.viewer ? (state.viewer.theme || '') : '';
      state.palette = 'palette' in state.viewer ? (state.viewer.palette || '') : '';
      return true;
    } catch (_) { return false; }
  }
  function writeHash() {
    try {
      var v = tm.viewerState || {};
      // Page-side theme/palette take precedence (we're authoritative over
      // page chrome; the component only mirrors them for its own painting).
      if (state.theme) v.theme = state.theme; else delete v.theme;
      if (state.palette) v.palette = state.palette; else delete v.palette;
      var out = {
        size: state.size,
        color: state.color,
        path: state.path.slice(),
        viewer: v,
      };
      if (state.colorScale && state.colorScale !== 'linear') out.colorScale = state.colorScale;
      var s = 's=' + encodeURIComponent(JSON.stringify(out));
      history.replaceState(null, '', '#' + s);
    } catch (_) {}
  }

  // The component's viewerState is the source of truth for zoom/target/
  // focus/depth/showLabels — we just pull it fresh at writeHash() time.
  tm.addEventListener('gp-zoom-change', writeHash);
  tm.addEventListener('gp-target', writeHash);
  tm.addEventListener('gp-focus', writeHash);
  tm.addEventListener('gp-depth-change', writeHash);

  // ---- Boot: inflate envelope, set controls, render. ----
  var raw = document.getElementById('tmdata').textContent;
  inflateRaw(b64ToBytes(raw)).then(function (text) {
    envelope = JSON.parse(text);
    rowCount = envelope.rowCount;
    // Decode column buffers into TypedArrays. Each column is either a
    // Float64Array (kind='f64', null = NaN) or a Uint16/Uint32 dictionary
    // index (null = top-bit sentinel).
    envelope.colInfo.forEach(function (ci, i) {
      var buf = null;
      var nullIdx = null;
      if (ci.kind === 'rowidx') {
        // Synthesize 1..N so sizeof(HTML) doesn't grow with the row count.
        buf = { length: rowCount, isRowIdx: true };
      } else {
        var bytes = b64ToBytes(envelope.colBuffers[i]);
        if (ci.kind === 'f64')       buf = new Float64Array(bytes.buffer, bytes.byteOffset, rowCount);
        else if (ci.kind === 'i32')  buf = new Int32Array(bytes.buffer, bytes.byteOffset, rowCount);
        else if (ci.kind === 'u32')  { buf = new Uint32Array(bytes.buffer, bytes.byteOffset, rowCount); nullIdx = 0xFFFFFFFF; }
        else /* u16 */               { buf = new Uint16Array(bytes.buffer, bytes.byteOffset, rowCount); nullIdx = 0xFFFF; }
      }
      colByName[ci.name] = {
        index: i, kind: ci.kind, dict: ci.dict || null, nullIdx: nullIdx, buf: buf,
      };
    });
    // Free the base64 column strings now that they're decoded.
    envelope.colBuffers = null;

    var hadHash = readHash();
    // Validate size/color/path against available columns (fall back to defaults).
    if (NUMERIC_NONNEG.indexOf(state.size) < 0) state.size = DEFAULTS.size;
    if (ALL_COLS.indexOf(state.color) < 0) state.color = DEFAULTS.color;
    state.path = state.path.filter(function (c) { return ALL_COLS.indexOf(c) >= 0; });
    if (state.path.length === 0) state.path = DEFAULTS.path.slice();

    sizeSel.value = state.size;
    colorSel.value = state.color;
    renderChips();
    applyPageTheme(state.theme);
    applyPalette(state.palette);

    rebuild();

    // If the URL had no hash, seed the component slice with the baked
    // defaults (e.g. --show-labels sets showLabels=true at build time).
    if (!hadHash && !('showLabels' in state.viewer) && DEFAULTS.showLabels) {
      state.viewer.showLabels = true;
    }
    // Hand the component's slice of state back to it in one shot.
    tm.viewerState = state.viewer;

    // If no hash was present, populate it with the current defaults.
    if (!hadHash) writeHash();

    // Stats bar.
    var bar = statsBar;
    function fmt(n) {
      if (typeof n !== 'number') return String(n);
      if (Math.abs(n) >= 1e9) return (n/1e9).toFixed(2) + 'B';
      if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(2) + 'M';
      if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(2) + 'k';
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    function update() {
      var id = tm._focusId != null ? tm._focusId : tm._targetId != null ? tm._targetId : null;
      var node = id != null && tm._tree ? tm._tree.nodes.get(id) : null;
      if (!node) { bar.textContent = state.size + ': ' + fmt(tree ? tree.values[0] : 0); return; }
      var parts = [node.id || 'All', state.size + ': ' + fmt(node.value)];
      if (state.color && state.color !== state.size) {
        parts.push(state.color + ': ' + (typeof node.colorValue === 'number' ? fmt(node.colorValue) : String(node.colorValue)));
      }
      bar.textContent = parts.join('   |   ');
    }
    tm.addEventListener('gp-focus', update);
    tm.addEventListener('gp-target', update);
    tm.addEventListener('gp-zoom-change', update);
    requestAnimationFrame(function () { setTimeout(update, 0); });
    window._allBlocksReady = Promise.resolve();
  });
})();
</script>
</body>
</html>
`;
  fs.writeFileSync(outPath, html);
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (positional.length < 1 || flags.help || flags.h) {
    console.error('Usage: node tools/table-treemap.js [--size=COL] [--color=COL] [--path=A,B,C] [--theme=NAME] [--palette=NAME] [--title=STR] [--no-open] [--max-rows=N] <input.(jsonl|csv)> [output.html]');
    process.exit(positional.length < 1 ? 2 : 0);
  }
  if (!fs.existsSync(BUNDLE_PATH)) {
    console.error('bundle not found at ' + BUNDLE_PATH + '\nRun `node tools/build.js` first.');
    process.exit(1);
  }
  const input = path.resolve(positional[0]);
  const out = positional[1]
    ? path.resolve(positional[1])
    : path.join(os.tmpdir(), 'table-treemap-' + path.basename(input).replace(/[^a-zA-Z0-9._-]/g, '_') + '-' + Date.now() + '.html');

  const maxRows = flags['max-rows'] ? Number(flags['max-rows']) : 0;
  let { columns, rows } = loadTable(input, maxRows);
  if (columns.length === 0 || rows.length === 0) {
    console.error('no data loaded from ' + input);
    process.exit(1);
  }
  // --keep-cols narrows the column set (the synthetic _row is always kept).
  if (flags['keep-cols']) {
    const keep = new Set(flags['keep-cols'].split(',').map((s) => s.trim()).filter(Boolean));
    keep.add('_row');
    const missing = [...keep].filter((c) => !columns.includes(c));
    if (missing.length) {
      console.error('--keep-cols: unknown column(s): ' + missing.join(', '));
      process.exit(2);
    }
    const kept = columns.filter((c) => keep.has(c));
    columns = kept;
    rows = rows.map((r) => { const o = {}; for (const c of kept) o[c] = r[c]; return o; });
  }
  const info = profileColumns(columns, rows);
  const defaults = pickDefaults(columns, info, flags);
  const title = flags.title || path.basename(input);
  buildHtml(out, title, columns, info, rows, defaults, flags);
  const sz = fs.statSync(out).size;
  console.log('wrote ' + out + '  (' + humanBytes(sz) + ', ' + rows.length.toLocaleString() + ' rows, ' + columns.length + ' cols)');
  console.log('  size  ' + defaults.size);
  console.log('  color ' + defaults.color);
  console.log('  path  ' + defaults.pathCols.join(' > '));
  if (!flags.noOpen) {
    try {
      const { execSync } = require('node:child_process');
      const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
      execSync(openCmd + ' ' + JSON.stringify(out));
    } catch {}
  }
}

main();
