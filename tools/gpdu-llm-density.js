#!/usr/bin/env node
// Visualize the LLM-assigned probability density over sentence continuations
// of a starter prompt as a treemap. Each tree node is one token. A node's
// cell area is the joint probability that the prefix from the root reaches
// that token; sibling areas at any subtree sum to that subtree's joint.
//
// At every internal node, a synthetic `(other)` leaf carries the residual
// mass (1 − Σ expanded children) — top-k / top-p / prune-probability tails
// all fold into it. Internal aggregates therefore reconcile to that node's
// joint exactly, and the tree total reconciles to 1.0.
//
// Usage:
//   node tools/gpdu-llm-density.js
//     --prompt "..."                  (or pipe via stdin, or `--prompt -`)
//     --model <gguf-path | HF-repo-id | URI>
//     [--continuation-max-depth=20]
//     [--prune-probability=1e-5]
//     [--top-k=N]            [--top-p=X]
//     [--temperature=T]      [--max-nodes=N]
//     [--color=probability|depth|token-rank|surprisal|leaf-reason]
//     [--backend=real|stub]
//     [--context-size=N]
//     [--no-prepend-bos]                (default: prepend the model's BOS
//                                        token, matching HuggingFace
//                                        tokenizer behavior)
//     [--scan-in=PATH]                  (skip the LLM; render HTML from a
//                                        cached scan)
//     [--scan-out=PATH]                 (explicit cache path; default is
//                                        <output-stem>.scan.json.gz next
//                                        to the HTML file)
//     [--no-cache]                      (force re-running the LLM even if
//                                        a cached scan exists)
//     [--block-size=N]       [--no-open]
//     [output.html]
//
// Caching: every run also writes a UI-independent scan JSON next to the
// HTML output (default: <stem>.scan.json.gz). If that file already exists
// the LLM step is skipped and HTML is emitted from the cached scan — so
// iterating on rendering changes against a slow-to-generate tree only
// costs an HTML write. SIGINT during the build saves whatever was
// explored so far before exiting.
//
// Backends:
//   * real (default; requires `node-llama-cpp` as an optionalDependency).
//     `--model` is either a local `.gguf` path or anything `resolveModelFile`
//     can resolve (HF repo IDs like `Qwen/Qwen2.5-0.5B-Instruct-GGUF`, URIs,
//     `hf:...` shorthands). Downloaded models cache to
//     `~/.node-llama-cpp/models/`.
//   * stub (deterministic synthetic distribution; no model required;
//     used by tests and for offline demos).
//
// Traversal:
//   * Depth-first. At each frontier we run a single forward pass on one new
//     token via `controlledEvaluate`, advancing the KV cache. Before
//     recursing into a child we snapshot `seq.nextTokenIndex`; after we
//     return we `eraseContextTokenRanges` back to that snapshot. So
//     descending a branch is the natural causal completion, with O(depth)
//     state on the stack rather than O(nodes) prefix re-evaluations.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { BUNDLE } from '../dist/gp-treemap.bundle.embed.js';
import { partitionBlocks, encodeBlock, escapeHtml, LOADER_JS } from './scan-core.js';
import { buildCliCommand, COPY_BTN_HTML, COPY_BTN_CSS, copyButtonScript } from './cli-command.js';

const COLOR_MODES = ['[Level 1]', 'probability', 'depth', 'token-rank', 'surprisal', 'leaf-reason'];
const CATEGORICAL_MODES = ['leaf-reason'];
const QUANTITATIVE_MODES = ['probability', 'depth', 'token-rank', 'surprisal'];
const BACKENDS = ['real', 'stub'];

function usage(exitCode) {
  console.error(
    'Usage: node tools/gpdu-llm-density.js\n' +
    '         --prompt "..." | --prompt - | (piped stdin)\n' +
    '         --model <gguf-path | HF-repo-id | hf:URI>\n' +
    '         [--continuation-max-depth=20]\n' +
    '         [--prune-probability=1e-5]\n' +
    '         [--top-k=N]   [--top-p=X]\n' +
    '         [--temperature=T]   [--max-nodes=N]\n' +
    '         [--color=' + COLOR_MODES.join('|') + ']\n' +
    '         [--backend=' + BACKENDS.join('|') + ']\n' +
    '         [--context-size=N]\n' +
    '         [--block-size=N]   [--no-open]\n' +
    '         [output.html]'
  );
  process.exit(exitCode);
}

function parseNumber(flag, raw, { positive = false, integer = false, allowInfinity = false } = {}) {
  if (allowInfinity && (raw === 'inf' || raw === 'Infinity')) return Infinity;
  const v = Number(raw);
  if (!Number.isFinite(v)) {
    console.error('gpdu-llm-density: bad value for ' + flag + ': ' + raw);
    process.exit(2);
  }
  if (positive && !(v > 0)) {
    console.error('gpdu-llm-density: ' + flag + ' must be positive, got ' + raw);
    process.exit(2);
  }
  if (integer && !Number.isInteger(v)) {
    console.error('gpdu-llm-density: ' + flag + ' must be an integer, got ' + raw);
    process.exit(2);
  }
  return v;
}

async function main() {
  const argv = process.argv.slice(2);
  let prompt = null;
  let model = null;
  let maxDepth = 20;
  let pruneProbability = 1e-5;
  let topK = Infinity;
  let topP = 1.0;
  let temperature = 1.0;
  let maxNodes = Infinity;
  let colorBy = '[Level 1]';
  let backend = 'real';
  let contextSize = 2048;
  let blockSize = 500000;
  let noOpen = false;
  let prependBos = true;
  let noCache = false;
  let scanInPath = null;
  let scanOutPath = null;
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') usage(0);
    if (a === '--no-open') { noOpen = true; continue; }
    if (a === '--prepend-bos')    { prependBos = true;  continue; }
    if (a === '--no-prepend-bos') { prependBos = false; continue; }
    if (a === '--no-cache')       { noCache = true; continue; }
    if (a === '--scan-in' || a.startsWith('--scan-in=')) {
      scanInPath = a.includes('=') ? a.slice('--scan-in='.length) : argv[++i];
      continue;
    }
    if (a === '--scan-out' || a.startsWith('--scan-out=')) {
      scanOutPath = a.includes('=') ? a.slice('--scan-out='.length) : argv[++i];
      continue;
    }
    if (a === '--prompt' || a.startsWith('--prompt=')) {
      const v = a.includes('=') ? a.slice('--prompt='.length) : argv[++i];
      if (v === undefined) { console.error('gpdu-llm-density: --prompt requires a value'); process.exit(2); }
      prompt = v; continue;
    }
    if (a === '--model' || a.startsWith('--model=')) {
      const v = a.includes('=') ? a.slice('--model='.length) : argv[++i];
      if (v === undefined) { console.error('gpdu-llm-density: --model requires a value'); process.exit(2); }
      model = v; continue;
    }
    if (a.startsWith('--continuation-max-depth=')) { maxDepth = parseNumber('--continuation-max-depth', a.split('=')[1], { positive: true, integer: true }); continue; }
    if (a.startsWith('--prune-probability='))      { pruneProbability = parseNumber('--prune-probability', a.split('=')[1], { positive: true }); continue; }
    if (a.startsWith('--top-k='))                  { topK = parseNumber('--top-k', a.split('=')[1], { positive: true, allowInfinity: true }); continue; }
    if (a.startsWith('--top-p='))                  { topP = parseNumber('--top-p', a.split('=')[1], { positive: true }); continue; }
    if (a.startsWith('--temperature='))            { temperature = parseNumber('--temperature', a.split('=')[1], { positive: true }); continue; }
    if (a.startsWith('--max-nodes='))              { maxNodes = parseNumber('--max-nodes', a.split('=')[1], { positive: true, allowInfinity: true }); continue; }
    if (a.startsWith('--context-size='))           { contextSize = parseNumber('--context-size', a.split('=')[1], { positive: true, integer: true }); continue; }
    if (a.startsWith('--block-size='))             { blockSize = parseNumber('--block-size', a.split('=')[1], { positive: true, integer: true }); continue; }
    if (a === '--color' || a === '--color-by' || a.startsWith('--color=') || a.startsWith('--color-by=')) {
      colorBy = a.includes('=') ? a.split('=')[1] : argv[++i];
      if (!COLOR_MODES.includes(colorBy)) {
        console.error('Unknown --color mode: ' + colorBy + '\nValid modes: ' + COLOR_MODES.join(', '));
        process.exit(2);
      }
      continue;
    }
    if (a === '--backend' || a.startsWith('--backend=')) {
      backend = a.includes('=') ? a.split('=')[1] : argv[++i];
      if (!BACKENDS.includes(backend)) {
        console.error('Unknown --backend: ' + backend + '\nValid: ' + BACKENDS.join(', '));
        process.exit(2);
      }
      continue;
    }
    if (a.startsWith('--')) { console.error('gpdu-llm-density: unknown flag: ' + a); usage(2); }
    positional.push(a);
  }

  if (prompt === '-' || (prompt === null && !process.stdin.isTTY)) {
    try { prompt = fs.readFileSync(0, 'utf8'); } catch (e) { console.error('gpdu-llm-density: failed to read stdin: ' + e.message); process.exit(1); }
  }

  const modelSlug = (model || 'cached').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
  const out = positional[0]
    ? path.resolve(positional[0])
    : path.join(os.tmpdir(), 'gpdu-llm-density-' + modelSlug + '-' + Date.now() + '.html');

  // Cached scan path: explicit --scan-out wins; otherwise derive from the
  // HTML output path. The cache file is a gzipped JSON blob containing the
  // normalized scan + the prompt + model + opts metadata, independent of any
  // UI choices (color mode, theme, etc.). If it already exists, we skip the
  // LLM entirely and emit HTML from the cached scan — handy for iterating on
  // the rendering pipeline without paying the 11-minute model cost again.
  const scanCachePath = scanOutPath || scanInPath || deriveScanCachePath(out);

  const opts = { maxDepth, pruneProbability, topK, topP, temperature, maxNodes };

  let scan, scanPrompt, scanModelLabel, fromCache = false;
  const explicitIn = scanInPath != null;
  const cacheExists = fs.existsSync(scanCachePath);

  if (explicitIn || (cacheExists && !noCache)) {
    if (!cacheExists) {
      console.error('gpdu-llm-density: --scan-in path does not exist: ' + scanCachePath);
      process.exit(1);
    }
    process.stderr.write('  loading cached scan: ' + scanCachePath + '\n');
    const cached = loadScanJson(scanCachePath);
    scan = { ...cached.scan, counts: cached.counts };
    scanPrompt = (prompt !== null && prompt !== '') ? prompt : cached.meta.prompt;
    scanModelLabel = cached.meta.modelLabel;
    fromCache = true;
  } else {
    if (!model) { console.error('gpdu-llm-density: --model is required (no cached scan found at ' + scanCachePath + ')'); usage(2); }
    if (prompt === null || prompt === '') {
      console.error('gpdu-llm-density: --prompt is required (or pipe text via stdin)');
      usage(2);
    }
    process.stderr.write('  loading backend: ' + backend + '\n');
    const be = backend === 'stub'
      ? makeStubBackend(model)
      : await loadRealBackend(model, { contextSize, prependBos });

    process.stderr.write('  prompt: ' + JSON.stringify(prompt.length > 80 ? prompt.slice(0, 40) + '…' + prompt.slice(-40) : prompt) + '\n');

    const t0 = Date.now();
    let buildErr = null;
    try {
      scan = await buildScan(be, prompt, opts);
    } catch (e) {
      buildErr = e;
    }
    const elapsed = Date.now() - t0;
    scanPrompt = prompt;
    scanModelLabel = be.modelLabel();

    // Save the scan cache *before* writing HTML — and even if buildScan
    // threw partway through, so a crashed/interrupted build still leaves
    // a usable artifact for re-rendering. buildScan's SIGINT handler
    // already returns a partial-but-consistent scan, so the common case
    // (Ctrl-C during build) lands here with a valid `scan` object.
    if (scan) {
      saveScanJson(scanCachePath, scan, {
        type: 'llm-density',
        prompt: scanPrompt,
        modelLabel: scanModelLabel,
        backend, model, opts,
        cliCommand: buildCliCommand('gp-visualize-llm-continuation-density'),
        builtAt: new Date().toISOString(),
        buildMs: elapsed,
      });
      process.stderr.write('  saved scan: ' + scanCachePath +
        '  (' + (fs.statSync(scanCachePath).size / 1024).toFixed(1) + ' KB gz)\n');
    }

    if (typeof be.dispose === 'function') { try { await be.dispose(); } catch {} }
    if (buildErr && !scan) { throw buildErr; }
  }

  buildHtml(out, scanPrompt, scanModelLabel, scan, colorBy, blockSize);

  console.log('');
  console.log((fromCache ? 'loaded ' : 'built ') + 'tree from ' + scanModelLabel + (fromCache ? ' (cached)' : ''));
  console.log('  nodes             ' + scan.counts.nodes.toLocaleString());
  console.log('  max depth         ' + scan.counts.maxDepth);
  console.log('  leaves            ' + scan.counts.leaves.toLocaleString());
  console.log('  mass explored     ' + (scan.counts.exploredMass * 100).toFixed(4) + '%');
  console.log('');
  console.log('wrote ' + out + '  (' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB)');

  if (!noOpen) {
    const { execSync } = await import('node:child_process');
    const openCmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { execSync(openCmd + ' ' + JSON.stringify(out)); } catch { console.log('open it with:  open "' + out + '"'); }
  }
}

// ---------------------------------------------------------------------------
// Scan cache (.scan.json.gz) — UI-independent payload that round-trips
// through buildHtml so you can iterate on rendering without re-running the
// model. Format intentionally close to scan-core.js's normalized scan
// shape, plus enough metadata to label the visualization.
// ---------------------------------------------------------------------------

function deriveScanCachePath(htmlPath) {
  return htmlPath.replace(/\.html?$/i, '') + '.scan.json.gz';
}

function saveScanJson(path, scan, meta) {
  const payload = {
    v: 1,
    type: meta.type || 'llm-density',
    meta,
    scan: {
      labels: scan.labels,
      parentIndices: scan.parentIndices,
      values: scan.values,
      attributes: scan.attributes,
    },
    counts: scan.counts,
  };
  const json = JSON.stringify(payload);
  const compressed = zlib.gzipSync(json, { level: 6 });
  fs.writeFileSync(path, compressed);
}

function loadScanJson(path) {
  const compressed = fs.readFileSync(path);
  const json = zlib.gunzipSync(compressed).toString();
  const payload = JSON.parse(json);
  if (!payload.v || !payload.scan) {
    throw new Error('not a recognized scan-cache file (missing v / scan): ' + path);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Scan builder — iterative-deepening "breadth-first within each depth pass,
// DFS-tree-order within a layer". Each pass D expands every frontier node
// at depth D-1, then snapshots. The cache cursor is repositioned per node
// by walking to the longest common ancestor in tokens and re-folding from
// there — for DFS-tree-order frontiers (siblings consecutive, cousins
// LCA-deep), this approaches the cost of single-step DFS while giving us
// per-depth complete snapshots for graceful Ctrl-C.
//
// Backend contract:
//
//   be.encodePrompt(text)                  -> number[]   (sync)
//   be.createSequence()                    -> seq        (sync)
//   be.distAtPath(seq, nodeTokens, { temperature })
//                                          -> Promise< Array<[tokenId, prob]> >
//        Re-positions the seq's KV cache so it holds `prompt + nodeTokens`,
//        then returns the next-token distribution at that position. The
//        backend tracks its own cursor and does LCA-rewind + forward-fold
//        to reach the target. `nodeTokens` is the token-id path from
//        ROOT (NOT including the prompt). `[]` returns distribution
//        immediately after the prompt itself. Returned entries are
//        sorted descending by prob and sum to ~1.
//   be.eosTokenId()                        -> number|null
//   be.decode(tokenId)                     -> string (display-safe; visible newlines etc.)
//   be.modelLabel()                        -> string
//   be.dispose?()                          -> Promise<void>      optional cleanup
// ---------------------------------------------------------------------------

async function buildScan(be, promptText, opts) {
  const labels = [];
  const parentIndices = [];
  const values = [];          // joint prob — 0 for internals, joint for leaves; aggValue reconciles
  const probability = [];     // conditional p|parent
  const depth = [];
  const tokenRank = [];       // 1-based sibling rank
  const surprisal = [];       // -log2(conditional)
  const leafReason = [];      // '(internal)' or 'max-depth' / 'pruned' / 'eos' / 'other-bucket'
  const tokenId = [];

  function push(label, parentIdx, value, p, d, rank, reason, tid) {
    labels.push(label);
    parentIndices.push(parentIdx);
    values.push(value);
    probability.push(p);
    depth.push(d);
    tokenRank.push(rank);
    surprisal.push(Number.isFinite(p) && p > 0 ? -Math.log2(p) : 0);
    leafReason.push(reason);
    tokenId.push(tid);
    return labels.length - 1;
  }

  const ROOT = push('(prompt)', -1, 0, 1.0, 0, NaN, '(internal)', -1);

  const promptTokens = be.encodePrompt(promptText);
  if (promptTokens.length === 0) {
    console.error('gpdu-llm-density: prompt tokenized to 0 tokens');
    process.exit(1);
  }
  const seq = be.createSequence();

  const { maxDepth, pruneProbability, topK, topP, temperature, maxNodes } = opts;
  const eosId = be.eosTokenId();

  const state = { nodeCount: 1, leafCount: 0, exploredMass: 0, deepest: 0, lastProgressAt: 0, pass: 0 };

  // Track the current root-to-cursor path for the progress display. Pushed
  // every time we descend into a child, popped on return.
  const currentPath = [];
  // Set by SIGINT handler. expand() checks this at every level and unwinds
  // cleanly, returning whatever partial tree has been built so far.
  let interrupted = false;
  const sigintHandler = () => {
    if (interrupted) {
      process.stderr.write('\n  ^C^C — exiting immediately without writing\n');
      process.exit(130);
    }
    interrupted = true;
    process.stderr.write('\n  ^C — interrupting; finalizing partial tree (press Ctrl-C again to abort)\n');
  };
  process.on('SIGINT', sigintHandler);

  function progress(force) {
    const now = Date.now();
    if (!force && now - state.lastProgressAt < 200) return;
    state.lastProgressAt = now;
    const pct = (state.exploredMass * 100).toFixed(2);
    // Build current-sentence indicator. Show the tail of the path so we keep
    // sight of where we are when paths get long. Visible-whitespace markers
    // (⏎ etc.) come pre-substituted in be.decode().
    let pathStr = currentPath.join('');
    const MAX = 50;
    if (pathStr.length > MAX) pathStr = '…' + pathStr.slice(-(MAX - 1));
    // Show iterative-deepening pass we're inside (pass D expands depth-(D-1)
    // nodes to create depth-D children), plus the depth of the current node
    // being expanded (= currentPath.length, matches what's in the » … «).
    const passStr = 'pass ' + state.pass + '/' + maxDepth;
    process.stderr.write('\r  nodes ' + state.nodeCount.toLocaleString().padStart(8) +
      '  ' + passStr.padEnd(10) +
      '  explored ' + pct.padStart(6) + '%' +
      '  »' + pathStr.padEnd(MAX) + '«   ');
  }

  // Joint probability per node, kept in lock-step with the labels array.
  // For internals we still ship value=0 to scan-core so aggValue's
  // bottom-up sum reconstructs the joint at every internal node; this
  // array is the cheap top-down precomputation we use locally for
  // pruning, terminate(), and orphan fix-up.
  const joints = [1.0];

  function terminate(nodeIdx, nodeJoint, reason) {
    leafReason[nodeIdx] = reason;
    values[nodeIdx] = nodeJoint;
    state.exploredMass += nodeJoint;
    state.leafCount++;
    progress(false);
  }

  // Reconstruct token-id path from ROOT to nodeIdx (NOT including prompt).
  function tokenPathOf(nodeIdx) {
    if (nodeIdx === 0) return [];
    const path = [];
    let cur = nodeIdx;
    while (cur !== 0) {
      path.unshift(tokenId[cur]);
      cur = parentIndices[cur];
    }
    return path;
  }

  // Cached human-readable path for the progress display.
  function refreshCurrentPath(nodeIdx) {
    currentPath.length = 0;
    if (nodeIdx === 0) return;
    const tids = tokenPathOf(nodeIdx);
    for (const tid of tids) currentPath.push(be.decode(tid));
  }

  // Expand a single node: ask the backend for the next-token distribution at
  // this node's prefix, apply top-k / top-p / prune-probability filters, push
  // the surviving children + the (other) residual into the tree arrays, and
  // return the list of newly-created non-leaf children (= next-pass frontier
  // contribution).
  async function expandNode(nodeIdx) {
    if (interrupted) return [];
    const d = depth[nodeIdx];
    const nodeJoint = joints[nodeIdx];
    if (d >= maxDepth) { terminate(nodeIdx, nodeJoint, 'max-depth'); return []; }
    if (state.nodeCount >= maxNodes) { terminate(nodeIdx, nodeJoint, 'pruned'); return []; }
    if ((state.nodeCount & 1023) === 0) {
      await new Promise(setImmediate);
      if (interrupted) return [];
    }

    refreshCurrentPath(nodeIdx);
    progress(false);

    let dist;
    try {
      dist = await be.distAtPath(seq, tokenPathOf(nodeIdx), { temperature });
    } catch (e) {
      // Defensive: backend error (context overflow, etc.). Terminate.
      terminate(nodeIdx, nodeJoint, 'pruned');
      return [];
    }

    // Apply top-p.
    let cum = 0, nucleusCutoff = dist.length;
    for (let i = 0; i < dist.length; i++) {
      cum += dist[i][1];
      if (cum >= topP) { nucleusCutoff = i + 1; break; }
    }
    const candidateCount = Math.min(Number.isFinite(topK) ? topK : dist.length, nucleusCutoff, dist.length);

    const newInternalChildren = [];
    let sumConditional = 0;
    for (let r = 0; r < candidateCount; r++) {
      const [tid, cond] = dist[r];
      if (!(cond > 0)) break;
      const childJoint = nodeJoint * cond;
      if (childJoint < pruneProbability) break;
      if (state.nodeCount >= maxNodes) break;
      const isEos = (eosId != null && tid === eosId);
      const isMaxDepth = !isEos && (d + 1 >= maxDepth);
      const label = isEos ? '(end)' : be.decode(tid);
      const rank = r + 1;
      const reason = isEos ? 'eos' : (isMaxDepth ? 'max-depth' : '(internal)');
      const childIdx = push(label, nodeIdx, 0, cond, d + 1, rank, reason, tid);
      joints.push(childJoint);
      state.nodeCount++;
      sumConditional += cond;
      if (isEos || isMaxDepth) {
        values[childIdx] = childJoint;
        state.exploredMass += childJoint;
        state.leafCount++;
        if (d + 1 > state.deepest) state.deepest = d + 1;
      } else {
        if (d + 1 > state.deepest) state.deepest = d + 1;
        newInternalChildren.push(childIdx);
      }
    }

    // Residual `(other)` leaf so the parent's joint reconciles via aggValue.
    const otherCond = Math.max(0, 1 - sumConditional);
    if (otherCond > 1e-12) {
      const otherJoint = nodeJoint * otherCond;
      push('(other)', nodeIdx, otherJoint, otherCond, d + 1, NaN, 'other-bucket', -1);
      joints.push(otherJoint);
      state.nodeCount++;
      state.leafCount++;
      state.exploredMass += otherJoint;
    }
    return newInternalChildren;
  }

  // Iterative deepening with DFS-tree-order within each pass. Frontier is
  // the set of nodes pending expansion. Each pass D pops every frontier
  // node (already in DFS-tree-order from how they were pushed), expands
  // them, and collects the next-pass frontier from the new internal
  // children. We snapshot the array length at the end of each completed
  // pass; if interrupted mid-pass we keep whatever partial work was done
  // (orphan fix-up at the bottom reconciles the sum invariant either way).
  let frontier = [ROOT];
  let lastCompletePassDepth = 0;

  try {
    for (let pass = 1; pass <= maxDepth; pass++) {
      if (interrupted) break;
      if (frontier.length === 0) break;
      state.pass = pass;

      const nextFrontier = [];
      for (const nodeIdx of frontier) {
        if (interrupted) break;
        const newKids = await expandNode(nodeIdx);
        for (const k of newKids) nextFrontier.push(k);
      }

      if (interrupted) break;
      lastCompletePassDepth = pass;
      frontier = nextFrontier;
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler);
  }
  progress(true);
  process.stderr.write('\n');

  // Orphan fix-up: any internal node that was pushed but never expanded
  // (an interrupted pass, or the depth-limit cutoff for the deepest pass)
  // would otherwise break the sum-of-children invariant at its parent.
  // Mark each such orphan as a 'pruned' leaf carrying its full joint, so
  // every internal node still aggregates to its expected mass.
  const childCount = new Array(labels.length).fill(0);
  for (let i = 1; i < parentIndices.length; i++) childCount[parentIndices[i]]++;
  let orphanCount = 0;
  for (let i = 1; i < labels.length; i++) {
    if (leafReason[i] === '(internal)' && childCount[i] === 0) {
      leafReason[i] = 'pruned';
      values[i] = joints[i];
      state.exploredMass += joints[i];
      state.leafCount++;
      orphanCount++;
    }
  }
  if (interrupted) {
    process.stderr.write('  interrupted at depth-pass ' + (lastCompletePassDepth + 1) +
      ' (last complete depth: ' + lastCompletePassDepth + '); finalized ' +
      orphanCount.toLocaleString() + ' un-expanded internal nodes as pruned leaves\n');
  } else if (orphanCount > 0) {
    // Normal completion: orphans = leaves of the deepest pass that the
    // depth-limit prevented from being expanded. They are conceptually
    // 'max-depth' but it's clearer to keep them as 'pruned' since they
    // didn't reach a real max-depth check (the pass loop terminated first).
    process.stderr.write('  finalized ' + orphanCount.toLocaleString() + ' depth-limit leaves\n');
  }

  return {
    labels, parentIndices, values,
    attributes: {
      probability: { kind: 'numeric',     values: probability },
      depth:       { kind: 'numeric',     values: depth },
      tokenRank:   { kind: 'numeric',     values: tokenRank },
      surprisal:   { kind: 'numeric',     values: surprisal },
      leafReason:  { kind: 'categorical', values: leafReason },
      tokenId:     { kind: 'numeric',     values: tokenId },
    },
    counts: {
      nodes: state.nodeCount,
      leaves: state.leafCount,
      maxDepth: state.deepest,
      exploredMass: state.exploredMass,
    },
  };
}

function softmaxWithTemperature(logits, T) {
  const n = logits.length;
  const out = new Float64Array(n);
  if (!(T > 0)) T = 1.0;
  let max = -Infinity;
  for (let i = 0; i < n; i++) { const v = logits[i] / T; if (v > max) max = v; }
  let sum = 0;
  for (let i = 0; i < n; i++) { const e = Math.exp(logits[i] / T - max); out[i] = e; sum += e; }
  if (sum > 0) for (let i = 0; i < n; i++) out[i] /= sum;
  return out;
}

function distToSortedEntries(dist) {
  const entries = [];
  for (let i = 0; i < dist.length; i++) if (dist[i] > 0) entries.push([i, dist[i]]);
  entries.sort((a, b) => b[1] - a[1]);
  return entries;
}

// Convert the `Map<Token, prob>` returned by controlledEvaluate (which
// documents iteration order as descending probability) into an
// [[token, prob], ...] array. Empty / missing map → [].
function mapToSortedEntries(probs) {
  if (!probs || probs.size === 0) return [];
  const entries = new Array(probs.size);
  let i = 0;
  for (const [tok, p] of probs) entries[i++] = [tok, p];
  return entries;
}

// ---------------------------------------------------------------------------
// Stub backend — deterministic synthetic distribution from a hash of the
// current token sequence. No model, no dependency; used by tests + demos.
// ---------------------------------------------------------------------------

const STUB_VOCAB = [
  ' the', ' a', ' an', ' and', ' or', ' but', ' so', ' if',
  ' fruit', ' apple', ' banana', ' arrow', ' time', ' flies',
  ' like', ' love', ' fly', ' fast', ' slow', ' high', ' low',
  ' is', ' was', ' will', ' would', ' could', ' should', ' may',
  ' very', ' really', ' quite', ' rather', ' too',
  ' good', ' bad', ' big', ' small', ' new', ' old',
  ' you', ' me', ' it', ' he', ' she', ' we', ' they',
  '.', ',', '!', '?', ';', ':',
  "'s", "n't", "'re", "'ll",
  '\n',
  '<eos>',
];

function makeStubBackend(modelArg) {
  const V = STUB_VOCAB.length;
  const EOS_ID = V - 1;

  function logitsForSequence(tokens) {
    const h = crypto.createHash('sha256');
    h.update(modelArg + '|');
    const tail = tokens.slice(Math.max(0, tokens.length - 32));
    for (const t of tail) h.update(String(t) + ',');
    const buf = h.digest();
    const logits = new Float32Array(V);
    for (let i = 0; i < V; i++) {
      const j = (i * 4) % (buf.length - 3);
      const u = (buf.readUInt32BE(j) >>> 0) / 4294967296;
      const commonBias = Math.max(0, 3.0 - i * 0.06);
      logits[i] = Math.log(u + 1e-9) + commonBias;
    }
    logits[EOS_ID] -= 4.0;
    return logits;
  }

  // Stub stores its "cache" as a token array. distAtPath just sets the array
  // to (promptTokens + nodeTokens) and computes logits from the hash. No LCA
  // optimization needed since the hash is cheap.
  return {
    promptTokens: null,
    encodePrompt(text) {
      const ids = [];
      for (let i = 0; i < text.length; i++) ids.push(text.charCodeAt(i) % V);
      this.promptTokens = ids;
      return ids;
    },
    createSequence() { return { tokens: [] }; },
    async distAtPath(seq, nodeTokens, { temperature }) {
      seq.tokens = (this.promptTokens || []).concat(nodeTokens);
      const logits = logitsForSequence(seq.tokens);
      const dist = softmaxWithTemperature(logits, temperature);
      return distToSortedEntries(dist);
    },
    eosTokenId() { return EOS_ID; },
    decode(id) {
      const raw = STUB_VOCAB[id] || '?';
      return raw.replace(/\n/g, '⏎').replace(/\r/g, '⏎').replace(/\t/g, '⇥');
    },
    modelLabel() { return '(stub: ' + modelArg + ')'; },
  };
}

// ---------------------------------------------------------------------------
// Real backend — `node-llama-cpp` (optional dependency).
//
// Lazy-imported so the package still installs / runs in stub mode without
// the native deps. Uses the v3 LlamaContextSequence API:
//
//   * model.tokenize(text) for tokenization
//   * model.tokens.eos for the EOS id
//   * seq.controlledEvaluate([[t, { generateNext: { probabilities: true } }]])
//     to fold `t` into the KV cache and get the full next-token distribution
//   * seq.evaluateWithoutGeneratingNewTokens(...) for the prompt-priming
//     bulk pass (no logits needed)
//   * seq.nextTokenIndex for checkpoints
//   * seq.eraseContextTokenRanges([{start,end}]) for rewinds — this is the
//     KV-cache pop that makes DFS O(depth) instead of O(nodes).
// ---------------------------------------------------------------------------

async function loadRealBackend(modelArg, { contextSize, prependBos }) {
  let llamaMod;
  try {
    llamaMod = await import('node-llama-cpp');
  } catch (e) {
    console.error('gpdu-llm-density: the `real` backend requires `node-llama-cpp` to be installed.');
    console.error('  npm install node-llama-cpp');
    console.error('Or pass `--backend=stub` to use a synthetic demo distribution.');
    process.exit(1);
  }
  const { getLlama, resolveModelFile } = llamaMod;

  // Resolve modelArg: path-or-URI.
  let modelPath;
  if (modelArg.endsWith('.gguf') || modelArg.startsWith('/') || modelArg.startsWith('./') || modelArg.startsWith('../')) {
    modelPath = path.resolve(modelArg);
    if (!fs.existsSync(modelPath)) {
      console.error('gpdu-llm-density: model file not found: ' + modelPath);
      process.exit(1);
    }
  } else {
    process.stderr.write('  resolving ' + modelArg + ' ...\n');
    modelPath = await resolveModelFile(modelArg, { cli: true });
  }
  process.stderr.write('  loading ' + modelPath + '\n');

  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const ctx = await model.createContext({ contextSize });
  let labelStr = modelArg + ' (' + path.basename(modelPath) + ')';

  // The backend keeps a cursor into the seq's KV cache, expressed as the
  // suffix of tokens currently held *after* the prompt. `null` means the
  // cache is uninitialized; the first distAtPath() call primes it. With
  // DFS-tree-order iteration in buildScan, the LCA-rewind path is short
  // for siblings (length-1 rewind + 0-token forward) and longer for
  // cousins (LCA + a short forward fold).
  let promptCache = null;        // Token[] — the prompt we primed with
  let cachedNodePath = null;     // Token[] — tokens after the prompt currently in the KV cache

  function tokenizePrompt(text) {
    const tokens = model.tokenize(text);
    if (!prependBos) return tokens;
    const bos = model.tokens.bos;
    return bos != null ? [bos, ...tokens] : tokens;
  }

  return {
    encodePrompt(text) {
      // HuggingFace tokenizers auto-prepend BOS for Llama-family models and
      // the next-token distribution depends on it heavily (without BOS the
      // model is conditioned on "mid-document text"; with BOS, "start of a
      // new document"). node-llama-cpp's tokenize() doesn't auto-prepend,
      // so we do it here. Disable with --no-prepend-bos.
      promptCache = tokenizePrompt(text);
      return promptCache.slice();
    },
    createSequence() { return ctx.getSequence(); },

    async distAtPath(seq, nodePath, { temperature }) {
      // Walk the KV cache to `prompt + nodePath`, then re-fold the last
      // token of (prompt + nodePath) via controlledEvaluate to obtain the
      // next-token distribution at this position.
      //
      // node-llama-cpp's sampler defaults topK=40 / topP=0.95 even when
      // we only ask for the probabilities map — that silently truncates
      // the returned distribution. We pass topK:0 / topP:1 so the full
      // vocabulary comes back and the `(other)` residual reflects the
      // actual long tail.
      const promptLen = promptCache.length;

      if (cachedNodePath === null) {
        // First call. Prime the cache with prompt + nodePath, splitting off
        // the last token for the logits-producing controlledEvaluate call.
        const allTokens = promptCache.concat(nodePath);
        if (allTokens.length > 1) {
          await seq.evaluateWithoutGeneratingNewTokens(allTokens.slice(0, allTokens.length - 1));
        }
        const lastTok = allTokens[allTokens.length - 1];
        const out = await seq.controlledEvaluate([
          [lastTok, { generateNext: { probabilities: true, options: { temperature, topK: 0, topP: 1 } } }],
        ]);
        cachedNodePath = nodePath.slice();
        return mapToSortedEntries(out[0]?.next?.probabilities);
      }

      // Subsequent call. LCA of cachedNodePath and nodePath.
      let lca = 0;
      const maxLca = Math.min(cachedNodePath.length, nodePath.length);
      while (lca < maxLca && cachedNodePath[lca] === nodePath[lca]) lca++;

      // Rewind to (promptLen + lca) if cache has more tokens than that.
      if (cachedNodePath.length > lca) {
        await seq.eraseContextTokenRanges([{ start: promptLen + lca, end: promptLen + cachedNodePath.length }]);
      }

      // We now need the controlledEvaluate to fold the LAST token of
      // `prompt + nodePath`. Three cases for what controlledEvaluate's
      // input array should be:
      //
      // (a) nodePath.length > lca (target has tokens beyond LCA): feed the
      //     middle bulk via evaluateWithoutGeneratingNewTokens, then
      //     controlledEvaluate the final token.
      // (b) nodePath.length === lca && nodePath.length > 0: cache is
      //     exactly at the target. Re-fold the final token by rewinding
      //     one more, then controlledEvaluate.
      // (c) nodePath.length === 0 (ROOT, revisit): rewind one prompt token
      //     and re-fold it via controlledEvaluate.
      let lastTok;
      if (nodePath.length > lca) {
        const middle = nodePath.slice(lca, nodePath.length - 1);
        if (middle.length > 0) {
          await seq.evaluateWithoutGeneratingNewTokens(middle);
        }
        lastTok = nodePath[nodePath.length - 1];
      } else if (nodePath.length > 0) {
        // Re-fold the last node token.
        await seq.eraseContextTokenRanges([{ start: promptLen + nodePath.length - 1, end: promptLen + nodePath.length }]);
        lastTok = nodePath[nodePath.length - 1];
      } else {
        // Re-fold the last prompt token.
        await seq.eraseContextTokenRanges([{ start: promptLen - 1, end: promptLen }]);
        lastTok = promptCache[promptLen - 1];
      }

      const out = await seq.controlledEvaluate([
        [lastTok, { generateNext: { probabilities: true, options: { temperature, topK: 0, topP: 1 } } }],
      ]);
      cachedNodePath = nodePath.slice();
      return mapToSortedEntries(out[0]?.next?.probabilities);
    },

    eosTokenId() { return model.tokens.eos ?? null; },
    decode(id) {
      const raw = model.detokenize([id]);
      return raw.replace(/\n/g, '⏎').replace(/\r/g, '⏎').replace(/\t/g, '⇥');
    },
    modelLabel() { return labelStr; },
    async dispose() {
      try { await ctx.dispose(); } catch {}
      try { await model.dispose(); } catch {}
    },
  };
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

const LEAF_REASON_COLORMAP = {
  '(internal)':   'hsl(220, 10%, 35%)',
  'max-depth':    'hsl(211, 70%, 52%)',
  'pruned':       'hsl(0,    0%, 55%)',
  'eos':          'hsl(300, 55%, 55%)',
  'other-bucket': 'hsl(48,  85%, 55%)',
};

function truncatePromptForDisplay(s, max = 110) {
  if (s.length <= max) return s;
  return s.slice(0, 50) + ' … ' + s.slice(-50);
}

const HELP_HTML_TEMPLATE = (fullPrompt) => `
<h2>gp-treemap &mdash; LLM continuation density</h2>
<p>Cell area is the joint probability that the LLM assigns to the prefix
  from the root token to that cell — i.e. P(prompt followed by these
  tokens). Sibling cells at any subtree sum to that subtree's joint
  probability; the entire treemap sums to 1.0.</p>
<p>At every internal node, a synthetic <code>(other)</code> leaf carries
  the residual mass that wasn't expanded — long-tail tokens dropped by
  <code>--top-k</code> / <code>--top-p</code> / <code>--prune-probability</code>
  all fold into it. The aggregates therefore reconcile exactly at every
  level.</p>
<h3>Prompt</h3>
<pre style="white-space:pre-wrap;font-size:12px;background:var(--page-bg,#fafafa);
  padding:6px 8px;border-radius:4px;border:1px solid var(--page-border,#0002);
  max-height:160px;overflow:auto;">${escapeHtml(fullPrompt)}</pre>
<h3>Color modes</h3>
<ul>
  <li><b>probability</b>: conditional p (given the parent) — Viridis.</li>
  <li><b>depth</b>: depth from the root token — Viridis.</li>
  <li><b>token-rank</b>: sibling rank (1 = most-likely sibling) — Viridis.</li>
  <li><b>surprisal</b>: −log₂(conditional) — Viridis (higher = redder).</li>
  <li><b>leaf-reason</b>: categorical — why the branch stopped expanding
    (<code>max-depth</code> / <code>pruned</code> / <code>eos</code> /
    <code>other-bucket</code>).</li>
</ul>
<h3>Mouse</h3>
<ul>
  <li><b>Hover</b>: see decoded token + conditional p + joint p.</li>
  <li><b>Click</b> a cell: select it; breadcrumb lights up.</li>
  <li><b>Scroll wheel</b> on a selected cell: walk focus up/down the
    ancestor chain.</li>
  <li><b>Double-click</b>: zoom into the cell.</li>
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
    color: var(--page-fg, #222); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw; }
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
    max-width: 620px; max-height: 80vh; overflow: auto; box-shadow: 0 8px 40px #000a;
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

function buildHtml(outPath, promptText, modelLabel, scan, colorBy, blockSize) {
  const fd = fs.openSync(outPath, 'w');
  const w = (s) => fs.writeSync(fd, s);

  const isLevel1 = colorBy === '[Level 1]';
  const isCategorical = isLevel1 || CATEGORICAL_MODES.includes(colorBy);
  const tmColorMode = isLevel1 ? 'level1' : (isCategorical ? 'categorical' : 'quantitative');
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

  const promptDisplay = truncatePromptForDisplay(promptText);

  w(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>treemap · LLM continuation density · ${escapeHtml(modelLabel)}</title>
<style>${PAGE_CSS}${COPY_BTN_CSS}</style>
</head>
<body>
<div class="title-row">
  ${COPY_BTN_HTML}
  <h1 title="${escapeHtml(promptText)}">"${escapeHtml(promptDisplay)}"</h1>
  <span class="stat"><b>${escapeHtml(modelLabel)}</b> model</span>
  <span class="stat"><b>${scan.counts.nodes.toLocaleString()}</b> nodes</span>
  <span class="stat"><b>${scan.counts.maxDepth}</b> max depth</span>
  <span class="stat"><b>${(scan.counts.exploredMass * 100).toFixed(3)}%</b> explored</span>
  <span class="spacer" style="flex:1"></span>
  <button id="help-btn" class="help-btn" title="Help">?</button>
</div>
<div class="app-toolbar">
  <span>color
    <select id="color-sel">
      <option value="[Level 1]" title="Color by the topmost visible ancestor (re-applies on zoom)">[Level 1]</option>
      <option value="probability">probability</option>
      <option value="depth">depth</option>
      <option value="token-rank">token-rank</option>
      <option value="surprisal">surprisal</option>
      <option value="leaf-reason">leaf-reason</option>
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
    ${HELP_HTML_TEMPLATE(promptText)}
  </div>
</div>
<gp-treemap id="tm"
  color-mode="${tmColorMode}"
  palette="${tmPalette}"
  gradient-intensity="0.6"
  value-format="p"
  min-cell-area="30"></gp-treemap>
<div id="bottom-bar">
  <div id="stats-bar"></div>
  <span id="scanned-note">built ${escapeHtml(when)}</span>
</div>

<script type="application/json" id="tmdata">
`);

  const { blocks, aggValue } = partitionBlocks(scan, blockSize);
  process.stderr.write('  partitioned into ' + blocks.length + ' blocks\n');

  w('{"v":3,"totalProb":1,"blocks":[');
  for (let bi = 0; bi < blocks.length; bi++) {
    const blockJson = JSON.stringify(encodeBlock(scan, blocks[bi], { aggValue }));
    const compressed = zlib.deflateRawSync(blockJson, { level: 6 });
    if (bi > 0) w(',');
    w('"' + compressed.toString('base64') + '"');
  }
  w(']}');

  const cfg = {
    defaultColorMode: colorBy,
    categoricalModes: CATEGORICAL_MODES,
    quantitativeModes: QUANTITATIVE_MODES,
    catColorMaps: { 'leaf-reason': LEAF_REASON_COLORMAP },
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
  if (!(v > 0)) return '0';
  if (v >= 0.01)   return (v * 100).toFixed(2) + '%';
  if (v >= 1e-4)   return (v * 100).toFixed(4) + '%';
  return v.toExponential(2);
};
<\/script>
<script>
${BUNDLE}
<\/script>
<script>
${LOADER_JS}
<\/script>
<script>
${copyButtonScript(buildCliCommand('gp-visualize-llm-continuation-density'))}
<\/script>
<script>
// Stats bar: focused-node detail (decoded token, conditional p, joint p, leaf reason).
window._bootReady.then(function () {
  var tm = document.getElementById('tm');
  var bar = document.getElementById('stats-bar');
  var store = window._store;
  function fmtP(v) {
    if (!(v > 0)) return '0';
    if (v >= 0.01)   return (v * 100).toFixed(2) + '%';
    if (v >= 1e-4)   return (v * 100).toFixed(4) + '%';
    return v.toExponential(2);
  }
  function subtreeNodes(nodeId) {
    var n = 0, stack = [nodeId];
    while (stack.length) {
      var id = stack.pop(); var nd = store.get(id);
      if (!nd) continue; n++;
      if (nd.childIds) for (var i = 0; i < nd.childIds.length; i++) stack.push(nd.childIds[i]);
    }
    return n;
  }
  function update() {
    var id = tm._focusId != null ? tm._focusId : tm._targetId != null ? tm._targetId : tm._tree ? tm._tree.roots[0] : null;
    if (id == null) { bar.textContent = ''; return; }
    var nd = store.get(id);
    if (!nd) { bar.textContent = ''; return; }
    var parts = [];
    parts.push('label: ' + (nd.label || ''));
    parts.push('joint: ' + fmtP(nd.value || 0));
    if (nd.probability != null && nd.probability === nd.probability) parts.push('p|parent: ' + fmtP(nd.probability));
    if (nd.leafReason && nd.leafReason !== '(internal)') parts.push('reason: ' + nd.leafReason);
    parts.push(subtreeNodes(id).toLocaleString() + ' nodes in subtree');
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
