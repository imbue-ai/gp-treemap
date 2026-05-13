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
import { LOADER_JS } from '../dist/scan-loader.embed.js';

export { LOADER_JS };

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
export function partitionBlocksBFS(scan, targetSize = 50000) {
  const n = scan.labels.length;
  const pi = scan.parentIndices;

  const childIds = new Array(n);
  for (let i = 0; i < n; i++) childIds[i] = null;
  for (let i = 1; i < n; i++) {
    const p = pi[i];
    if (childIds[p] === null) childIds[p] = [];
    childIds[p].push(i);
  }

  // Aggregate value, reverse pass (used by encodeBlock).
  const aggValue = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    aggValue[i] = scan.values[i];
    if (childIds[i]) for (const c of childIds[i]) aggValue[i] += aggValue[c];
  }

  const blocks = [];

  function buildBlock(rootGi) {
    const blockId = blocks.length;
    const block = { globalRows: [rootGi], stubs: [] };
    blocks.push(block);

    // Local row of each node in this block, for stub bookkeeping.
    const localRowOf = new Map([[rootGi, 0]]);

    // BFS frontier of nodes whose children we still need to consider adding
    // to *this* block. Each child-set is added atomically: if it fits, all
    // children join the block; otherwise the parent becomes a stub.
    const q = [rootGi];
    while (q.length > 0) {
      const parent = q.shift();
      const kids = childIds[parent];
      if (!kids) continue;

      // The block-root's children are always added (even if oversized), so
      // any node with more than `targetSize` direct children — say a vocab-
      // sized fan-out at the root — won't loop forever. After that, parent
      // child-sets only get added if they fit; otherwise the parent becomes
      // a stub and its child-set goes in a recursively-built child block.
      const isBlockRoot = parent === rootGi;
      if (isBlockRoot || block.globalRows.length + kids.length <= targetSize) {
        for (const c of kids) {
          localRowOf.set(c, block.globalRows.length);
          block.globalRows.push(c);
          if (childIds[c]) q.push(c);
        }
      } else {
        block.stubs.push({ gi: parent, localRow: localRowOf.get(parent), childBlockId: -1 });
      }
    }

    for (const stub of block.stubs) {
      stub.childBlockId = buildBlock(stub.gi);
    }
    return blockId;
  }
  buildBlock(0);

  return { blocks, childIds, aggValue };
}

// Encode one block as a JSON-serializable object. The browser-side loader
// (scan-loader.source.js) decodes the same shape.
export function encodeBlock(scan, block, ctx) {
  const { aggValue } = ctx;
  const stubFields = scan.stubFields || {};
  const stubFieldNames = Object.keys(stubFields);

  const gRows = block.globalRows;
  const m = gRows.length;
  const globalToLocal = new Map();
  for (let i = 0; i < m; i++) globalToLocal.set(gRows[i], i);

  const labels = new Array(m);
  const values = new Array(m);
  const localPI = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    const gi = gRows[i];
    labels[i] = scan.labels[gi];
    values[i] = aggValue[gi];
    const gp = scan.parentIndices[gi];
    localPI[i] = globalToLocal.has(gp) ? globalToLocal.get(gp) : -1;
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
    piB64: Buffer.from(localPI.buffer).toString('base64'),
    grB64: Buffer.from(Int32Array.from(gRows).buffer).toString('base64'),
    attributes,
    stubFieldNames,
    stubs,
  };
}
