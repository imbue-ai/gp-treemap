// Shared core for the gpdu-* CLI family.
//
// Each tool produces a normalized "scan" object with this shape:
//
//   scan = {
//     labels: string[],          // node label
//     parentIndices: number[],   // parent index, -1 for root
//     values: number[],          // self size; aggregated bottom-up by partitionBlocks
//     attributes: {              // per-node attribute arrays the loader exposes to the viewer
//       [name]: { kind: 'categorical' | 'numeric', values: any[] }
//     },
//     stubFields: { [name]: number[] }   // optional per-node values; included in stub records so
//                                        // unexpanded subtrees can carry pre-computed aggregates
//   }
//
// scan-core.js exposes:
//   * `partitionBlocks(scan, targetSize)` — block-partition the flat arrays.
//   * `encodeBlock(scan, block, ctx)`     — encode one block as a JSON envelope.
//   * `humanBytes`, `escapeHtml`          — small shared utilities.
//   * `LOADER_JS`                          — browser-side IIFE source string,
//                                           inlined into each tool's HTML.
//
// scan-core.js does *not* render HTML page chrome. Each tool writes its own
// title row, app toolbar, stats bar, and help modal — calling into this
// module only for the heavy mechanics.

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { LOADER_JS } from '../dist/scan-loader.embed.js';

export { LOADER_JS };

// Scan-cache JSON (gzipped). Each gpdu-* tool writes its pre-encoded
// wire-format envelope to disk alongside the HTML output, so subsequent
// runs can re-emit HTML without re-doing the slow build step (directory
// walk, LLM forward passes, parquet read, …) AND without re-doing the
// partition/encode pipeline.
//
// Format (v=2):
//   { v: 2,
//     type: 'directory' | 'llm-density' | …,   // tool short id
//     meta: { target, cliCommand, builtAt, scanMs, counts: {…}, … },
//     envelope: {                              // wire format (v=3 internal)
//       v: 3,
//       totalBytes | totalProb | totalFiles…,  // tool-specific scalars
//       blocks: ['b64...', 'b64...', …]        // independently
//                                              // base64+deflate-compressed
//     }
//   }
//
// Each block string is small (~target-blocksize bytes worth of nodes,
// compressed), so the array can be many GB cumulatively without any
// single value tripping V8's ~512 MB string-length ceiling — that's why
// the cache survives even at the 11 M-node home-directory scale.
export function deriveScanCachePath(htmlPath) {
  return htmlPath.replace(/\.html?$/i, '') + '.scan.json.gz';
}

// Streaming JSON+gzip writer for the scan cache. Big `blocks` arrays are
// emitted one element at a time so no single JSON.stringify call sees a
// payload bigger than one block (~1–15 MB for typical block sizes),
// keeping us comfortably under V8's ~512 MB per-string ceiling regardless
// of scan size. The wrapper object (v / type / meta) is small enough to
// stringify whole; the `envelope` object is special-cased so its
// `blocks` array streams element-by-element while its scalar fields
// (totalBytes / totalProb / totalFiles / …) get included normally.
export async function saveScanJson(filePath, envelope, meta) {
  const { pipeline } = await import('node:stream/promises');
  const { Readable } = await import('node:stream');

  async function* gen() {
    yield '{"v":2,"type":';
    yield JSON.stringify(meta.type || 'unknown');
    yield ',"meta":';
    yield JSON.stringify(meta);
    yield ',"envelope":';
    yield* genValue(envelope);
    yield '}';
  }
  function* genValue(v) {
    if (Array.isArray(v)) {
      if (v.length === 0) { yield '[]'; return; }
      yield '[';
      for (let i = 0; i < v.length; i++) {
        if (i > 0) yield ',';
        yield* genValue(v[i]);
      }
      yield ']';
    } else if (v && typeof v === 'object') {
      yield '{';
      let first = true;
      for (const [k, val] of Object.entries(v)) {
        if (!first) yield ',';
        first = false;
        yield JSON.stringify(k) + ':';
        yield* genValue(val);
      }
      yield '}';
    } else {
      yield JSON.stringify(v);
    }
  }

  await pipeline(
    Readable.from(gen()),
    zlib.createGzip({ level: 6 }),
    fs.createWriteStream(filePath),
  );
}

export function loadScanJson(filePath) {
  const compressed = fs.readFileSync(filePath);
  const json = zlib.gunzipSync(compressed).toString();
  const payload = JSON.parse(json);
  if (!payload.v || !payload.envelope) {
    throw new Error('not a recognized scan-cache file (missing v / envelope): ' + filePath);
  }
  return payload;
}

export function humanBytes(v) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0, n = v;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  const s = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  return s + ' ' + units[i];
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Block partitioning. Two strategies share the same output shape (so
// encodeBlock and the browser loader don't care which one produced the
// blocks) but order the rows very differently:
//
//   * `partitionBlocks` (default, DFS-subtree-first): each block contains
//     a contiguous SUBTREE slice. Stubs at subtree boundaries lazily
//     reference child blocks. Good fit when the renderer drills *into*
//     a focused subtree (the canonical "zoom in" gesture).
//
//   * `partitionBlocksBFS`: each block contains a contiguous BFS slice
//     across the whole tree, cut on parent boundaries (so all of one
//     parent's children always live in the same block — guaranteeing
//     each stub still points to exactly one child block). Good fit when
//     the renderer paints level-by-level, since the visually-near
//     "shallow" nodes all land in early blocks.
//
// Both produce `{ blocks, childIds, aggValue }` and use the same
// `block.stubs[i] = { gi, localRow, childBlockId }` representation.
export function partitionBlocks(scan, targetSize = 50000) {
  const n = scan.labels.length;
  const pi = scan.parentIndices;

  const childIds = new Array(n);
  for (let i = 0; i < n; i++) childIds[i] = null;
  for (let i = 1; i < n; i++) {
    const p = pi[i];
    if (childIds[p] === null) childIds[p] = [];
    childIds[p].push(i);
  }

  // Subtree node count, reverse pass.
  const subtreeSize = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    subtreeSize[i] = 1;
    if (childIds[i]) for (const c of childIds[i]) subtreeSize[i] += subtreeSize[c];
  }

  // Aggregate value (bytes / serialized-size / etc.), reverse pass.
  const aggValue = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    aggValue[i] = scan.values[i];
    if (childIds[i]) for (const c of childIds[i]) aggValue[i] += aggValue[c];
  }

  const blocks = [];

  function buildBlock(rootGi) {
    const blockId = blocks.length;
    const block = { globalRows: [], stubs: [] };
    blocks.push(block);

    function visit(gi) {
      block.globalRows.push(gi);
      if (!childIds[gi]) return;
      for (const c of childIds[gi]) {
        if (!childIds[c]) {
          block.globalRows.push(c);
        } else if (block.globalRows.length + subtreeSize[c] <= targetSize) {
          visit(c);
        } else {
          const stubLocalRow = block.globalRows.length;
          block.globalRows.push(c);
          block.stubs.push({ gi: c, localRow: stubLocalRow, childBlockId: -1 });
        }
      }
    }
    visit(rootGi);

    for (const stub of block.stubs) {
      stub.childBlockId = buildBlock(stub.gi);
    }
    return blockId;
  }
  buildBlock(0);

  return { blocks, childIds, aggValue };
}

// BFS-order partitioner. Same `{ blocks, childIds, aggValue }` output and
// same single-`childBlockId` stub model as `partitionBlocks`, but within
// each block the nodes are arranged in BFS-from-block-root order (the
// block contains a "rough sphere" of descendants around its root, with
// each branch going as deep as space allows).
//
// Each block: starts at a block-root, BFS-expands children until adding
// the next parent's entire child-set would push the block over
// `targetSize`. That parent then becomes a stub (a leaf-placeholder in
// the current block), and a child block is built rooted at that stub
// node — recursively the same logic. So every parent's children stay
// together in one block, and every stub points to exactly one child
// block whose root is the stub node itself, matching the DFS scheme's
// loader semantics.
//
// Why this is useful: shallow descendants of the root land in block 0,
// deeper ones in later blocks — which is what a layer-by-layer renderer
// wants to paint first.
export function partitionBlocksBFS(scan, targetSize = 50000, firstBlockSize = targetSize) {
  const n = scan.labels.length;
  const pi = scan.parentIndices;

  const childIds = new Array(n);
  for (let i = 0; i < n; i++) childIds[i] = null;
  for (let i = 1; i < n; i++) {
    const p = pi[i];
    if (childIds[p] === null) childIds[p] = [];
    childIds[p].push(i);
  }

  // Subtree size and aggregated value, both reverse-pass.
  const subtreeSize = new Int32Array(n);
  const aggValue = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    subtreeSize[i] = 1;
    aggValue[i] = scan.values[i];
    if (childIds[i]) for (const c of childIds[i]) {
      subtreeSize[i] += subtreeSize[c];
      aggValue[i] += aggValue[c];
    }
  }

  const blocks = [];

  // Block 0 is built BFS-style with the same per-child subtree-fit logic
  // the DFS partitioner uses: a child whose entire subtree fits in the
  // remaining capacity gets admitted (and BFS-queued for further
  // expansion); otherwise it becomes a stub. This avoids the failure
  // mode where every parent at the block-cap boundary becomes its own
  // stub, cascading into thousands of size-2/-3 child blocks.
  //
  // Child blocks (post-stub) fall back to standard DFS subtree-first
  // packing — same algorithm as `partitionBlocks` — which produces
  // O(totalNodes / targetSize) blocks instead of growing with depth.
  function buildBlock0() {
    const block = { globalRows: [0], stubs: [] };
    blocks.push(block);
    const localRowOf = new Map([[0, 0]]);
    const q = [0];
    while (q.length > 0) {
      const parent = q.shift();
      const kids = childIds[parent];
      if (!kids) continue;
      for (const c of kids) {
        const remaining = firstBlockSize - block.globalRows.length;
        localRowOf.set(c, block.globalRows.length);
        block.globalRows.push(c);
        if (!childIds[c]) {
          // Leaf — already pushed; nothing more to do.
        } else if (subtreeSize[c] <= remaining) {
          // Entire subtree of c fits in this block; BFS-queue for layer-
          // by-layer expansion of its descendants in the rows that follow.
          q.push(c);
        } else {
          // Subtree too big — stub for a recursively-built DFS-style
          // sub-block.
          block.stubs.push({ gi: c, localRow: localRowOf.get(c), childBlockId: -1 });
        }
      }
    }
    for (const stub of block.stubs) {
      stub.childBlockId = buildSubBlock(stub.gi);
    }
  }

  function buildSubBlock(rootGi) {
    const blockId = blocks.length;
    const block = { globalRows: [], stubs: [] };
    blocks.push(block);
    function visit(gi) {
      block.globalRows.push(gi);
      if (!childIds[gi]) return;
      for (const c of childIds[gi]) {
        if (!childIds[c]) {
          block.globalRows.push(c);
        } else if (block.globalRows.length + subtreeSize[c] <= targetSize) {
          visit(c);
        } else {
          const stubLocalRow = block.globalRows.length;
          block.globalRows.push(c);
          block.stubs.push({ gi: c, localRow: stubLocalRow, childBlockId: -1 });
        }
      }
    }
    visit(rootGi);
    for (const stub of block.stubs) {
      stub.childBlockId = buildSubBlock(stub.gi);
    }
    return blockId;
  }

  buildBlock0();

  return { blocks, childIds, aggValue };
}

// Depth-band partitioner. Re-orders nodes by (depth, original-position),
// then slices the depth-sorted sequence into fixed-size chunks. Each
// chunk is a contiguous depth slice across the whole tree, so block 0
// holds the shallowest layers (root + depth 1 + depth 2 + …) up to
// `firstBlockSize`, block 1 picks up where block 0 left off, etc.
//
// Notable differences from `partitionBlocks` / `partitionBlocksBFS`:
//
//   * No stubs. A parent in block K with children in block K+1 simply
//     has `childIds === null` until block K+1 lands; the loader appends
//     each new node to its parent's `childIds` and the renderer redraws.
//   * Parents always live in EARLIER blocks. So every row's parent ref
//     is cross-block; the encoder writes a `parentGlobalB64` array (Int32
//     of global parent ids) instead of relying on local-row offsets.
//   * No fan-out limits — a layer wider than `blockSize` simply spans
//     multiple blocks, all at full capacity.
//
// Output shape:
//   {
//     blocks: [{ globalRows: number[], stubs: [] }, ...],
//     childIds,
//     aggValue,
//     reorder,    // new[i] = old-row-of-new-row-i  (= globalRows flat-concat)
//     newOrder,   // newOrder[oldGi] = newGi  (== inverse of reorder)
//   }
//
// `reorder` / `newOrder` let encodeBlock rewrite parentIndices in the
// new ordering; this is the only partitioner that touches the row order.
export function partitionBlocksDepthBand(scan, blockSize = 500000, firstBlockSize = blockSize) {
  const n = scan.labels.length;
  const pi = scan.parentIndices;

  const childIds = new Array(n);
  for (let i = 0; i < n; i++) childIds[i] = null;
  for (let i = 1; i < n; i++) {
    const p = pi[i];
    if (childIds[p] === null) childIds[p] = [];
    childIds[p].push(i);
  }

  // aggValue, reverse pass (used by encodeBlock for the values column).
  const aggValue = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    aggValue[i] = scan.values[i];
    if (childIds[i]) for (const c of childIds[i]) aggValue[i] += aggValue[c];
  }

  // Per-node depth. Root (-1 parent) = 0; parents always have a lower id
  // than children in a well-formed scan, so a forward pass works.
  const depth = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    depth[i] = pi[i] < 0 ? 0 : depth[pi[i]] + 1;
  }

  // Permutation: sort node indices by (depth ASC, originalId ASC). The
  // secondary sort by id preserves source-order within a layer, which keeps
  // adjacent siblings together for nicer locality in compressed blocks.
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // V8 sort doesn't apply to typed arrays as objects; do via plain Array.
  const orderArr = Array.from(order);
  orderArr.sort((a, b) => (depth[a] - depth[b]) || (a - b));

  // Slice into blocks. First block uses `firstBlockSize`; the rest use
  // `blockSize`. No layer-boundary alignment — a dense layer simply
  // continues across blocks.
  const blocks = [];
  let i = 0;
  while (i < n) {
    const cap = blocks.length === 0 ? firstBlockSize : blockSize;
    const end = Math.min(i + cap, n);
    const slice = orderArr.slice(i, end);
    blocks.push({ globalRows: slice, stubs: [] });
    i = end;
  }

  return { blocks, childIds, aggValue, depth };
}

// Build the full wire-format envelope for a scan. This is the JSON object
// that ends up inside `<script type="application/json" id="tmdata">` in
// the HTML output AND inside the scan-cache JSON — same shape in both
// places, so cache→HTML re-rendering is just "splice these base64 strings
// into the new HTML's tmdata" with no re-partition / re-encode work.
//
// Returns `{ v: 3, ...extraTopLevel, blocks: ['b64...', ...] }`. Each
// block is independently base64+deflate compressed; the array can be
// many GB cumulatively without any single string ever exceeding V8's
// per-string limit. `extraTopLevel` is for tool-specific scalars the
// existing loader knows about (`totalBytes`, `totalProb`, etc.).
//
// Caller is responsible for running the partitioner first. This lets
// tools that depend on the partition result (e.g. gpdu-scan needs
// `childIds` to compute per-node aggregate counts for stubFields)
// inspect or patch the scan between partition and encode.
export function buildEnvelope(scan, partitionResult, extraTopLevel = {}) {
  const { blocks: blockMetas, aggValue, depth } = partitionResult;
  // If the partitioner produced a `depth` array, it's the depth-band
  // variant and every block needs global parent ids (cross-block links).
  // Bump the envelope version so the loader picks the right code path.
  const useGlobalParents = depth != null;
  const v = useGlobalParents ? 4 : 3;
  const parentEncoding = useGlobalParents ? 'global' : 'local';
  const b64 = new Array(blockMetas.length);
  for (let i = 0; i < blockMetas.length; i++) {
    const json = JSON.stringify(encodeBlock(scan, blockMetas[i], { aggValue, parentEncoding }));
    b64[i] = zlib.deflateRawSync(json, { level: 6 }).toString('base64');
  }
  return { v, ...extraTopLevel, blocks: b64 };
}

// Write an envelope's JSON form into a file descriptor without ever
// stringifying the whole `blocks` array at once. Used both by the HTML
// emitter (writing into the `<script id="tmdata">` body) and tests that
// want to inspect the wire format. `write(s)` is any callback that
// accepts a string chunk (e.g. `(s) => fs.writeSync(fd, s)`).
export function writeEnvelopeJson(write, envelope) {
  write('{');
  let first = true;
  for (const k of Object.keys(envelope)) {
    if (k === 'blocks') continue;
    if (!first) write(',');
    first = false;
    write(JSON.stringify(k) + ':' + JSON.stringify(envelope[k]));
  }
  if (!first) write(',');
  write('"blocks":[');
  for (let i = 0; i < envelope.blocks.length; i++) {
    if (i > 0) write(',');
    write('"' + envelope.blocks[i] + '"');
  }
  write(']}');
}

// Encode one block as a JSON-serializable object. The browser-side loader
// (scan-loader.source.js) decodes the same shape.
//
// `ctx.parentEncoding` (optional, default 'local'):
//   * 'local': writes `piB64` with local-row offsets, -1 for "parent is
//     elsewhere". This is what partitionBlocks / partitionBlocksBFS need —
//     each block is subtree-rooted, parents are typically in this block.
//   * 'global': writes `pgB64` with the global parent id for every row.
//     This is what partitionBlocksDepthBand needs — blocks are depth
//     slices, so every parent is in some earlier block; the loader looks
//     parents up in the store rather than via local-row offsets.
export function encodeBlock(scan, block, ctx) {
  const { aggValue, parentEncoding = 'local' } = ctx;
  const stubFields = scan.stubFields || {};
  const stubFieldNames = Object.keys(stubFields);

  const gRows = block.globalRows;
  const m = gRows.length;

  const labels = new Array(m);
  const values = new Array(m);
  for (let i = 0; i < m; i++) {
    const gi = gRows[i];
    labels[i] = scan.labels[gi];
    values[i] = aggValue[gi];
  }

  // Parent references: one of two encodings (see ctx.parentEncoding).
  let parentRefs;
  if (parentEncoding === 'global') {
    const pg = new Int32Array(m);
    for (let i = 0; i < m; i++) pg[i] = scan.parentIndices[gRows[i]];
    parentRefs = { pgB64: Buffer.from(pg.buffer).toString('base64') };
  } else {
    const globalToLocal = new Map();
    for (let i = 0; i < m; i++) globalToLocal.set(gRows[i], i);
    const localPI = new Int32Array(m);
    for (let i = 0; i < m; i++) {
      const gp = scan.parentIndices[gRows[i]];
      localPI[i] = globalToLocal.has(gp) ? globalToLocal.get(gp) : -1;
    }
    parentRefs = { piB64: Buffer.from(localPI.buffer).toString('base64') };
  }

  // Per-attribute encoding. Categorical → enum-indexed Uint16. Numeric → Float64Array.
  const attributes = {};
  const inAttrs = scan.attributes || {};
  for (const name of Object.keys(inAttrs)) {
    const a = inAttrs[name];
    if (a.kind === 'categorical') {
      const slice = new Array(m);
      for (let i = 0; i < m; i++) slice[i] = a.values[gRows[i]];
      const names = [...new Set(slice)].sort();
      const toIdx = new Map(names.map((c, j) => [c, j]));
      const u16 = new Uint16Array(m);
      for (let j = 0; j < m; j++) u16[j] = toIdx.get(slice[j]);
      attributes[name] = { kind: 'categorical', names, b64: Buffer.from(u16.buffer).toString('base64') };
    } else if (a.kind === 'numeric') {
      const f64 = new Float64Array(m);
      for (let i = 0; i < m; i++) f64[i] = a.values[gRows[i]];
      attributes[name] = { kind: 'numeric', b64: Buffer.from(f64.buffer).toString('base64') };
    } else {
      throw new Error('Unknown attribute kind: ' + a.kind + ' (attr: ' + name + ')');
    }
  }

  // Stubs: [localRow, childBlockId, ...stubFieldValuesInOrder].
  const stubs = block.stubs.map((s) => {
    const row = [s.localRow, s.childBlockId];
    for (const name of stubFieldNames) row.push(stubFields[name][s.gi]);
    return row;
  });

  return {
    labels, values,
    ...parentRefs,
    grB64: Buffer.from(Int32Array.from(gRows).buffer).toString('base64'),
    attributes,
    stubFieldNames,
    stubs,
  };
}
