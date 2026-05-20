// gpdu-llm-density.js — LLM token-continuation density → treemap.
//
// Centerpiece invariants:
//   1. Aggregate consistency at every internal node — sum of children's
//      (aggregated) joint probability equals the parent's joint.
//   2. Root joint = 1.0 (within float epsilon). Every internal node
//      reconciles via its synthetic `(other)` leaf.
//
// Exercises the deterministic `--backend=stub` path so the test runs
// offline with no model download.
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
const TOOL = path.join(ROOT, 'tools', 'gpdu-llm-density.js');

function runTool(args, { stdin } = {}) {
  return spawnSync(process.execPath, [TOOL, '--no-open', ...args], {
    encoding: 'utf8',
    timeout: 30000,
    input: stdin,
  });
}

function parseScanHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script type="application\/json" id="tmdata">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('tmdata script tag not found');
  const envelope = JSON.parse(m[1]);
  const compressed = Buffer.from(envelope.blocks[0], 'base64');
  const raw = JSON.parse(zlib.inflateRawSync(compressed).toString());
  // The wire format has two parent encodings — v=3 (subtree-with-stubs)
  // writes `piB64` as local row offsets, v=4 (depth-band) writes `pgB64`
  // as direct global ids. For these tests every input fits in a single
  // block so local row IS global id, and either field gives the same
  // [row → parent-row] interpretation.
  const parentB64 = raw.pgB64 || raw.piB64;
  const piBuf = Buffer.from(parentB64, 'base64');
  const parentIndices = Array.from(new Int32Array(piBuf.buffer, piBuf.byteOffset, piBuf.byteLength / 4));
  function decodeCat(attr) {
    const buf = Buffer.from(attr.b64, 'base64');
    const idx = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
    return Array.from(idx).map(i => attr.names[i]);
  }
  function decodeNum(attr) {
    const buf = Buffer.from(attr.b64, 'base64');
    return Array.from(new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8));
  }
  return {
    labels: raw.labels,
    values: raw.values,
    parentIndices,
    probability: decodeNum(raw.attributes.probability),
    depth:       decodeNum(raw.attributes.depth),
    leafReason:  decodeCat(raw.attributes.leafReason),
    totalProb: envelope.totalProb,
  };
}

function buildChildIds(scan) {
  const n = scan.labels.length;
  const childIds = new Array(n);
  for (let i = 0; i < n; i++) childIds[i] = null;
  for (let i = 1; i < n; i++) {
    const p = scan.parentIndices[i];
    if (childIds[p] === null) childIds[p] = [];
    childIds[p].push(i);
  }
  return childIds;
}

function assertSumInvariant(scan, epsilon = 1e-9) {
  const childIds = buildChildIds(scan);
  for (let i = 0; i < scan.labels.length; i++) {
    if (!childIds[i]) continue;
    let sum = 0;
    for (const c of childIds[i]) sum += scan.values[c];
    expect(
      Math.abs(scan.values[i] - sum),
      `node ${i} (${scan.labels[i]}, reason=${scan.leafReason[i]}) value ${scan.values[i]} vs children sum ${sum}`
    ).toBeLessThan(epsilon);
  }
}

function mkOut() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gpdu-llm-density-'));
  return { tmp, out: path.join(tmp, 'out.html') };
}

function cleanup(tmp) { fs.rmSync(tmp, { recursive: true, force: true }); }

// ---- Aggregate-consistency invariant ----

const CASES = [
  { name: 'short prompt, shallow',  prompt: 'Fruit flies like a',                 depth: 4,  prune: '1e-4', topK: '6'  },
  { name: 'longer prompt, medium',  prompt: 'Time flies like an arrow. Fruit flies like a banana.', depth: 6,  prune: '1e-5', topK: '8'  },
  { name: 'tiny top-k forces big (other)', prompt: 'Hello world',                  depth: 4,  prune: '1e-4', topK: '2'  },
  { name: 'unbounded top-k',         prompt: 'The quick brown fox',                depth: 3,  prune: '1e-3', topK: 'Infinity' },
];

for (const tc of CASES) {
  test(`aggregate consistency: ${tc.name}`, () => {
    const { tmp, out } = mkOut();
    try {
      const res = runTool([
        '--backend=stub',
        '--model=test',
        '--prompt', tc.prompt,
        `--continuation-max-depth=${tc.depth}`,
        `--prune-probability=${tc.prune}`,
        `--top-k=${tc.topK}`,
        out,
      ]);
      expect(res.status, res.stderr).toBe(0);
      const scan = parseScanHtml(out);
      assertSumInvariant(scan);
      // Root joint reconciles to 1.0 exactly modulo float-summation error.
      expect(Math.abs(scan.values[0] - 1.0)).toBeLessThan(1e-9);
      expect(scan.totalProb).toBe(1);
    } finally { cleanup(tmp); }
  });
}

// ---- CLI behavior ----

test('missing --model exits 2', () => {
  const res = runTool(['--backend=stub', '--prompt=hi', '/tmp/should-not-write.html']);
  expect(res.status).toBe(2);
  expect(res.stderr).toMatch(/--model is required/);
});

test('missing --prompt with TTY-piped stdin exits 2', () => {
  const res = runTool(['--backend=stub', '--model=test', '/tmp/should-not-write.html']);
  expect(res.status).toBe(2);
  expect(res.stderr).toMatch(/--prompt is required/);
});

test('--prompt - reads stdin', () => {
  const { tmp, out } = mkOut();
  try {
    const res = runTool([
      '--backend=stub', '--model=test',
      '--prompt', '-',
      '--continuation-max-depth=3', '--prune-probability=1e-3', '--top-k=4',
      out,
    ], { stdin: 'Piped prompt text here' });
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(out);
    assertSumInvariant(scan);
  } finally { cleanup(tmp); }
});

test('unknown --color exits 2', () => {
  const res = runTool(['--backend=stub', '--model=test', '--prompt=hi', '--color=bogus', '/tmp/x.html']);
  expect(res.status).toBe(2);
  expect(res.stderr).toMatch(/Unknown --color/);
});

test('unknown --backend exits 2', () => {
  const res = runTool(['--backend=bogus', '--model=test', '--prompt=hi', '/tmp/x.html']);
  expect(res.status).toBe(2);
  expect(res.stderr).toMatch(/Unknown --backend/);
});

test('every internal node has exactly one (other) child (when not pruned-empty)', () => {
  const { tmp, out } = mkOut();
  try {
    const res = runTool([
      '--backend=stub', '--model=test',
      '--prompt=Fruit flies like a',
      '--continuation-max-depth=4', '--prune-probability=1e-4', '--top-k=5',
      out,
    ]);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(out);
    const childIds = buildChildIds(scan);
    for (let i = 0; i < scan.labels.length; i++) {
      if (!childIds[i]) continue; // leaf
      const otherChildren = childIds[i].filter(c => scan.labels[c] === '(other)');
      expect(otherChildren.length, `node ${i} (${scan.labels[i]})`).toBe(1);
    }
  } finally { cleanup(tmp); }
});

test('leaf-reasons include exactly the expected set', () => {
  const { tmp, out } = mkOut();
  try {
    const res = runTool([
      '--backend=stub', '--model=test',
      '--prompt=Fruit flies like a',
      '--continuation-max-depth=4', '--prune-probability=1e-4', '--top-k=5',
      out,
    ]);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(out);
    const reasons = new Set(scan.leafReason);
    for (const r of reasons) {
      expect(['(internal)', 'max-depth', 'pruned', 'eos', 'other-bucket']).toContain(r);
    }
    // Should at least see (internal), max-depth or pruned, and other-bucket.
    expect(reasons.has('(internal)')).toBe(true);
    expect(reasons.has('other-bucket')).toBe(true);
  } finally { cleanup(tmp); }
});

// ---- Scan cache (.scan.json.gz) ----

test('cache: first run writes <stem>.scan.json.gz; second run skips LLM and produces identical scan', () => {
  const { tmp, out } = mkOut();
  const cachePath = out.replace(/\.html$/, '.scan.json.gz');
  try {
    // First run builds and caches.
    const r1 = runTool([
      '--backend=stub', '--model=test',
      '--prompt=Fruit flies like a',
      '--continuation-max-depth=4', '--prune-probability=1e-4', '--top-k=8',
      out,
    ]);
    expect(r1.status, r1.stderr).toBe(0);
    expect(fs.existsSync(cachePath)).toBe(true);
    const cacheSize = fs.statSync(cachePath).size;
    expect(cacheSize).toBeGreaterThan(0);
    const scan1 = parseScanHtml(out);

    // Second run: cache exists → skip LLM, emit HTML from cache.
    fs.rmSync(out);
    const r2 = runTool([
      '--backend=stub', '--model=test',
      '--prompt=Fruit flies like a',
      '--continuation-max-depth=4', '--prune-probability=1e-4', '--top-k=8',
      out,
    ]);
    expect(r2.status, r2.stderr).toBe(0);
    expect(r2.stderr).toMatch(/loading cached scan/);
    const scan2 = parseScanHtml(out);

    // The encoded scan in both HTMLs should be bit-identical (same labels /
    // parents / values), confirming the cache round-trips losslessly.
    expect(scan2.labels).toEqual(scan1.labels);
    expect(scan2.parentIndices).toEqual(scan1.parentIndices);
    expect(scan2.values).toEqual(scan1.values);
    assertSumInvariant(scan2);
  } finally { cleanup(tmp); }
});

test('cache: --scan-in renders HTML without --model', () => {
  const { tmp, out } = mkOut();
  const cachePath = out.replace(/\.html$/, '.scan.json.gz');
  const outFromCache = path.join(tmp, 'from-cache.html');
  try {
    // First, build a cache.
    const r1 = runTool([
      '--backend=stub', '--model=test',
      '--prompt=Fruit flies like a',
      '--continuation-max-depth=4', '--prune-probability=1e-4', '--top-k=8',
      out,
    ]);
    expect(r1.status, r1.stderr).toBe(0);

    // Now render from cache, with NO --model / --prompt.
    const r2 = runTool([`--scan-in=${cachePath}`, outFromCache]);
    expect(r2.status, r2.stderr).toBe(0);
    expect(r2.stderr).toMatch(/loading cached scan/);
    const scan = parseScanHtml(outFromCache);
    assertSumInvariant(scan);
    expect(scan.values[0]).toBeCloseTo(1, 9);
  } finally { cleanup(tmp); }
});

test('cache: --no-cache forces rebuild even when cache exists', () => {
  const { tmp, out } = mkOut();
  const cachePath = out.replace(/\.html$/, '.scan.json.gz');
  try {
    const r1 = runTool([
      '--backend=stub', '--model=test',
      '--prompt=Fruit flies like a',
      '--continuation-max-depth=4', '--prune-probability=1e-4', '--top-k=8',
      out,
    ]);
    expect(r1.status, r1.stderr).toBe(0);
    const r2 = runTool([
      '--backend=stub', '--model=test',
      '--prompt=Fruit flies like a',
      '--continuation-max-depth=4', '--prune-probability=1e-4', '--top-k=8',
      '--no-cache', out,
    ]);
    expect(r2.status, r2.stderr).toBe(0);
    expect(r2.stderr).not.toMatch(/loading cached scan/);
    expect(r2.stderr).toMatch(/saved scan/);
  } finally { cleanup(tmp); }
});

// ---- Rendered HTML smoke test ----

test('generated HTML loads under file:// and renders cells', async ({ page }) => {
  const { tmp, out } = mkOut();
  try {
    const res = runTool([
      '--backend=stub', '--model=test',
      '--prompt=Fruit flies like a',
      '--continuation-max-depth=5', '--prune-probability=1e-4', '--top-k=6',
      out,
    ]);
    expect(res.status, res.stderr).toBe(0);

    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

    await page.goto('file://' + out);
    await page.waitForTimeout(400);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    expect(errs, 'no errors').toEqual([]);
    const cells = await page.locator('gp-treemap').evaluate((el) => el._leaves.length);
    expect(cells).toBeGreaterThan(5);
  } finally { cleanup(tmp); }
});
