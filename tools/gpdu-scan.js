#!/usr/bin/env node
// Scan a directory recursively and emit a self-contained HTML file that
// renders its size treemap with <gp-treemap>. The output has the bundle and
// the dataset inlined, so you can open it from anywhere with no server.
//
// Usage:  node tools/gpdu-scan.js [--color=extension|kind|folder|ctime|mtime|atime] <dir> [output.html]
//                 (or `npm run scan -- [--color=...] <dir> [output.html]`)
//
// Symlinks are not followed (we use lstat). Unreadable entries are counted
// and skipped.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUNDLE_PATH = path.join(ROOT, 'dist', 'gp-treemap.bundle.js');

const COLOR_MODES = ['extension', 'kind', 'folder', 'ctime', 'mtime', 'atime'];

async function main() {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  let colorBy = 'extension';
  let blockSize = 500000;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-open') continue;
    if (argv[i].startsWith('--block-size=')) { blockSize = Number(argv[i].split('=')[1]) || 500000; continue; }
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
    console.error('Usage: node tools/gpdu-scan.js [--no-open] [--color=extension|kind|folder|ctime|mtime|atime] <dir> [output.html]');
    process.exit(args[0] === '-h' || args[0] === '--help' ? 0 : 2);
  }
  const target = path.resolve(args[0]);
  const out = args[1]
    ? path.resolve(args[1])
    : path.join(os.tmpdir(), 'gp-treemap-' + path.basename(target).replace(/[^a-zA-Z0-9._-]/g, '_') + '-' + Date.now() + '.html');

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

// ---------------------------------------------------------------------------
// Block partitioning: split the flat scan arrays into subtree-sized blocks.
// Each block is ~targetSize nodes. Directories whose subtrees exceed the
// remaining capacity become "stubs" — leaf placeholders with aggregate values.
// Their real children live in a child block, inflated on demand in the browser.
// ---------------------------------------------------------------------------
function partitionBlocks(scan, targetSize = 50000) {
  const n = scan.labels.length;
  const pi = scan.parentIndices;

  // Build childIds lists.
  const childIds = new Array(n);
  for (let i = 0; i < n; i++) childIds[i] = null;
  for (let i = 1; i < n; i++) {
    const p = pi[i];
    if (childIds[p] === null) childIds[p] = [];
    childIds[p].push(i);
  }

  // Subtree node count (reverse pass).
  const subtreeSize = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    subtreeSize[i] = 1;
    if (childIds[i]) for (const c of childIds[i]) subtreeSize[i] += subtreeSize[c];
  }

  // Aggregate byte values (reverse pass).
  const aggValue = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    aggValue[i] = scan.values[i];
    if (childIds[i]) for (const c of childIds[i]) aggValue[i] += aggValue[c];
  }

  // Aggregate file/dir counts.
  const aggFiles = new Int32Array(n);
  const aggDirs = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    if (!childIds[i]) { aggFiles[i] = 1; aggDirs[i] = 0; }
    else {
      aggFiles[i] = 0; aggDirs[i] = 1;
      for (const c of childIds[i]) { aggFiles[i] += aggFiles[c]; aggDirs[i] += aggDirs[c]; }
    }
  }

  const blocks = []; // each: { globalRows: number[], stubs: {gi, localRow, childBlockId}[] }

  function buildBlock(rootGi, parentBlockId) {
    const blockId = blocks.length;
    const block = { globalRows: [], stubs: [] };
    blocks.push(block);

    // DFS, adding nodes to this block. Large subdirectories become stubs.
    function visit(gi) {
      block.globalRows.push(gi);
      if (!childIds[gi]) return; // leaf
      for (const c of childIds[gi]) {
        if (!childIds[c]) {
          // File — always include.
          block.globalRows.push(c);
        } else if (block.globalRows.length + subtreeSize[c] <= targetSize) {
          visit(c);
        } else {
          // Directory too large — add as stub leaf, defer children to a child block.
          const stubLocalRow = block.globalRows.length;
          block.globalRows.push(c);
          block.stubs.push({ gi: c, localRow: stubLocalRow, childBlockId: -1 });
        }
      }
    }
    visit(rootGi);

    // Recursively create child blocks for stubs.
    for (const stub of block.stubs) {
      stub.childBlockId = buildBlock(stub.gi, blockId);
    }
    return blockId;
  }
  buildBlock(0, -1);

  return { blocks, childIds, aggValue, aggFiles, aggDirs };
}

// Encode one block as a JSON-serialisable object from the global scan arrays.
function encodeBlock(scan, block, aggValue, aggFiles, aggDirs) {
  const gRows = block.globalRows;
  const m = gRows.length;
  const globalToLocal = new Map();
  for (let i = 0; i < m; i++) globalToLocal.set(gRows[i], i);

  const labels = new Array(m);
  const values = new Array(m);
  const localPI = new Int32Array(m);
  const rawExt = new Array(m);
  const ext = new Array(m);
  const folder = new Array(m);
  const ctimes = new Float64Array(m);
  const mtimes = new Float64Array(m);
  const atimes = new Float64Array(m);

  const stubSet = new Set(block.stubs.map(s => s.gi));

  for (let i = 0; i < m; i++) {
    const gi = gRows[i];
    labels[i] = scan.labels[gi];
    // All nodes get the aggregate value: for leaves it equals the file size;
    // for directories it's the subtree total. The lazy accessor path in the
    // component uses getValue() directly (no bottom-up aggregation).
    values[i] = aggValue[gi];
    // Parent index: remap to local, or -1 for block root.
    const gp = scan.parentIndices[gi];
    localPI[i] = globalToLocal.has(gp) ? globalToLocal.get(gp) : -1;
    rawExt[i] = scan.rawExtColor[gi];
    ext[i] = scan.extColor[gi];
    folder[i] = scan.folderColor[gi];
    ctimes[i] = scan.ctimes[gi];
    mtimes[i] = scan.mtimes[gi];
    atimes[i] = scan.atimes[gi];
  }

  // Encode categoricals as Uint16 enum-indexed.
  function encodeCat(arr) {
    const names = [...new Set(arr)].sort();
    const toIdx = new Map(names.map((c, j) => [c, j]));
    const u16 = new Uint16Array(arr.length);
    for (let j = 0; j < arr.length; j++) u16[j] = toIdx.get(arr[j]);
    return { names, b64: Buffer.from(u16.buffer).toString('base64') };
  }

  const stubs = block.stubs.map(s => [
    s.localRow, s.childBlockId,
    aggValue[s.gi], aggFiles[s.gi], aggDirs[s.gi],
  ]);

  const re = encodeCat(rawExt);
  const ec = encodeCat(ext);
  const fc = encodeCat(folder);

  return {
    labels, values,
    piB64: Buffer.from(localPI.buffer).toString('base64'),
    grB64: Buffer.from(Int32Array.from(gRows).buffer).toString('base64'), // global row indices → unique node IDs
    rawExtNames: re.names, rawExtB64: re.b64,
    extNames: ec.names, extB64: ec.b64,
    folderNames: fc.names, folderB64: fc.b64,
    ctimeB64: Buffer.from(ctimes.buffer).toString('base64'),
    mtimeB64: Buffer.from(mtimes.buffer).toString('base64'),
    atimeB64: Buffer.from(atimes.buffer).toString('base64'),
    stubs,
  };
}

// Streaming HTML builder — writes directly to a file descriptor to avoid
// hitting V8's ~512 MB string limit on large scans (8M+ files).
function buildHtml(outPath, target, scan, colorBy, blockSize) {
  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const fd = fs.openSync(outPath, 'w');
  const w = (s) => fs.writeSync(fd, s);

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
  // Continuous / standalone palettes shown in the combined dropdown.
  const palettePicks = {
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

  const themesJson = JSON.stringify(themePageColors);
  const themeOptions = Object.entries(themePageColors)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`)
    .join('');
  const paletteOptions = Object.entries(palettePicks)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`)
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
  <span class="stat" style="margin-left:auto;">theme
    <select id="theme-sel">
      <option value="">Default (light)</option>
      ${themeOptions}
    </select>
  </span>
  <span class="stat">palette
    <select id="palette-sel">
      <option value="">(theme default)</option>
      ${paletteOptions}
    </select>
  </span>
</header>
<gp-treemap id="tm"
  color-mode="${tmColorMode}"
  palette="${tmPalette}"
  gradient-intensity="0.6"
  value-format="b"
  min-cell-area="30"></gp-treemap>
<div id="bottom-bar">
  <div id="stats-bar"></div>
  <span id="scanned-note">scanned ${escapeHtml(stats.when)}</span>
</div>

<script type="application/json" id="tmdata">
`);

  // --- Partition into blocks and write the envelope ---
  const { blocks, aggValue, aggFiles, aggDirs } = partitionBlocks(scan, blockSize);
  process.stderr.write('  partitioned into ' + blocks.length + ' blocks\n');

  // All blocks (including block 0) are deflateRaw + base64.
  // Block 0 is decompressed at boot time before the component renders.
  w('{"v":3,"totalFiles":' + scan.files + ',"totalDirs":' + scan.dirs +
    ',"totalBytes":' + scan.bytes + ',"blocks":[');
  for (let bi = 0; bi < blocks.length; bi++) {
    const blockJson = JSON.stringify(encodeBlock(scan, blocks[bi], aggValue, aggFiles, aggDirs));
    const compressed = zlib.deflateRawSync(blockJson, { level: 6 });
    if (bi > 0) w(',');
    w('"' + compressed.toString('base64') + '"');
  }
  w(']}');

  // --- Rest of the HTML (bundle + page scripts) ---
  w(`
<\/script>
<script>
${bundle}
<\/script>
<script>
// Progressive block loader — uses the component's lazy tree-accessor API.
// Each "item" is just a node's global integer ID. The component calls
// getChildren(id) during layout, which looks up the node store. Blocks are
// inflated on demand: if a stub's block isn't ready, getChildren returns []
// (stub renders as a leaf), kicks off async inflate, and re-renders when done.
(function () {
  var raw = JSON.parse(document.getElementById('tmdata').textContent);
  // v3: all blocks compressed. v2: block0 is inline JSON.
  var envelope = raw;
  var tm = document.getElementById('tm');

  // --- Decode helpers ---
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

  // --- Node store: id -> { label, value, childIds, colorExt, colorKind, colorFolder, ctime, mtime, atime, stubBlockId?, aggFiles?, aggDirs? } ---
  var store = new Map();
  var inflating = new Set(); // block IDs currently being inflated
  var currentColorMode = '${colorBy}';
  var extColorMap = ${extColorMapJson};

  // Decode a block JSON object and add its nodes to the store.
  function loadBlock(blk) {
    var m = blk.labels.length;
    var pi = new Int32Array(_buf(blk.piB64));
    var gr = new Int32Array(_buf(blk.grB64));
    var rawExtArr = decodeCat(blk.rawExtNames, blk.rawExtB64);
    var extArr = decodeCat(blk.extNames, blk.extB64);
    var folderArr = decodeCat(blk.folderNames, blk.folderB64);
    var ct = new Float64Array(_buf(blk.ctimeB64));
    var mt = new Float64Array(_buf(blk.mtimeB64));
    var at = new Float64Array(_buf(blk.atimeB64));

    // Build childIds per node (local).
    var localChildren = new Array(m);
    for (var i = 0; i < m; i++) localChildren[i] = null;
    for (var j = 1; j < m; j++) {
      var p = pi[j];
      if (p >= 0) {
        if (!localChildren[p]) localChildren[p] = [];
        localChildren[p].push(j);
      }
    }

    // Stub set for quick lookup.
    var stubSet = new Map();
    if (blk.stubs) {
      for (var si = 0; si < blk.stubs.length; si++) {
        var s = blk.stubs[si];
        // s = [localRow, childBlockId, aggValue, aggFiles, aggDirs]
        stubSet.set(s[0], s);
      }
    }

    for (var k = 0; k < m; k++) {
      var gid = gr[k];
      if (store.has(gid)) {
        // Node already exists (it's a stub from a parent block) — update it
        // with real children from this block.
        var existing = store.get(gid);
        if (localChildren[k]) {
          existing.childIds = localChildren[k].map(function(li) { return gr[li]; });
        }
        continue;
      }
      // parentId is the global row of this node's parent, or null for the
      // block root (whose parent lives in another block — we look it up by
      // the stub's localRow==0 record; block 0's node 0 is the tree root).
      var gp = null;
      if (pi[k] >= 0) gp = gr[pi[k]];
      var nd = {
        label: blk.labels[k],
        value: blk.values[k],
        parentId: gp,
        childIds: localChildren[k] ? localChildren[k].map(function(li) { return gr[li]; }) : null,
        colorExt: rawExtArr[k],
        colorKind: extArr[k],
        colorFolder: folderArr[k],
        ctime: ct[k], mtime: mt[k], atime: at[k],
      };
      var stubInfo = stubSet.get(k);
      if (stubInfo) {
        nd.stubBlockId = stubInfo[1];
        nd.aggFiles = stubInfo[3];
        nd.aggDirs = stubInfo[4];
      }
      store.set(gid, nd);
    }
  }

  // Inflate a single compressed block, add to store. Returns a promise.
  function inflateBlock(blockId) {
    var b64 = envelope.blocks[blockId];
    if (!b64) return Promise.resolve();
    var bytes = new Uint8Array(atob(b64).split('').map(function(c) { return c.charCodeAt(0); }));
    var ds = new DecompressionStream('deflate-raw');
    var writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(ds.readable).text().then(function(text) {
      loadBlock(JSON.parse(text));
      envelope.blocks[blockId] = null; // free compressed data
    });
  }

  // After the first render, inflate ALL remaining blocks in parallel,
  // then do one final re-render. This gives exactly two renders:
  // 1) block 0 only (fast, shows stubs as leaves)
  // 2) all blocks loaded (complete tree)
  var allBlocksReady = null;
  function inflateAllBlocks() {
    if (allBlocksReady) return allBlocksReady;
    var promises = [];
    for (var i = 1; i < envelope.blocks.length; i++) {
      if (envelope.blocks[i]) promises.push(inflateBlock(i));
    }
    allBlocksReady = Promise.all(promises).then(function() {
      // Invalidate the lazy tree so new children are discovered.
      if (tm._tree) tm._tree._lazy = true;
      tm._queueRender();
    });
    return allBlocksReady;
  }

  // --- Accessor functions for the component ---
  function getChildren(id) {
    var nd = store.get(id);
    if (!nd) return null;
    // Stub whose block hasn't been loaded yet: return null to signal
    // "not yet available, retry later". The component will leave
    // childIds as null and re-call getChildren on the next render.
    if (nd.stubBlockId != null && nd.childIds === null) return null;
    // Files (true leaves) return [] so the component marks them as
    // childless and doesn't re-call getChildren on subsequent renders.
    if (!nd.childIds) return [];
    return nd.childIds;  // array of global IDs (each is an "item")
  }
  function getValue(id) { var nd = store.get(id); return nd ? nd.value : 0; }
  function getLabel(id) { var nd = store.get(id); return nd ? nd.label : ''; }
  function getId(id) { return id; }

  function getColor(id) {
    var nd = store.get(id);
    if (!nd) return '';
    switch (currentColorMode) {
      case 'extension': return nd.colorExt;
      case 'kind': return nd.colorKind;
      case 'folder': return nd.colorFolder;
      case 'ctime': return nd.ctime;
      case 'mtime': return nd.mtime;
      case 'atime': return nd.atime;
      default: return nd.colorExt;
    }
  }

  // --- Inflate block 0 and boot ---
  function inflateBlock0(b64) {
    var bytes = new Uint8Array(atob(b64).split('').map(function(c) { return c.charCodeAt(0); }));
    var ds = new DecompressionStream('deflate-raw');
    var writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(ds.readable).text().then(function(text) {
      return JSON.parse(text);
    });
  }
  // v3: block0 is compressed like all others; v2: block0 is inline JSON.
  var block0Promise = envelope.block0
    ? Promise.resolve(envelope.block0)
    : inflateBlock0(envelope.blocks[0]);
  block0Promise.then(function(block0) {
  loadBlock(block0);
  envelope.blocks[0] = null; // free compressed data
  var rootId = new Int32Array(_buf(block0.grB64))[0];
  tm.root = rootId;
  window._rootId = rootId;
  tm.getId = getId;
  tm.getChildren = getChildren;
  tm.getValue = getValue;
  tm.getLabel = getLabel;
  tm.getColor = getColor;

  // Color mode is categorical by default; quantitative for timestamps.
  var isCat = currentColorMode === 'extension' || currentColorMode === 'kind' || currentColorMode === 'folder';
  tm.setAttribute('color-mode', isCat ? 'categorical' : 'quantitative');

  // Expose for other scripts.
  window._store = store;
  window._currentColorMode = currentColorMode;
  window._applyColorBy = function (mode) {
    currentColorMode = mode;
    window._currentColorMode = mode;
    var cat = mode === 'extension' || mode === 'kind' || mode === 'folder';
    var newMap = cat ? (mode === 'kind' ? extColorMap : {}) : {};
    tm._props._userColorMap = newMap;
    tm.colorMap = tm.getAttribute('theme') ? {} : newMap;
    // If the user picked a palette from the dropdown, respect it;
    // otherwise fall back to a sensible default for the color mode.
    var paletteOverride = window._currentPalette || '';
    if (cat) {
      tm.setAttribute('color-mode', 'categorical');
      var catPal = paletteOverride || 'tokyo-night';
      tm._props._userPalette = catPal;
      if (!tm.getAttribute('theme')) tm.setAttribute('palette', catPal);
      tm.colorDomain = undefined;
    } else {
      tm.setAttribute('color-mode', 'quantitative');
      var qPal = paletteOverride || 'viridis';
      tm._props._userPalette = qPal;
      tm.setAttribute('palette', qPal);
      // Compute domain from all loaded timestamps.
      var lo = Infinity, hi = -Infinity;
      store.forEach(function(nd) {
        var v = mode === 'ctime' ? nd.ctime : mode === 'mtime' ? nd.mtime : nd.atime;
        if (v > 0) { if (v < lo) lo = v; if (v > hi) hi = v; }
      });
      tm.colorDomain = lo !== Infinity ? [lo, hi] : undefined;
    }
    // getColor already reads currentColorMode, just re-render.
    tm._queueRender();
  };

  var fmtBytes = function (v) {
    var units = ['B','KB','MB','GB','TB','PB']; var i = 0, n = v || 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
  };
  tm.valueFormatter = tm.valueFormatter || fmtBytes;

  // After the first render (queued via microtask from property setters above),
  // inflate all remaining blocks in parallel, then render once more.
  requestAnimationFrame(function() { inflateAllBlocks(); });
  }); // block0Promise.then
  window._bootReady = block0Promise;
  window._allBlocksReady = block0Promise.then(function() { return inflateAllBlocks(); });
})();
// Stats bar: subtree counts + per-node metadata for the focused node.
// Uses the node store; stubs carry pre-computed aggregates from the scan.
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
    // Unexpanded stub: use pre-computed aggregates.
    if (nd.stubBlockId != null && nd.childIds === null) {
      return { files: nd.aggFiles || 0, dirs: nd.aggDirs || 0, bytes: nd.value };
    }
    var files = 0, dirs = 0, bytes = 0;
    var stack = [nodeId];
    while (stack.length) {
      var id = stack.pop();
      var n = store.get(id);
      if (!n) continue;
      if (n.stubBlockId != null && n.childIds === null) {
        files += n.aggFiles || 0; dirs += n.aggDirs || 0; bytes += n.value; continue;
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
    // Per-node metadata for leaf files.
    var nd = store.get(id);
    if (nd && !nd.childIds && !nd.stubBlockId) {
      var kind = nd.colorKind;
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
// Color-by switcher + theme/palette switcher + URL hash sync.
// Theme drives page chrome + the default categorical palette. The
// Palette dropdown is an independent override applied on top. Both are
// persisted in a single URL-encoded JSON blob under the key "s"; legacy
// key=value params are still read for backwards compatibility.
window._bootReady.then(function () {
  var themes = ${themesJson};
  var themeSel = document.getElementById('theme-sel');
  var paletteSel = document.getElementById('palette-sel');
  var colorSel = document.getElementById('color-sel');
  var tm = document.getElementById('tm');
  var htmlRoot = document.documentElement;
  var DEFAULT_THEME = 'tokyo-night';
  var DEFAULT_COLOR = '${colorBy}';
  var DEFAULT_PALETTE = '';
  var currentTheme = DEFAULT_THEME;
  var currentColor = DEFAULT_COLOR;
  var currentPalette = DEFAULT_PALETTE;

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
    applyPalette(currentPalette);
    themeSel.value = currentTheme;
  }
  function applyPalette(name) {
    currentPalette = name || '';
    window._currentPalette = currentPalette;
    var effective = name || currentTheme || 'gp-default';
    tm._props._userPalette = effective;
    tm.setAttribute('palette', effective);
    tm._props.palette = effective;
    tm._queueRender();
    paletteSel.value = currentPalette;
  }
  function applyColor(mode) {
    currentColor = mode || DEFAULT_COLOR;
    window._applyColorBy(currentColor);
    colorSel.value = currentColor;
    if (currentPalette) applyPalette(currentPalette);
  }
  themeSel.addEventListener('change', function () { applyPageTheme(themeSel.value); writeHash(); });
  paletteSel.addEventListener('change', function () { applyPalette(paletteSel.value); writeHash(); });
  colorSel.addEventListener('change', function () { applyColor(colorSel.value); writeHash(); });

  // Node IDs inside the component are integer row indices — stable and
  // compact for Map keys. For the URL hash, though, we want something a
  // human can read, so we convert to path arrays (array of labels from
  // the tree root down to the node, exclusive of the root).
  function idToPath(id) {
    if (id == null) return undefined;
    var rootId = window._rootId;
    var nd = window._store && window._store.get(id);
    if (!nd) return undefined;
    if (id === rootId) return [];
    var parts = [];
    var cur = nd;
    while (cur && cur.parentId != null) {
      parts.unshift(cur.label);
      cur = window._store.get(cur.parentId);
    }
    return parts;
  }
  function pathToId(path) {
    if (path == null) return undefined;
    if (!Array.isArray(path)) return undefined;
    var rootId = window._rootId;
    if (path.length === 0) return rootId;
    var cur = rootId;
    for (var i = 0; i < path.length; i++) {
      var nd = window._store.get(cur);
      if (!nd || !nd.childIds) return undefined;
      var found = null;
      for (var j = 0; j < nd.childIds.length; j++) {
        var child = window._store.get(nd.childIds[j]);
        if (child && child.label === path[i]) { found = nd.childIds[j]; break; }
      }
      if (found == null) return undefined;
      cur = found;
    }
    return cur;
  }
  function readHash() {
    try {
      if (location.hash.length <= 1) return;
      var raw = location.hash.slice(1);
      if (!(raw.charAt(0) === 's' && raw.charAt(1) === '=')) return;
      var obj = JSON.parse(decodeURIComponent(raw.slice(2)));
      applyPageTheme('theme' in obj ? (obj.theme || '') : DEFAULT_THEME);
      applyPalette('palette' in obj ? (obj.palette || '') : '');
      applyColor(obj.color || DEFAULT_COLOR);
      var v = obj.viewer || {};
      // All blocks are inflated in parallel after first render, so we may
      // not yet be able to resolve every path; resolve what we can now,
      // then re-try after _allBlocksReady to pick up deeper paths.
      applyViewer(v);
      if (window._allBlocksReady) {
        window._allBlocksReady.then(function () { applyViewer(v); });
      }
    } catch (_) {}
  }
  function applyViewer(v) {
    tm.viewerState = {
      zoom: 'zoom' in v ? pathToId(v.zoom) : undefined,
      zoomPath: Array.isArray(v.zoomPath)
        ? v.zoomPath.map(function (p) { return pathToId(p); }).filter(function (id) { return id != null; })
        : undefined,
      depth: v.depth === 'Infinity' ? Infinity : (v.depth != null ? Number(v.depth) : undefined),
      target: 'target' in v ? pathToId(v.target) : undefined,
      focus: 'focus' in v ? pathToId(v.focus) : undefined,
      showLabels: 'showLabels' in v ? !!v.showLabels : undefined,
    };
  }
  function writeHash() {
    try {
      var v = tm.viewerState || {};
      // Rewrite integer IDs into readable path arrays.
      var vOut = {};
      if (v.zoom != null) vOut.zoom = idToPath(v.zoom);
      if (v.zoomPath) vOut.zoomPath = v.zoomPath.map(idToPath).filter(function (p) { return p != null; });
      if (v.target != null) vOut.target = idToPath(v.target);
      if (v.focus != null) vOut.focus = idToPath(v.focus);
      if (v.depth != null) vOut.depth = v.depth === Infinity ? 'Infinity' : v.depth;
      if ('showLabels' in v) vOut.showLabels = v.showLabels;

      var out = {};
      if (currentColor !== DEFAULT_COLOR) out.color = currentColor;
      if (currentTheme !== DEFAULT_THEME) out.theme = currentTheme;
      if (currentPalette !== DEFAULT_PALETTE) out.palette = currentPalette;
      if (Object.keys(vOut).length) out.viewer = vOut;
      var s = Object.keys(out).length ? 's=' + encodeURIComponent(JSON.stringify(out)) : '';
      history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
    } catch (_) {}
  }
  colorSel.value = DEFAULT_COLOR;
  readHash();
  // Always establish the theme/palette/color so the page chrome CSS vars
  // and the treemap's color pipeline are live even when the URL has no
  // hash. (readHash is a no-op on an empty hash.)
  if (location.hash.length <= 1) {
    applyPageTheme(DEFAULT_THEME);
    applyColor(DEFAULT_COLOR);
  }
  if (location.hash.length > 1) tm._queueRender();
  tm.addEventListener('gp-zoom-change', writeHash);
  tm.addEventListener('gp-depth-change', writeHash);
  tm.addEventListener('gp-target', writeHash);
  tm.addEventListener('gp-focus', writeHash);
});
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
