// gpdu-json.js — JSON5 → treemap.
//
// Centerpiece: aggregate-consistency invariant. At every node in the tree,
// the aggregated bytes (self + descendants) must equal that node's source
// span — and the tree's grand total must equal the source file size, so
// every byte is accounted for.
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
const TOOL = path.join(ROOT, 'tools', 'gpdu-json.js');

function runJson(inputPath, outPath, extra = []) {
  const res = spawnSync(process.execPath, [TOOL, '--no-open', ...extra, inputPath, outPath], {
    encoding: 'utf8', timeout: 30000,
  });
  return res;
}

// Decode the first block of the embedded envelope and return labels/parent
// indices/values/types.
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
    return Array.from(idx).map(i => attr.names[i]);
  }
  return {
    labels: raw.labels,
    values: raw.values,
    parentIndices,
    types: decodeCat(raw.attributes.type),
    keys:  decodeCat(raw.attributes.key),
    totalBytes: envelope.totalBytes,
  };
}

// Build childIds from parentIndices. The encoded `values` are already
// subtree-aggregated (encodeBlock stores aggValue), so the parent/children
// sum invariant we check is `parent.value === sum(child.value)` directly.
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

function assertSumInvariant(scan) {
  const childIds = buildChildIds(scan);
  for (let i = 0; i < scan.labels.length; i++) {
    if (!childIds[i]) continue;
    let sum = 0;
    for (const c of childIds[i]) sum += scan.values[c];
    expect(scan.values[i], `node ${i} (${scan.labels[i]}, type=${scan.types[i]}) value vs children sum`).toBe(sum);
  }
}

function writeFixture(content, suffix = '.json5') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gpdu-json-'));
  const inputPath = path.join(tmp, 'fixture' + suffix);
  fs.writeFileSync(inputPath, content);
  const outPath = path.join(tmp, 'out.html');
  return { tmp, inputPath, outPath };
}

function cleanup(tmp) { fs.rmSync(tmp, { recursive: true, force: true }); }

// ---- Aggregate-consistency invariant (the centerpiece) ----

const CASES = [
  {
    name: 'simple object',
    src: `{"a": 1, "b": 2, "c": "hello"}`,
  },
  {
    name: 'JSON5 with comments and trailing commas',
    src: `// header comment
{
  // inside comment
  name: 'test', /* inline */
  count: 42,
  arr: [1, 2, 3,],   // trailing comma
}
// trailing comment
`,
  },
  {
    name: 'deeply nested',
    src: `{"a":{"b":{"c":{"d":{"e":42}}}}}`,
  },
  {
    name: 'array of objects',
    src: `[{"x":1}, {"x":2}, {"x":3}, {"x":4}]`,
  },
  {
    name: 'mixed primitive types',
    src: `{"s": "x", "n": 42, "f": 3.14, "b": true, "z": null, "neg": -7}`,
  },
  {
    name: 'lots of weird whitespace',
    src: `   {  "a"  :   1   ,   "b"  :  [  1  ,  2  ,  3  ]   }   \n\n  `,
  },
];

for (const tc of CASES) {
  test(`aggregate consistency: ${tc.name}`, () => {
    const { tmp, inputPath, outPath } = writeFixture(tc.src);
    try {
      const res = runJson(inputPath, outPath);
      expect(res.status, res.stderr).toBe(0);
      const scan = parseScanHtml(outPath);

      // parent.value === sum(child.value) at every internal node.
      assertSumInvariant(scan);

      // Tree total === source file size.
      expect(scan.values[0]).toBe(scan.totalBytes);
      expect(scan.totalBytes).toBe(Buffer.byteLength(tc.src));
    } finally {
      cleanup(tmp);
    }
  });
}

// ---- Edge cases ----

test('root scalar produces single-leaf tree', () => {
  const { tmp, inputPath, outPath } = writeFixture('42');
  try {
    const res = runJson(inputPath, outPath);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(outPath);
    // 1 file root + 1 scalar leaf (no leftovers since whole file is the scalar).
    expect(scan.labels.length).toBeGreaterThanOrEqual(2);
    expect(scan.types[0]).toBe('file');
    // Find the scalar leaf
    const scalarIdx = scan.types.findIndex(t => t === 'number');
    expect(scalarIdx).toBeGreaterThan(0);
    expect(scan.values[scalarIdx]).toBe(2);  // "42"
    assertSumInvariant(scan);
    expect(scan.values[0]).toBe(scan.totalBytes);
  } finally { cleanup(tmp); }
});

test('empty object', () => {
  const { tmp, inputPath, outPath } = writeFixture('{}');
  try {
    const res = runJson(inputPath, outPath);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(outPath);
    // file root + object internal + (leftover) for the {} bytes
    const objIdx = scan.types.indexOf('object');
    expect(objIdx).toBeGreaterThan(0);
    const childIds = buildChildIds(scan);
    expect(childIds[objIdx]).not.toBeNull();
    // Object's only child is a leftover for the 2 bytes of `{}`.
    expect(childIds[objIdx].length).toBe(1);
    expect(scan.types[childIds[objIdx][0]]).toBe('leftover');
    expect(scan.values[objIdx]).toBe(2);
  } finally { cleanup(tmp); }
});

test('empty array', () => {
  const { tmp, inputPath, outPath } = writeFixture('[]');
  try {
    const res = runJson(inputPath, outPath);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(outPath);
    const arrIdx = scan.types.indexOf('array');
    expect(arrIdx).toBeGreaterThan(0);
    const childIds = buildChildIds(scan);
    expect(childIds[arrIdx].length).toBe(1);
    expect(scan.types[childIds[arrIdx][0]]).toBe('leftover');
  } finally { cleanup(tmp); }
});

test('parse error from invalid JSON exits 1 with line/col', () => {
  const { tmp, inputPath, outPath } = writeFixture('{ this is not valid }');
  try {
    const res = runJson(inputPath, outPath);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/parse error at line \d+, column \d+/);
  } finally { cleanup(tmp); }
});

// ---- Pruning behavior ----

test('--max-array-children rolls extras into a [...M more] leaf', () => {
  // 100-element array, cap at 5
  const els = Array.from({ length: 100 }, (_, i) => i).join(',');
  const src = '[' + els + ']';
  const { tmp, inputPath, outPath } = writeFixture(src);
  try {
    const res = runJson(inputPath, outPath, ['--max-array-children=5']);
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(outPath);

    // Find a [...95 more] rollup leaf
    const rollupIdx = scan.labels.findIndex(l => /\[\u202695 more\]/.test(l));
    expect(rollupIdx).toBeGreaterThan(0);

    // Aggregate consistency still holds.
    assertSumInvariant(scan);
    expect(scan.values[0]).toBe(scan.totalBytes);
  } finally { cleanup(tmp); }
});

test('--min-bytes drops tiny leaves; their bytes go into parent leftover', () => {
  // {"a":1,"b":2,"c":3} — all values are 1-byte
  const src = '{"a":1,"b":2,"c":3}';
  const { tmp, inputPath, outPath } = writeFixture(src);
  try {
    const res = runJson(inputPath, outPath, ['--min-bytes=2']);  // drop all 1-byte leaves
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(outPath);
    // No 'number' leaves (all dropped), but aggregate still adds up to file size.
    const numCount = scan.types.filter(t => t === 'number').length;
    expect(numCount).toBe(0);
    assertSumInvariant(scan);
    expect(scan.values[0]).toBe(scan.totalBytes);
  } finally { cleanup(tmp); }
});

// ---- Smoke test: rendered HTML loads and shows cells ----

test('generated HTML loads under file:// and renders cells', async ({ page }) => {
  const src = JSON.stringify({
    name: 'test',
    items: Array.from({ length: 30 }, (_, i) => ({ id: i, label: 'item-' + i })),
    nested: { a: { b: { c: 1 } } },
  }, null, 2);
  const { tmp, inputPath, outPath } = writeFixture(src, '.json');
  try {
    const res = runJson(inputPath, outPath);
    expect(res.status, res.stderr).toBe(0);

    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

    await page.goto('file://' + outPath);
    await page.waitForTimeout(400);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    expect(errs, 'no errors').toEqual([]);
    const cells = await page.locator('gp-treemap').evaluate((el) => el._leaves.length);
    expect(cells).toBeGreaterThan(10);
  } finally {
    cleanup(tmp);
  }
});
