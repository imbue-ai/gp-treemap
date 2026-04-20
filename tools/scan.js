#!/usr/bin/env node
// Scan a directory recursively and emit a self-contained HTML file that
// renders its size treemap with <raised-treemap>. The output has the bundle and
// the dataset inlined, so you can open it from anywhere with no server.
//
// Usage:  node tools/scan.js <dir> [output.html]
//                 (or `npm run scan -- <dir> [output.html]`)
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

async function main() {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  const args = argv.filter((a) => a !== '--no-open');
  if (args.length < 1 || args[0] === '-h' || args[0] === '--help') {
    console.error('Usage: node tools/scan.js [--no-open] <dir> [output.html]');
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
  const html = buildHtml(target, scan);
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

async function walk(rootPath) {
  const { Worker } = await import('node:worker_threads');
  const NWORKERS = Math.max(2, Math.min(os.cpus().length, 8));
  const workerPath = path.join(__dirname, 'scan-worker.js');

  const labels = [], parentIndices = [], values = [], color = [];
  let bytes = 0, files = 0, dirs = 0, unreadable = 0;

  labels.push(path.basename(rootPath) || rootPath);
  parentIndices.push(-1); values.push(0); color.push('dir');
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
            values.push(0); color.push('dir');
            dirs++;
            queue.push({ dirPath: path.join(result.dirPath, ent.name), dirRow: row });
          } else {
            labels.push(ent.name);
            parentIndices.push(result.dirRow);
            values.push(ent.size);
            color.push(extKind(ent.name));
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

  return { labels, parentIndices, values, color, bytes, files, dirs, unreadable };
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

function buildHtml(target, scan) {
  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');
  // Per-bucket color map. Hues chosen to be distinct under the raised-tile shading.
  const colorMap = {
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
    when: new Date().toISOString(),
  };

  // Binary-encode parentIndices (Int32Array) and color (Uint16 enum index).
  // Avoids ~96 MB of JSON integers and ~80 MB of repeated color strings;
  // typed-array base64 decodes far faster than JSON.parse on the same data.
  const colorNames = [...new Set(scan.color)].sort();
  const colorToIdx = new Map(colorNames.map((c, i) => [c, i]));
  const colorU16 = new Uint16Array(scan.color.length);
  for (let i = 0; i < scan.color.length; i++) colorU16[i] = colorToIdx.get(scan.color[i]);
  const colorB64 = Buffer.from(colorU16.buffer).toString('base64');

  const piI32 = Int32Array.from(scan.parentIndices);
  const piB64 = Buffer.from(piI32.buffer).toString('base64');

  // Labels and values stay as JSON (values include files > 4 GB, exceed Uint32).
  // Embed all data in a non-executing script tag so the browser uses the fast
  // JSON parser (not the general JS compiler) at runtime.
  const labelsJson  = JSON.stringify(scan.labels);
  const valuesJson  = JSON.stringify(scan.values);
  const colorNamesJson = JSON.stringify(colorNames);
  const colorMapJson   = JSON.stringify(colorMap);

  // Escape </script so the data tag can't be prematurely closed.
  const embeddedJson = `{"labels":${labelsJson},"values":${valuesJson},"colorNames":${colorNamesJson},"piB64":"${piB64}","colorB64":"${colorB64}"}`
    .replace(/<\/script/gi, '<\\/script');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>treemap · ${escapeHtml(target)}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background:#fafafa; color:#111; }
  header { padding: 8px 14px; border-bottom: 1px solid #0002; display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; background:#fff; }
  header h1 { margin:0; font-size:14px; font-weight:600; font-family: ui-monospace, SF Mono, Menlo, monospace; color:#222; }
  header .stat { color:#555; font-size:13px; font-variant-numeric: tabular-nums; }
  header .stat b { color:#000; font-weight:600; }
  raised-treemap { display:flex; height: calc(100vh - 42px); }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(target)}</h1>
  <span class="stat"><b>${stats.files.toLocaleString()}</b> files</span>
  <span class="stat"><b>${stats.dirs.toLocaleString()}</b> directories</span>
  <span class="stat"><b>${stats.humanSize}</b> total</span>
  ${stats.unreadable ? `<span class="stat">(${stats.unreadable.toLocaleString()} unreadable)</span>` : ''}
  <span class="stat" style="margin-left:auto; color:#888;">scanned ${escapeHtml(stats.when)}</span>
</header>
<raised-treemap id="tm"
  color-mode="categorical"
  palette="gp-default"
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
  var cn = raw.colorNames, ci = new Uint16Array(_buf(raw.colorB64));
  var ca = new Array(ci.length);
  for (var i = 0; i < ci.length; i++) ca[i] = cn[ci[i]];
  tm.color = ca;
  tm.colorMap = ${colorMapJson};
  tm.valueFormatter = function (v) {
    var units = ['B','KB','MB','GB','TB','PB']; var i = 0, n = v || 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
  };
})();
// Sync zoom/depth state with URL hash so copying the URL preserves the view.
(function () {
  var tm = document.getElementById('tm');
  function readHash() {
    try {
      var p = new URLSearchParams(location.hash.slice(1));
      var z = p.get('zoom');   if (z) tm.visibleRootId = z;
      var d = p.get('depth');  if (d != null) tm.displayDepth = d === 'Infinity' ? Infinity : Number(d);
    } catch (_) {}
  }
  function writeHash() {
    try {
      var p = new URLSearchParams();
      var z = tm._internalVisibleRootId; if (z) p.set('zoom', z);
      var d = tm.displayDepth;           if (d !== Infinity) p.set('depth', String(d));
      var s = p.toString();
      history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
    } catch (_) {}
  }
  readHash();
  tm.addEventListener('rt-zoom-change', writeHash);
  tm.addEventListener('rt-depth-change', writeHash);
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
