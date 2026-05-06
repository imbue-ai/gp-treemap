#!/usr/bin/env node
// Regenerate the assets for the "treemap library comparison" article.
//
// Each section walks one canonical hierarchy and feeds it through three
// renderers (Plotly.js, D3, gp-treemap). The canonical shape is:
//
//   {
//     labels:  string[],      // node label
//     parents: number[],      // parent index, -1 for root
//     values:  number[],      // raw leaf value (0 at interiors)
//     colors:  string[],      // categorical color label per node
//     isBytes: boolean,       // whether values represent file bytes
//   }
//
// Library-specific shape conversions live in toPlotly / toD3 / toGptm.
//
// Output:
//   gallery/comparison.html              — the article itself
//   gallery/comparison/{plotly,d3,gptm}-{toy,repo,mega}.html — per-frame pages

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse as parseCsvSync } from 'csv-parse/sync';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'gallery', 'comparison');
const BUNDLE_PATH = path.join(ROOT, 'dist', 'gp-treemap.bundle.js');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PLOTLY_CDN = 'https://cdn.plot.ly/plotly-3.0.1.min.js';
const D3_CDN = 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js';

// ---------------------------------------------------------------------------
// Canonical hierarchy builders
// ---------------------------------------------------------------------------

function buildToy() {
  // Coffee-shop sales by region → category → product.
  const ROWS = [
    ['Americas','Beverages','Espresso',820],   ['Americas','Beverages','Latte',940],
    ['Americas','Beverages','Drip Coffee',610],['Americas','Beverages','Tea',230],
    ['Americas','Pastries','Croissant',410],   ['Americas','Pastries','Muffin',330],
    ['Americas','Pastries','Scone',180],       ['Americas','Sandwiches','Turkey',520],
    ['Americas','Sandwiches','Caprese',310],
    ['EMEA','Beverages','Espresso',1120],      ['EMEA','Beverages','Cappuccino',880],
    ['EMEA','Beverages','Tea',640],            ['EMEA','Pastries','Croissant',760],
    ['EMEA','Pastries','Pain au Choc',540],    ['EMEA','Pastries','Madeleine',220],
    ['EMEA','Sandwiches','Jambon',470],        ['EMEA','Sandwiches','Caprese',290],
    ['APAC','Beverages','Matcha',710],         ['APAC','Beverages','Bubble Tea',1180],
    ['APAC','Beverages','Drip Coffee',340],    ['APAC','Pastries','Mochi',450],
    ['APAC','Pastries','Egg Tart',520],        ['APAC','Sandwiches','Katsu',390],
    ['APAC','Sandwiches','Banh Mi',610],
  ];
  const labels = ['All'], parents = [-1], values = [0], colors = ['root'];
  const idxByPath = new Map([['All', 0]]);
  for (const [region, category, product, sales] of ROWS) {
    let parentIdx = 0, parentPath = 'All';
    for (const seg of [region, category, product]) {
      const fullPath = parentPath + '/' + seg;
      let idx = idxByPath.get(fullPath);
      if (idx == null) {
        idx = labels.length;
        idxByPath.set(fullPath, idx);
        labels.push(seg);
        parents.push(parentIdx);
        values.push(0);
        colors.push(category); // color leaves by category
      }
      parentIdx = idx;
      parentPath = fullPath;
    }
    values[parentIdx] += sales;
  }
  return { labels, parents, values, colors, isBytes: false };
}

function walkRepo(rootPath, { excludeNames = new Set() } = {}) {
  // Recursive disk walk. Symlinks are skipped. Stat errors are ignored.
  const labels = [], parents = [], values = [], colors = [];
  function fileKind(name) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return 'other';
    const ext = name.slice(dot + 1).toLowerCase();
    const BUCKETS = {
      code: ['js','mjs','cjs','ts','tsx','jsx','py','rb','go','rs','c','cc','cpp','h','java','sh','json','yaml','yml','toml'],
      docs: ['md','txt','rst','adoc','tex'],
      web:  ['html','htm','css','scss','svg'],
      data: ['csv','tsv','jsonl','ndjson','parquet','xml','db','sqlite','zip','tar','gz'],
      image:['png','jpg','jpeg','gif','webp','heic','tiff','ico'],
      git:  ['pack','idx'],
      lock: ['lock'],
    };
    for (const [k, exts] of Object.entries(BUCKETS)) if (exts.includes(ext)) return k;
    return ext;
  }
  function walk(dir, parentIdx) {
    const idx = labels.length;
    labels.push(path.basename(dir));
    parents.push(parentIdx);
    values.push(0);
    colors.push('dir');
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return idx; }
    for (const ent of entries) {
      if (excludeNames.has(ent.name)) continue;
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, idx);
      else if (ent.isFile()) {
        let st; try { st = fs.statSync(full); } catch { continue; }
        labels.push(ent.name);
        parents.push(idx);
        values.push(st.size);
        colors.push(fileKind(ent.name));
      }
    }
    return idx;
  }
  walk(rootPath, -1);
  return { labels, parents, values, colors, isBytes: true };
}

function loadCaCity(zipPath, { maxRows } = {}) {
  // Unzip to tmp, parse the CSV, then build a hierarchy keyed by
  // Department → County → Employer → Position → row. Produces the same
  // canonical shape walkRepo does so all three renderers see identical input.
  const tmp = fs.mkdtempSync(path.join(path.dirname(zipPath), '.unzip-'));
  try {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmp], { stdio: 'inherit' });
    const csvFile = fs.readdirSync(tmp).find((f) => f.toLowerCase().endsWith('.csv'));
    if (!csvFile) throw new Error('no .csv in ' + zipPath);
    const csv = fs.readFileSync(path.join(tmp, csvFile), 'utf8');
    const records = parseCsvSync(csv, { columns: true, skip_empty_lines: true, relax_column_count: true });
    const labels = ['All'], parents = [-1], values = [0], colors = ['root'];
    const idxByPath = new Map([['All', 0]]);
    let n = 0;
    const total = maxRows ? Math.min(records.length, maxRows) : records.length;
    for (let r = 0; r < total; r++) {
      const row = records[r];
      const dept = (row.DepartmentOrSubdivision || '(blank)').trim() || '(blank)';
      const county = (row.EmployerCounty || '(blank)').trim() || '(blank)';
      const employer = (row.EmployerName || '(blank)').trim() || '(blank)';
      const position = (row.Position || '(blank)').trim() || '(blank)';
      const wages = Number(row.TotalWages) || 0;
      if (wages <= 0) continue;
      const segs = [dept, county, employer, position];
      let parentIdx = 0, parentPath = 'All';
      for (let s = 0; s < segs.length; s++) {
        const seg = segs[s].replace(/\x00/g, '_');
        const fullPath = parentPath + '\x00' + seg;
        let idx = idxByPath.get(fullPath);
        if (idx == null) {
          idx = labels.length;
          idxByPath.set(fullPath, idx);
          labels.push(seg);
          parents.push(parentIdx);
          values.push(0);
          colors.push(dept);
        }
        parentIdx = idx;
        parentPath = fullPath;
      }
      // Synthetic _row leaf so every individual row gets its own cell.
      labels.push('#' + (r + 1));
      parents.push(parentIdx);
      values.push(wages);
      colors.push(dept);
      n++;
    }
    console.log('  parsed ' + records.length.toLocaleString() + ' CSV rows; ' +
      'kept ' + n.toLocaleString() + '; ' + labels.length.toLocaleString() + ' tree nodes');
    return { labels, parents, values, colors, isBytes: false };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Translators — turn canonical hierarchy into each library's expected shape.
// ---------------------------------------------------------------------------

function subtreeSums(canon) {
  // For each node, sum of own value + children's subtree sums. Plotly's
  // `branchvalues:'total'` and gp-treemap's auto-aggregation both work
  // when interior values are 0 + we let them sum, but Plotly is stricter
  // so we pre-roll for safety.
  const sums = canon.values.slice();
  for (let i = canon.labels.length - 1; i > 0; i--) {
    if (canon.parents[i] >= 0) sums[canon.parents[i]] += sums[i];
  }
  return sums;
}

function toPlotly(canon) {
  const ids = canon.labels.map((_, i) => String(i));
  const parents = canon.parents.map((p) => p < 0 ? '' : String(p));
  const sums = subtreeSums(canon);
  return {
    ids, parents, labels: canon.labels, values: sums,
    customdata: canon.isBytes ? sums.map(humanBytes) : undefined,
    isBytes: canon.isBytes,
  };
}

function toD3(canon) {
  // Build a nested {name, value | children} tree. Leaves carry their raw
  // value; D3 sums them up via d3.hierarchy.sum().
  const kids = canon.labels.map(() => []);
  let rootIdx = 0;
  for (let i = 0; i < canon.labels.length; i++) {
    if (canon.parents[i] < 0) rootIdx = i;
    else kids[canon.parents[i]].push(i);
  }
  function node(i) {
    if (kids[i].length === 0) return { name: canon.labels[i], value: canon.values[i] };
    return { name: canon.labels[i], children: kids[i].map(node) };
  }
  return { nested: node(rootIdx), nodeCount: canon.labels.length, isBytes: canon.isBytes };
}

function toGptm(canon) {
  // gp-treemap's web component takes ids/labels/parents/values/color
  // arrays; parents are id strings ('' for root). Interior values are 0
  // and the component aggregates internally.
  const ids = canon.labels.map((_, i) => String(i));
  const parents = canon.parents.map((p) => p < 0 ? '' : String(p));
  return { ids, parents, labels: canon.labels, values: canon.values, color: canon.colors, isBytes: canon.isBytes };
}

function humanBytes(v) {
  const u = ['B','KB','MB','GB','TB']; let i = 0, n = v;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Inline a large JS data object via JSON.parse('...') instead of as a JS
// object literal \u2014 the V8 JSON parser is several times faster than the JS
// literal parser for big objects (it knows the strict shape upfront).
function inlineJsonParse(value) {
  // Escape \\, ', and </ so the string is safe inside a JS single-quoted
  // string and inside a <script> tag.
  const json = JSON.stringify(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/<\//g, '<\\/');
  return "JSON.parse('" + json + "')";
}

// ---------------------------------------------------------------------------
// Iframe HTML emitters — one canonical hierarchy → three renderers.
// ---------------------------------------------------------------------------

const PAGE_CSS = `
  html,body{margin:0;padding:0;height:100%;font-family:system-ui,-apple-system,Segoe UI,sans-serif;
    background:#1a1b26;color:#c0caf5;}
  body{display:flex;flex-direction:column;}
  header{padding:6px 12px;border-bottom:1px solid #0f0f14;background:#16161e;
    display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;font-size:12px;}
  header h1{margin:0;font-size:12px;font-weight:600;font-family:ui-monospace,SF Mono,Menlo,monospace;}
  header .stat{color:#787c99;font-size:11px;font-variant-numeric:tabular-nums;}
  #plot,#chart,gp-treemap{flex:1;min-height:0;display:flex;}
  #plot,#chart{overflow:auto;}
  #status{padding:4px 12px;font-size:11px;color:#787c99;background:#16161e;
    border-top:1px solid #0f0f14;font-variant-numeric:tabular-nums;}
`;

function emitPlotly(outPath, title, canon, opts) {
  const data = toPlotly(canon);
  const stat = data.labels.length.toLocaleString() + ' nodes';
  const trace = {
    type: 'treemap',
    ids: data.ids,
    parents: data.parents,
    labels: data.labels,
    values: data.values,
    branchvalues: 'total',
    textinfo: 'label+value+percent parent',
    customdata: data.customdata,
    hovertemplate: data.isBytes
      ? '<b>%{label}</b><br>%{customdata}<br>%{percentParent} of parent<extra></extra>'
      : '<b>%{label}</b><br>%{value:,}<br>%{percentParent} of parent<extra></extra>',
    marker: { line: { width: 1, color: '#1a1b26' }, pad: { l: 4, r: 4, t: 22, b: 4 } },
    pathbar: { visible: true, side: 'top', thickness: 22, edgeshape: '>' },
    tiling: { pad: 2 },
  };
  const layout = {
    template: 'plotly_dark',
    margin: { l: 0, r: 0, t: 0, b: 0 },
    paper_bgcolor: '#1a1b26', plot_bgcolor: '#1a1b26',
    font: { color: '#c0caf5', family: 'system-ui,-apple-system,Segoe UI,sans-serif', size: 12 },
    hoverlabel: { bgcolor: '#1a1b26', bordercolor: '#7aa2f7',
      font: { color: '#c0caf5', family: 'ui-monospace, SF Mono, Menlo, monospace' } },
  };
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)} \xb7 plotly</title>
<style>${PAGE_CSS}</style>
<script src="${PLOTLY_CDN}"></script>
</head><body>
<header><h1>${escapeHtml(title)} \u2014 plotly.js v3</h1><span class="stat">${stat}</span></header>
<div id="plot"></div>
<div id="status">loading\u2026</div>
<script>
  var trace = ${inlineJsonParse(trace)};
  var layout = ${JSON.stringify(layout)};
  var statusEl = document.getElementById('status');
  var plotDiv = document.getElementById('plot');
  var t0 = performance.now();
  statusEl.textContent = 'rendering ' + trace.labels.length.toLocaleString() + ' nodes\u2026';
  var done = false;
  function finish() {
    if (done) return; done = true;
    var dt = +(performance.now() - t0).toFixed(0);
    statusEl.textContent = 'rendered in ' + dt.toLocaleString() + ' ms';
    try { window.parent.postMessage({ type: 'render-time', tool: ${JSON.stringify(opts.tool)}, ms: dt }, '*'); } catch (_) {}
  }
  // plotly_afterplot fires after every render pass; wait one more so the
  // browser actually paints before stopping the clock.
  plotDiv.on && plotDiv.on('plotly_afterplot', function () {
    requestAnimationFrame(function () { requestAnimationFrame(finish); });
  });
  Plotly.newPlot('plot', [trace], layout, { responsive: true, displaylogo: false })
    .then(function () {
      // Fallback if afterplot never fires.
      setTimeout(function () {
        if (!done) requestAnimationFrame(function () { requestAnimationFrame(finish); });
      }, 200);
    })
    .catch(function (e) {
      statusEl.textContent = 'plotly failed: ' + (e && e.message || e);
      try { window.parent.postMessage({ type: 'render-time', tool: ${JSON.stringify(opts.tool)}, error: String(e && e.message || e) }, '*'); } catch (_) {}
    });
</script></body></html>`;
  fs.writeFileSync(outPath, html);
}

function emitD3(outPath, title, canon, opts) {
  const data = toD3(canon);
  const stat = data.nodeCount.toLocaleString() + ' nodes';
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)} \xb7 d3</title>
<style>${PAGE_CSS}
  svg { display: block; }
  text { font: 11px ui-monospace, SF Mono, Menlo, monospace; pointer-events: none; }
  .leaf rect { stroke: #1a1b26; stroke-width: 0.5; }
  .parent rect { fill: none; stroke: #1a1b26; stroke-width: 0.75; }
  .parent-label { fill: #c0caf5; font-weight: 600; font-size: 11px; }
  .leaf-label { fill: #1a1b26; }
  .tooltip { position: fixed; pointer-events: none; background: #16161e; color: #c0caf5;
    border: 1px solid #7aa2f7; border-radius: 4px; padding: 6px 9px;
    font: 12px ui-monospace, SF Mono, Menlo, monospace; white-space: nowrap;
    box-shadow: 0 4px 12px #0008; opacity: 0; transition: opacity .1s; z-index: 10; }
</style>
<script src="${D3_CDN}"></script>
</head><body>
<header><h1>${escapeHtml(title)} \u2014 d3 v7 treemap</h1><span class="stat">${stat}</span></header>
<div id="chart"></div>
<div id="tooltip" class="tooltip"></div>
<div id="status">loading\u2026</div>
<script>
  var data = ${inlineJsonParse(data.nested)};
  var IS_BYTES = ${JSON.stringify(data.isBytes)};
  var statusEl = document.getElementById('status');
  var tip = document.getElementById('tooltip');
  var t0 = performance.now();
  statusEl.textContent = 'computing layout\u2026';
  function fmtBytes(v) {
    var u = ['B','KB','MB','GB','TB']; var i = 0, n = v || 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
  }
  function fmt(v) { return IS_BYTES ? fmtBytes(v) : (v || 0).toLocaleString(); }
  requestAnimationFrame(function () {
    try {
      var chart = document.getElementById('chart');
      var W = chart.clientWidth, H = chart.clientHeight;
      var root = d3.hierarchy(data).sum(function (d) { return d.value || 0; })
        .sort(function (a, b) { return b.value - a.value; });
      d3.treemap().size([W, H]).tile(d3.treemapSquarify.ratio(1))
        .paddingTop(14).paddingInner(1).paddingOuter(2).round(true)(root);
      var topLevels = (root.children || []).map(function (n) { return n.data.name; });
      var hue = d3.scaleOrdinal().domain(topLevels)
        .range(['#7aa2f7','#bb9af7','#7dcfff','#9ece6a','#e0af68','#f7768e','#73daca','#c0caf5','#ff9e64','#cba6f7']);
      function colorFor(node) {
        var anc = node;
        while (anc.depth > 1) anc = anc.parent;
        var base = anc && anc.data ? hue(anc.data.name) : '#787c99';
        var k = Math.max(0, Math.min(0.55, (node.depth - 1) * 0.10));
        return d3.interpolateRgb(base, '#1a1b26')(k);
      }
      var svg = d3.select('#chart').append('svg').attr('width', W).attr('height', H);
      var parents = root.descendants().filter(function (d) { return d.children && d.depth > 0; });
      var pg = svg.selectAll('g.parent').data(parents).join('g').attr('class','parent')
        .attr('transform', function (d) { return 'translate(' + d.x0 + ',' + d.y0 + ')'; });
      pg.append('rect').attr('width', function (d) { return d.x1 - d.x0; })
        .attr('height', function (d) { return d.y1 - d.y0; })
        .attr('fill', function (d) { return d3.color(colorFor(d)).copy({ opacity: 0.18 }) + ''; });
      pg.filter(function (d) { return (d.x1 - d.x0) > 40; })
        .append('text').attr('class','parent-label').attr('x', 4).attr('y', 11)
        .text(function (d) {
          var maxChars = Math.floor((d.x1 - d.x0 - 6) / 6);
          var s = d.data.name;
          return s.length > maxChars ? s.slice(0, Math.max(1, maxChars - 1)) + '\u2026' : s;
        });
      var leaves = root.leaves();
      var lg = svg.selectAll('g.leaf').data(leaves).join('g').attr('class','leaf')
        .attr('transform', function (d) { return 'translate(' + d.x0 + ',' + d.y0 + ')'; });
      lg.append('rect').attr('width', function (d) { return d.x1 - d.x0; })
        .attr('height', function (d) { return d.y1 - d.y0; }).attr('fill', colorFor);
      lg.filter(function (d) { return (d.x1 - d.x0) > 32 && (d.y1 - d.y0) > 12; })
        .append('text').attr('class','leaf-label').attr('x', 3).attr('y', 11)
        .text(function (d) {
          var maxChars = Math.floor((d.x1 - d.x0 - 6) / 6);
          var s = d.data.name;
          return s.length > maxChars ? s.slice(0, Math.max(1, maxChars - 1)) + '\u2026' : s;
        });
      function show(e, d) {
        var ancNames = d.ancestors().reverse().slice(1).map(function (a) { return a.data.name; }).join(' / ');
        tip.innerHTML = (ancNames ? '<div style="opacity:.7">' + ancNames + '</div>' : '') +
          '<b>' + d.data.name + '</b><br>' + fmt(d.value);
        tip.style.opacity = '1';
      }
      function move(e) {
        var x = Math.min(window.innerWidth - tip.offsetWidth - 10, e.clientX + 12);
        var y = Math.min(window.innerHeight - tip.offsetHeight - 10, e.clientY + 12);
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
      }
      function hide() { tip.style.opacity = '0'; }
      svg.selectAll('g.leaf, g.parent').on('mouseenter', show).on('mousemove', move).on('mouseleave', hide);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var dt = +(performance.now() - t0).toFixed(0);
          statusEl.textContent = 'rendered ' + leaves.length.toLocaleString() + ' leaves in ' + dt.toLocaleString() + ' ms';
          try { window.parent.postMessage({ type: 'render-time', tool: ${JSON.stringify(opts.tool)}, ms: dt }, '*'); } catch (_) {}
        });
      });
    } catch (e) {
      statusEl.textContent = 'd3 failed: ' + (e && e.message || e);
      try { window.parent.postMessage({ type: 'render-time', tool: ${JSON.stringify(opts.tool)}, error: String(e && e.message || e) }, '*'); } catch (_) {}
    }
  });
</script></body></html>`;
  fs.writeFileSync(outPath, html);
}

function emitGptm(outPath, title, canon, opts) {
  // Drives the <gp-treemap> web component directly (bundle inlined),
  // with the same canonical hierarchy that plotly + d3 receive. No
  // disk re-walk, no separate loader pipeline.
  const data = toGptm(canon);
  const stat = data.labels.length.toLocaleString() + ' nodes';
  const colorMap = data.isBytes
    ? { dir: 'hsl(220,10%,35%)', code: 'hsl(48,85%,55%)', docs: 'hsl(211,70%,52%)',
        web: 'hsl(188,70%,48%)', data: 'hsl(138,55%,45%)', image: 'hsl(300,55%,55%)',
        git: 'hsl(20,60%,48%)', lock: 'hsl(0,0%,55%)', other: 'hsl(264,55%,58%)', root: 'hsl(220,10%,35%)' }
    : null;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)} \xb7 gp-treemap</title>
<style>${PAGE_CSS}
  gp-treemap { display:flex; flex:1; min-height:0; }
</style>
</head><body>
<header><h1>${escapeHtml(title)} \u2014 gp-treemap</h1><span class="stat">${stat}</span></header>
<gp-treemap id="tm"
  color-mode="categorical"
  theme="tokyo-night"
  palette="tokyo-night"
  gradient-intensity="0.6"
  ${data.isBytes ? 'value-format="b"' : ''}
  min-cell-area="20"></gp-treemap>
<div id="status">loading\u2026</div>
<script src="../../dist/gp-treemap.bundle.js"><\/script>
<script>
  var t0 = performance.now();
  var DATA = ${inlineJsonParse(data)};
  var COLOR_MAP = ${JSON.stringify(colorMap)};
  var statusEl = document.getElementById('status');
  var tm = document.getElementById('tm');
  tm.toolbar = { controls: false }; // hide depth/labels; keep breadcrumb
  tm.ids = DATA.ids;
  tm.labels = DATA.labels;
  tm.parents = DATA.parents;
  tm.values = DATA.values;
  tm.color = DATA.color;
  if (COLOR_MAP) tm.colorMap = COLOR_MAP;
  if (!DATA.isBytes) {
    tm.valueFormatter = function (v) { return (v == null) ? '' : Math.round(v).toLocaleString(); };
  }
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      var dt = +(performance.now() - t0).toFixed(0);
      statusEl.textContent = 'rendered in ' + dt.toLocaleString() + ' ms';
      try { window.parent.postMessage({ type: 'render-time', tool: ${JSON.stringify(opts.tool)}, ms: dt }, '*'); } catch (_) {}
    });
  });
</script></body></html>`;
  fs.writeFileSync(outPath, html);
}

// ---------------------------------------------------------------------------
// Article HTML
// ---------------------------------------------------------------------------

function emitArticle(outPath, repoStat, megaStat) {
  // Per-section three-card grid. gp-treemap on the left, labeled "Ours",
  // and queued first.
  function card(tool, libLabel, tag, isOurs) {
    const file = 'comparison/' + tool + '.html';
    const oursBadge = isOurs ? ' <span class="ours">Ours</span>' : '';
    const tagHtml = tag ? ` <span class="tag">${tag}</span>` : '';
    return `<div class="card">` +
      `<div class="label">${libLabel}${oursBadge}${tagHtml}<a class="open" href="${file}" target="_blank">open \u2197</a></div>` +
      `<iframe data-src="${file}" data-tool="${tool}"></iframe>` +
      `<div class="counter" data-state="queued"><span class="label" data-label-for="${tool}">queued</span><span class="val" data-time-for="${tool}">\u2014</span></div>` +
      `</div>`;
  }
  function renderGrid(suffix) {
    return `<div class="grid">
  ${card('gptm-' + suffix, 'gp-treemap', 'canvas', true)}
  ${card('plotly-' + suffix, 'Plotly.js', 'treemap', false)}
  ${card('d3-' + suffix, 'D3', 'd3-hierarchy + SVG', false)}
</div>`;
  }
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Treemap libraries compared \xb7 gp-treemap</title>
<style>
  :root { --bg:#1a1b26; --surface:#16161e; --border:#2a2b3a; --fg:#c0caf5;
    --muted:#787c99; --accent:#7aa2f7; --warn:#e0af68; }
  html,body { margin:0; padding:0; background:var(--bg); color:var(--fg);
    font: 15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 28px; margin: 16px 0 8px; }
  h2 { font-size: 19px; margin: 32px 0 8px; border-top: 1px solid var(--border); padding-top: 24px; }
  h3 { font-size: 14px; margin: 16px 0 6px; color: var(--muted); font-weight:600;
    text-transform: uppercase; letter-spacing: .04em; }
  p { margin: 8px 0; }
  a { color: var(--accent); }
  .lede { color: var(--muted); font-size: 16px; }
  .grid { display: grid; gap: 12px; grid-template-columns: 1fr; margin: 14px 0 0; }
  @media (min-width: 880px) { .grid { grid-template-columns: 1fr 1fr 1fr; } }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    overflow: hidden; display: flex; flex-direction: column; }
  .card .label { padding: 6px 10px; font-size: 12px; font-weight: 600;
    color: var(--fg); background: #0f0f14; border-bottom: 1px solid var(--border);
    display:flex; gap:8px; align-items:center; }
  .card .label .tag { color: var(--muted); font-weight: 400; }
  .card iframe { width: 100%; border: 0; height: 360px; background:#0a0a10; }
  .card .open { margin-left:auto; font-size:11px; color: var(--accent); text-decoration: none; }
  .card .ours { background: var(--accent); color: #0a0a10; padding: 1px 6px;
    border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: .04em; }
  .card .counter { padding: 6px 10px; font-size: 12px; color: var(--muted);
    background: #0a0a10; border-top: 1px solid var(--border);
    font-family: ui-monospace,SF Mono,Menlo,monospace; font-variant-numeric: tabular-nums;
    display: flex; align-items: center; gap: 8px; }
  .card .counter .label { color: var(--muted); }
  .card .counter[data-state="running"] .label { color: var(--accent); }
  .card .counter .val { margin-left: auto; color: var(--muted); }
  .card .counter[data-state="running"] .val { color: var(--fg); }
  .card .counter[data-state="done"] .val { color: var(--accent); font-weight: 600; }
  .card .counter[data-state="failed"] .val { color: var(--warn); font-weight: 600; }
  .card .counter[data-state="running"] .label::before {
    content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 6px;
    border-radius: 50%; background: var(--accent); vertical-align: middle;
    animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
  .note { background: var(--surface); border-left: 3px solid var(--warn); padding: 10px 14px;
    border-radius: 4px; margin: 12px 0; font-size: 14px; color: var(--fg); }
  .note b { color: var(--warn); }
  ul { padding-left: 22px; }
  li { margin: 4px 0; }
  code, kbd { background: #0f0f14; color: var(--fg); padding: 1px 5px; border-radius: 3px;
    font-size: 12px; font-family: ui-monospace,SF Mono,Menlo,monospace; }
  .nav { color: var(--muted); font-size: 13px; margin-bottom: 4px; }
  .nav a { color: var(--muted); }
</style>
</head>
<body>
<main>
<div class="nav"><a href="./index.html">\u2190 gallery</a></div>
<h1>Three treemap libraries, side by side</h1>
<p class="lede">
  Same data, three renderers: <a href="https://plotly.com/javascript/treemaps/">Plotly.js</a>,
  <a href="https://d3js.org/d3-hierarchy/treemap">D3</a>, and
  <a href="https://github.com/imbue-ai/gp-treemap">gp-treemap</a>.
  Each section walks the same canonical hierarchy and translates it into
  whatever each library wants (labels/parents/values arrays for Plotly
  and gp-treemap; a nested object for D3). No re-walking, no separate
  data pipelines \u2014 just three different renderings.
</p>
<p class="lede" style="margin-top: 12px;">
  Up front: <b>we love Plotly</b>. It's our go-to for everything else,
  and its treemap defaults are some of the nicest out of the box. This
  comparison is about scale, not quality.
</p>

<h2>1. A 24-row toy dataset</h2>
<p>
  Coffee-shop sales by region \u2192 category \u2192 product. Tiny enough that
  every library renders comfortably; useful as a baseline for visual
  style and default behavior.
</p>
${renderGrid('toy')}

<h3>What's different at this scale</h3>
<ul>
  <li><b>Plotly</b> ships click-to-zoom and a path bar by default. Each
    node \u2014 leaf <i>and</i> parent \u2014 gets its own bordered rect with a
    label, so you can hover or click any level of the hierarchy.</li>
  <li><b>D3</b> is a layout primitive, not a widget \u2014 you draw the rects
    yourself. The version here uses <code>paddingTop</code> for parent
    label gutters, hover tooltips, and depth-shaded colors; out of the
    box it's just a layout function and an empty <code>&lt;svg&gt;</code>.</li>
  <li><b>gp-treemap</b> renders the
    <a href="https://grandperspectiv.sourceforge.net/">GrandPerspective</a>
    raised-tile shading on a single canvas. Cell shading shows the tree
    structure without label gutters, so the data gets every pixel.</li>
</ul>

<p class="note">
  <b>The gp-treemap tradeoff:</b> only nodes with their own pixel area
  get an explicit rect. Interior nodes (folders, categories) don't get
  a separate "container" rect or a top-strip label \u2014 their boundary
  is implied by the seam-and-shading between children. That means
  there's no parent rect to click on. Instead, gp-treemap surfaces
  parents through the <b>breadcrumb at the bottom</b>: hover or click
  any leaf and the full ancestor path lights up, with the stats bar
  showing each ancestor's aggregate. Click a breadcrumb segment to
  focus that ancestor; double-click to zoom to it. (Outside an iframe
  the mouse wheel also walks the focus up and down the ancestor chain
  \u2014 try the full-page versions linked above.)
</p>
<p class="note">
  <b>Their tradeoff in return:</b> every parent strip Plotly and D3
  reserve for a label is pixels that <i>came out of that parent's
  area</i>. The children inside still fill the rectangle, but the
  rectangle itself is smaller than the parent's true share of the
  total. The distortion compounds with depth \u2014 at five levels of
  nesting, a leaf's visible area can be noticeably smaller than its
  proportional value. gp-treemap doesn't reserve gutters, so cell
  area is exactly proportional to leaf size all the way down.
</p>

<h2>2. Disk usage of this repo</h2>
<p>
  ${repoStat.nodeCount.toLocaleString()} files and folders,
  ${humanBytes(repoStat.totalBytes)} total \u2014 including <code>.git</code>,
  which dominates by byte count. Same hierarchy in all three frames.
</p>
${renderGrid('repo')}

<h3>Why the gap widens</h3>
<ul>
  <li><b>Plotly</b> creates an SVG node per rect plus per label, and
    runs a per-text-layout pass on initial render and on every zoom.
    The cost grows linearly but the per-node constant is high.
    Above ~10k nodes interaction starts to feel sluggish; above ~100k
    it can stall the tab.</li>
  <li><b>D3</b>'s layout itself is fast, but bare-SVG rendering bogs
    the DOM as the rect count climbs \u2014 thousands of
    <code>&lt;rect&gt;</code> + <code>&lt;text&gt;</code> elements add up.
    Workarounds (Canvas, WebGL, virtualized SVG) exist, but they're
    your code to write.</li>
  <li><b>gp-treemap</b> draws every cell with a per-pixel raised-tile
    painter into a single <code>&lt;canvas&gt;</code>. Paint cost scales
    with pixels, not nodes \u2014 8M files render in under a second.</li>
</ul>

<h2>3. A ${megaStat.nodeCount.toLocaleString()}-node dataset</h2>
<p>
  California city-government wages, 2024
  (<a href="https://publicpay.ca.gov/Reports/RawExport.aspx">Government Compensation in California</a>),
  rolled up by department \u2192 county \u2192 employer \u2192 position \u2192 individual
  row. ${megaStat.rowCount.toLocaleString()} rows, ${megaStat.nodeCount.toLocaleString()}
  tree nodes \u2014 an order of magnitude bigger than the repo above.
</p>
${renderGrid('mega')}
<p class="note">
  At this scale the divergence is dramatic: Plotly and D3 may take tens
  of seconds, freeze, or fail to load at all; gp-treemap renders the
  whole tree in well under a second.
</p>

<h2>Takeaways</h2>
<ul>
  <li><b>Plotly</b> is the right choice for a small treemap embedded in
    a dashboard with the rest of the Plotly toolkit \u2014 great defaults,
    interactive out of the box, but not suited to large hierarchies.</li>
  <li><b>D3</b> is the right choice when you want the layout primitive
    and full control of the render surface. Plan to write your own
    rendering if you need more than a few thousand cells.</li>
  <li><b>gp-treemap</b> is the right choice when the tree is large
    (thousands to millions of nodes) and you want
    <a href="https://grandperspectiv.sourceforge.net/">GrandPerspective</a>-style
    shading. It's a Web Component \u2014 drop it in, hand it labels/parents/values,
    done.</li>
</ul>

<p style="color:var(--muted); font-size:12px; margin-top:32px;">
  Render times are measured live in your browser \u2014 each iframe reports
  back when its first paint completes. Regenerate everything with
  <code>node scripts/build-comparison.mjs</code>.
</p>
</main>
<script>
// Always start at the top so the toy section renders first \u2014 otherwise
// a reload that restores the user to the bottom of the page would gate
// the queue on the mega iframes (the only ones visible) and the user
// would see a long pause before anything appears.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

// Serialize iframe loads so each renders in isolation (concurrent loads
// distort timing). Each iframe gets a live wall-clock counter beneath it
// that ticks while rendering and freezes when the iframe reports back.
// Only kick off an iframe once it has scrolled into the viewport \u2014
// browsers throttle rAF in offscreen frames and the timing inflates.
(function () {
  var queue = Array.prototype.slice.call(document.querySelectorAll('iframe[data-src]'));
  function valFor(tool) { return document.querySelector('[data-time-for="' + tool + '"]'); }
  function labelFor(tool) { return document.querySelector('[data-label-for="' + tool + '"]'); }
  function counterFor(tool) { return document.querySelector('[data-time-for="' + tool + '"]').parentElement; }

  var inflight = null, inflightT0 = 0, inflightVal = null, inflightLabel = null, inflightCounter = null;
  var tickHandle = 0;
  var timeoutHandle = null;
  var visible = new Set();

  function tick() {
    if (!inflight) return;
    var dt = Math.round(performance.now() - inflightT0);
    if (inflightVal) inflightVal.textContent = dt.toLocaleString() + ' ms';
  }

  function pump() {
    if (inflight || queue.length === 0) return;
    var i = 0;
    for (; i < queue.length; i++) if (visible.has(queue[i])) break;
    if (i === queue.length) return;
    inflight = queue.splice(i, 1)[0];
    var tool = inflight.dataset.tool;
    inflightVal = valFor(tool);
    inflightLabel = labelFor(tool);
    inflightCounter = counterFor(tool);
    if (inflightCounter) inflightCounter.dataset.state = 'running';
    if (inflightLabel) inflightLabel.textContent = 'rendering';
    if (inflightVal) inflightVal.textContent = '0 ms';
    inflightT0 = performance.now();
    inflight.src = inflight.dataset.src;
    tickHandle = setInterval(tick, 50);
    timeoutHandle = setTimeout(function () {
      if (!inflight) return;
      clearInterval(tickHandle);
      if (inflightCounter) inflightCounter.dataset.state = 'failed';
      if (inflightLabel) inflightLabel.textContent = 'timed out';
      if (inflightVal) inflightVal.textContent = '\u2014';
      inflight = null;
      pump();
    }, 60000);
  }

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'render-time' || !e.data.tool) return;
    if (!inflight || inflight.dataset.tool !== e.data.tool) return;
    clearInterval(tickHandle);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (e.data.error) {
      if (inflightCounter) inflightCounter.dataset.state = 'failed';
      if (inflightLabel) inflightLabel.textContent = 'failed';
      if (inflightVal) inflightVal.textContent = '\u2014';
    } else {
      var dt = Math.round(performance.now() - inflightT0);
      if (inflightCounter) inflightCounter.dataset.state = 'done';
      if (inflightLabel) inflightLabel.textContent = 'rendered in';
      if (inflightVal) inflightVal.textContent = dt.toLocaleString() + ' ms';
    }
    inflight = null;
    pump();
  });
  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting) visible.add(entries[i].target);
    }
    pump();
  }, { rootMargin: '0px' });
  for (var j = 0; j < queue.length; j++) io.observe(queue[j]);
})();
</script>
</body></html>`;
  fs.writeFileSync(outPath, html);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(BUNDLE_PATH)) {
    console.error('bundle missing at ' + BUNDLE_PATH + '; run `node tools/build.js` first');
    process.exit(1);
  }

  console.log('toy hierarchy\u2026');
  const toy = buildToy();
  console.log('  ' + toy.labels.length + ' nodes');
  emitPlotly(path.join(OUT_DIR, 'plotly-toy.html'), 'Coffee-shop sales (toy)', toy, { tool: 'plotly-toy' });
  emitD3(path.join(OUT_DIR, 'd3-toy.html'), 'Coffee-shop sales (toy)', toy, { tool: 'd3-toy' });
  emitGptm(path.join(OUT_DIR, 'gptm-toy.html'), 'Coffee-shop sales (toy)', toy, { tool: 'gptm-toy' });

  console.log('walking repo (.git included)\u2026');
  const repo = walkRepo(ROOT);
  const repoTotal = subtreeSums(repo)[0];
  console.log('  ' + repo.labels.length.toLocaleString() + ' nodes,', humanBytes(repoTotal), 'total');
  emitPlotly(path.join(OUT_DIR, 'plotly-repo.html'), 'gp-treemap repo on disk', repo, { tool: 'plotly-repo' });
  emitD3(path.join(OUT_DIR, 'd3-repo.html'), 'gp-treemap repo on disk', repo, { tool: 'd3-repo' });
  emitGptm(path.join(OUT_DIR, 'gptm-repo.html'), 'gp-treemap repo on disk', repo, { tool: 'gptm-repo' });

  console.log('loading CA city wages CSV\u2026');
  const megaZip = path.join(ROOT, 'samples', 'data', 'table', 'ca-raw', '2024_City.zip');
  // Cap at 100k rows so the embedded HTML stays under ~30 MB and the
  // plotly/d3 versions actually attempt a render rather than OOM-ing.
  const mega = loadCaCity(megaZip, { maxRows: 100000 });
  emitPlotly(path.join(OUT_DIR, 'plotly-mega.html'), 'CA city wages 2024 (mega)', mega, { tool: 'plotly-mega' });
  emitD3(path.join(OUT_DIR, 'd3-mega.html'), 'CA city wages 2024 (mega)', mega, { tool: 'd3-mega' });
  emitGptm(path.join(OUT_DIR, 'gptm-mega.html'), 'CA city wages 2024 (mega)', mega, { tool: 'gptm-mega' });

  emitArticle(path.join(ROOT, 'gallery', 'comparison.html'),
    { nodeCount: repo.labels.length, totalBytes: repoTotal },
    { nodeCount: mega.labels.length, rowCount: 100000 });

  console.log('done.');
}

main();
