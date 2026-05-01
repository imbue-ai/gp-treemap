// gpdu-s3-inventory.js — S3 Inventory parquet → treemap.
//
// Tests the math: total bytes preserved through the full pipeline
// (DuckDB pass 1 + pass 2 + Node tree-build + post-build pruning), and
// the parent.value === sum(child.value) invariant at every node.
//
// Generates synthetic parquet fixtures via DuckDB so we don't need an
// in-tree parquet writer dependency. Skips automatically if `duckdb` is
// not on PATH — same posture as the tool itself.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'gpdu-s3-inventory.js');

const duckPath = (() => {
  const r = spawnSync('which', ['duckdb'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
})();

// ---- Helpers ----

// Write rows to a parquet file via DuckDB. `rows` is an array of objects
// with keys: key, size, last_modified_date (ISO string), storage_class.
// Schema mirrors S3 Inventory's columns the tool reads.
function writeParquetFixture(parquetPath, rows) {
  const csvPath = parquetPath.replace(/\.parquet$/, '.input.csv');
  const lines = ['key,size,last_modified_date,storage_class'];
  for (const r of rows) {
    const k = (r.key === null || r.key === undefined) ? '' : String(r.key).replace(/"/g, '""');
    const lm = r.last_modified_date || '2024-01-01 00:00:00';
    const sc = r.storage_class || 'STANDARD';
    lines.push(`"${k}",${r.size},${lm},${sc}`);
  }
  fs.writeFileSync(csvPath, lines.join('\n') + '\n');
  const sql = `COPY (SELECT key, size, CAST(last_modified_date AS TIMESTAMP) AS last_modified_date, storage_class
                    FROM read_csv_auto('${csvPath.replace(/'/g, "''")}'))
              TO '${parquetPath.replace(/'/g, "''")}' (FORMAT 'PARQUET');`;
  const r = spawnSync('duckdb', ['-c', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('duckdb parquet-write failed: ' + r.stderr);
}

function writeManifest(manifestPath, parquetPath) {
  // Keys in manifest.files[].key are interpreted relative to the manifest's
  // directory when the manifest itself is local (per the tool's loader).
  const m = {
    sourceBucket: 'test-bucket',
    destinationBucket: 'arn:aws:s3:::test-inventory',
    fileFormat: 'Parquet',
    files: [{ key: path.basename(parquetPath), size: fs.statSync(parquetPath).size }],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));
}

function runTool(manifestPath, outPath, extra = []) {
  return spawnSync(process.execPath, [TOOL, '--no-open', ...extra, manifestPath, outPath], {
    encoding: 'utf8', timeout: 120000,
  });
}

// Decode the first block of the embedded envelope and return the flat
// scan arrays, plus the envelope's totalBytes header.
function parseScanHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script type="application\/json" id="tmdata">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('tmdata script tag not found');
  const envelope = JSON.parse(m[1]);
  const compressed = Buffer.from(envelope.blocks[0], 'base64');
  const raw = JSON.parse(zlib.inflateRawSync(compressed).toString());
  const piBuf = Buffer.from(raw.piB64, 'base64');
  const parentIndices = Array.from(new Int32Array(piBuf.buffer, piBuf.byteOffset, piBuf.byteLength / 4));
  function decodeCat(attr) {
    const buf = Buffer.from(attr.b64, 'base64');
    const idx = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
    return Array.from(idx).map((i) => attr.names[i]);
  }
  function decodeNum(attr) {
    const buf = Buffer.from(attr.b64, 'base64');
    return Array.from(new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8));
  }
  return {
    labels: raw.labels,
    values: raw.values,
    parentIndices,
    kinds: decodeCat(raw.attributes.kind),
    exts: decodeCat(raw.attributes.extension),
    storageClasses: decodeCat(raw.attributes['storage-class']),
    objectCounts: raw.attributes.objectCount ? decodeNum(raw.attributes.objectCount) : null,
    totalBytes: envelope.totalBytes,
  };
}

function buildChildIds(scan) {
  const n = scan.labels.length;
  const c = new Array(n);
  for (let i = 0; i < n; i++) c[i] = null;
  for (let i = 1; i < n; i++) {
    const p = scan.parentIndices[i];
    if (c[p] === null) c[p] = [];
    c[p].push(i);
  }
  return c;
}

function assertSumInvariant(scan) {
  const childIds = buildChildIds(scan);
  for (let i = 0; i < scan.labels.length; i++) {
    if (!childIds[i]) continue;
    let sum = 0;
    for (const c of childIds[i]) sum += scan.values[c];
    expect(scan.values[i], `node ${i} (${scan.labels[i]}) value vs children sum`).toBeCloseTo(sum, 6);
  }
}

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gpdu-s3-inv-test-')); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

// ---- The math invariants ----

test('total bytes preserved end-to-end (small bucket, no pruning)', () => {
  test.skip(!duckPath, 'duckdb not on PATH — skipping');
  const dir = tmpDir();
  try {
    const parquet = path.join(dir, 'data.parquet');
    const manifest = path.join(dir, 'manifest.json');
    const out = path.join(dir, 'out.html');
    const rows = [
      { key: 'a/b/c/file1.txt', size: 1000 },
      { key: 'a/b/c/file2.txt', size: 2000 },
      { key: 'a/d/file3.txt',   size: 3000 },
      { key: 'top.txt',          size: 4000 },
    ];
    writeParquetFixture(parquet, rows);
    writeManifest(manifest, parquet);

    const res = runTool(manifest, out, ['--min-fraction=0']);  // no pruning
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(out);

    const expectedTotal = rows.reduce((s, r) => s + r.size, 0);
    expect(scan.totalBytes).toBe(expectedTotal);
    expect(scan.values[0]).toBe(expectedTotal);
    assertSumInvariant(scan);
  } finally { cleanup(dir); }
});

test('parent.value === sum(child.value) at every node, with pruning + rollups', () => {
  test.skip(!duckPath, 'duckdb not on PATH — skipping');
  const dir = tmpDir();
  try {
    const parquet = path.join(dir, 'data.parquet');
    const manifest = path.join(dir, 'manifest.json');
    const out = path.join(dir, 'out.html');
    // Mix of big files (keep as leaves) and many small files (must roll up).
    const rows = [];
    rows.push({ key: 'big/giant.bin', size: 100000000 });   // 100 MB
    rows.push({ key: 'big/another.bin', size: 50000000 });  // 50 MB
    for (let i = 0; i < 200; i++) {
      rows.push({ key: 'small/' + i + '.txt', size: 100 + i });
    }
    for (let i = 0; i < 100; i++) {
      rows.push({ key: 'deep/a/b/c/d/e/f/g/' + i + '.bin', size: 50 });
    }
    writeParquetFixture(parquet, rows);
    writeManifest(manifest, parquet);

    // Threshold = 1% of total → small/ files roll up; big/ files kept.
    const res = runTool(manifest, out, ['--min-fraction=0.01', '--max-depth=4']);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(out);

    const expectedTotal = rows.reduce((s, r) => s + r.size, 0);
    expect(scan.totalBytes).toBe(expectedTotal);
    expect(scan.values[0]).toBe(expectedTotal);

    // Both big files appear as leaves, each at full path.
    expect(scan.labels).toContain('giant.bin');
    expect(scan.labels).toContain('another.bin');

    // Small files do NOT appear individually — they should be rolled up
    // into a "(N small)" leaf. Find it.
    const smallNames = scan.labels.filter((l) => l.match(/\(\d+ small\)/));
    expect(smallNames.length).toBeGreaterThan(0);

    // Sum invariant must hold across the whole tree.
    assertSumInvariant(scan);
  } finally { cleanup(dir); }
});

test('big leaves at deep paths are preserved verbatim, regardless of --max-depth', () => {
  test.skip(!duckPath, 'duckdb not on PATH — skipping');
  const dir = tmpDir();
  try {
    const parquet = path.join(dir, 'data.parquet');
    const manifest = path.join(dir, 'manifest.json');
    const out = path.join(dir, 'out.html');
    const rows = [
      // depth 9 — way past --max-depth=3, but big enough to keep as leaf
      { key: 'a/b/c/d/e/f/g/h/giant.bin', size: 1000000 },
      // small filler to scale total so threshold is below the giant
      ...Array.from({ length: 50 }, (_, i) => ({ key: 'fill/' + i + '.txt', size: 1 })),
    ];
    writeParquetFixture(parquet, rows);
    writeManifest(manifest, parquet);

    const res = runTool(manifest, out, ['--min-fraction=0.5', '--max-depth=3']);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(out);

    // Find the giant leaf and trace its ancestor chain — must be the full
    // depth-9 path even though --max-depth=3.
    const giantIdx = scan.labels.findIndex((l) => l === 'giant.bin');
    expect(giantIdx).toBeGreaterThan(0);
    expect(scan.values[giantIdx]).toBe(1000000);
    const path9 = [];
    let cur = giantIdx;
    while (cur > 0) {
      path9.unshift(scan.labels[cur]);
      cur = scan.parentIndices[cur];
    }
    // path9 = [a, b, c, d, e, f, g, h, giant.bin]
    expect(path9).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'giant.bin']);
  } finally { cleanup(dir); }
});

test('directory-marker objects (key ending with /) are accounted for', () => {
  test.skip(!duckPath, 'duckdb not on PATH — skipping');
  const dir = tmpDir();
  try {
    const parquet = path.join(dir, 'data.parquet');
    const manifest = path.join(dir, 'manifest.json');
    const out = path.join(dir, 'out.html');
    const rows = [
      { key: 'a/b/file.txt', size: 1000 },
      { key: 'a/b/',         size: 500 },  // directory marker
      { key: 'top.txt',      size: 200 },
    ];
    writeParquetFixture(parquet, rows);
    writeManifest(manifest, parquet);

    const res = runTool(manifest, out, ['--min-fraction=0']);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(out);

    // Total must include the dir-marker bytes.
    expect(scan.totalBytes).toBe(1700);
    expect(scan.values[0]).toBe(1700);
    assertSumInvariant(scan);

    // The dir-marker should be visible as its own leaf with a synthesized
    // label.
    const dmIdx = scan.labels.findIndex((l) => l.includes('dir marker'));
    expect(dmIdx).toBeGreaterThan(0);
    expect(scan.values[dmIdx]).toBe(500);
  } finally { cleanup(dir); }
});

test('big leaf nested deep inside a depth-truncated rollup is not double-counted', () => {
  test.skip(!duckPath, 'duckdb not on PATH — skipping');
  const dir = tmpDir();
  try {
    const parquet = path.join(dir, 'data.parquet');
    const manifest = path.join(dir, 'manifest.json');
    const out = path.join(dir, 'out.html');

    // Construct a fixture where:
    //   - One big file lives at depth 7 ("deep/a/b/c/d/e/giant.bin"),
    //     above the threshold so it's kept as a leaf.
    //   - 500 tiny files share various deeper prefixes ALSO under
    //     "deep/a/b/...", below the threshold so they're aggregated.
    //   - --max-depth=3 means small rollups truncate to depth 3.
    //
    // The big leaf must (a) appear once as a leaf at its full path, and
    // (b) NOT have its bytes also baked into any small rollup's value or
    // its objectCount baked into any rollup's count.
    const rows = [];
    rows.push({ key: 'deep/a/b/c/d/e/giant.bin', size: 10_000_000 });
    for (let i = 0; i < 500; i++) {
      // Small files at varying depths under deep/a/b/
      const subdir = i % 5 === 0 ? 'deep/a/b/c/d/'
                   : i % 5 === 1 ? 'deep/a/b/c/d/e/'
                   : i % 5 === 2 ? 'deep/a/b/c/'
                   : i % 5 === 3 ? 'deep/a/b/'
                                 : 'deep/a/b/c/d/e/f/';
      rows.push({ key: subdir + 'tiny-' + i + '.txt', size: 50 });
    }
    // Plus some unrelated content so threshold pruning doesn't degenerate.
    rows.push({ key: 'unrelated/file.bin', size: 5_000_000 });

    writeParquetFixture(parquet, rows);
    writeManifest(manifest, parquet);

    // 1% threshold ⇒ keep files >= ~250 KB. Only the two "big" files survive
    // as leaves; all 500 tiny files roll up.
    const res = runTool(manifest, out, ['--min-fraction=0.01', '--max-depth=3']);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(out);

    // ---- Bytes ----
    const expectedBytes = rows.reduce((s, r) => s + r.size, 0);
    expect(scan.totalBytes).toBe(expectedBytes);
    expect(scan.values[0]).toBe(expectedBytes);

    // ---- Object counts ----
    expect(scan.objectCounts).not.toBeNull();
    let totalObjs = 0;
    for (let i = 0; i < scan.kinds.length; i++) {
      if (scan.kinds[i] === 'object') totalObjs += scan.objectCounts[i];
    }
    expect(totalObjs).toBe(rows.length);  // 502 — every input row counted exactly once

    // ---- Big leaf is its own cell at the full deep path ----
    const giantIdx = scan.labels.findIndex((l) => l === 'giant.bin');
    expect(giantIdx).toBeGreaterThan(0);
    expect(scan.values[giantIdx]).toBe(10_000_000);
    expect(scan.objectCounts[giantIdx]).toBe(1);
    // Walk up: must reach root via a/b/c/d/e/deep, no rollup in between.
    const pathFromRoot = [];
    let cur = giantIdx;
    while (cur > 0) {
      pathFromRoot.unshift(scan.labels[cur]);
      cur = scan.parentIndices[cur];
    }
    expect(pathFromRoot).toEqual(['deep', 'a', 'b', 'c', 'd', 'e', 'giant.bin']);

    // ---- Sum-invariant must hold including the big leaf and the rollup
    // sharing an ancestor ("deep/a/b") ----
    assertSumInvariant(scan);

    // ---- The rollup's recorded bytes/count must be exactly the small-file
    // contributions, not including any of giant.bin or unrelated ----
    const childIds = buildChildIds(scan);
    // Locate "deep/a/b" — its children include the rollup leaf for tiny
    // files plus the prefix subtree containing giant.bin.
    const deepIdx = scan.labels.findIndex(
      (l, i) => l === 'deep' && scan.parentIndices[i] === 0);
    const aIdx = childIds[deepIdx].find(i => scan.labels[i] === 'a');
    const bIdx = childIds[aIdx].find(i => scan.labels[i] === 'b');
    expect(bIdx).toBeDefined();
    const bChildren = childIds[bIdx];
    const rollupChild = bChildren.find(i => /\(\d+ small\)/.test(scan.labels[i]));
    expect(rollupChild).toBeDefined();
    // Every tiny file contributes 50 bytes, count = 500.
    expect(scan.values[rollupChild]).toBe(500 * 50);
    expect(scan.objectCounts[rollupChild]).toBe(500);
  } finally { cleanup(dir); }
});

test('rollup leaves carry the underlying object count, not 1', () => {
  test.skip(!duckPath, 'duckdb not on PATH — skipping');
  const dir = tmpDir();
  try {
    const parquet = path.join(dir, 'data.parquet');
    const manifest = path.join(dir, 'manifest.json');
    const out = path.join(dir, 'out.html');
    const rows = [];
    rows.push({ key: 'big/giant.bin', size: 100000000 });   // 100 MB — kept as leaf
    // 250 small files in a single directory; should roll up into one
    // "(250 small)" leaf carrying objectCount=250.
    for (let i = 0; i < 250; i++) {
      rows.push({ key: 'mass/' + i + '.txt', size: 100 });
    }
    writeParquetFixture(parquet, rows);
    writeManifest(manifest, parquet);

    const res = runTool(manifest, out, ['--min-fraction=0.05', '--max-depth=4']);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(out);

    expect(scan.objectCounts).not.toBeNull();
    // Find the (250 small) rollup; its objectCount must be 250 (not 1).
    const rollupIdx = scan.labels.findIndex((l) => /\(250 small\)/.test(l));
    expect(rollupIdx).toBeGreaterThan(0);
    expect(scan.objectCounts[rollupIdx]).toBe(250);

    // The big leaf carries objectCount = 1.
    const bigIdx = scan.labels.findIndex((l) => l === 'giant.bin');
    expect(scan.objectCounts[bigIdx]).toBe(1);

    // Sum of all leaf objectCounts equals the total real S3 object count.
    let totalObjs = 0;
    for (let i = 0; i < scan.kinds.length; i++) {
      if (scan.kinds[i] === 'object') totalObjs += scan.objectCounts[i];
    }
    expect(totalObjs).toBe(rows.length);
  } finally { cleanup(dir); }
});

test('small file at depth 1 (top level) rolls up at the root', () => {
  test.skip(!duckPath, 'duckdb not on PATH — skipping');
  const dir = tmpDir();
  try {
    const parquet = path.join(dir, 'data.parquet');
    const manifest = path.join(dir, 'manifest.json');
    const out = path.join(dir, 'out.html');
    const rows = [
      { key: 'big.bin', size: 1000000 },
      ...Array.from({ length: 20 }, (_, i) => ({ key: 'tiny-' + i + '.txt', size: 10 })),
    ];
    writeParquetFixture(parquet, rows);
    writeManifest(manifest, parquet);

    const res = runTool(manifest, out, ['--min-fraction=0.001', '--max-depth=4']);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(out);

    const expectedTotal = rows.reduce((s, r) => s + r.size, 0);
    expect(scan.totalBytes).toBe(expectedTotal);
    expect(scan.values[0]).toBe(expectedTotal);

    // The tiny-N.txt files should be rolled up into a "(N small)" leaf
    // attached directly to the root (since their paths are depth 1).
    const childIds = buildChildIds(scan);
    const rootChildren = childIds[0] || [];
    const smallChild = rootChildren.find((i) => /\(\d+ small\)/.test(scan.labels[i]));
    expect(smallChild).toBeDefined();
    expect(scan.values[smallChild]).toBe(20 * 10);

    assertSumInvariant(scan);
  } finally { cleanup(dir); }
});
