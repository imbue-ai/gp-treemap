#!/usr/bin/env node
// Microbenchmark: recursive vs iterative slice-and-dice layout on a balanced
// binary tree of ~1M nodes (branching factor 2).
//
// Usage:
//   node tools/bench-layout.js                 # default ~1M nodes
//   node tools/bench-layout.js --leaves=524288
//   node tools/bench-layout.js --time=3000

import { Bench } from 'tinybench';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const { balanceChildren, maxDepth } = await import(path.join(__dirname, '../src/balancer.js'));
const { layoutTree } = await import(path.join(__dirname, '../src/layout.js'));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : Number(v) || v];
  })
);
// 524288 leaves → 1,048,575 total nodes in a balanced binary tree.
const LEAVES  = args.leaves ?? 524_288;
const TIME_MS = args.time   ?? 2000;
const CANVAS  = { x: 0, y: 0, w: 2000, h: 1400 };

// ---- Iterative port of layoutTree ------------------------------------------
// Same split logic, same visibility test, same onLeaf ordering (left-first DFS).
function layoutTreeIter(root, rect, onLeaf, splitBias) {
  if (!root) return;
  const bias = splitBias || 1;
  // Preallocate a generous stack; depth is ~log2(n) for balanced trees but
  // skewed inputs can push it toward n.
  const stack = [root, rect];
  while (stack.length) {
    const r = stack.pop();
    const node = stack.pop();
    if (!visible(r)) continue;
    if (node.isLeaf) { onLeaf(node.id, r); continue; }
    const ratio = node.size > 0 ? node.left.size / node.size : 0.5;
    let r1, r2;
    if (r.w > r.h * bias) {
      const w1 = ratio * r.w;
      r1 = { x: r.x, y: r.y, w: w1, h: r.h };
      r2 = { x: r.x + w1, y: r.y, w: r.w - w1, h: r.h };
    } else {
      const h1 = ratio * r.h;
      r1 = { x: r.x, y: r.y, w: r.w, h: h1 };
      r2 = { x: r.x, y: r.y + h1, w: r.w, h: r.h - h1 };
    }
    // Push right first so left is processed first (matches recursive order).
    stack.push(node.right, r2);
    stack.push(node.left, r1);
  }
}

function visible(rect) {
  const dx = Math.floor(rect.x + rect.w + 0.5) - Math.floor(rect.x + 0.5);
  const dy = Math.floor(rect.y + rect.h + 0.5) - Math.floor(rect.y + 0.5);
  return dx > 0 && dy > 0;
}

// ---- Build the tree ---------------------------------------------------------
console.log(`\ngp-treemap layout bench  leaves=${LEAVES.toLocaleString()}  canvas=${CANVAS.w}×${CANVAS.h}  time=${TIME_MS}ms/bench\n`);

process.stdout.write('Generating items... ');
let t0 = performance.now();
const items = new Array(LEAVES);
// Deterministic-ish sizes with some variance; balanceChildren sorts by size.
for (let i = 0; i < LEAVES; i++) {
  items[i] = { id: 'n' + i, size: 1 + Math.floor(Math.random() * 1e6) };
}
console.log(`${(performance.now() - t0).toFixed(0)} ms`);

process.stdout.write('Balancing (binary tree)... ');
t0 = performance.now();
const root = balanceChildren(items);
console.log(`${(performance.now() - t0).toFixed(0)} ms`);

// Walk the tree to get exact counts/depth.
let total = 0, leaves = 0;
(function count(n) {
  if (!n) return;
  total++;
  if (n.isLeaf) { leaves++; return; }
  count(n.left); count(n.right);
})(root);
const depth = maxDepth(root);
console.log(`  total nodes: ${total.toLocaleString()}  leaves: ${leaves.toLocaleString()}  depth: ${depth}\n`);

// Sanity: both versions must agree on leaf ordering and rects.
{
  const a = []; layoutTree(root, CANVAS, (id, r) => a.push(id + ':' + r.x.toFixed(3) + ',' + r.y.toFixed(3) + ',' + r.w.toFixed(3) + ',' + r.h.toFixed(3)));
  const b = []; layoutTreeIter(root, CANVAS, (id, r) => b.push(id + ':' + r.x.toFixed(3) + ',' + r.y.toFixed(3) + ',' + r.w.toFixed(3) + ',' + r.h.toFixed(3)));
  if (a.length !== b.length) throw new Error(`leaf count mismatch: recursive ${a.length} vs iter ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) throw new Error(`leaf #${i} mismatch:\n  rec:  ${a[i]}\n  iter: ${b[i]}`);
  }
  console.log(`Parity check: ${a.length.toLocaleString()} visible leaves, identical output.\n`);
}

// ---- Benchmarks -------------------------------------------------------------
let sink = 0;
const bench = new Bench({ time: TIME_MS });
bench
  .add('layoutTree        recursive', () => {
    let n = 0;
    layoutTree(root, CANVAS, () => { n++; });
    sink += n;
  })
  .add('layoutTreeIter    stack',     () => {
    let n = 0;
    layoutTreeIter(root, CANVAS, () => { n++; });
    sink += n;
  });

await bench.run();

function fmtMs(ms) {
  return ms >= 1000 ? (ms / 1000).toFixed(3) + ' s ' : ms.toFixed(2).padStart(8) + ' ms';
}

console.log('  ' + ['Task'.padEnd(34), 'mean', 'min', 'max', 'iter/s'].join('  '));
console.log('  ' + '-'.repeat(80));
for (const t of bench.tasks) {
  const r = t.result;
  if (!r) continue;
  if (r.error) { console.log('  ' + t.name.padEnd(34) + '  ERROR: ' + r.error.message); continue; }
  console.log(
    '  ' + t.name.padEnd(34) +
    '  ' + fmtMs(r.latency.mean) +
    '  ' + fmtMs(r.latency.min) +
    '  ' + fmtMs(r.latency.max) +
    '  ' + r.throughput.mean.toFixed(2).padStart(9)
  );
}

const [rec, it] = bench.tasks.map((t) => t.result?.latency.mean);
if (rec && it) {
  const ratio = rec / it;
  const label = ratio > 1 ? `iterative is ${ratio.toFixed(2)}× faster` : `recursive is ${(1/ratio).toFixed(2)}× faster`;
  console.log(`\n  ${label}\n`);
}

void sink;
