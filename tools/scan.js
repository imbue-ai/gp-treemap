#!/usr/bin/env node
// Scan a directory recursively and emit a self-contained HTML file that
// renders its size treemap with <raised-treemap>. The output has the bundle and
// the dataset inlined, so you can open it from anywhere with no server.
//
// Usage:  node tools/scan.js [--color=extension|kind|folder|ctime|mtime|atime] <dir> [output.html]
//                 (or `npm run scan -- [--color=...] <dir> [output.html]`)
//
// Symlinks are not followed (we use lstat). Unreadable entries are counted
// and skipped.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUNDLE_PATH = path.join(ROOT, 'dist', 'raised-treemap.bundle.js');

const COLOR_MODES = ['extension', 'kind', 'folder', 'ctime', 'mtime', 'atime'];

async function main() {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  let colorBy = 'extension';
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-open') continue;
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
    console.error('Usage: node tools/scan.js [--no-open] [--color=extension|kind|folder|ctime|mtime|atime] <dir> [output.html]');
    process.exit(args[0] === '-h' || args[0] === '--help' ? 0 : 2);
  }
  const target = path.resolve(args[0]);
  const out = args[1]
    ? path.resolve(args[1])
    : path.join(os.tmpdir(), 'raised-treemap-' + path.basename(target).replace(/[^a-zA-Z0-9._-]/g, '_') + '-' + Date.now() + '.html');

  let rootStat;
  try { rootStat = fs.lstatSync(target); }
  catch (e) { console.error('cannot stat ' + target + ': ' + e.message); process.exit(1); }
  if (!rootStat.isDirectory()) {
    console.error(target + ' is not a directory');
    process.exit(1);
  }
  if (!fs.existsSync(BUNDLE_PATH)) {
    console.error('bundle not found at ' + BUNDLE_PATH + '\nRun `node tools/build.js` first.');
    process.exit(1);
  }

  const t0 = Date.now();
  const scan = await walk(target);
  const elapsed = Date.now() - t0;
  buildHtml(out, target, scan, colorBy);

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

async function walk(rootPath) {
  const { Worker } = await import('node:worker_threads');
  const NWORKERS = Math.max(2, Math.min(os.cpus().length, 16));
  const workerPath = path.join(__dirname, 'scan-worker.js');

  const labels = [], parentIndices = [], values = [];
  const rawExtColor = [];   // raw lowercased extension per node
  const extColor = [];      // extKind bucket per node
  const folderColor = [];   // parent folder label per node
  const ctimes = [];        // ctimeMs per node
  const mtimes = [];        // mtimeMs per node
  const atimes = [];        // atimeMs per node
  let bytes = 0, files = 0, dirs = 0, unreadable = 0;

  labels.push(path.basename(rootPath) || rootPath);
  parentIndices.push(-1); values.push(0);
  rawExtColor.push('dir'); extColor.push('dir'); folderColor.push('dir'); ctimes.push(0); mtimes.push(0); atimes.push(0);
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
      const wi = i;
      const w = new Worker(workerPath);
      w.on('message', (result) => {
        pending--;
        idle.push(wi);
        unreadable += result.unreadable;
        for (const ent of result.results) {
          if (ent.isDir) {
            const row = labels.length;
            labels.push(ent.name);
            parentIndices.push(result.dirRow);
            values.push(0);
            rawExtColor.push('dir'); extColor.push('dir'); folderColor.push('dir'); ctimes.push(0); mtimes.push(0); atimes.push(0);
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

  return { labels, parentIndices, values, rawExtColor, extColor, folderColor, ctimes, mtimes, atimes, bytes, files, dirs, unreadable };
}

// Raw lowercased extension (e.g. 'js', 'png'). Dot-files / no extension → '(none)'.
function rawExt(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '(none)';
}

// Map a filename to a color-key. Curated buckets for common kinds; everything
// else falls through to the lowercased extension (hash-colored by the
// component's fnv1a), and dot-files/extension-less get 'bin'.
function extKind(name) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return 'bin';
  const ext = lower.slice(dot + 1);
  // Curated buckets so similar file kinds share a color.
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

function humanBytes(v) {
  const units = ['B','KB','MB','GB','TB','PB'];
  let i = 0, n = v;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  const s = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  return s + ' ' + units[i];
}

// Streaming HTML builder — writes directly to a file descriptor to avoid
// hitting V8's ~512 MB string limit on large scans (8M+ files).
function buildHtml(outPath, target, scan, colorBy) {
  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const fd = fs.openSync(outPath, 'w');
  const w = (s) => fs.writeSync(fd, s);

  // --- helpers for writing large arrays without giant strings ---
  const BATCH = 20000;

  // Write a JSON array of strings in batches.
  function writeJsonStringArray(arr) {
    w('[');
    for (let i = 0; i < arr.length; i += BATCH) {
      if (i > 0) w(',');
      const slice = arr.slice(i, Math.min(i + BATCH, arr.length));
      const json = JSON.stringify(slice);
      w(json.slice(1, -1)); // strip outer [ ]
    }
    w(']');
  }
  // Write a JSON array of numbers in batches.
  function writeJsonNumberArray(arr) {
    w('[');
    for (let i = 0; i < arr.length; i += BATCH) {
      if (i > 0) w(',');
      const slice = arr.slice(i, Math.min(i + BATCH, arr.length));
      const json = JSON.stringify(slice);
      w(json.slice(1, -1));
    }
    w(']');
  }
  // Write base64 of a TypedArray in chunks (3 MB raw per chunk = clean base64).
  function writeBase64(typedArray) {
    const buf = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const CHUNK = 3 * 1024 * 1024; // must be multiple of 3 for clean base64 boundaries
    for (let i = 0; i < buf.length; i += CHUNK) {
      w(buf.subarray(i, Math.min(i + CHUNK, buf.length)).toString('base64'));
    }
  }
  // Encode a categorical string array to Uint16 enum-index + write base64.
  function encodeCategorical(arr) {
    const names = [...new Set(arr)].sort();
    const toIdx = new Map(names.map((c, i) => [c, i]));
    const u16 = new Uint16Array(arr.length);
    for (let i = 0; i < arr.length; i++) u16[i] = toIdx.get(arr[i]);
    return { names: JSON.stringify(names), u16 };
  }

  // Per-bucket color map for extension mode.
  const extColorMapObj = {
    image:   'hsl(300, 55%, 55%)',  // magenta
    video:   'hsl(348, 70%, 50%)',  // red
    audio:   'hsl(170, 55%, 45%)',  // teal
    doc:     'hsl(211, 70%, 52%)',  // blue
    sheet:   'hsl(138, 55%, 45%)',  // green
    slide:   'hsl(26,  85%, 55%)',  // orange
    code:    'hsl(48,  85%, 55%)',  // yellow
    web:     'hsl(188, 70%, 48%)',  // cyan
    archive: 'hsl(20,  60%, 48%)',  // brown
    font:    'hsl(264, 55%, 58%)',  // purple
    build:   'hsl(0,    0%, 55%)',  // gray
    bin:     'hsl(210, 10%, 45%)',  // slate
    dir:     'hsl(220, 10%, 35%)',  // dark slate (only seen on root)
  };

  const stats = {
    target,
    files: scan.files,
    dirs: scan.dirs,
    bytes: scan.bytes,
    unreadable: scan.unreadable,
    humanSize: humanBytes(scan.bytes),
    when: (() => { const d = new Date(); const off = -d.getTimezoneOffset(); const sign = off >= 0 ? '+' : '-'; const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0'); const mm = String(Math.abs(off) % 60).padStart(2, '0'); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') + sign + hh + ':' + mm; })(),
  };

  const rawExt = encodeCategorical(scan.rawExtColor);
  const ext = encodeCategorical(scan.extColor);
  const folder = encodeCategorical(scan.folderColor);

  const isCategorical = colorBy === 'extension' || colorBy === 'kind' || colorBy === 'folder';
  const tmColorMode = isCategorical ? 'categorical' : 'quantitative';
  const tmPalette = isCategorical ? 'tokyo-night' : 'viridis';
  const extColorMapJson = JSON.stringify(extColorMapObj);

  const themePageColors = {
    nord:          { label: 'Nord',             dark: true,  bg: '#2e3440', surface: '#3b4252', border: '#4c566a', fg: '#d8dee9', fgMuted: '#81a1c1', accent: '#88c0d0' },
    solarized:     { label: 'Solarized Dark',   dark: true,  bg: '#002b36', surface: '#073642', border: '#586e75', fg: '#839496', fgMuted: '#657b83', accent: '#268bd2' },
    dracula:       { label: 'Dracula',           dark: true,  bg: '#282a36', surface: '#44475a', border: '#6272a4', fg: '#f8f8f2', fgMuted: '#6272a4', accent: '#bd93f9' },
    catppuccin:    { label: 'Catppuccin Mocha',  dark: true,  bg: '#1e1e2e', surface: '#313244', border: '#45475a', fg: '#cdd6f4', fgMuted: '#a6adc8', accent: '#cba6f7' },
    gruvbox:       { label: 'Gruvbox Dark',      dark: true,  bg: '#282828', surface: '#3c3836', border: '#504945', fg: '#ebdbb2', fgMuted: '#a89984', accent: '#fabd2f' },
    'tokyo-night': { label: 'Tokyo Night',       dark: true,  bg: '#1a1b26', surface: '#16161e', border: '#0f0f14', fg: '#c0caf5', fgMuted: '#787c99', accent: '#7aa2f7' },
    'rose-pine':   { label: 'Rosé Pine',         dark: true,  bg: '#191724', surface: '#1f1d2e', border: '#26233a', fg: '#e0def4', fgMuted: '#908caa', accent: '#c4a7e7' },
    'one-dark':    { label: 'One Dark',           dark: true,  bg: '#282c34', surface: '#2c313a', border: '#3e4452', fg: '#abb2bf', fgMuted: '#828997', accent: '#61afef' },
  };
  const themesJson = JSON.stringify(themePageColors);
  const themeOptions = Object.entries(themePageColors)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`)
    .join('');

  // --- Write the HTML, streaming the large data section ---
  w(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>treemap \xb7 ${escapeHtml(target)}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--page-bg, #fafafa); color: var(--page-fg, #111); transition: background .15s, color .15s; }
  body { display: flex; flex-direction: column; }
  header { padding: 8px 14px; border-bottom: 1px solid var(--page-border, #0002); display: flex; gap: 16px;
    align-items: baseline; flex-wrap: wrap; background: var(--page-surface, #fff); transition: background .15s; }
  header h1 { margin:0; font-size:14px; font-weight:600; font-family: ui-monospace, SF Mono, Menlo, monospace;
    color: var(--page-fg, #222); }
  header .stat { color: var(--page-fg-muted, #555); font-size:13px; font-variant-numeric: tabular-nums; }
  header .stat b { color: var(--page-fg, #000); font-weight:600; }
  raised-treemap { display:flex; flex: 1; min-height: 0; }
  #stats-bar { padding: 3px 14px; font-size: 12px; font-variant-numeric: tabular-nums; min-height: 18px;
    color: var(--page-fg-muted, #888); background: var(--page-surface, #fff);
    border-top: 1px solid var(--page-border, #0002); transition: background .15s, color .15s; }
  #theme-sel, #color-sel { font-size: 12px; padding: 2px 4px; border-radius: 4px;
    background: var(--page-bg, #fff); color: var(--page-fg, #333);
    border: 1px solid var(--page-border, #ccc); cursor: pointer; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(target)}</h1>
  <span class="stat"><b>${stats.files.toLocaleString()}</b> files</span>
  <span class="stat"><b>${stats.dirs.toLocaleString()}</b> directories</span>
  <span class="stat"><b>${stats.humanSize}</b> total</span>
  ${stats.unreadable ? `<span class="stat">(${stats.unreadable.toLocaleString()} unreadable)</span>` : ''}
  <span class="stat" style="color: var(--page-fg-muted, #888);">color
    <select id="color-sel">
      <option value="extension">extension</option>
      <option value="kind">file kind</option>
      <option value="folder">folder</option>
      <option value="ctime">created</option>
      <option value="mtime">modified</option>
      <option value="atime">accessed</option>
    </select>
  </span>
  <span class="stat" style="margin-left:auto;">
    <select id="theme-sel">
      <option value="">Default (light)</option>
      ${themeOptions}
    </select>
  </span>
  <span class="stat" style="color: var(--page-fg-muted, #888);">scanned ${escapeHtml(stats.when)}</span>
</header>
<raised-treemap id="tm"
  color-mode="${tmColorMode}"
  palette="${tmPalette}"
  gradient-intensity="0.6"
  value-format="b"
  min-cell-area="30"></raised-treemap>
<div id="stats-bar"></div>

<script type="application/json" id="tmdata">
`);

  // --- Stream the embedded JSON data (the big part) ---
  w('{"labels":');
  writeJsonStringArray(scan.labels);
  w(',"values":');
  writeJsonNumberArray(scan.values);
  w(',"piB64":"');
  writeBase64(Int32Array.from(scan.parentIndices));
  w('"');
  // Categorical color variants.
  w(',"rawExtNames":' + rawExt.names + ',"rawExtB64":"');
  writeBase64(rawExt.u16);
  w('"');
  w(',"extNames":' + ext.names + ',"extB64":"');
  writeBase64(ext.u16);
  w('"');
  w(',"folderNames":' + folder.names + ',"folderB64":"');
  writeBase64(folder.u16);
  w('"');
  // Timestamp variants.
  w(',"ctimeB64":"');
  writeBase64(Float64Array.from(scan.ctimes));
  w('"');
  w(',"mtimeB64":"');
  writeBase64(Float64Array.from(scan.mtimes));
  w('"');
  w(',"atimeB64":"');
  writeBase64(Float64Array.from(scan.atimes));
  w('"}');

  // --- Rest of the HTML (bundle + page scripts) ---
  w(`
<\/script>
<script>
${bundle}
<\/script>
<script>
(function () {
  function _buf(b64) {
    var s = atob(b64), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  }
  function decodeCat(names, b64) {
    var ci = new Uint16Array(_buf(b64));
    var a = new Array(ci.length);
    for (var i = 0; i < ci.length; i++) a[i] = names[ci[i]];
    return a;
  }
  function tsMinMax(arr) {
    var lo = Infinity, hi = -Infinity;
    for (var j = 0; j < arr.length; j++) {
      if (arr[j] > 0) { if (arr[j] < lo) lo = arr[j]; if (arr[j] > hi) hi = arr[j]; }
    }
    return lo !== Infinity ? [lo, hi] : null;
  }

  var raw = JSON.parse(document.getElementById('tmdata').textContent);
  var tm = document.getElementById('tm');
  tm.labels = raw.labels;
  tm.values = raw.values;
  tm.parentIndices = new Int32Array(_buf(raw.piB64));

  // Pre-decode all color variants.
  var extColorMap = ${extColorMapJson};
  var variants = {
    extension: { cat: true, data: decodeCat(raw.rawExtNames, raw.rawExtB64), colorMap: null },
    kind:      { cat: true, data: decodeCat(raw.extNames, raw.extB64), colorMap: extColorMap },
    folder:    { cat: true, data: decodeCat(raw.folderNames, raw.folderB64), colorMap: null },
    ctime:     { cat: false, data: Array.from(new Float64Array(_buf(raw.ctimeB64))) },
    mtime:     { cat: false, data: Array.from(new Float64Array(_buf(raw.mtimeB64))) },
    atime:     { cat: false, data: Array.from(new Float64Array(_buf(raw.atimeB64))) },
  };
  variants.ctime.domain = tsMinMax(variants.ctime.data);
  variants.mtime.domain = tsMinMax(variants.mtime.data);
  variants.atime.domain = tsMinMax(variants.atime.data);

  window._colorVariants = variants;
  window._applyColorBy = function (mode) {
    var v = variants[mode];
    if (!v) return;
    tm.color = v.data;
    var newMap = v.cat ? (v.colorMap || {}) : {};
    tm._props._userColorMap = newMap;
    tm.colorMap = tm.getAttribute('theme') ? {} : newMap;
    if (v.cat) {
      tm.setAttribute('color-mode', 'categorical');
      tm._props._userPalette = 'tokyo-night';
      if (!tm.getAttribute('theme')) tm.setAttribute('palette', 'tokyo-night');
      tm.colorDomain = undefined;
    } else {
      tm.setAttribute('color-mode', 'quantitative');
      tm._props._userPalette = 'viridis';
      if (!tm.getAttribute('theme')) tm.setAttribute('palette', 'viridis');
      tm.colorDomain = v.domain || undefined;
    }
  };

  window._applyColorBy('${colorBy}');

  var fmtBytes = function (v) {
    var units = ['B','KB','MB','GB','TB','PB']; var i = 0, n = v || 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
  };
  tm.valueFormatter = tm.valueFormatter || fmtBytes;
})();
// Stats bar: subtree counts + per-node metadata for the focused node.
(function () {
  var tm = document.getElementById('tm');
  var bar = document.getElementById('stats-bar');
  var variants = window._colorVariants;
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
    var nodes = tm._tree && tm._tree.nodes;
    if (!nodes) return null;
    var files = 0, dirs = 0, bytes = 0;
    var stack = [nodeId];
    while (stack.length) {
      var id = stack.pop();
      var nd = nodes.get(id);
      if (!nd) continue;
      if (nd.childIds && nd.childIds.length > 0) {
        dirs++;
        for (var k = 0; k < nd.childIds.length; k++) stack.push(nd.childIds[k]);
      } else {
        files++;
        bytes += nd.value || 0;
      }
    }
    return { files: files, dirs: dirs, bytes: bytes };
  }
  function isLeaf(id) {
    var nd = tm._tree && tm._tree.nodes.get(id);
    return nd && (!nd.childIds || nd.childIds.length === 0);
  }
  function update() {
    var id = tm._focusId != null ? tm._focusId : tm._targetId != null ? tm._targetId : tm._tree ? tm._tree.roots[0] : null;
    if (id == null) { bar.textContent = ''; return; }
    var s = subtreeStats(id);
    if (!s) { bar.textContent = ''; return; }
    var parts = [];
    if (s.files > 0) parts.push(s.files.toLocaleString() + ' file' + (s.files !== 1 ? 's' : ''));
    if (s.dirs > 0) parts.push(s.dirs.toLocaleString() + ' folder' + (s.dirs !== 1 ? 's' : ''));
    parts.push(fmtBytes(s.bytes));
    if (typeof id === 'number' && isLeaf(id) && variants) {
      var kind = variants.kind.data[id];
      var label = tm.labels[id] || '';
      var dot = label.lastIndexOf('.');
      var ext = dot > 0 ? label.slice(dot) : '';
      if (kind && kind !== 'dir') {
        parts.push(ext && ext.slice(1) !== kind ? ext + ' (' + kind + ')' : kind);
      }
      var ct = variants.ctime.data[id];
      var mt = variants.mtime.data[id];
      var at = variants.atime.data[id];
      if (ct) parts.push('created: ' + fmtDate(ct));
      if (mt) parts.push('modified: ' + fmtDate(mt));
      if (at) parts.push('accessed: ' + fmtDate(at));
    }
    bar.textContent = parts.join('  |  ');
  }
  tm.addEventListener('rt-focus', update);
  tm.addEventListener('rt-target', update);
  tm.addEventListener('rt-zoom-change', update);
  requestAnimationFrame(function () { setTimeout(update, 0); });
})();
// Color-by switcher + theme switcher + URL hash sync.
(function () {
  var themes = ${themesJson};
  var themeSel = document.getElementById('theme-sel');
  var colorSel = document.getElementById('color-sel');
  var tm = document.getElementById('tm');
  var htmlRoot = document.documentElement;
  var DEFAULT_THEME = 'tokyo-night';
  var DEFAULT_COLOR = '${colorBy}';
  var currentTheme = DEFAULT_THEME;
  var currentColor = DEFAULT_COLOR;

  function applyPageTheme(name) {
    currentTheme = name || '';
    var t = name ? themes[name] : null;
    if (t) {
      htmlRoot.style.setProperty('--page-bg', t.bg);
      htmlRoot.style.setProperty('--page-surface', t.surface);
      htmlRoot.style.setProperty('--page-border', t.border);
      htmlRoot.style.setProperty('--page-fg', t.fg);
      htmlRoot.style.setProperty('--page-fg-muted', t.fgMuted);
      htmlRoot.style.setProperty('--page-accent', t.accent);
    } else {
      ['--page-bg','--page-surface','--page-border','--page-fg','--page-fg-muted','--page-accent']
        .forEach(function (v) { htmlRoot.style.removeProperty(v); });
    }
    tm.setAttribute('theme', name || '');
    themeSel.value = name || '';
  }
  function applyColor(mode) {
    currentColor = mode || DEFAULT_COLOR;
    window._applyColorBy(currentColor);
    colorSel.value = currentColor;
  }
  themeSel.addEventListener('change', function () { applyPageTheme(themeSel.value); writeHash(); });
  colorSel.addEventListener('change', function () { applyColor(colorSel.value); writeHash(); });

  function coerceId(s) { return /^\\d+$/.test(s) ? Number(s) : s; }
  function readHash() {
    try {
      var p = new URLSearchParams(location.hash.slice(1));
      var z = p.get('zoom');   if (z) tm._internalVisibleRootId = coerceId(z);
      var d = p.get('depth');  if (d != null) tm.displayDepth = d === 'Infinity' ? Infinity : Number(d);
      var t = p.get('target'); if (t) { tm._targetId = coerceId(t); tm._selectionLocked = true; }
      var f = p.get('focus');  if (f) tm._focusId = coerceId(f);
      var th = p.get('theme'); applyPageTheme(th != null ? th : DEFAULT_THEME);
      var cb = p.get('color'); if (cb) applyColor(cb);
    } catch (_) {}
  }
  function writeHash() {
    try {
      var p = new URLSearchParams();
      var z = tm._activeVisibleRootId(); if (z) p.set('zoom', z);
      var d = tm.displayDepth;           if (d !== Infinity) p.set('depth', String(d));
      var t = tm._targetId;              if (t) p.set('target', t);
      var f = tm._focusId;               var root = tm._tree && tm._tree.roots[0];
                                         if (f && f !== t && f !== root) p.set('focus', f);
      if (currentTheme !== DEFAULT_THEME) p.set('theme', currentTheme);
      if (currentColor !== DEFAULT_COLOR) p.set('color', currentColor);
      var s = p.toString();
      history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
    } catch (_) {}
  }
  colorSel.value = DEFAULT_COLOR;
  readHash();
  if (location.hash.length > 1) tm._queueRender();
  tm.addEventListener('rt-zoom-change', writeHash);
  tm.addEventListener('rt-depth-change', writeHash);
  tm.addEventListener('rt-target', writeHash);
  tm.addEventListener('rt-focus', writeHash);
})();
<\/script>
</body>
</html>
`);

  fs.closeSync(fd);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

main();
