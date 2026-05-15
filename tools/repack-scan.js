#!/usr/bin/env node
// Re-pack a scan-cache file (*.scan.json.gz) using a different block
// partitioner. The original scan envelope is decoded back into a flat scan
// object, re-partitioned, re-encoded, and written to a new cache file —
// without re-running the expensive build step (directory walk, LLM forward
// passes, etc.) that produced the original cache.
//
// Useful when an earlier partitioner produced too many tiny blocks for the
// browser-side loader to inflate concurrently. The depth-band partitioner
// (the default here) sorts nodes by depth, slices into fixed-size blocks,
// and never creates more blocks than ceil(totalNodes / blockSize) — no
// dependence on fan-out or tree shape.
//
// Usage:
//   node tools/repack-scan.js <input.scan.json.gz> [output.scan.json.gz]
//                              [--block-size=N] [--first-block-size=N]
//                              [--strategy=depth-band|bfs|dfs]
//
// If output is omitted, writes alongside input as `<input>.repacked.scan.json.gz`.

import fs from 'node:fs';
import path from 'node:path';
import {
  loadScanJson, saveScanJson,
  decodeEnvelope, buildEnvelope,
  partitionBlocksDepthBand, partitionBlocksBFS, partitionBlocks,
} from './scan-core.js';

function parseArgs(argv) {
  let inputPath = null, outputPath = null;
  let blockSize = 500000, firstBlockSize = null;
  let strategy = 'depth-band';
  let maxDepth = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { usage(0); }
    else if (a.startsWith('--block-size=')) blockSize = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--first-block-size=')) firstBlockSize = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--strategy=')) strategy = a.split('=')[1];
    else if (a.startsWith('--max-depth=')) maxDepth = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('-')) { console.error('unknown flag: ' + a); usage(2); }
    else if (inputPath === null) inputPath = a;
    else if (outputPath === null) outputPath = a;
    else { console.error('extra positional arg: ' + a); usage(2); }
  }
  if (!inputPath) usage(2);
  if (!outputPath) outputPath = inputPath.replace(/\.scan\.json\.gz$/i, '') + '.repacked.scan.json.gz';
  if (firstBlockSize === null) firstBlockSize = blockSize;
  return { inputPath, outputPath, blockSize, firstBlockSize, strategy, maxDepth };
}

function usage(code = 0) {
  process.stderr.write(
    'Usage: node tools/repack-scan.js <input.scan.json.gz> [output.scan.json.gz]\n' +
    '         [--block-size=500000] [--first-block-size=<block-size>]\n' +
    '         [--strategy=depth-band|bfs|dfs]\n' +
    '         [--max-depth=N]   drop every node whose depth (root=0) exceeds N;\n' +
    '                           parents that lose all their children become leaves\n' +
    '                           carrying their pre-prune aggregate value.\n'
  );
  process.exit(code);
}

// Drop every node whose depth (root=0) exceeds `maxDepth`. Parents whose
// children were all pruned become leaves, and their per-node `value` is
// set to the old aggregate so the post-partition reverse pass reconstructs
// the same aggValue at every kept node.
function pruneToDepth(scan, maxDepth) {
  const n = scan.labels.length;
  const pi = scan.parentIndices;
  // 1. Depth per node.
  const depth = new Int32Array(n);
  for (let i = 0; i < n; i++) depth[i] = pi[i] < 0 ? 0 : depth[pi[i]] + 1;
  // 2. childIds + aggValue (sum of own value + descendants', reverse pass).
  const childIds = new Array(n);
  for (let i = 0; i < n; i++) childIds[i] = null;
  for (let i = 1; i < n; i++) {
    const p = pi[i];
    if (!childIds[p]) childIds[p] = [];
    childIds[p].push(i);
  }
  const aggValue = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    aggValue[i] = scan.values[i];
    if (childIds[i]) for (const c of childIds[i]) aggValue[i] += aggValue[c];
  }
  // 3. Keep nodes with depth <= maxDepth. Compact and renumber.
  const keep = new Uint8Array(n);
  let kept = 0;
  for (let i = 0; i < n; i++) if (depth[i] <= maxDepth) { keep[i] = 1; kept++; }
  const newIdx = new Int32Array(n).fill(-1);
  let nextIdx = 0;
  for (let i = 0; i < n; i++) if (keep[i]) newIdx[i] = nextIdx++;
  const labels = new Array(kept);
  const parentIndices = new Int32Array(kept);
  const values = new Float64Array(kept);
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const ni = newIdx[i];
    labels[ni] = scan.labels[i];
    parentIndices[ni] = pi[i] < 0 ? -1 : newIdx[pi[i]];
    // If this node had any descendants pruned (i.e. it lives at maxDepth
    // *or* its old children landed beyond the cap), it becomes a leaf and
    // must carry the old aggregate value so the partitioner's reverse pass
    // reproduces the original aggValue at every kept ancestor. Otherwise
    // keep the original per-node value (typically 0 for internal nodes).
    const hadAnyChildAtMaxDepth = depth[i] === maxDepth && childIds[i] && childIds[i].length > 0;
    values[ni] = hadAnyChildAtMaxDepth ? aggValue[i] : scan.values[i];
  }
  // 4. Compact attributes the same way.
  const attributes = {};
  for (const name of Object.keys(scan.attributes || {})) {
    const a = scan.attributes[name];
    const newVals = new Array(kept);
    for (let i = 0; i < n; i++) if (keep[i]) newVals[newIdx[i]] = a.values[i];
    attributes[name] = { kind: a.kind, values: newVals };
  }
  // 5. If a leafReason attribute exists, mark the new leaves so the
  // viewer can show why (a UI hint, not a load-bearing invariant).
  if (attributes.leafReason) {
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue;
      const ni = newIdx[i];
      if (depth[i] === maxDepth && childIds[i] && childIds[i].length > 0) {
        attributes.leafReason.values[ni] = 'depth-stripped';
      }
    }
  }
  return { labels, parentIndices, values, attributes };
}

async function main() {
  const { inputPath, outputPath, blockSize, firstBlockSize, strategy, maxDepth } = parseArgs(process.argv.slice(2));

  process.stderr.write('reading ' + inputPath + ' (' + (fs.statSync(inputPath).size / 1024 / 1024).toFixed(1) + ' MB gz)\n');
  const cached = loadScanJson(inputPath);
  const oldBlocks = cached.envelope.blocks.length;
  process.stderr.write('  envelope v=' + cached.envelope.v + ', ' + oldBlocks.toLocaleString() + ' blocks\n');

  process.stderr.write('decoding envelope...\n');
  const t0 = Date.now();
  let scan = decodeEnvelope(cached.envelope);
  process.stderr.write('  decoded ' + scan.labels.length.toLocaleString() + ' nodes in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's\n');

  if (maxDepth != null) {
    process.stderr.write('pruning to max-depth=' + maxDepth + '...\n');
    const before = scan.labels.length;
    const tp = Date.now();
    scan = pruneToDepth(scan, maxDepth);
    process.stderr.write('  ' + before.toLocaleString() + ' → ' + scan.labels.length.toLocaleString() + ' nodes in ' + ((Date.now() - tp) / 1000).toFixed(1) + 's\n');
  }

  process.stderr.write('re-partitioning with strategy=' + strategy + ', block-size=' + blockSize.toLocaleString() + '\n');
  const t1 = Date.now();
  let partResult;
  if (strategy === 'depth-band')      partResult = partitionBlocksDepthBand(scan, blockSize, firstBlockSize);
  else if (strategy === 'bfs')        partResult = partitionBlocksBFS(scan, blockSize, firstBlockSize);
  else if (strategy === 'dfs')        partResult = partitionBlocks(scan, blockSize);
  else { console.error('unknown strategy: ' + strategy); process.exit(2); }
  process.stderr.write('  ' + partResult.blocks.length.toLocaleString() + ' blocks in ' + ((Date.now() - t1) / 1000).toFixed(1) + 's\n');

  // Preserve any top-level envelope scalars the original tool set (e.g.
  // totalBytes for disk usage, totalProb for LLM density). We strip `v`
  // and `blocks` since buildEnvelope owns those.
  const extra = {};
  for (const k of Object.keys(cached.envelope)) {
    if (k === 'v' || k === 'blocks') continue;
    extra[k] = cached.envelope[k];
  }
  process.stderr.write('re-encoding ' + partResult.blocks.length.toLocaleString() + ' blocks...\n');
  const t2 = Date.now();
  const envelope = buildEnvelope(scan, partResult, extra);
  process.stderr.write('  encoded in ' + ((Date.now() - t2) / 1000).toFixed(1) + 's\n');

  process.stderr.write('writing ' + outputPath + '\n');
  // Recompute counts after a prune so the rendered HTML / stats-bar
  // doesn't report stale pre-prune numbers.
  let counts = cached.meta.counts;
  if (maxDepth != null) {
    let leaves = 0, deepest = 0;
    const n = scan.labels.length;
    const pi = scan.parentIndices;
    const depth = new Int32Array(n);
    const hasKids = new Uint8Array(n);
    for (let i = 0; i < n; i++) depth[i] = pi[i] < 0 ? 0 : depth[pi[i]] + 1;
    for (let i = 0; i < n; i++) if (pi[i] >= 0) hasKids[pi[i]] = 1;
    for (let i = 0; i < n; i++) {
      if (!hasKids[i]) leaves++;
      if (depth[i] > deepest) deepest = depth[i];
    }
    counts = { ...(counts || {}), nodes: n, leaves, maxDepth: deepest };
  }
  await saveScanJson(outputPath, envelope, {
    ...cached.meta,
    counts,
    repackedFrom: path.basename(inputPath),
    repackedAt: new Date().toISOString(),
    repackedStrategy: strategy,
    repackedBlockSize: blockSize,
    ...(maxDepth != null ? { repackedMaxDepth: maxDepth } : {}),
  });
  const newSize = fs.statSync(outputPath).size;
  process.stderr.write('  wrote ' + (newSize / 1024 / 1024).toFixed(1) + ' MB gz (' + oldBlocks.toLocaleString() + ' → ' + partResult.blocks.length.toLocaleString() + ' blocks)\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
