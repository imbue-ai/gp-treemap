#!/usr/bin/env node
// Visualize an S3 bucket / prefix as a treemap. Recursively enumerates
// every object via ListObjectsV2 (or ListObjectVersions if --include-versions),
// fans out by `Delimiter=/` so each sub-prefix can be walked in parallel.
//
// Worker pool is an async Promise pool on the main thread (S3 is I/O-bound;
// real worker threads buy nothing).
//
// Usage:
//   node tools/gpdu-s3.js [--no-open] [--color=extension|storage-class|last-modified]
//                         [--workers=N] [--region=REGION] [--no-sign-request]
//                         [--include-versions] [--block-size=N]
//                         <s3://bucket[/prefix]> [<s3://...>...] [output.html]
//
// Auth via the default AWS credential chain (env, ~/.aws/credentials, IAM
// role, ...). `--no-sign-request` skips signing for public buckets.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import { BUNDLE } from '../dist/gp-treemap.bundle.embed.js';
import { partitionBlocks, encodeBlock, humanBytes, escapeHtml, LOADER_JS } from './scan-core.js';
import { buildCliCommand, COPY_BTN_HTML, COPY_BTN_CSS, copyButtonScript } from './cli-command.js';

const COLOR_MODES = ['extension', 'storage-class', 'last-modified'];
const CATEGORICAL_MODES = ['extension', 'storage-class'];
const QUANTITATIVE_MODES = ['last-modified'];

function usage(exitCode) {
  console.error(
    'Usage: node tools/gpdu-s3.js [--no-open] [--color=' + COLOR_MODES.join('|') + ']\n' +
    '                             [--workers=N] [--region=REGION] [--no-sign-request]\n' +
    '                             [--include-versions] [--block-size=N]\n' +
    '                             <s3://bucket[/prefix]> [<s3://...>...] [output.html]'
  );
  process.exit(exitCode);
}

async function main() {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  let colorBy = 'extension';
  let blockSize = 500000;
  let workers = 16;
  let region;
  let noSign = false;
  let includeVersions = false;
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') continue;
    if (a === '-h' || a === '--help') usage(0);
    if (a === '--no-sign-request') { noSign = true; continue; }
    if (a === '--include-versions') { includeVersions = true; continue; }
    if (a.startsWith('--block-size=')) { blockSize = Number(a.split('=')[1]) || 500000; continue; }
    if (a.startsWith('--workers=')) { workers = Math.max(1, Number(a.split('=')[1]) || 16); continue; }
    if (a.startsWith('--region=')) { region = a.split('=')[1]; continue; }
    if (a === '--region') { region = argv[++i]; continue; }
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
    positionals.push(a);
  }

  // Last positional is treated as output path if it doesn't look like an
  // s3:// URI; everything before it is treated as input URIs.
  let outArg = null;
  const inputs = [];
  for (const p of positionals) {
    if (p.startsWith('s3://')) inputs.push(p);
    else outArg = p;  // last non-s3 positional wins
  }
  if (inputs.length === 0) usage(2);

  const inputSlug = inputs.map(s => s.replace(/^s3:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_')).join('+').slice(0, 80);
  const out = outArg
    ? path.resolve(outArg)
    : path.join(os.tmpdir(), 'gpdu-s3-' + inputSlug + '-' + Date.now() + '.html');

  // Lazy import @aws-sdk/client-s3 (it's an optionalDependency).
  let S3Client, ListObjectsV2Command, ListObjectVersionsCommand;
  try {
    const sdk = await import('@aws-sdk/client-s3');
    S3Client = sdk.S3Client;
    ListObjectsV2Command = sdk.ListObjectsV2Command;
    ListObjectVersionsCommand = sdk.ListObjectVersionsCommand;
  } catch (_) {
    console.error('gpdu-s3: @aws-sdk/client-s3 not installed.\nInstall with: npm install @aws-sdk/client-s3');
    process.exit(1);
  }

  // followRegionRedirects: when the bucket is in a different region than
  // the configured client (common with public buckets — e.g. commoncrawl
  // is us-east-1 but a us-west-2 user gets a PermanentRedirect 301
  // otherwise), auto-redirect instead of hard-failing.
  const clientOpts = { followRegionRedirects: true };
  if (region) clientOpts.region = region;
  if (noSign) {
    // Anonymous mode: stub-credentials provider so SigV4 signs with empty
    // access-key/secret. The SDK still attempts to sign; some endpoints
    // reject empty credentials. The recommended SDK incantation for this
    // is to set `signer` to a no-op, but that's an internal API — using
    // an empty-credentials provider works for the common public-bucket
    // case (s3.us-east-1.amazonaws.com etc.).
    clientOpts.credentials = async () => ({ accessKeyId: '', secretAccessKey: '' });
    clientOpts.signer = { sign: async (req) => req };
  }
  const s3 = new S3Client(clientOpts);

  const t0 = Date.now();
  let scan;
  try {
    scan = await scanBuckets(s3, ListObjectsV2Command, ListObjectVersionsCommand, inputs, workers, includeVersions);
  } catch (e) {
    if (e && (e.name === 'NoSuchBucket' || e.Code === 'NoSuchBucket')) {
      console.error('gpdu-s3: ' + (e.name || e.Code) + ': ' + (e.message || 'bucket does not exist'));
      process.exit(1);
    }
    if (e && (e.name === 'AccessDenied' || e.Code === 'AccessDenied')) {
      console.error('gpdu-s3: ' + (e.name || e.Code) + ': ' + (e.message || 'access denied'));
      process.exit(1);
    }
    throw e;
  }
  const elapsed = Date.now() - t0;

  buildHtml(out, inputs, scan, colorBy, blockSize, includeVersions);

  console.log('');
  console.log('scanned ' + inputs.join(', '));
  console.log('  objects      ' + scan.counts.object.toLocaleString());
  console.log('  prefixes     ' + scan.counts.prefix.toLocaleString());
  console.log('  total bytes  ' + humanBytes(scan.totalBytes) + '  (' + scan.totalBytes.toLocaleString() + ' B)');
  if (includeVersions) console.log('  (all versions included)');
  console.log('  scan took    ' + elapsed + ' ms');
  console.log('');
  console.log('wrote ' + out + '  (' + humanBytes(fs.statSync(out).size) + ')');

  if (!noOpen) {
    const { execSync } = await import('node:child_process');
    const openCmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { execSync(openCmd + ' ' + JSON.stringify(out)); } catch { console.log('open it with:  open "' + out + '"'); }
  }
}

// ---------------------------------------------------------------------------
// Walker — async Promise pool, prefix-fanout via Delimiter='/'
// ---------------------------------------------------------------------------

function parseS3Uri(uri) {
  const m = /^s3:\/\/([^/]+)(?:\/(.*))?$/.exec(uri);
  if (!m) throw new Error('not an s3:// URI: ' + uri);
  return { Bucket: m[1], Prefix: m[2] || '' };
}

async function scanBuckets(s3, ListObjectsV2Command, ListObjectVersionsCommand, uris, workers, includeVersions) {
  const labels = [];
  const parentIndices = [];
  const values = [];
  const exts = [];
  const storageClasses = [];
  const lastModified = [];
  const kinds = [];  // 'root', 'bucket', 'prefix', 'object'
  const counts = { object: 0, prefix: 0, bucket: 0 };
  let totalBytes = 0;

  function add(label, parentIdx, value, ext, storage, mtime, kind) {
    const idx = labels.length;
    labels.push(label);
    parentIndices.push(parentIdx);
    values.push(value);
    exts.push(ext);
    storageClasses.push(storage);
    lastModified.push(mtime);
    kinds.push(kind);
    if (counts[kind] != null) counts[kind]++;
    return idx;
  }

  // Synthetic root spanning all input URIs (so multi-arg invocations get a
  // single tree).
  const rootLabel = uris.length === 1 ? uris[0] : '(' + uris.length + ' inputs)';
  const ROOT = add(rootLabel, -1, 0, '', '', 0, 'root');

  // For each URI, build the bucket+initial-prefix node and fan out.
  const queue = [];
  for (const uri of uris) {
    const { Bucket, Prefix } = parseS3Uri(uri);
    let parent = ROOT;
    if (uris.length > 1) {
      parent = add(uri, ROOT, 0, '', '', 0, 'bucket');
    }
    // Walk from the given prefix.
    queue.push({ Bucket, Prefix, parentIdx: parent });
  }

  let lastPrint = 0;
  function printProgress() {
    const now = Date.now();
    if (now - lastPrint < 150) return;
    lastPrint = now;
    process.stderr.write(
      '\r  ' + counts.object.toLocaleString() + ' objects   ' +
      counts.prefix.toLocaleString() + ' prefixes   ' + humanBytes(totalBytes) + '          '
    );
  }

  // Async Promise pool. Each task expands one prefix; prefixes discovered
  // within get pushed back onto the queue for other workers.
  let active = 0;
  await new Promise((resolve, reject) => {
    function tryDispatch() {
      while (active < workers && queue.length > 0) {
        const task = queue.shift();
        active++;
        runTask(task).then(() => {
          active--;
          tryDispatch();
          if (active === 0 && queue.length === 0) resolve();
        }).catch(reject);
      }
      if (active === 0 && queue.length === 0) resolve();
    }

    async function runTask({ Bucket, Prefix, parentIdx }) {
      let ContinuationToken, KeyMarker, VersionIdMarker;
      while (true) {
        let resp;
        if (includeVersions) {
          const cmd = new ListObjectVersionsCommand({
            Bucket, Prefix, Delimiter: '/', KeyMarker, VersionIdMarker,
          });
          resp = await s3.send(cmd);
        } else {
          const cmd = new ListObjectsV2Command({
            Bucket, Prefix, Delimiter: '/', ContinuationToken,
          });
          resp = await s3.send(cmd);
        }

        // Sub-prefixes → enqueue.
        for (const cp of (resp.CommonPrefixes || [])) {
          const subPrefix = cp.Prefix;
          if (!subPrefix || subPrefix === Prefix) continue;
          const localName = subPrefix.slice(Prefix.length).replace(/\/$/, '');
          const subIdx = add(localName, parentIdx, 0, '', '', 0, 'prefix');
          queue.push({ Bucket, Prefix: subPrefix, parentIdx: subIdx });
        }

        // Objects (or versions) → leaves.
        const items = includeVersions
          ? [].concat(resp.Versions || [], resp.DeleteMarkers || [])
          : (resp.Contents || []);
        for (const obj of items) {
          if (!obj.Key) continue;
          if (obj.Key === Prefix) continue; // skip directory-marker objects
          const localKey = obj.Key.slice(Prefix.length);
          const size = obj.Size || 0;
          const sc = obj.StorageClass || 'STANDARD';
          const mt = obj.LastModified ? new Date(obj.LastModified).getTime() : 0;
          let label = localKey;
          if (includeVersions && obj.VersionId && obj.VersionId !== 'null') {
            label = localKey + ' @' + obj.VersionId.slice(0, 6);
          }
          add(label, parentIdx, size, rawExt(localKey), sc, mt, 'object');
          totalBytes += size;
        }
        printProgress();

        // Pagination.
        if (includeVersions) {
          if (!resp.IsTruncated) break;
          KeyMarker = resp.NextKeyMarker;
          VersionIdMarker = resp.NextVersionIdMarker;
        } else {
          if (!resp.IsTruncated) break;
          ContinuationToken = resp.NextContinuationToken;
        }
      }
    }

    tryDispatch();
  });

  process.stderr.write('\r' + ' '.repeat(72) + '\r');

  return {
    labels, parentIndices, values, exts, storageClasses, lastModified, kinds,
    counts, totalBytes,
  };
}

function rawExt(key) {
  const slash = key.lastIndexOf('/');
  const tail = slash >= 0 ? key.slice(slash + 1) : key;
  const dot = tail.lastIndexOf('.');
  return dot > 0 ? tail.slice(dot + 1).toLowerCase() : '(none)';
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

const STORAGE_COLORMAP = {
  STANDARD:            'hsl(211, 70%, 52%)',
  STANDARD_IA:         'hsl(48,  85%, 55%)',
  ONEZONE_IA:          'hsl(26,  85%, 55%)',
  INTELLIGENT_TIERING: 'hsl(138, 55%, 45%)',
  GLACIER:             'hsl(188, 70%, 48%)',
  GLACIER_IR:          'hsl(264, 55%, 58%)',
  DEEP_ARCHIVE:        'hsl(220, 10%, 35%)',
  REDUCED_REDUNDANCY:  'hsl(0,    0%, 55%)',
  OUTPOSTS:            'hsl(348, 70%, 50%)',
};

const HELP_HTML = `
<h2>gp-treemap &mdash; S3</h2>
<p>Cell area is the size in bytes of each S3 object. The tree mirrors the
  bucket's key hierarchy as if "/" were a path separator (synthesized from
  S3's <code>CommonPrefixes</code> response).</p>
<h3>Color modes</h3>
<ul>
  <li><b>extension</b>: lowercased file extension; categorically hashed.</li>
  <li><b>storage class</b>: STANDARD / IA / GLACIER / etc., each with a
    distinct hue.</li>
  <li><b>last modified</b>: quantitative — older objects are darker, recent
    ones lighter.</li>
</ul>
<h3>Mouse</h3>
<ul>
  <li><b>Hover</b>: see full key + size in the tooltip.</li>
  <li><b>Click</b> a cell: select it; the breadcrumb lights up.</li>
  <li><b>Scroll wheel</b> while a cell is selected: walk focus up and down
    the prefix chain.</li>
  <li><b>Double-click</b> a cell: zoom into it.</li>
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

function buildHtml(outPath, inputs, scan, colorBy, blockSize, includeVersions) {
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

  const titleStr = inputs.length === 1 ? inputs[0] : '(' + inputs.length + ' inputs)';

  w(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>treemap \xb7 ${escapeHtml(titleStr)}</title>
<style>${PAGE_CSS}${COPY_BTN_CSS}</style>
</head>
<body>
<div class="title-row">
  ${COPY_BTN_HTML}
  <h1>${escapeHtml(titleStr)}</h1>
  <span class="stat"><b>${scan.counts.object.toLocaleString()}</b> objects</span>
  <span class="stat"><b>${scan.counts.prefix.toLocaleString()}</b> "folders"</span>
  <span class="stat"><b>${humanBytes(scan.totalBytes)}</b> total</span>
  ${includeVersions ? '<span class="stat">(all versions)</span>' : ''}
  <span class="spacer" style="flex:1"></span>
  <button id="help-btn" class="help-btn" title="Help">?</button>
</div>
<div class="app-toolbar">
  <span>color
    <select id="color-sel">
      <option value="extension">extension</option>
      <option value="storage-class">storage class</option>
      <option value="last-modified">last modified</option>
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

  const normScan = {
    labels: scan.labels,
    parentIndices: scan.parentIndices,
    values: scan.values,
    attributes: {
      extension:       { kind: 'categorical', values: scan.exts },
      'storage-class': { kind: 'categorical', values: scan.storageClasses },
      'last-modified': { kind: 'numeric',     values: scan.lastModified },
      kind:            { kind: 'categorical', values: scan.kinds },
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
    catColorMaps: { 'storage-class': STORAGE_COLORMAP },
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
${copyButtonScript(buildCliCommand('gpdu-s3'))}
<\/script>
<script>
window._bootReady.then(function () {
  var tm = document.getElementById('tm');
  var bar = document.getElementById('stats-bar');
  var store = window._store;
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
    var c = { object: 0, prefix: 0, bytes: 0 };
    var stack = [nodeId];
    while (stack.length) {
      var id = stack.pop();
      var n = store.get(id);
      if (!n) continue;
      var k = n.kind;
      if (k === 'object') { c.object++; c.bytes += n.value || 0; }
      else if (k === 'prefix') c.prefix++;
      if (n.childIds && n.childIds.length > 0) {
        for (var i = 0; i < n.childIds.length; i++) stack.push(n.childIds[i]);
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
    if (s.object > 0) parts.push(s.object.toLocaleString() + ' object' + (s.object !== 1 ? 's' : ''));
    if (s.prefix > 0) parts.push(s.prefix.toLocaleString() + ' "folder' + (s.prefix !== 1 ? 's"' : '"'));
    parts.push(fmtBytes(s.bytes || nd.value || 0));
    if (nd.kind === 'object') {
      parts.push('class: ' + (nd['storage-class'] || ''));
      if (nd['last-modified']) parts.push('modified: ' + fmtDate(nd['last-modified']));
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

if (isEntryPoint(import.meta.url)) {
  main();
}

function isEntryPoint(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    const real = fs.realpathSync(process.argv[1]);
    return metaUrl === url.pathToFileURL(real).href;
  } catch {
    return metaUrl === url.pathToFileURL(process.argv[1]).href;
  }
}
