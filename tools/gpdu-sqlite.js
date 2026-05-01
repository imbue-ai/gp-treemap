#!/usr/bin/env node
// Visualize a SQLite database as a treemap.
//
// Hierarchy: db → <table-or-view-or-trigger> → [<column-1>, ..., <index-1>, ...].
// Tables drill into per-column byte estimates and per-index totals; views and
// triggers appear as 0-byte leaves alongside.
//
// Per-column sizes are estimated by sampling rows and applying SQLite's
// serial-type encoding rules JS-side. With --include-row-elements-for-all-columns
// every (row, column) cell becomes a leaf — slow on big DBs.
//
// Usage:
//   node tools/gpdu-sqlite.js [--no-open] [--color=kind|parent-table|value-type]
//                             [--sample-rows=N] [--include-row-elements-for-all-columns]
//                             [--block-size=N] <db.sqlite> [output.html]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import { BUNDLE } from '../dist/gp-treemap.bundle.embed.js';
import { partitionBlocks, encodeBlock, humanBytes, escapeHtml, LOADER_JS } from './scan-core.js';

const COLOR_MODES = ['kind', 'parent-table', 'value-type'];
const CATEGORICAL_MODES = ['kind', 'parent-table', 'value-type'];
const QUANTITATIVE_MODES = [];

function usage(exitCode) {
  console.error(
    'Usage: node tools/gpdu-sqlite.js [--no-open] [--color=' + COLOR_MODES.join('|') + ']\n' +
    '                                 [--sample-rows=N] [--include-row-elements-for-all-columns]\n' +
    '                                 [--block-size=N] <db.sqlite> [output.html]'
  );
  process.exit(exitCode);
}

async function main() {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  let colorBy = 'kind';
  let blockSize = 500000;
  let sampleRows = 10000;
  let includeRowElements = false;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') continue;
    if (a === '-h' || a === '--help') usage(0);
    if (a.startsWith('--block-size=')) { blockSize = Number(a.split('=')[1]) || 500000; continue; }
    if (a.startsWith('--sample-rows=')) { sampleRows = Math.max(1, Number(a.split('=')[1]) || 10000); continue; }
    if (a === '--include-row-elements-for-all-columns') { includeRowElements = true; continue; }
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
    : path.join(os.tmpdir(), 'gpdu-sqlite-' + inputBasename.replace(/[^a-zA-Z0-9._-]/g, '_') + '-' + Date.now() + '.html');

  // Lazy-import better-sqlite3 (it's an optionalDependency).
  let Database;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch (_) {
    console.error('gpdu-sqlite: better-sqlite3 not installed.\nInstall with: npm install better-sqlite3');
    process.exit(1);
  }

  let db;
  try {
    db = new Database(inputPath, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error('gpdu-sqlite: cannot open ' + inputPath + ': ' + e.message);
    process.exit(1);
  }

  // Sanity-check it's a sqlite database (would have thrown above if it weren't,
  // but check for common error message anyway).
  try { db.prepare('SELECT 1').get(); }
  catch (e) {
    console.error("gpdu-sqlite: '" + inputPath + "' is not a sqlite database (" + e.message + ')');
    process.exit(1);
  }

  const t0 = Date.now();
  const scan = buildScan(db, sampleRows, includeRowElements);
  const elapsed = Date.now() - t0;
  db.close();

  buildHtml(out, inputPath, scan, colorBy, blockSize);

  console.log('');
  console.log('analyzed ' + inputPath);
  console.log('  tables       ' + scan.counts.table.toLocaleString());
  console.log('  indices      ' + scan.counts.index.toLocaleString());
  console.log('  columns      ' + scan.counts.column.toLocaleString());
  if (scan.counts.row > 0) console.log('  row cells    ' + scan.counts.row.toLocaleString());
  console.log('  total bytes  ' + humanBytes(scan.totalBytes) + '  (' + scan.totalBytes.toLocaleString() + ' B)');
  console.log('  took         ' + elapsed + ' ms');
  console.log('');
  console.log('wrote ' + out + '  (' + humanBytes(fs.statSync(out).size) + ')');

  if (!noOpen) {
    const { execSync } = await import('node:child_process');
    const openCmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { execSync(openCmd + ' ' + JSON.stringify(out)); } catch { console.log('open it with:  open "' + out + '"'); }
  }
}

// ---------------------------------------------------------------------------
// Schema introspection + dbstat aggregation + per-column byte estimation
// ---------------------------------------------------------------------------

// Bytes a SQLite value would occupy in a record, per the serial-type encoding.
//   https://www.sqlite.org/fileformat.html#record_format
//
// Keep this in sync with tests/gpdu-sqlite.spec.js, which exercises every
// branch.
export function serialBytes(value) {
  if (value == null) return 0;                                    // NULL → serial type 0 (0 bytes)
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      if (value === 0 || value === 1) return 0;                   // serial types 8, 9 → no payload
      const a = Math.abs(value);
      if (a < 128)              return 1;                          // serial type 1
      if (a < 32768)            return 2;                          // serial type 2
      if (a < 8388608)          return 3;                          // serial type 3
      if (a < 2147483648)       return 4;                          // serial type 4
      if (a < 140737488355328)  return 6;                          // serial type 5 (48-bit)
      return 8;                                                    // serial type 6 (64-bit)
    }
    return 8;                                                      // serial type 7 (float)
  }
  if (typeof value === 'bigint') return 8;
  if (typeof value === 'boolean') return 0;                       // 0/1 → no payload
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.length;
  return 0;
}

function buildScan(db, sampleRows, includeRowElements) {
  const labels = [];
  const parentIndices = [];
  const values = [];
  const kinds = [];        // categorical: db / table / view / trigger / column / index / row / leftover
  const parentTables = []; // categorical: which table this node belongs to (or '(none)')
  const valueTypes = [];   // categorical: text / int / real / blob / mixed / null / (n/a)
  const counts = { table: 0, view: 0, trigger: 0, index: 0, column: 0, row: 0, leftover: 0, db: 0 };

  function add(label, parentIdx, value, kind, parentTable, valueType) {
    const idx = labels.length;
    labels.push(label);
    parentIndices.push(parentIdx);
    values.push(value);
    kinds.push(kind);
    parentTables.push(parentTable || '(none)');
    valueTypes.push(valueType || '(n/a)');
    if (counts[kind] != null) counts[kind]++;
    return idx;
  }

  const ROOT = add('database', -1, 0, 'db', '(none)', '(n/a)');

  // dbstat aggregates: bytes per top-level master entity (table / index).
  // dbstat columns are name / path / pageno / pagetype / ncell / payload /
  // unused / mx_payload / pgoffset / pgsize. We sum `payload` (actual data
  // bytes used; excludes free space within pages and overflow chains —
  // overflow content is reflected by additional dbstat rows for the chain
  // pages, so summing payload across all rows for a name gives the true
  // on-disk record total).
  const dbstatRows = (() => {
    try {
      return db.prepare('SELECT name, payload FROM dbstat').all();
    } catch (e) {
      // dbstat not compiled in — fall back to zero sizes everywhere.
      return [];
    }
  })();
  const dbstatTotalsByName = new Map();
  for (const r of dbstatRows) {
    const v = r.payload || 0;
    dbstatTotalsByName.set(r.name, (dbstatTotalsByName.get(r.name) || 0) + v);
  }

  // Iterate sqlite_master to discover tables/views/triggers/indices.
  const masterRows = db.prepare(
    "SELECT type, name, tbl_name FROM sqlite_master ORDER BY type, name"
  ).all();
  const tables = masterRows.filter(r => r.type === 'table');
  const views = masterRows.filter(r => r.type === 'view');
  const triggers = masterRows.filter(r => r.type === 'trigger');
  const indices = masterRows.filter(r => r.type === 'index');

  // Group indices by parent table.
  const indicesByTable = new Map();
  for (const ix of indices) {
    if (!indicesByTable.has(ix.tbl_name)) indicesByTable.set(ix.tbl_name, []);
    indicesByTable.get(ix.tbl_name).push(ix);
  }

  // Tables with their columns + indices, grouped under synthetic "Columns"
  // and "Indices" buckets so the treemap visually groups them. Buckets are
  // skipped when there's nothing to put in them.
  for (const t of tables) {
    const tableBytes = dbstatTotalsByName.get(t.name) || 0;
    const tableIdx = add(t.name, ROOT, 0, 'table', t.name, '(n/a)');

    let cols = [];
    try { cols = db.pragma('table_info(' + JSON.stringify(t.name) + ')'); }
    catch (e) { cols = []; }

    const colNames = cols.map(c => c.name);
    const tIxs = indicesByTable.get(t.name) || [];

    // ---- Columns bucket ----
    if (colNames.length > 0) {
      const colsBucketIdx = add('Columns', tableIdx, 0, 'bucket', t.name, '(n/a)');

      // Estimate per-column bytes by sampling.
      let perColBytes = new Array(colNames.length).fill(0);
      let perColType = new Array(colNames.length).fill('(n/a)');
      let rowsScanned = 0, totalRows = 0;
      try { totalRows = db.prepare('SELECT COUNT(*) AS n FROM ' + qIdent(t.name)).get().n; }
      catch (e) { totalRows = 0; }

      const sampleN = includeRowElements ? totalRows : Math.min(sampleRows, totalRows);
      if (sampleN > 0) {
        // Pick the first sampleN rows for determinism. (For very-large tables
        // a random TABLESAMPLE-style approach would be more accurate, but
        // this is simple and enough for visualization.)
        const cols_q = colNames.map(qIdent).join(', ');
        const rowidColumn = pickRowidLabelColumn(cols);
        const stmt = db.prepare('SELECT ' + (rowidColumn ? qIdent(rowidColumn) + ' AS __rowid_label, ' : 'rowid AS __rowid_label, ') + cols_q + ' FROM ' + qIdent(t.name) + ' LIMIT ?');

        // Track per-column type observations to label `value-type` color attr.
        const seen = new Array(colNames.length).fill(null).map(() => new Set());

        // For row-element mode, collect per-row per-column bytes.
        let perRowPerCol = null;
        let rowLabels = null;
        if (includeRowElements) {
          perRowPerCol = new Array(sampleN);
          rowLabels = new Array(sampleN);
        }

        let i = 0;
        for (const row of stmt.iterate(sampleN)) {
          if (includeRowElements) {
            rowLabels[i] = '#' + (row.__rowid_label != null ? row.__rowid_label : (i + 1));
            perRowPerCol[i] = new Array(colNames.length);
          }
          for (let c = 0; c < colNames.length; c++) {
            const v = row[colNames[c]];
            const b = serialBytes(v);
            perColBytes[c] += b;
            seen[c].add(typeofSqlite(v));
            if (includeRowElements) perRowPerCol[i][c] = b;
          }
          i++;
        }
        rowsScanned = i;

        // Scale up if we sampled (not full scan).
        if (!includeRowElements && rowsScanned > 0 && rowsScanned < totalRows) {
          const k = totalRows / rowsScanned;
          for (let c = 0; c < perColBytes.length; c++) perColBytes[c] = Math.round(perColBytes[c] * k);
        }

        // Resolve per-column dominant value type.
        for (let c = 0; c < colNames.length; c++) {
          const types = [...seen[c]];
          if (types.length === 0) perColType[c] = '(n/a)';
          else if (types.length === 1) perColType[c] = types[0];
          else perColType[c] = 'mixed';
        }

        // One column entry per column, plus per-row leaves under each column
        // when --include-row-elements-for-all-columns is on.
        for (let c = 0; c < colNames.length; c++) {
          if (includeRowElements && rowsScanned > 0) {
            const colIdx = add(colNames[c], colsBucketIdx, 0, 'column', t.name, perColType[c]);
            for (let r = 0; r < rowsScanned; r++) {
              const lb = rowLabels[r];
              add(lb, colIdx, perRowPerCol[r][c], 'row', t.name, perColType[c]);
            }
          } else {
            add(colNames[c], colsBucketIdx, perColBytes[c], 'column', t.name, perColType[c]);
          }
        }
      } else {
        // Empty table: still emit columns with zero bytes.
        for (let c = 0; c < colNames.length; c++) {
          add(colNames[c], colsBucketIdx, 0, 'column', t.name, '(n/a)');
        }
      }
    }

    // ---- Indices bucket ----
    if (tIxs.length > 0) {
      const ixBucketIdx = add('Indices', tableIdx, 0, 'bucket', t.name, '(n/a)');
      for (const ix of tIxs) {
        const ixBytes = dbstatTotalsByName.get(ix.name) || 0;
        add(ix.name, ixBucketIdx, ixBytes, 'index', t.name, '(n/a)');
      }
    }

    // Leftover for the table: dbstat-total - sum of buckets' aggregates.
    const childrenBytes = sumChildrenAggregates(parentIndices, values, kinds, tableIdx);
    if (tableBytes > childrenBytes) {
      add('(leftover)', tableIdx, tableBytes - childrenBytes, 'leftover', t.name, '(n/a)');
    }
  }

  // Indices that have no matching table in tables[] (extremely rare; defensive).
  const tableNameSet = new Set(tables.map(t => t.name));
  for (const ix of indices) {
    if (!tableNameSet.has(ix.tbl_name)) {
      const ixBytes = dbstatTotalsByName.get(ix.name) || 0;
      add(ix.name, ROOT, ixBytes, 'index', ix.tbl_name || '(orphan)', '(n/a)');
    }
  }

  // Views and triggers — 0-byte leaves alongside tables.
  for (const v of views) {
    add(v.name, ROOT, 0, 'view', v.name, '(n/a)');
    counts.view++;
  }
  for (const tr of triggers) {
    add(tr.name, ROOT, 0, 'trigger', tr.tbl_name || '(none)', '(n/a)');
    counts.trigger++;
  }

  // Total: from dbstat (sum of all entries we know about).
  let totalBytes = 0;
  for (const v of dbstatTotalsByName.values()) totalBytes += v;

  return { labels, parentIndices, values, kinds, parentTables, valueTypes, counts, totalBytes };
}

// Add up the (already-recorded) aggregated values of all immediate children
// of `parentIdx`. We use this to compute a table's leftover after columns +
// indices are inserted.
function sumChildrenAggregates(parentIndices, values, kinds, parentIdx) {
  // The aggregated value of an internal node we add here is recorded as 0
  // (kinds === 'column' with row children would store 0 — only the row leaves
  // carry bytes). So sum descendant leaves' values directly.
  let sum = 0;
  // childIds for parentIdx so far — we only need the direct children we just
  // emitted, but their subtree may include row leaves. Walk the slice.
  for (let i = parentIdx + 1; i < parentIndices.length; i++) {
    if (parentIndices[i] === parentIdx) {
      // Sum this child's subtree.
      sum += subtreeSum(parentIndices, values, i);
    }
  }
  return sum;
}
function subtreeSum(parentIndices, values, root) {
  let s = values[root] || 0;
  for (let i = root + 1; i < parentIndices.length; i++) {
    // Walk only descendants of root.
    let p = parentIndices[i];
    while (p > root) p = parentIndices[p];
    if (p === root) s += values[i];
  }
  return s;
}

function pickRowidLabelColumn(cols) {
  // Pick a column with pk != 0 and INTEGER PRIMARY KEY; otherwise the first
  // pk column. If no PK, return null (we'll use rowid).
  const pks = cols.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk);
  if (pks.length > 0) return pks[0].name;
  return null;
}

function typeofSqlite(v) {
  if (v == null) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'real';
  if (typeof v === 'bigint') return 'int';
  if (typeof v === 'string') return 'text';
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return 'blob';
  return 'other';
}

function qIdent(name) {
  // Double-quote identifier; double internal quotes.
  return '"' + String(name).replace(/"/g, '""') + '"';
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

const KIND_COLORMAP = {
  db:       'hsl(220, 10%, 25%)',
  table:    'hsl(211, 70%, 52%)',  // blue
  view:     'hsl(188, 70%, 48%)',  // cyan
  trigger:  'hsl(26,  85%, 55%)',  // orange
  bucket:   'hsl(220, 10%, 30%)',  // dark slate (for synthetic Columns/Indices)
  column:   'hsl(138, 55%, 45%)',  // green
  index:    'hsl(348, 70%, 50%)',  // red
  row:      'hsl(48,  85%, 55%)',  // yellow
  leftover: 'hsl(220, 10%, 35%)',
};

const HELP_HTML = `
<h2>gp-treemap &mdash; SQLite</h2>
<p>Cell area is database bytes. Each table drills into per-column byte
  estimates and per-index totals. Tables, views, and triggers sit at the
  top level; views and triggers have no storage and appear as 0-byte
  cells.</p>
<h3>Numbers</h3>
<p>Per-column byte estimates apply SQLite's serial-type encoding rules
  to a sample of rows (<code>--sample-rows=N</code>, default 10 000) and
  scale up by row count. This is approximate. Pass
  <code>--include-row-elements-for-all-columns</code> for an exact count
  — at the cost of a full table scan plus an additional level under each
  column showing per-row cells.</p>
<h3>Color modes</h3>
<ul>
  <li><b>kind</b>: db / table / view / trigger / column / index / row /
    leftover — each gets its own hue.</li>
  <li><b>parent-table</b>: every distinct table gets a unique color; row
    cells inherit it.</li>
  <li><b>value-type</b>: text / int / real / blob / mixed — only
    meaningful at the column level (everything else is "(n/a)").</li>
</ul>
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

function buildHtml(outPath, inputPath, scan, colorBy, blockSize) {
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
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="title-row">
  <h1>${escapeHtml(inputPath)}</h1>
  <span class="stat"><b>${scan.counts.table.toLocaleString()}</b> tables</span>
  <span class="stat"><b>${scan.counts.index.toLocaleString()}</b> indices</span>
  <span class="stat"><b>${scan.counts.column.toLocaleString()}</b> columns</span>
  <span class="stat"><b>${humanBytes(scan.totalBytes)}</b> total</span>
  <span class="spacer" style="flex:1"></span>
  <button id="help-btn" class="help-btn" title="Help">?</button>
</div>
<div class="app-toolbar">
  <span>color
    <select id="color-sel">
      <option value="kind">kind</option>
      <option value="parent-table">parent table</option>
      <option value="value-type">value type</option>
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
  <span id="scanned-note">analyzed ${escapeHtml(when)}</span>
</div>

<script type="application/json" id="tmdata">
`);

  const normScan = {
    labels: scan.labels,
    parentIndices: scan.parentIndices,
    values: scan.values,
    attributes: {
      kind:           { kind: 'categorical', values: scan.kinds },
      'parent-table': { kind: 'categorical', values: scan.parentTables },
      'value-type':   { kind: 'categorical', values: scan.valueTypes },
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
    var c = { tables: 0, indices: 0, columns: 0, rows: 0, bytes: 0 };
    var stack = [nodeId];
    while (stack.length) {
      var id = stack.pop();
      var n = store.get(id);
      if (!n) continue;
      var k = n.kind;
      if (k === 'table') c.tables++;
      else if (k === 'index') c.indices++;
      else if (k === 'column') c.columns++;
      else if (k === 'row') c.rows++;
      if (n.childIds && n.childIds.length > 0) {
        for (var i = 0; i < n.childIds.length; i++) stack.push(n.childIds[i]);
      } else {
        c.bytes += n.value || 0;
      }
    }
    return c;
  }
  function update() {
    var id = tm._focusId != null ? tm._focusId : tm._targetId != null ? tm._targetId : tm._tree ? tm._tree.roots[0] : null;
    if (id == null) { bar.textContent = ''; return; }
    var nd = store.get(id);
    if (!nd) { bar.textContent = ''; return; }
    var s = subtreeStats(id);
    var parts = [];
    if (s.tables > 0)  parts.push(s.tables.toLocaleString() + ' table' + (s.tables !== 1 ? 's' : ''));
    if (s.indices > 0) parts.push(s.indices.toLocaleString() + ' ' + (s.indices !== 1 ? 'indices' : 'index'));
    if (s.columns > 0) parts.push(s.columns.toLocaleString() + ' column' + (s.columns !== 1 ? 's' : ''));
    if (s.rows > 0)    parts.push(s.rows.toLocaleString() + ' row' + (s.rows !== 1 ? 's' : ''));
    parts.push(fmtBytes(nd.value || 0));
    if (nd.kind === 'column' && nd['value-type'] && nd['value-type'] !== '(n/a)') {
      parts.push('type: ' + nd['value-type']);
    } else if (nd.kind && nd.kind !== 'db') {
      parts.push('kind: ' + nd.kind);
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

// Run main() only when this file is the entry point — not when imported as
// a module by tests for the serialBytes helper.
if (import.meta.url === url.pathToFileURL(process.argv[1] || '').href) {
  main();
}
