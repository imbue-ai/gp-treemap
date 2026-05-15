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
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { usage(0); }
    else if (a.startsWith('--block-size=')) blockSize = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--first-block-size=')) firstBlockSize = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--strategy=')) strategy = a.split('=')[1];
    else if (a.startsWith('-')) { console.error('unknown flag: ' + a); usage(2); }
    else if (inputPath === null) inputPath = a;
    else if (outputPath === null) outputPath = a;
    else { console.error('extra positional arg: ' + a); usage(2); }
  }
  if (!inputPath) usage(2);
  if (!outputPath) outputPath = inputPath.replace(/\.scan\.json\.gz$/i, '') + '.repacked.scan.json.gz';
  if (firstBlockSize === null) firstBlockSize = blockSize;
  return { inputPath, outputPath, blockSize, firstBlockSize, strategy };
}

function usage(code = 0) {
  process.stderr.write(
    'Usage: node tools/repack-scan.js <input.scan.json.gz> [output.scan.json.gz]\n' +
    '         [--block-size=500000] [--first-block-size=<block-size>]\n' +
    '         [--strategy=depth-band|bfs|dfs]\n'
  );
  process.exit(code);
}

async function main() {
  const { inputPath, outputPath, blockSize, firstBlockSize, strategy } = parseArgs(process.argv.slice(2));

  process.stderr.write('reading ' + inputPath + ' (' + (fs.statSync(inputPath).size / 1024 / 1024).toFixed(1) + ' MB gz)\n');
  const cached = loadScanJson(inputPath);
  const oldBlocks = cached.envelope.blocks.length;
  process.stderr.write('  envelope v=' + cached.envelope.v + ', ' + oldBlocks.toLocaleString() + ' blocks\n');

  process.stderr.write('decoding envelope...\n');
  const t0 = Date.now();
  const scan = decodeEnvelope(cached.envelope);
  process.stderr.write('  decoded ' + scan.labels.length.toLocaleString() + ' nodes in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's\n');

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
  await saveScanJson(outputPath, envelope, {
    ...cached.meta,
    repackedFrom: path.basename(inputPath),
    repackedAt: new Date().toISOString(),
    repackedStrategy: strategy,
    repackedBlockSize: blockSize,
  });
  const newSize = fs.statSync(outputPath).size;
  process.stderr.write('  wrote ' + (newSize / 1024 / 1024).toFixed(1) + ' MB gz (' + oldBlocks.toLocaleString() + ' → ' + partResult.blocks.length.toLocaleString() + ' blocks)\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
