#!/usr/bin/env node
// Scan a directory recursively and emit a self-contained HTML file that
// renders its size treemap with <raised-treemap>. The output has the bundle and
// the dataset inlined, so you can open it from anywhere with no server.
//
// Usage:  node tools/scan.js [--color=extension|folder|ctime|atime] <dir> [output.html]
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

const COLOR_MODES = ['extension', 'folder', 'ctime', 'atime'];

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
    console.error('Usage: node tools/scan.js [--no-open] [--color=extension|folder|ctime|atime] <dir> [output.html]');
    process.exit(args[0] === '-h' || args[0] === '--help' ? 0 : 2);
  }
  const needTimestamps = colorBy === 'ctime' || colorBy === 'atime';
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
  const scan = await walk(target, needTimestamps, colorBy);
  const elapsed = Date.now() - t0;
  const html = buildHtml(target, scan, colorBy);
  fs.writeFileSync(out, html);

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

async function walk(rootPath, needTimestamps, colorBy) {
  const { Worker } = await import('node:worker_threads');
  const NWORKERS = Math.max(2, Math.min(os.cpus().length, 16));
  const workerPath = path.join(__dirname, 'scan-worker.js');

  const labels = [], parentIndices = [], values = [], color = [];
  const timestamps = needTimestamps ? [] : null;
  let bytes = 0, files = 0, dirs = 0, unreadable = 0;

  labels.push(path.basename(rootPath) || rootPath);
  parentIndices.push(-1); values.push(0); color.push('dir');
  if (timestamps) timestamps.push(0);
  dirs++;

  const queue = [{ dirPath: rootPath, dirRow: 0, needTimestamps }];
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
            values.push(0); color.push('dir');
            if (timestamps) timestamps.push(0);
            dirs++;
            queue.push({ dirPath: path.join(result.dirPath, ent.name), dirRow: row, needTimestamps });
          } else {
            labels.push(ent.name);
            parentIndices.push(result.dirRow);
            values.push(ent.size);
            color.push(colorBy === 'folder' ? labels[result.dirRow] : extKind(ent.name));
            if (timestamps) timestamps.push(ent.ts ? ent.ts[colorBy] : 0);
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

  return { labels, parentIndices, values, color, timestamps, bytes, files, dirs, unreadable };
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

function buildHtml(target, scan, colorBy) {
  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const isCategorical = colorBy === 'extension' || colorBy === 'folder';

  // Per-bucket color map for extension mode.
  const extColorMap = {
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

  // Binary-encode parentIndices (Int32Array).
  const piI32 = Int32Array.from(scan.parentIndices);
  const piB64 = Buffer.from(piI32.buffer).toString('base64');

  const labelsJson  = JSON.stringify(scan.labels);
  const valuesJson  = JSON.stringify(scan.values);

  let colorDataFields, colorSetupJs;

  if (isCategorical) {
    // Binary-encode color categories as Uint16 enum indices.
    const colorNames = [...new Set(scan.color)].sort();
    const colorToIdx = new Map(colorNames.map((c, i) => [c, i]));
    const colorU16 = new Uint16Array(scan.color.length);
    for (let i = 0; i < scan.color.length; i++) colorU16[i] = colorToIdx.get(scan.color[i]);
    const colorB64 = Buffer.from(colorU16.buffer).toString('base64');
    const colorNamesJson = JSON.stringify(colorNames);
    const colorMapJson = colorBy === 'extension' ? JSON.stringify(extColorMap) : 'undefined';

    colorDataFields = `,"colorNames":${colorNamesJson},"colorB64":"${colorB64}"`;
    colorSetupJs = `
  var cn = raw.colorNames, ci = new Uint16Array(_buf(raw.colorB64));
  var ca = new Array(ci.length);
  for (var i = 0; i < ci.length; i++) ca[i] = cn[ci[i]];
  tm.color = ca;
  ${colorMapJson !== 'undefined' ? 'tm.colorMap = ' + colorMapJson + ';' : ''}`;
  } else {
    // Quantitative: embed timestamps as Float64Array base64.
    const tsF64 = Float64Array.from(scan.timestamps);
    const tsB64 = Buffer.from(tsF64.buffer).toString('base64');

    colorDataFields = `,"tsB64":"${tsB64}"`;
    const timeLabel = colorBy === 'ctime' ? 'created' : 'accessed';
    colorSetupJs = `
  var ts = new Float64Array(_buf(raw.tsB64));
  tm.color = Array.from(ts);
  // Compute domain excluding zero (directories have no timestamp).
  var tsMin = Infinity, tsMax = -Infinity;
  for (var j = 0; j < ts.length; j++) {
    if (ts[j] > 0) { if (ts[j] < tsMin) tsMin = ts[j]; if (ts[j] > tsMax) tsMax = ts[j]; }
  }
  if (tsMin !== Infinity) tm.colorDomain = [tsMin, tsMax];`;
  }

  // Escape </script so the data tag can't be prematurely closed.
  const embeddedJson = `{"labels":${labelsJson},"values":${valuesJson},"piB64":"${piB64}"${colorDataFields}}`
    .replace(/<\/script/gi, '<\\/script');

  const tmColorMode = isCategorical ? 'categorical' : 'quantitative';
  const tmPalette = isCategorical ? 'gp-default' : 'viridis';
  const colorLabel = { extension: 'file kind', folder: 'folder', ctime: 'creation time', atime: 'access time' }[colorBy];

  // Theme page-color metadata for the dropdown switcher.
  // The treemap component has its own copy; this is just for the outer page chrome.
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

  // Build theme <option> list.
  const themeOptions = Object.entries(themePageColors)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>treemap · ${escapeHtml(target)}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--page-bg, #fafafa); color: var(--page-fg, #111); transition: background .15s, color .15s; }
  header { padding: 8px 14px; border-bottom: 1px solid var(--page-border, #0002); display: flex; gap: 16px;
    align-items: baseline; flex-wrap: wrap; background: var(--page-surface, #fff); transition: background .15s; }
  header h1 { margin:0; font-size:14px; font-weight:600; font-family: ui-monospace, SF Mono, Menlo, monospace;
    color: var(--page-fg, #222); }
  header .stat { color: var(--page-fg-muted, #555); font-size:13px; font-variant-numeric: tabular-nums; }
  header .stat b { color: var(--page-fg, #000); font-weight:600; }
  raised-treemap { display:flex; height: calc(100vh - 58px); margin-bottom: 16px; }
  #theme-sel { font-size: 12px; padding: 2px 4px; border-radius: 4px;
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
  <span class="stat" style="color: var(--page-fg-muted, #888);">colored by <b>${colorLabel}</b></span>
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

<script type="application/json" id="tmdata">
${embeddedJson}
</script>
<script>
${bundle}
</script>
<script>
(function () {
  function _buf(b64) {
    var s = atob(b64), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  }
  var raw = JSON.parse(document.getElementById('tmdata').textContent);
  var tm = document.getElementById('tm');
  tm.labels = raw.labels;
  tm.values = raw.values;
  tm.parentIndices = new Int32Array(_buf(raw.piB64));
${colorSetupJs}
  tm.valueFormatter = tm.valueFormatter || function (v) {
    var units = ['B','KB','MB','GB','TB','PB']; var i = 0, n = v || 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
  };
})();
// Theme switcher: updates both the page chrome and the <raised-treemap> component.
(function () {
  var themes = ${themesJson};
  var sel = document.getElementById('theme-sel');
  var tm = document.getElementById('tm');
  var root = document.documentElement;
  function applyPageTheme(name) {
    var t = name ? themes[name] : null;
    if (t) {
      root.style.setProperty('--page-bg', t.bg);
      root.style.setProperty('--page-surface', t.surface);
      root.style.setProperty('--page-border', t.border);
      root.style.setProperty('--page-fg', t.fg);
      root.style.setProperty('--page-fg-muted', t.fgMuted);
      root.style.setProperty('--page-accent', t.accent);
    } else {
      ['--page-bg','--page-surface','--page-border','--page-fg','--page-fg-muted','--page-accent']
        .forEach(function (v) { root.style.removeProperty(v); });
    }
    tm.setAttribute('theme', name || '');
  }
  sel.addEventListener('change', function () { applyPageTheme(sel.value); });
})();
// Sync UI state with URL hash so copying the URL preserves the view.
(function () {
  var tm = document.getElementById('tm');
  // Node IDs in the scan tree are integers; URL params arrive as strings.
  function coerceId(s) { return /^\\d+$/.test(s) ? Number(s) : s; }
  function readHash() {
    try {
      var p = new URLSearchParams(location.hash.slice(1));
      var z = p.get('zoom');   if (z) tm._internalVisibleRootId = coerceId(z);
      var d = p.get('depth');  if (d != null) tm.displayDepth = d === 'Infinity' ? Infinity : Number(d);
      var t = p.get('target'); if (t) { tm._targetId = coerceId(t); tm._selectionLocked = true; }
      var f = p.get('focus');  if (f) tm._focusId = coerceId(f);
    } catch (_) {}
  }
  function writeHash() {
    try {
      var p = new URLSearchParams();
      var z = tm._activeVisibleRootId(); if (z) p.set('zoom', z);
      var d = tm.displayDepth;           if (d !== Infinity) p.set('depth', String(d));
      var t = tm._targetId;              if (t) p.set('target', t);
      var f = tm._focusId;               if (f && f !== t) p.set('focus', f);
      var s = p.toString();
      history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
    } catch (_) {}
  }
  readHash();
  if (location.hash.length > 1) tm._queueRender();
  tm.addEventListener('rt-zoom-change', writeHash);
  tm.addEventListener('rt-depth-change', writeHash);
  tm.addEventListener('rt-target', writeHash);
  tm.addEventListener('rt-focus', writeHash);
})();
</script>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

main();
