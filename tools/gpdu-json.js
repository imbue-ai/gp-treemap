#!/usr/bin/env node
// Visualize a JSON5 file as a treemap. Each cell's area is the byte size of
// that node's serialized form in the source file. Comments and structural
// punctuation (braces, brackets, commas, whitespace) are accounted for via
// a synthetic "(leftover)" leaf at every internal node, so the tree's total
// reconciles to the exact source file byte count.
//
// Usage:
//   node tools/gpdu-json.js [--no-open] [--color=type|depth|key]
//                           [--min-bytes=N] [--max-array-children=N]
//                           [--block-size=N] <input.json5> [output.html]
//
// Accepts JSON5: comments, trailing commas, unquoted keys, single-quoted
// strings. Whatever @babel/parser parses, we render — no grammar enforcement.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { parseExpression } from '@babel/parser';
import { BUNDLE } from '../dist/gp-treemap.bundle.embed.js';
import { partitionBlocks, encodeBlock, humanBytes, escapeHtml, LOADER_JS } from './scan-core.js';
import { buildCliCommand, COPY_BTN_HTML, COPY_BTN_CSS, copyButtonScript } from './cli-command.js';

const COLOR_MODES = ['type', 'depth', 'key'];
const CATEGORICAL_MODES = ['type', 'key'];
const QUANTITATIVE_MODES = ['depth'];

function usage(exitCode) {
  console.error(
    'Usage: node tools/gpdu-json.js [--no-open] [--color=' + COLOR_MODES.join('|') + ']\n' +
    '                               [--min-bytes=N] [--max-array-children=N]\n' +
    '                               [--block-size=N] <input.json5> [output.html]'
  );
  process.exit(exitCode);
}

async function main() {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  let colorBy = 'type';
  let blockSize = 500000;
  let minBytes = 0;
  let maxArrayChildren = Infinity;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') continue;
    if (a === '-h' || a === '--help') usage(0);
    if (a.startsWith('--block-size=')) { blockSize = Number(a.split('=')[1]) || 500000; continue; }
    if (a.startsWith('--min-bytes=')) { minBytes = Math.max(0, Number(a.split('=')[1]) || 0); continue; }
    if (a.startsWith('--max-array-children=')) {
      const v = Number(a.split('=')[1]);
      maxArrayChildren = (Number.isFinite(v) && v > 0) ? v : Infinity;
      continue;
    }
    if (a === '--color' || a === '--color-by') {
      colorBy = argv[++i];
      if (!COLOR_MODES.includes(colorBy)) {
        console.error('Unknown --color mode: ' + colorBy + '\nValid modes: ' + COLOR_MODES.join(', '));
        process.exit(2);
      }
      continue;
    }
    if (a.startsWith('--color=') || a.startsWith('--color-by=')) {
      colorBy = a.split('=')[1];
      if (!COLOR_MODES.includes(colorBy)) {
        console.error('Unknown --color mode: ' + colorBy + '\nValid modes: ' + COLOR_MODES.join(', '));
        process.exit(2);
      }
      continue;
    }
    args.push(a);
  }
  if (args.length < 1) usage(2);

  const inputPath = path.resolve(args[0]);
  const inputBasename = path.basename(args[0]);
  const out = args[1]
    ? path.resolve(args[1])
    : path.join(os.tmpdir(), 'gpdu-json-' + inputBasename.replace(/[^a-zA-Z0-9._-]/g, '_') + '-' + Date.now() + '.html');

  let source;
  try { source = fs.readFileSync(inputPath, 'utf8'); }
  catch (e) { console.error('cannot read ' + inputPath + ': ' + e.message); process.exit(1); }

  // Parse with @babel/parser. Accept whatever parses cleanly.
  let ast;
  try {
    ast = parseExpression(source, {
      sourceType: 'module',
      ranges: false,
      tokens: false,
      errorRecovery: false,
    });
  } catch (e) {
    if (e && e.loc) {
      console.error('gpdu-json: parse error at line ' + e.loc.line + ', column ' + e.loc.column + ': ' + (e.reasonCode || e.message));
    } else {
      console.error('gpdu-json: parse error: ' + (e && e.message));
    }
    process.exit(1);
  }

  process.stderr.write('  parsed ' + humanBytes(source.length) + '\n');

  const t0 = Date.now();
  const scan = buildScan(source, ast, inputBasename, minBytes, maxArrayChildren);
  const elapsed = Date.now() - t0;

  buildHtml(out, inputPath, source, scan, colorBy, blockSize);

  console.log('');
  console.log('parsed ' + inputPath);
  console.log('  source size  ' + humanBytes(source.length) + '  (' + source.length.toLocaleString() + ' B)');
  console.log('  objects      ' + scan.counts.object.toLocaleString());
  console.log('  arrays       ' + scan.counts.array.toLocaleString());
  console.log('  strings      ' + scan.counts.string.toLocaleString());
  console.log('  numbers      ' + scan.counts.number.toLocaleString());
  console.log('  booleans     ' + scan.counts.boolean.toLocaleString());
  console.log('  nulls        ' + scan.counts.null.toLocaleString());
  console.log('  leftovers    ' + scan.counts.leftover.toLocaleString());
  console.log('  parse took   ' + elapsed + ' ms');
  console.log('');
  console.log('wrote ' + out + '  (' + humanBytes(fs.statSync(out).size) + ')');

  if (!noOpen) {
    const { execSync } = await import('node:child_process');
    const openCmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { execSync(openCmd + ' ' + JSON.stringify(out)); } catch { console.log('open it with:  open "' + out + '"'); }
  }
}

// ---------------------------------------------------------------------------
// AST → flat scan arrays
// ---------------------------------------------------------------------------

function keyName(prop) {
  const k = prop.key;
  if (!k) return '?';
  if (k.type === 'Identifier') return k.name;
  if (k.type === 'StringLiteral') return k.value;
  if (k.type === 'NumericLiteral') return String(k.value);
  if (k.type === 'Literal') return String(k.value);
  return '?';
}

function scalarType(node) {
  if (!node) return 'null';
  switch (node.type) {
    case 'StringLiteral':  return 'string';
    case 'NumericLiteral': return 'number';
    case 'BooleanLiteral': return 'boolean';
    case 'NullLiteral':    return 'null';
    case 'UnaryExpression': return 'number';   // -1 etc.
    case 'Identifier':     return 'string';     // Infinity / NaN / undefined
    case 'TemplateLiteral': return 'string';
    case 'BigIntLiteral': return 'number';
    default: return 'other';
  }
}

function buildScan(source, ast, fileLabel, minBytes, maxArrayChildren) {
  const labels = [];
  const parentIndices = [];
  const values = [];
  const types = [];     // categorical: object/array/string/number/boolean/null/leftover/file
  const keys = [];      // categorical: key name (or [N] for arrays, '(root)' for top, '(leftover)' / '[…M more]' for synthesized)
  const depths = [];    // numeric
  const counts = { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0, leftover: 0, file: 0, other: 0 };

  // Synthesize a file-level root so the tree total reconciles to source.length.
  labels.push(fileLabel);
  parentIndices.push(-1);
  values.push(0);
  types.push('file');
  keys.push('(root)');
  depths.push(0);
  counts.file++;
  const ROOT = 0;

  // Walk the AST, returning the byte-span attributed to the walked node
  // (= span of its node in source, or 0 if pruned-and-rolled-up).
  function walk(node, parentIdx, label, depth) {
    if (!node) return 0;
    const span = node.end - node.start;

    if (node.type === 'ObjectExpression') {
      const idx = labels.length;
      labels.push(label);
      parentIndices.push(parentIdx);
      values.push(0);
      types.push('object');
      keys.push(label);
      depths.push(depth);
      counts.object++;

      let childSpanSum = 0;
      for (const prop of node.properties) {
        // Skip non-property entries (spread, methods etc. we treat liberally).
        if (!prop || !prop.value) {
          // Treat as a leaf with the property's span.
          const propSpan = (prop.end || 0) - (prop.start || 0);
          if (propSpan > minBytes) {
            const lbl = prop.key ? keyName(prop) : '?';
            labels.push(lbl);
            parentIndices.push(idx);
            values.push(propSpan);
            types.push('other');
            keys.push(lbl);
            depths.push(depth + 1);
            counts.other++;
            childSpanSum += propSpan;
          }
          continue;
        }
        const childLabel = keyName(prop);
        const used = walk(prop.value, idx, childLabel, depth + 1);
        childSpanSum += used;
      }
      addLeftover(idx, span - childSpanSum, depth + 1);
      return span;
    }

    if (node.type === 'ArrayExpression') {
      const idx = labels.length;
      labels.push(label);
      parentIndices.push(parentIdx);
      values.push(0);
      types.push('array');
      keys.push(label);
      depths.push(depth);
      counts.array++;

      const elements = node.elements || [];
      const cap = Math.min(elements.length, maxArrayChildren);
      let childSpanSum = 0;
      for (let i = 0; i < cap; i++) {
        const el = elements[i];
        if (!el) continue;  // sparse array hole
        const used = walk(el, idx, '[' + i + ']', depth + 1);
        childSpanSum += used;
      }
      // Roll up the rest into a single "[…M more]" leaf.
      if (elements.length > cap) {
        let restSpan = 0;
        for (let i = cap; i < elements.length; i++) {
          const el = elements[i];
          if (el) restSpan += el.end - el.start;
        }
        const restLabel = '[\u2026' + (elements.length - cap) + ' more]';
        labels.push(restLabel);
        parentIndices.push(idx);
        values.push(restSpan);
        types.push('array');
        keys.push(restLabel);
        depths.push(depth + 1);
        counts.array++;
        childSpanSum += restSpan;
      }
      addLeftover(idx, span - childSpanSum, depth + 1);
      return span;
    }

    // Scalar leaf.
    if (span <= minBytes) return 0; // pruned: roll up into parent's leftover budget
    const t = scalarType(node);
    labels.push(label);
    parentIndices.push(parentIdx);
    values.push(span);
    types.push(t);
    keys.push(label);
    depths.push(depth);
    counts[t] = (counts[t] || 0) + 1;
    return span;
  }

  function addLeftover(parentIdx, bytes, depth) {
    if (bytes <= 0) return;
    labels.push('(leftover)');
    parentIndices.push(parentIdx);
    values.push(bytes);
    types.push('leftover');
    keys.push('(leftover)');
    depths.push(depth);
    counts.leftover++;
  }

  // Walk the parsed expression as the root's only "real" child.
  const exprSpan = walk(ast, ROOT, '(value)', 1);
  // Add a leftover for any source bytes outside the expression (leading /
  // trailing whitespace, comments at file level, BOM, ...).
  addLeftover(ROOT, source.length - exprSpan, 1);

  return { labels, parentIndices, values, types, keys, depths, counts, totalBytes: source.length };
}

// ---------------------------------------------------------------------------
// HTML
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
  viridis: 'Viridis', plasma: 'Plasma', inferno: 'Inferno', magma: 'Magma',
  turbo: 'Turbo', heatmap: 'Heatmap', coolwarm: 'Cool\u2013Warm', rainbow: 'Rainbow',
  'gp-default': 'Default 8-hue',
};

const TYPE_COLORMAP = {
  object:   'hsl(211, 70%, 52%)',  // blue
  array:    'hsl(48,  85%, 55%)',  // yellow
  string:   'hsl(138, 55%, 45%)',  // green
  number:   'hsl(300, 55%, 55%)',  // magenta
  boolean:  'hsl(26,  85%, 55%)',  // orange
  null:     'hsl(0,    0%, 55%)',  // gray
  leftover: 'hsl(220, 10%, 35%)',  // dark slate
  file:     'hsl(220, 10%, 25%)',  // very dark slate (root)
  other:    'hsl(0,   60%, 50%)',  // red (unexpected node types)
};

const HELP_HTML = `
<h2>gp-treemap &mdash; JSON5</h2>
<p>Cell area is the byte size of that node's serialized form in the
  source file. Internal nodes (objects and arrays) carry a synthetic
  <code>(leftover)</code> leaf at the end that absorbs bytes not accounted
  for by the real children — punctuation, whitespace, comments — so the
  tree's total reconciles to the source file size exactly.</p>
<h3>Color modes</h3>
<ul>
  <li><b>type</b>: object / array / string / number / boolean / null /
    <code>leftover</code> — each gets its own hue.</li>
  <li><b>depth</b>: quantitative — shallower nodes are darker, deeper
    nodes lighter (Viridis).</li>
  <li><b>key</b>: categorical hash by key name — every distinct key gets
    a unique color, so repeating keys stand out.</li>
</ul>
<h3>Mouse</h3>
<ul>
  <li><b>Hover</b>: see full path + size in the tooltip.</li>
  <li><b>Click</b> a cell: select it; the breadcrumb lights up.</li>
  <li><b>Scroll wheel</b> while a cell is selected: walk focus up and
    down the ancestor chain.</li>
  <li><b>Double-click</b> a cell: zoom into it.</li>
</ul>
<h3>URL</h3>
<p>All state (zoom / focus / theme / palette / depth) is serialized into
  the URL hash as a single JSON blob, so you can copy a link to any view.</p>
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

function buildHtml(outPath, inputPath, source, scan, colorBy, blockSize) {
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

  w(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>treemap \xb7 ${escapeHtml(inputPath)}</title>
<style>${PAGE_CSS}${COPY_BTN_CSS}</style>
</head>
<body>
<div class="title-row">
  ${COPY_BTN_HTML}
  <h1>${escapeHtml(inputPath)}</h1>
  <span class="stat"><b>${humanBytes(source.length)}</b> source</span>
  <span class="stat"><b>${scan.counts.object.toLocaleString()}</b> objects</span>
  <span class="stat"><b>${scan.counts.array.toLocaleString()}</b> arrays</span>
  <span class="stat"><b>${(scan.counts.string + scan.counts.number + scan.counts.boolean + scan.counts.null).toLocaleString()}</b> primitives</span>
  <span class="spacer" style="flex:1"></span>
  <button id="help-btn" class="help-btn" title="Help">?</button>
</div>
<div class="app-toolbar">
  <span>color
    <select id="color-sel">
      <option value="type">type</option>
      <option value="depth">depth</option>
      <option value="key">key</option>
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
  <span id="scanned-note">parsed ${escapeHtml(when)}</span>
</div>

<script type="application/json" id="tmdata">
`);

  const normScan = {
    labels: scan.labels,
    parentIndices: scan.parentIndices,
    values: scan.values,
    attributes: {
      type:  { kind: 'categorical', values: scan.types },
      key:   { kind: 'categorical', values: scan.keys },
      depth: { kind: 'numeric',     values: scan.depths },
    },
  };

  const { blocks, aggValue } = partitionBlocks(normScan, blockSize);
  process.stderr.write('  partitioned into ' + blocks.length + ' blocks\n');

  w('{"v":3,"totalBytes":' + scan.totalBytes + ',"blocks":[');
  for (let bi = 0; bi < blocks.length; bi++) {
    const blockJson = JSON.stringify(encodeBlock(normScan, blocks[bi], { aggValue }));
    const compressed = zlib.deflateRawSync(blockJson, { level: 6 });
    if (bi > 0) w(',');
    w('"' + compressed.toString('base64') + '"');
  }
  w(']}');

  const cfg = {
    defaultColorMode: colorBy,
    categoricalModes: CATEGORICAL_MODES,
    quantitativeModes: QUANTITATIVE_MODES,
    catColorMaps: { type: TYPE_COLORMAP },
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
${copyButtonScript(buildCliCommand('gpdu-json'))}
<\/script>
<script>
// Stats bar: per-focused-node counts of objects / arrays / primitives.
window._bootReady.then(function () {
  var tm = document.getElementById('tm');
  var bar = document.getElementById('stats-bar');
  var store = window._store;
  var totalBytes = ${scan.totalBytes};
  function fmtBytes(v) {
    var units = ['B','KB','MB','GB','TB','PB']; var i = 0, n = v || 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
  }
  function subtreeStats(nodeId) {
    var c = { object: 0, array: 0, primitive: 0, leftover: 0, bytes: 0 };
    var stack = [nodeId];
    while (stack.length) {
      var id = stack.pop();
      var n = store.get(id);
      if (!n) continue;
      var t = n.type;
      if (t === 'object') c.object++;
      else if (t === 'array') c.array++;
      else if (t === 'leftover') { c.leftover++; c.bytes += n.value || 0; }
      else if (t === 'file') {/* skip */}
      else { c.primitive++; c.bytes += n.value || 0; }
      if (n.childIds && n.childIds.length > 0) {
        for (var k = 0; k < n.childIds.length; k++) stack.push(n.childIds[k]);
      } else {
        if (t !== 'leftover' && t !== 'file' && t !== 'object' && t !== 'array') c.bytes += 0;  // already counted
      }
    }
    return c;
  }
  function update() {
    var id = tm._focusId != null ? tm._focusId : tm._targetId != null ? tm._targetId : tm._tree ? tm._tree.roots[0] : null;
    if (id == null) { bar.textContent = ''; return; }
    var nd = store.get(id);
    if (!nd) { bar.textContent = ''; return; }
    var parts = [];
    var s = subtreeStats(id);
    if (s.object > 0) parts.push(s.object.toLocaleString() + ' object' + (s.object !== 1 ? 's' : ''));
    if (s.array > 0)  parts.push(s.array.toLocaleString() + ' array' + (s.array !== 1 ? 's' : ''));
    if (s.primitive > 0) parts.push(s.primitive.toLocaleString() + ' primitive' + (s.primitive !== 1 ? 's' : ''));
    if (s.leftover > 0) parts.push(s.leftover.toLocaleString() + ' leftover');
    parts.push(fmtBytes(nd.value || 0));
    if (nd.type && nd.type !== 'file' && nd.type !== 'object' && nd.type !== 'array') {
      parts.push('type: ' + nd.type);
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
