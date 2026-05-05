#!/usr/bin/env node
// Convert a Chrome DevTools .cpuprofile into a self-contained HTML treemap
// visualization using <gp-treemap>.
//
// Hierarchy:
//   root
//     └── <thread> (e.g. "Renderer Main" — cpuprofile is single-threaded)
//           └── <call-tree-root>
//                 └── function call-stack descendants...
//
// Value = CPU time attributed to each node (self-time at the leaves,
// summed to subtree time at the ancestors). Color = script/URL.
//
// Usage:  node tools/profile-to-html.js <input.cpuprofile> [output.html]
//                 [--thread-label=...]  (default: "Renderer Main")
//                 [--no-open]

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import { buildCliCommand, COPY_BTN_HTML, COPY_BTN_CSS, copyButtonScript } from './cli-command.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUNDLE_PATH = path.join(ROOT, 'dist', 'gp-treemap.bundle.js');

function parseArgs() {
  const argv = process.argv.slice(2);
  const positional = [];
  const opts = { threadLabel: 'Renderer Main', open: true };
  for (const a of argv) {
    if (a === '--no-open') opts.open = false;
    else if (a.startsWith('--thread-label=')) opts.threadLabel = a.slice('--thread-label='.length);
    else if (a === '-h' || a === '--help') {
      console.error('Usage: node tools/profile-to-html.js <input.cpuprofile> [output.html] [--thread-label=...] [--no-open]');
      process.exit(0);
    }
    else positional.push(a);
  }
  if (positional.length < 1) {
    console.error('Usage: node tools/profile-to-html.js <input.cpuprofile> [output.html]');
    process.exit(2);
  }
  return { input: positional[0], output: positional[1], ...opts };
}

// Attribute sample counts and CPU time to each profile node, using the
// timeDeltas. cpuprofile contract:
//   samples[i] is the nodeId active at sample i.
//   timeDeltas[i] is the microsecond delta BEFORE samples[i].
function attributeSelfTime(profile) {
  const { nodes, samples, timeDeltas } = profile;
  const nodeById = new Map();
  for (const n of nodes) nodeById.set(n.id, n);

  const self = new Map(); // nodeId -> microseconds
  for (const n of nodes) self.set(n.id, 0);

  if (samples && samples.length) {
    for (let i = 0; i < samples.length; i++) {
      const id = samples[i];
      const dt = timeDeltas ? Math.max(0, timeDeltas[i] | 0) : 1;
      self.set(id, (self.get(id) || 0) + dt);
    }
  } else {
    // No samples array (rare) — fall back to hitCount.
    for (const n of nodes) self.set(n.id, (n.hitCount | 0));
  }
  return { nodeById, self };
}

// The cpuprofile has a node tree with a single synthetic "(root)" node
// (functionName === '(root)'). Each node's `children` is an array of child IDs.
// Build a subtree-time (us) for each node and produce our flat arrays.
function buildTreemapData(profile, threadLabel) {
  const { nodes } = profile;
  const { nodeById, self } = attributeSelfTime(profile);

  // Find the cpuprofile root.
  let cpuRoot = nodes.find((n) => n.callFrame && n.callFrame.functionName === '(root)');
  if (!cpuRoot) cpuRoot = nodes[0];

  // Compute subtree time via iterative post-order.
  const subtree = new Map();
  const order = [];
  {
    const stack = [[cpuRoot.id, false]];
    while (stack.length) {
      const [id, visited] = stack.pop();
      if (visited) { order.push(id); continue; }
      stack.push([id, true]);
      const n = nodeById.get(id);
      if (n.children) for (const c of n.children) stack.push([c, false]);
    }
  }
  for (const id of order) {
    const n = nodeById.get(id);
    let total = self.get(id) || 0;
    if (n.children) for (const c of n.children) total += subtree.get(c) || 0;
    subtree.set(id, total);
  }

  // Build flat arrays:
  //   node 0 = synthetic root ("profile")
  //   node 1 = thread container
  //   node 2..N = function nodes (preserving cpuprofile tree under the thread)
  const labels = [];
  const parents = [];
  const values = [];
  const ids = [];
  const color = [];        // script/URL bucket
  const fileLabel = [];    // just the filename portion
  const funcName = [];
  const lineNo = [];
  const colNo = [];
  const scriptUrl = [];

  const totalUs = subtree.get(cpuRoot.id) || 0;

  // 0: root
  labels.push('profile');
  parents.push(-1);
  values.push(0);          // aggregated up by the component? No — we pass values directly, so set to total.
  ids.push('root');
  color.push('(root)');
  fileLabel.push(''); funcName.push('(profile)'); lineNo.push(0); colNo.push(0); scriptUrl.push('');

  // 1: thread container
  labels.push(threadLabel);
  parents.push(0);
  values.push(0);
  ids.push('thread');
  color.push('(thread)');
  fileLabel.push(''); funcName.push(threadLabel); lineNo.push(0); colNo.push(0); scriptUrl.push('');

  // Map cpuprofile node id -> treemap index.
  const idxById = new Map();

  // DFS from cpuRoot, placing nodes under the thread container (row 1).
  const stack = [{ id: cpuRoot.id, parentIdx: 1 }];
  while (stack.length) {
    const { id, parentIdx } = stack.pop();
    const n = nodeById.get(id);
    const cf = n.callFrame || {};
    const fn = cf.functionName || '(anonymous)';
    const urlStr = cf.url || '';
    const line = (cf.lineNumber | 0) + 1; // 0-based in profile, prefer 1-based for display
    const col = (cf.columnNumber | 0) + 1;

    // Skip the synthetic cpuprofile (root) — but keep its children directly
    // under the thread. This makes the visualization start from real work.
    let myIdx;
    const isRoot = id === cpuRoot.id;
    if (isRoot) {
      myIdx = parentIdx; // children hang directly off the thread row
    } else {
      myIdx = labels.length;
      const label = fn && fn !== '' ? fn : '(anonymous)';
      labels.push(label);
      parents.push(parentIdx);
      values.push(self.get(id) || 0); // self time; directory rows aggregate via children
      ids.push('n' + id);
      // Color by function name (the "deepest function" at each cell).
      color.push(fn && fn !== '' ? fn : '(anonymous)');
      fileLabel.push(filenameFromUrl(urlStr));
      funcName.push(fn);
      lineNo.push(line);
      colNo.push(col);
      scriptUrl.push(urlStr);
    }
    idxById.set(id, myIdx);

    if (n.children) {
      for (const c of n.children) stack.push({ id: c, parentIdx: myIdx });
    }
  }

  // The thread container value is the cpuRoot's subtree total (in µs).
  values[1] = 0; // treemap aggregates leaf values up; container stays 0

  return {
    labels, parents, values, ids, color,
    fileLabel, funcName, lineNo, colNo, scriptUrl,
    totalUs,
    startTime: profile.startTime,
    endTime: profile.endTime,
    samples: profile.samples ? profile.samples.length : 0,
    nodeCount: profile.nodes.length,
    threadLabel,
  };
}

function scriptBucket(urlStr) {
  if (!urlStr) return '(native)';
  // Protocol-based buckets.
  if (urlStr.startsWith('chrome-extension://')) return '(extension)';
  if (urlStr.startsWith('extensions::')) return '(extension)';
  if (urlStr.startsWith('node:')) return '(node)';
  // file://... — use just the basename so same-file calls share a color.
  const f = filenameFromUrl(urlStr);
  if (f) return f;
  return '(other)';
}

function filenameFromUrl(urlStr) {
  if (!urlStr) return '';
  try {
    if (urlStr.startsWith('file://')) {
      const p = url.fileURLToPath(urlStr);
      return path.basename(p);
    }
    const u = new URL(urlStr);
    const parts = u.pathname.split('/');
    return parts[parts.length - 1] || u.hostname;
  } catch (_) {
    const s = urlStr.split(/[\/\\]/);
    return s[s.length - 1];
  }
}

function humanUs(us) {
  if (us < 1000) return us.toFixed(0) + ' µs';
  if (us < 1_000_000) return (us / 1000).toFixed(1) + ' ms';
  return (us / 1_000_000).toFixed(2) + ' s';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function main() {
  const args = parseArgs();
  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error('profile not found: ' + inputPath);
    process.exit(1);
  }
  if (!fs.existsSync(BUNDLE_PATH)) {
    console.error('bundle not found at ' + BUNDLE_PATH + '\nRun `node tools/build.js` first.');
    process.exit(1);
  }
  const outputPath = path.resolve(
    args.output ||
    path.join(os.tmpdir(), 'profile-' + path.basename(inputPath, path.extname(inputPath)) + '-' + Date.now() + '.html')
  );

  console.error('reading ' + inputPath + '...');
  const profile = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  console.error('building treemap data...');
  const data = buildTreemapData(profile, args.threadLabel);

  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');

  const stats = {
    totalUs: data.totalUs,
    totalHuman: humanUs(data.totalUs),
    nodeCount: data.nodeCount,
    sampleCount: data.samples,
    treemapRows: data.labels.length,
    startTime: data.startTime,
    endTime: data.endTime,
    input: inputPath,
    thread: data.threadLabel,
  };

  // Embed data as a typed JSON payload. For profiles (typically <1M nodes)
  // we keep it simple — no block partitioning, no compression.
  // Builder expects `parents` to be parent-id strings (matching `ids`),
  // with '' marking the root. Convert our integer parent indices.
  const parentIds = data.parents.map((pi) => (pi < 0 ? '' : data.ids[pi]));

  const payload = {
    labels: data.labels,
    parents: parentIds,
    values: data.values,  // µs of self time per leaf; directory rows are 0 and get aggregated
    ids: data.ids,
    color: data.color,
    fileLabel: data.fileLabel,
    funcName: data.funcName,
    lineNo: data.lineNo,
    colNo: data.colNo,
    scriptUrl: data.scriptUrl,
  };

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>profile \xb7 ${escapeHtml(path.basename(inputPath))}</title>
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
  #stats-bar { padding: 3px 14px; font-size: 12px; font-variant-numeric: tabular-nums; min-height: 18px;
    color: var(--page-fg-muted, #888); background: var(--page-surface, #fff);
    border-top: 1px solid var(--page-border, #0002); transition: background .15s, color .15s;
    font-family: ui-monospace, SF Mono, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #theme-sel { font-size: 12px; padding: 2px 4px; border-radius: 4px;
    background: var(--page-bg, #fff); color: var(--page-fg, #333);
    border: 1px solid var(--page-border, #ccc); cursor: pointer; }
${COPY_BTN_CSS}
</style>
</head>
<body>
<header>
  ${COPY_BTN_HTML}
  <h1>${escapeHtml(path.basename(inputPath))}</h1>
  <span class="stat"><b>${escapeHtml(stats.thread)}</b></span>
  <span class="stat"><b>${stats.totalHuman}</b> total CPU</span>
  <span class="stat"><b>${stats.sampleCount.toLocaleString()}</b> samples</span>
  <span class="stat"><b>${stats.nodeCount.toLocaleString()}</b> profile nodes</span>
  <span class="stat"><b>${stats.treemapRows.toLocaleString()}</b> treemap rows</span>
  <span class="stat" style="margin-left:auto;">
    <select id="theme-sel">
      <option value="tokyo-night">Tokyo Night</option>
      <option value="nord">Nord</option>
      <option value="solarized">Solarized Dark</option>
      <option value="dracula">Dracula</option>
      <option value="catppuccin">Catppuccin Mocha</option>
      <option value="gruvbox">Gruvbox Dark</option>
      <option value="one-dark">One Dark</option>
      <option value="rose-pine">Rosé Pine</option>
      <option value="">Default (light)</option>
    </select>
  </span>
</header>
<gp-treemap id="tm"
  color-mode="categorical"
  palette="tokyo-night"
  theme="tokyo-night"
  gradient-intensity="0.6"
  min-cell-area="30"></gp-treemap>
<div id="stats-bar"></div>

<script type="application/json" id="tmdata">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
<script>
${bundle}
</script>
<script>
(function () {
  var d = JSON.parse(document.getElementById('tmdata').textContent);
  var tm = document.getElementById('tm');

  // µs value formatter.
  function fmtUs(v) {
    if (v == null) return '';
    if (v < 1) return v.toFixed(2) + ' µs';
    if (v < 1000) return v.toFixed(0) + ' µs';
    if (v < 1000000) return (v / 1000).toFixed(1) + ' ms';
    return (v / 1000000).toFixed(2) + ' s';
  }

  tm.labels = d.labels;
  tm.parents = d.parents;
  tm.values = d.values;
  tm.ids = d.ids;
  tm.color = d.color;
  tm.valueFormatter = fmtUs;

  // Theme switching.
  var themePageColors = {
    'tokyo-night': { bg: '#1a1b26', surface: '#16161e', border: '#0f0f14', fg: '#c0caf5', fgMuted: '#787c99', accent: '#7aa2f7' },
    'nord':        { bg: '#2e3440', surface: '#3b4252', border: '#4c566a', fg: '#d8dee9', fgMuted: '#81a1c1', accent: '#88c0d0' },
    'solarized':   { bg: '#002b36', surface: '#073642', border: '#586e75', fg: '#839496', fgMuted: '#657b83', accent: '#268bd2' },
    'dracula':     { bg: '#282a36', surface: '#44475a', border: '#6272a4', fg: '#f8f8f2', fgMuted: '#6272a4', accent: '#bd93f9' },
    'catppuccin':  { bg: '#1e1e2e', surface: '#313244', border: '#45475a', fg: '#cdd6f4', fgMuted: '#a6adc8', accent: '#cba6f7' },
    'gruvbox':     { bg: '#282828', surface: '#3c3836', border: '#504945', fg: '#ebdbb2', fgMuted: '#a89984', accent: '#fabd2f' },
    'one-dark':    { bg: '#282c34', surface: '#2c313a', border: '#3e4452', fg: '#abb2bf', fgMuted: '#828997', accent: '#61afef' },
    'rose-pine':   { bg: '#191724', surface: '#1f1d2e', border: '#26233a', fg: '#e0def4', fgMuted: '#908caa', accent: '#c4a7e7' },
  };
  var sel = document.getElementById('theme-sel');
  function applyTheme(name) {
    var t = themePageColors[name];
    var root = document.documentElement;
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
    tm.setAttribute('palette', name || 'gp-default');
  }
  sel.addEventListener('change', function () { applyTheme(sel.value); });
  applyTheme(sel.value);

  // Stats bar — per-focused-node details. Use id -> row index map for O(1).
  var bar = document.getElementById('stats-bar');
  var idxById = Object.create(null);
  for (var ii = 0; ii < d.ids.length; ii++) idxById[d.ids[ii]] = ii;

  function updateBar() {
    var id = tm._focusId != null ? tm._focusId : tm._targetId;
    if (id == null) { bar.textContent = ''; return; }
    var idx = idxById[id];
    if (idx == null) { bar.textContent = ''; return; }
    var parts = [];
    var fn = d.funcName[idx] || d.labels[idx];
    parts.push(fn);
    var file = d.fileLabel[idx];
    if (file) {
      var loc = d.lineNo[idx] > 0 ? file + ':' + d.lineNo[idx] + ':' + d.colNo[idx] : file;
      parts.push(loc);
    }
    // The builder aggregates parent values from children, so tree.nodes has
    // the subtree total for inner nodes and self-time for leaves.
    var v = 0;
    if (tm._tree && tm._tree.nodes && tm._tree.nodes.get(id)) v = tm._tree.nodes.get(id).value;
    parts.push(fmtUs(v));
    var urlStr = d.scriptUrl[idx];
    if (urlStr) parts.push(urlStr);
    bar.textContent = parts.join('  |  ');
  }
  tm.addEventListener('gp-focus', updateBar);
  tm.addEventListener('gp-target', updateBar);
  requestAnimationFrame(function () { setTimeout(updateBar, 0); });
})();
${copyButtonScript(buildCliCommand('gp-treemap-profile-to-html'))}
</script>
</body>
</html>
`;

  fs.writeFileSync(outputPath, html);
  console.error('');
  console.error('profile stats:');
  console.error('  samples    ' + stats.sampleCount.toLocaleString());
  console.error('  nodes      ' + stats.nodeCount.toLocaleString());
  console.error('  duration   ' + stats.totalHuman);
  console.error('  treemap    ' + stats.treemapRows.toLocaleString() + ' rows');
  console.error('wrote ' + outputPath + '  (' + fs.statSync(outputPath).size.toLocaleString() + ' bytes)');

  if (args.open) {
    const { execSync } = await import('node:child_process');
    try {
      const cmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      execSync(cmd + ' ' + JSON.stringify(outputPath));
    } catch (_) { console.error('open it with:  open "' + outputPath + '"'); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
