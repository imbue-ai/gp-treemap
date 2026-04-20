#!/usr/bin/env node
// Synthetic benchmark for the raised-treemap data pipeline.
// Generates configurable random trees, then times each phase:
//   generate → buildFromTabular → binary encode → binary decode + JSON.parse
//
// Usage:
//   node tools/bench.js                  # default: 5M nodes, depth 20  (~1-2 GB RAM)
//   node tools/bench.js --n=1000000      # lighter run (~400 MB RAM)
//   node tools/bench.js --depth=40       # very deep/narrow tree
//   node tools/bench.js --time=3000      # ms per benchmark (default 2000)
//
// V8 CPU profiling (generates isolate-*.log → cpuprofile via tools/bench.js):
//   node --prof tools/bench.js
//   node --prof-process isolate-*.log > profile.txt
//   # or open the .log in chrome://tracing after converting with:
//   node --prof-process --preprocess isolate-*.log > trace.json

import { Bench } from 'tinybench';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ---- CLI args ---------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : Number(v) || v];
  })
);
const N         = args.n    ?? 5_000_000;
const MAX_DEPTH = args.depth ?? 20;
const TIME_MS   = args.time  ?? 2000;

// ---- Synthetic tree generation ----------------------------------------------
const COLOR_BUCKETS = ['code','image','video','audio','doc','build','bin','archive','web','font'];

function generateTree(n, maxDepth) {
  const labels        = new Array(n);
  const parentIndices = new Int32Array(n);
  const values        = new Float64Array(n);
  const color         = new Array(n);

  labels[0] = 'root'; parentIndices[0] = -1; values[0] = 0; color[0] = 'dir';
  let nextRow = 1;
  const stack = [{ row: 0, depth: 0 }];

  function branchFactor(depth) {
    const base = Math.max(2, Math.round(n ** (1 / maxDepth)));
    return Math.max(1, base + Math.round((Math.random() - 0.5) * base * 0.4));
  }

  while (nextRow < n && stack.length) {
    const { row: parentRow, depth } = stack.pop();
    const children = Math.min(branchFactor(depth), n - nextRow);
    for (let c = 0; c < children && nextRow < n; c++) {
      const i = nextRow++;
      parentIndices[i] = parentRow;
      if (depth >= maxDepth - 1 || Math.random() < 0.7) {
        const ext = COLOR_BUCKETS[i % COLOR_BUCKETS.length];
        labels[i] = `file_${i}.${ext.slice(0, 3)}`;
        values[i]  = Math.floor(Math.random() * 1e7);
        color[i]   = ext;
      } else {
        labels[i] = `dir_${i}`;
        values[i]  = 0;
        color[i]   = 'dir';
        stack.push({ row: i, depth: depth + 1 });
      }
    }
  }
  // Remaining rows (if tree is shallower than n): leaf files under root.
  for (let i = nextRow; i < n; i++) {
    labels[i] = `file_${i}`; parentIndices[i] = 0;
    values[i] = Math.floor(Math.random() * 1e6); color[i] = 'code';
  }

  return { labels, parentIndices, values, color };
}

// ---- Import builder ---------------------------------------------------------
const { buildFromTabular } = await import(path.join(__dirname, '../src/builder.js'));

// ---- Setup ------------------------------------------------------------------
console.log(`\nraised-treemap benchmark  n=${N.toLocaleString()}  maxDepth=${MAX_DEPTH}  time=${TIME_MS}ms/bench\n`);
process.stdout.write('Generating tree data... ');
const t0 = performance.now();
const data = generateTree(N, MAX_DEPTH);
console.log(`done in ${(performance.now() - t0).toFixed(0)} ms\n`);

// Pre-compute encoded forms so encode/decode benches don't measure allocation.
const piI32 = data.parentIndices instanceof Int32Array
  ? data.parentIndices : Int32Array.from(data.parentIndices);
const piB64 = Buffer.from(piI32.buffer).toString('base64');

const colorNames = [...new Set(data.color)].sort();
const toIdx = new Map(colorNames.map((c, i) => [c, i]));
const colorU16 = new Uint16Array(data.color.length);
for (let i = 0; i < data.color.length; i++) colorU16[i] = toIdx.get(data.color[i]);
const colorB64 = Buffer.from(colorU16.buffer).toString('base64');
const labelsJson = JSON.stringify(data.labels);

// ---- Benchmarks -------------------------------------------------------------
const bench = new Bench({ time: TIME_MS });

bench
  .add('buildFromTabular (parentIndices path)', () => {
    buildFromTabular(data, {});
  })
  .add('encode parentIndices  Int32Array→base64', () => {
    Buffer.from(piI32.buffer).toString('base64');
  })
  .add('encode color          Uint16 enum→base64', () => {
    const u16 = new Uint16Array(data.color.length);
    for (let i = 0; i < data.color.length; i++) u16[i] = toIdx.get(data.color[i]);
    Buffer.from(u16.buffer).toString('base64');
  })
  .add('decode parentIndices  base64→Int32Array', () => {
    const bin = Buffer.from(piB64, 'base64');
    void new Int32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  })
  .add('decode color          base64→string[]', () => {
    const bin = Buffer.from(colorB64, 'base64');
    const idx = new Uint16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2);
    const out = new Array(idx.length);
    for (let i = 0; i < idx.length; i++) out[i] = colorNames[idx[i]];
  })
  .add('JSON.parse labels array', () => {
    void JSON.parse(labelsJson);
  });

await bench.run();

// ---- Report -----------------------------------------------------------------
function fmtMs(ms) {
  return ms >= 1000 ? (ms / 1000).toFixed(3) + ' s ' : ms.toFixed(1).padStart(8) + ' ms';
}

console.log('  ' + ['Task'.padEnd(44), 'mean', 'min', 'max', 'iter/s'].join('  '));
console.log('  ' + '-'.repeat(90));
for (const t of bench.tasks) {
  const r = t.result;
  if (!r) continue;
  if (r.error) { console.log('  ' + t.name.padEnd(44) + '  ERROR: ' + r.error.message); continue; }
  console.log(
    '  ' + t.name.padEnd(44) +
    '  ' + fmtMs(r.latency.mean) +
    '  ' + fmtMs(r.latency.min) +
    '  ' + fmtMs(r.latency.max) +
    '  ' + r.throughput.mean.toFixed(2).padStart(9)
  );
}

// ---- Size estimates ---------------------------------------------------------
const labelsBytes = labelsJson.length;
const valuesBytes = JSON.stringify(Array.from(data.values)).length;
const piBytes     = piB64.length;
const colorBytes  = colorB64.length;
const total       = labelsBytes + valuesBytes + piBytes + colorBytes;
console.log('\n  Estimated HTML data payload:');
console.log(`    labels JSON         ${(labelsBytes / 1e6).toFixed(1)} MB`);
console.log(`    values JSON         ${(valuesBytes / 1e6).toFixed(1)} MB`);
console.log(`    parentIndices b64   ${(piBytes / 1e6).toFixed(1)} MB`);
console.log(`    color b64           ${(colorBytes / 1e6).toFixed(1)} MB`);
console.log(`    total               ${(total / 1e6).toFixed(1)} MB`);
console.log(`    bundle              ~0.1 MB`);
console.log('');
