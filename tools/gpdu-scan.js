#!/usr/bin/env node
// Scan a directory recursively and emit a self-contained HTML treemap.
// The output has the bundle and the dataset inlined, so you can open it
// from anywhere with no server.
//
// Usage:
//   node tools/gpdu-scan.js [--no-open] [--color=...] [--workers=N]
//                           [--block-size=N] <dir> [output.html]
//
// Symlinks are not followed (we use lstat). Unreadable entries are counted
// and skipped.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { BUNDLE } from '../dist/gp-treemap.bundle.embed.js';
import { partitionBlocks, encodeBlock, humanBytes, escapeHtml, LOADER_JS } from './scan-core.js';

const COLOR_MODES = ['extension', 'kind', 'folder', 'ctime', 'mtime', 'atime'];
const CATEGORICAL_MODES = ['extension', 'kind', 'folder'];
const QUANTITATIVE_MODES = ['ctime', 'mtime', 'atime'];

async function main() {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  let colorBy = 'extension';
  let blockSize = 500000;
  let workers = 16;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-open') continue;
    if (argv[i].startsWith('--block-size=')) { blockSize = Number(argv[i].split('=')[1]) || 500000; continue; }
    if (argv[i].startsWith('--workers=')) { workers = Math.max(1, Number(argv[i].split('=')[1]) || 16); continue; }
    if (argv[i] === '--color' || argv[i] === '--color-by') {
      colorBy = argv[++i];
      if (!COLOR_MODES.includes(colorBy)) {
        console.error('Unknown --color mode: ' + colorBy + '\nValid modes: ' + COLOR_MODES.join(', '));
        process.exit(2);
      }
      continue;
    }
    if (argv[i].startsWith('--color=') || argv[i].startsWith('--color-by=')) {
      colorBy = argv[i].split('=')[1];
      if (!COLOR_MODES.includes(colorBy)) {
        console.error('Unknown --color mode: ' + colorBy + '\nValid modes: ' + COLOR_MODES.join(', '));
        process.exit(2);
      }
      continue;
    }
    args.push(argv[i]);
  }
  if (args.length < 1 || args[0] === '-h' || args[0] === '--help') {
    console.error('Usage: node tools/gpdu-scan.js [--no-open] [--color=' + COLOR_MODES.join('|') + '] <dir> [output.html]');
    process.exit(args[0] === '-h' || args[0] === '--help' ? 0 : 2);
  }
  const target = path.resolve(args[0]);
  const out = args[1]
    ? path.resolve(args[1])
    : path.join(os.tmpdir(), 'gpdu-scan-' + path.basename(target).replace(/[^a-zA-Z0-9._-]/g, '_') + '-' + Date.now() + '.html');

  let rootStat;
  try { rootStat = fs.lstatSync(target); }
  catch (e) { console.error('cannot stat ' + target + ': ' + e.message); process.exit(1); }
  if (!rootStat.isDirectory()) {
    console.error(target + ' is not a directory');
    process.exit(1);
  }
  const t0 = Date.now();
  const scan = await walk(target, workers);
  const elapsed = Date.now() - t0;
  buildHtml(out, target, scan, colorBy, blockSize);

  console.log('');
  console.log('scanned ' + target);
  console.log('  files        ' + scan.files.toLocaleString());
  console.log('  directories  ' + scan.dirs.toLocaleString());
  console.log('  total size   ' + humanBytes(scan.bytes) + '  (' + scan.bytes.toLocaleString() + ' B)');
  if (scan.unreadable) console.log('  unreadable   ' + scan.unreadable.toLocaleString() + ' entries skipped');
  console.log('  scan took    ' + elapsed + ' ms');
  console.log('');
  console.log('wrote ' + out + '  (' + humanBytes(fs.statSync(out).size) + ')');

  if (!noOpen) {
    const { execSync } = await import('node:child_process');
    const openCmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { execSync(openCmd + ' ' + JSON.stringify(out)); } catch { console.log('open it with:  open "' + out + '"'); }
  }
}

// Worker source, inlined so it runs via `{ eval: true }` instead of a file
// read — keeps the Deno sandbox from needing --allow-read on the npm cache.
const WORKER_SRC = `
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
parentPort.on('message', ({ dirPath, dirRow }) => {
  let entries; const results = []; let unreadable = 0;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch { parentPort.postMessage({ dirRow, dirPath, results, unreadable: 1 }); return; }
  for (const ent of entries) {
    if (ent.isSymbolicLink()) { unreadable++; continue; }
    if (ent.isDirectory()) {
      results.push({ name: ent.name, isDir: true });
    } else if (ent.isFile()) {
      let st;
      try { st = fs.statSync(path.join(dirPath, ent.name)); }
      catch { unreadable++; continue; }
      results.push({ name: ent.name, isDir: false, size: st.size,
        ts: { ctime: st.ctimeMs, mtime: st.mtimeMs, atime: st.atimeMs } });
    } else { unreadable++; }
  }
  parentPort.postMessage({ dirRow, dirPath, results, unreadable });
});
`;

async function walk(rootPath, NWORKERS) {
  const { Worker } = await import('node:worker_threads');

  // Per-node arrays (parallel; index i refers to the same node in all of these).
  const labels = [], parentIndices = [], values = [];
  const rawExtColor = [];   // raw lowercased extension
  const extColor = [];      // bucketed file kind
  const folderColor = [];   // parent folder label
  const ctimes = [];
  const mtimes = [];
  const atimes = [];
  let bytes = 0, files = 0, dirs = 0, unreadable = 0;

  labels.push(path.basename(rootPath) || rootPath);
  parentIndices.push(-1); values.push(0);
  rawExtColor.push('dir'); extColor.push('dir'); folderColor.push('dir');
  ctimes.push(0); mtimes.push(0); atimes.push(0);
  dirs++;

  const queue = [{ dirPath: rootPath, dirRow: 0 }];
  let pending = 0;

  let lastPrint = 0;
  function printProgress() {
    const now = Date.now();
    if (now - lastPrint < 150) return;
    lastPrint = now;
    process.stderr.write(
      '\r  ' + files.toLocaleString() + ' files   ' +
      dirs.toLocaleString() + ' dirs   ' + humanBytes(bytes) + '          '
    );
  }

  const workers = [];

  await new Promise((resolve, reject) => {
    const idle = [];

    function dispatch() {
      while (idle.length > 0 && queue.length > 0) {
        const wi = idle.pop();
        const work = queue.shift();
        pending++;
        workers[wi].postMessage(work);
      }
      if (pending === 0 && queue.length === 0) resolve();
    }

    for (let i = 0; i < NWORKERS; i++) {
      const w = new Worker(WORKER_SRC, { eval: true });
      w.on('message', (result) => {
        pending--;
        idle.push(i);
        unreadable += result.unreadable;
        for (const ent of result.results) {
          if (ent.isDir) {
            const row = labels.length;
            labels.push(ent.name);
            parentIndices.push(result.dirRow);
            values.push(0);
            rawExtColor.push('dir'); extColor.push('dir'); folderColor.push('dir');
            ctimes.push(0); mtimes.push(0); atimes.push(0);
            dirs++;
            queue.push({ dirPath: path.join(result.dirPath, ent.name), dirRow: row });
          } else {
            labels.push(ent.name);
            parentIndices.push(result.dirRow);
            values.push(ent.size);
            rawExtColor.push(rawExt(ent.name));
            extColor.push(extKind(ent.name));
            folderColor.push(labels[result.dirRow]);
            ctimes.push(ent.ts ? ent.ts.ctime : 0);
            mtimes.push(ent.ts ? ent.ts.mtime : 0);
            atimes.push(ent.ts ? ent.ts.atime : 0);
            bytes += ent.size;
            files++;
          }
        }
        printProgress();
        dispatch();
      });
      w.on('error', reject);
      workers.push(w);
      idle.push(i);
    }

    dispatch();
  });

  process.stderr.write('\r' + ' '.repeat(72) + '\r');
  for (const w of workers) w.terminate();

  return {
    labels, parentIndices, values,
    rawExtColor, extColor, folderColor,
    ctimes, mtimes, atimes,
    bytes, files, dirs, unreadable,
  };
}

function rawExt(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '(none)';
}

// Map a filename to a curated "kind" bucket so similar file kinds share a
// color. Anything outside the buckets falls through to its lowercased
// extension; dot-files / extension-less get 'bin'.
function extKind(name) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return 'bin';
  const ext = lower.slice(dot + 1);
  const BUCKETS = {
    image: ['jpg','jpeg','png','gif','webp','heic','tiff','bmp','svg','ico','raw','cr2','nef','arw'],
    video: ['mov','mp4','m4v','avi','mkv','webm','flv','wmv'],
    audio: ['mp3','wav','flac','aac','m4a','ogg','opus','aiff'],
    doc:   ['pdf','doc','docx','odt','rtf','txt','md','tex','pages'],
    sheet: ['xls','xlsx','ods','csv','tsv','numbers'],
    slide: ['ppt','pptx','key','odp'],
    code:  ['js','mjs','cjs','ts','tsx','jsx','py','rb','go','rs','java','kt','swift','c','cc','cpp','h','hpp','m','mm','cs','php','sh','zsh','bash','lua','sql','yaml','yml','toml','json','xml'],
    web:   ['html','htm','css','scss','sass','less','vue','svelte'],
    archive:['zip','tar','gz','bz2','xz','7z','rar','dmg','iso','pkg'],
    font:  ['ttf','otf','woff','woff2','eot'],
    build: ['o','a','so','dylib','dll','exe','class','jar','wasm','lock'],
  };
  for (const [k, exts] of Object.entries(BUCKETS)) {
    if (exts.includes(ext)) return k;
  }
  return ext;
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

const THEMES = {
  nord:          { label: 'Nord',             dark: true,  bg: '#2e3440', surface: '#3b4252', border: '#4c566a', fg: '#d8dee9', fgMuted: '#81a1c1', accent: '#88c0d0' },
  solarized:     { label: 'Solarized Dark',   dark: true,  bg: '#002b36', surface: '#073642', border: '#586e75', fg: '#839496', fgMuted: '#657b83', accent: '#268bd2' },
  dracula:       { label: 'Dracula',           dark: true,  bg: '#282a36', surface: '#44475a', border: '#6272a4', fg: '#f8f8f2', fgMuted: '#6272a4', accent: '#bd93f9' },
  catppuccin:    { label: 'Catppuccin Mocha',  dark: true,  bg: '#1e1e2e', surface: '#313244', border: '#45475a', fg: '#cdd6f4', fgMuted: '#a6adc8', accent: '#cba6f7' },
  gruvbox:       { label: 'Gruvbox Dark',      dark: true,  bg: '#282828', surface: '#3c3836', border: '#504945', fg: '#ebdbb2', fgMuted: '#a89984', accent: '#fabd2f' },
  'tokyo-night': { label: 'Tokyo Night',       dark: true,  bg: '#1a1b26', surface: '#16161e', border: '#0f0f14', fg: '#c0caf5', fgMuted: '#787c99', accent: '#7aa2f7' },
  'rose-pine':   { label: 'Rosé Pine',         dark: true,  bg: '#191724', surface: '#1f1d2e', border: '#26233a', fg: '#e0def4', fgMuted: '#908caa', accent: '#c4a7e7' },
  'one-dark':    { label: 'One Dark',           dark: true,  bg: '#282c34', surface: '#2c313a', border: '#3e4452', fg: '#abb2bf', fgMuted: '#828997', accent: '#61afef' },
};

const PALETTE_PICKS = {
  viridis:      'Viridis',
  plasma:       'Plasma',
  inferno:      'Inferno',
  magma:        'Magma',
  turbo:        'Turbo',
  heatmap:      'Heatmap',
  coolwarm:     'Cool\u2013Warm',
  rainbow:      'Rainbow',
  'gp-default': 'Default 8-hue',
};

const KIND_COLORMAP = {
  image:   'hsl(300, 55%, 55%)',
  video:   'hsl(348, 70%, 50%)',
  audio:   'hsl(170, 55%, 45%)',
  doc:     'hsl(211, 70%, 52%)',
  sheet:   'hsl(138, 55%, 45%)',
  slide:   'hsl(26,  85%, 55%)',
  code:    'hsl(48,  85%, 55%)',
  web:     'hsl(188, 70%, 48%)',
  archive: 'hsl(20,  60%, 48%)',
  font:    'hsl(264, 55%, 58%)',
  build:   'hsl(0,    0%, 55%)',
  bin:     'hsl(210, 10%, 45%)',
  dir:     'hsl(220, 10%, 35%)',
};

const HELP_HTML = `
<h2>gp-treemap &mdash; disk usage</h2>
<p>Cell area is bytes on disk. Cells are colored by the <b>color</b> mode
  above. Each folder's pixels are subdivided among its children, so the
  shape of the tree is visible in the layout.</p>
<h3>Mouse</h3>
<ul>
  <li><b>Hover</b>: see full path + size in the tooltip.</li>
  <li><b>Click</b> a cell: select it; the breadcrumb lights up.</li>
  <li><b>Scroll wheel</b> while a cell is selected: move the highlight up
    or down the ancestor chain.</li>
  <li><b>Double-click</b> a cell: zoom into it. Double-click a parent in
    the breadcrumb to zoom back to that ancestor.</li>
</ul>
<h3>Breadcrumb (the path row)</h3>
<ul>
  <li><b>Click</b> a segment to focus that ancestor.</li>
  <li><b>Double-click</b> to zoom to it. The home icon on the left jumps
    to the tree root.</li>
</ul>
<h3>Component toolbar</h3>
<ul>
  <li><b>Depth</b>: how many levels below the current zoom to draw.
    <kbd>+</kbd>/<kbd>&minus;</kbd>, or type a number. Snaps to <b>&infin;</b>
    once you reach the tree's deepest level.</li>
  <li><b>Labels</b>: show each leaf's full path from the zoom root inside
    its cell, when it fits.</li>
</ul>
<h3>URL</h3>
<p>All state (zoom / focus / theme / palette / depth &hellip;) is
  serialized into the URL hash as a single JSON blob, so you can copy a
  link to any view.</p>
`;

const PAGE_CSS = `
  html, body { margin: 0; padding: 0; height: 100%; font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--page-bg, #fafafa); color: var(--page-fg, #111); transition: background .15s, color .15s; }
  body { display: flex; flex-direction: column; }
  .title-row { padding: 8px 14px; border-bottom: 1px solid var(--page-border, #0002);
    display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap;
    background: var(--page-surface, #fff); transition: background .15s; }
  .title-row h1 { margin:0; font-size:14px; font-weight:600; font-family: ui-monospace, SF Mono, Menlo, monospace;
    color: var(--page-fg, #222); }
  .title-row .stat { color: var(--page-fg-muted, #555); font-size:13px; font-variant-numeric: tabular-nums; }
  .title-row .stat b { color: var(--page-fg, #000); font-weight:600; }
  .app-toolbar { padding: 4px 14px; border-bottom: 1px solid var(--page-border, #0002);
    display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
    background: var(--page-surface, #fff); font-size: 12px; color: var(--page-fg-muted, #666);
    transition: background .15s; }
  .app-toolbar .spacer { flex: 1; }
  .help-btn { font-size: 12px; width: 22px; height: 22px; line-height: 20px; text-align: center;
    border-radius: 50%; background: var(--page-bg, #fff); color: var(--page-fg, #333);
    border: 1px solid var(--page-border, #ccc); cursor: pointer; padding: 0;
    font-family: inherit; font-weight: 600; }
  .help-btn:hover { background: var(--page-border, #eee); }
  .help-modal-backdrop { position: fixed; inset: 0; background: #0007; z-index: 999; display: none;
    align-items: center; justify-content: center; }
  .help-modal-backdrop.open { display: flex; }
  .help-modal { background: var(--page-surface, #fff); color: var(--page-fg, #111);
    border: 1px solid var(--page-border, #333); border-radius: 8px; padding: 20px 24px;
    max-width: 560px; max-height: 80vh; overflow: auto; box-shadow: 0 8px 40px #000a;
    font-size: 13px; line-height: 1.5; }
  .help-modal h2 { margin: 0 0 10px; font-size: 16px; }
  .help-modal h3 { margin: 14px 0 4px; font-size: 13px; font-weight: 600; }
  .help-modal ul { margin: 4px 0 0 0; padding-left: 20px; }
  .help-modal .close { float: right; background: none; border: none; color: inherit;
    font-size: 18px; cursor: pointer; margin: -4px -8px 0 0; }
  .help-modal code, .help-modal kbd { background: var(--page-border, #eee); color: inherit;
    padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  gp-treemap { display:flex; flex: 1; min-height: 0; }
  #bottom-bar { display:flex; align-items:center; gap: 16px; padding: 3px 14px;
    font-size: 12px; font-variant-numeric: tabular-nums; min-height: 18px;
    color: var(--page-fg-muted, #888); background: var(--page-surface, #fff);
    border-top: 1px solid var(--page-border, #0002); transition: background .15s, color .15s; }
  #stats-bar { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #scanned-note { flex-shrink: 0; color: var(--page-fg-muted, #888); }
  #theme-sel, #palette-sel, #color-sel { font-size: 12px; padding: 2px 4px; border-radius: 4px;
    background: var(--page-bg, #fff); color: var(--page-fg, #333);
    border: 1px solid var(--page-border, #ccc); cursor: pointer; }
`;

// Streaming HTML builder — writes directly to a file descriptor to avoid
// hitting V8's ~512 MB string limit on large scans (8M+ files).
function buildHtml(outPath, target, scan, colorBy, blockSize) {
  const fd = fs.openSync(outPath, 'w');
  const w = (s) => fs.writeSync(fd, s);

  const isCategorical = CATEGORICAL_MODES.includes(colorBy);
  const tmColorMode = isCategorical ? 'categorical' : 'quantitative';
  const tmPalette = isCategorical ? 'tokyo-night' : 'viridis';

  const themeOptions = Object.entries(THEMES)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`)
    .join('');
  const paletteOptions = Object.entries(PALETTE_PICKS)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`)
    .join('');

  const humanSize = humanBytes(scan.bytes);
  const when = (() => {
    const d = new Date();
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
    const mm = String(Math.abs(off) % 60).padStart(2, '0');
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
      'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') +
      sign + hh + ':' + mm;
  })();

  // ---- Page chrome ----
  w(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>treemap \xb7 ${escapeHtml(target)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="title-row">
  <h1>${escapeHtml(target)}</h1>
  <span class="stat"><b>${scan.files.toLocaleString()}</b> files</span>
  <span class="stat"><b>${scan.dirs.toLocaleString()}</b> directories</span>
  <span class="stat"><b>${humanSize}</b> total</span>
  ${scan.unreadable ? `<span class="stat">(${scan.unreadable.toLocaleString()} unreadable)</span>` : ''}
  <span class="spacer" style="flex:1"></span>
  <button id="help-btn" class="help-btn" title="Keyboard &amp; mouse cheatsheet">?</button>
</div>
<div class="app-toolbar">
  <span>color
    <select id="color-sel">
      <option value="extension">extension</option>
      <option value="kind">file kind</option>
      <option value="folder">folder</option>
      <option value="ctime">created</option>
      <option value="mtime">modified</option>
      <option value="atime">accessed</option>
    </select>
  </span>
  <span class="spacer"></span>
  <span>theme
    <select id="theme-sel">
      <option value="">Default (light)</option>
      ${themeOptions}
    </select>
  </span>
  <span>palette
    <select id="palette-sel">
      <option value="">(theme default)</option>
      ${paletteOptions}
    </select>
  </span>
</div>
<div id="help-modal" class="help-modal-backdrop">
  <div class="help-modal" role="dialog" aria-label="Help">
    <button class="close" aria-label="close">\xD7</button>
    ${HELP_HTML}
  </div>
</div>
<gp-treemap id="tm"
  color-mode="${tmColorMode}"
  palette="${tmPalette}"
  gradient-intensity="0.6"
  value-format="b"
  min-cell-area="30"></gp-treemap>
<div id="bottom-bar">
  <div id="stats-bar"></div>
  <span id="scanned-note">scanned ${escapeHtml(when)}</span>
</div>

<script type="application/json" id="tmdata">
`);

  // ---- Block-partition + envelope ----
  const normScan = {
    labels: scan.labels,
    parentIndices: scan.parentIndices,
    values: scan.values,
    attributes: {
      extension: { kind: 'categorical', values: scan.rawExtColor },
      kind:      { kind: 'categorical', values: scan.extColor },
      folder:    { kind: 'categorical', values: scan.folderColor },
      ctime:     { kind: 'numeric',     values: scan.ctimes },
      mtime:     { kind: 'numeric',     values: scan.mtimes },
      atime:     { kind: 'numeric',     values: scan.atimes },
    },
    stubFields: {
      // Per-node leaf and dir counts for the stats bar's stub fast path.
      // Computed below from childIds.
    },
  };

  const { blocks, childIds, aggValue } = partitionBlocks(normScan, blockSize);

  // Compute aggFiles / aggDirs (file-leaves vs. directory-internals) for stub records.
  const n = scan.labels.length;
  const aggFiles = new Int32Array(n);
  const aggDirs = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    if (!childIds[i]) { aggFiles[i] = 1; aggDirs[i] = 0; }
    else {
      aggFiles[i] = 0; aggDirs[i] = 1;
      for (const c of childIds[i]) { aggFiles[i] += aggFiles[c]; aggDirs[i] += aggDirs[c]; }
    }
  }
  normScan.stubFields = { aggFiles: Array.from(aggFiles), aggDirs: Array.from(aggDirs) };

  process.stderr.write('  partitioned into ' + blocks.length + ' blocks\n');

  w('{"v":3,"totalFiles":' + scan.files + ',"totalDirs":' + scan.dirs +
    ',"totalBytes":' + scan.bytes + ',"blocks":[');
  for (let bi = 0; bi < blocks.length; bi++) {
    const blockJson = JSON.stringify(encodeBlock(normScan, blocks[bi], { aggValue }));
    const compressed = zlib.deflateRawSync(blockJson, { level: 6 });
    if (bi > 0) w(',');
    w('"' + compressed.toString('base64') + '"');
  }
  w(']}');

  // ---- Loader config + bundle + loader IIFE + tool-specific stats bar ----
  const cfg = {
    defaultColorMode: colorBy,
    categoricalModes: CATEGORICAL_MODES,
    quantitativeModes: QUANTITATIVE_MODES,
    catColorMaps: { kind: KIND_COLORMAP },
    defaultTheme: 'tokyo-night',
    themes: THEMES,
    palettePicks: PALETTE_PICKS,
    catPaletteDefault: 'tokyo-night',
    qPaletteDefault: 'viridis',
  };

  w(`
<\/script>
<script>
window._gpduConfig = ${JSON.stringify(cfg)};
window._gpduConfig.valueFormatter = function (v) {
  var units = ['B','KB','MB','GB','TB','PB']; var i = 0, n = v || 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
};
<\/script>
<script>
${BUNDLE}
<\/script>
<script>
${LOADER_JS}
<\/script>
<script>
// Stats bar: subtree counts + per-node metadata for the focused node.
window._bootReady.then(function () {
  var tm = document.getElementById('tm');
  var bar = document.getElementById('stats-bar');
  var store = window._store;
  var envTotalFiles = ${scan.files}, envTotalDirs = ${scan.dirs}, envTotalBytes = ${scan.bytes};
  function fmtBytes(v) {
    var units = ['B','KB','MB','GB','TB','PB']; var i = 0, n = v || 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
  }
  function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function subtreeStats(nodeId) {
    var nd = store.get(nodeId);
    if (!nd) return null;
    if (nd.stubBlockId != null && nd.childIds === null) {
      var sa = nd.stubAggregates || {};
      return { files: sa.aggFiles || 0, dirs: sa.aggDirs || 0, bytes: nd.value };
    }
    var files = 0, dirs = 0, bytes = 0;
    var stack = [nodeId];
    while (stack.length) {
      var id = stack.pop();
      var n = store.get(id);
      if (!n) continue;
      if (n.stubBlockId != null && n.childIds === null) {
        var sa2 = n.stubAggregates || {};
        files += sa2.aggFiles || 0; dirs += sa2.aggDirs || 0; bytes += n.value; continue;
      }
      if (n.childIds && n.childIds.length > 0) {
        dirs++;
        for (var k = 0; k < n.childIds.length; k++) stack.push(n.childIds[k]);
      } else {
        files++; bytes += n.value || 0;
      }
    }
    return { files: files, dirs: dirs, bytes: bytes };
  }
  function update() {
    var id = tm._focusId != null ? tm._focusId : tm._targetId != null ? tm._targetId : tm._tree ? tm._tree.roots[0] : null;
    if (id == null) { bar.textContent = ''; return; }
    var root = tm._tree && tm._tree.roots[0];
    var s = (id === root) ? { files: envTotalFiles, dirs: envTotalDirs, bytes: envTotalBytes } : subtreeStats(id);
    if (!s) { bar.textContent = ''; return; }
    var parts = [];
    if (s.files > 0) parts.push(s.files.toLocaleString() + ' file' + (s.files !== 1 ? 's' : ''));
    if (s.dirs > 0) parts.push(s.dirs.toLocaleString() + ' folder' + (s.dirs !== 1 ? 's' : ''));
    parts.push(fmtBytes(s.bytes));
    var nd = store.get(id);
    if (nd && !nd.childIds && !nd.stubBlockId) {
      var kind = nd.kind;
      var label = nd.label || '';
      var dot = label.lastIndexOf('.');
      var ext = dot > 0 ? label.slice(dot) : '';
      if (kind && kind !== 'dir') {
        parts.push(ext && ext.slice(1) !== kind ? ext + ' (' + kind + ')' : kind);
      }
      if (nd.ctime) parts.push('created: ' + fmtDate(nd.ctime));
      if (nd.mtime) parts.push('modified: ' + fmtDate(nd.mtime));
      if (nd.atime) parts.push('accessed: ' + fmtDate(nd.atime));
    }
    bar.textContent = parts.join('  |  ');
  }
  tm.addEventListener('gp-focus', update);
  tm.addEventListener('gp-target', update);
  tm.addEventListener('gp-zoom-change', update);
  requestAnimationFrame(function () { setTimeout(update, 0); });
});
<\/script>
</body>
</html>
`);

  fs.closeSync(fd);
}

main();
