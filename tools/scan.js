#!/usr/bin/env node
// Scan a directory recursively and emit a self-contained HTML file that
// renders its size treemap with <gp-treemap>. The output has the bundle and
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
const BUNDLE_PATH = path.join(ROOT, 'dist', 'gp-treemap.bundle.js');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args[0] === '-h' || args[0] === '--help') {
    console.error('Usage: node tools/scan.js <dir> [output.html]');
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
  const scan = walk(target);
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
  console.log('open it with:  open "' + out + '"');
}

/**
 * Recursive scan. Returns { labels, parents, values, ids, color, bytes, files, dirs, unreadable }.
 * labels/parents/values/ids/color are the flat tabular arrays the component takes.
 */
function walk(rootPath) {
  const labels = [], parentIndices = [], values = [], color = [];
  let bytes = 0, files = 0, dirs = 0, unreadable = 0;

  // rowByPath maps a directory's full path to its row index so children can
  // reference their parent as an integer instead of a repeated path string.
  const rowByPath = new Map();

  // Root (parentIndex = -1).
  rowByPath.set(rootPath, 0);
  labels.push(path.basename(rootPath) || rootPath); parentIndices.push(-1); values.push(0); color.push('dir');
  dirs++;

  // Iterative DFS to avoid blowing the stack on deep trees.
  // Parents are always pushed to labels before their children, so
  // parentIndices[i] < i is guaranteed — enabling the O(n) fast path in builder.
  const stack = [rootPath];
  while (stack.length) {
    const dir = stack.pop();
    const dirRow = rowByPath.get(dir);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { unreadable++; continue; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) { unreadable++; continue; }
      if (ent.isDirectory()) {
        const row = labels.length;
        labels.push(ent.name); parentIndices.push(dirRow); values.push(0); color.push('dir');
        dirs++;
        rowByPath.set(full, row);
        stack.push(full);
      } else if (ent.isFile()) {
        let size = 0;
        try { size = fs.statSync(full).size; }
        catch (e) { unreadable++; continue; }
        labels.push(ent.name); parentIndices.push(dirRow); values.push(size);
        color.push(extKind(ent.name));
        bytes += size;
        files++;
      } else {
        unreadable++;
      }
    }
  }
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

  // NOTE: `data` is a big array. JSON-serialize it once and inline. `ids` are
  // filesystem paths; we keep them as-is so the tooltip shows the real path.
  const dataJson = JSON.stringify({
    labels: scan.labels,
    parentIndices: scan.parentIndices,
    values: scan.values,
    color: scan.color,
  });
  const colorMapJson = JSON.stringify(colorMap);
  const statsJson = JSON.stringify(stats);

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
  gp-treemap { display:flex; height: calc(100vh - 42px); }
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
<gp-treemap id="tm"
  color-mode="categorical"
  palette="gp-default"
  gradient-intensity="0.6"
  value-format="b"
  min-cell-area="30"></gp-treemap>

<script>
${bundle}
</script>
<script>
(function () {
  var d = ${dataJson};
  var tm = document.getElementById('tm');
  tm.labels = d.labels; tm.parentIndices = d.parentIndices; tm.values = d.values;
  tm.color = d.color;
  tm.colorMap = ${colorMapJson};
  tm.valueFormatter = function (v) {
    var units = ['B','KB','MB','GB','TB','PB']; var i = 0, n = v || 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
  };
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
