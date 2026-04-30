// Unit tests for tools/scan-core.js — block partitioning, encoding round-trip,
// and the small helper utilities. Independent of any one tool.
import { test, expect } from '@playwright/test';
import { partitionBlocks, encodeBlock, humanBytes, escapeHtml } from '../tools/scan-core.js';
import { Buffer } from 'node:buffer';

// ---- partitionBlocks ----

test('partitionBlocks: tiny tree fits in one block, no stubs', () => {
  // Tree:  root → a, b, c
  const scan = {
    labels: ['root', 'a', 'b', 'c'],
    parentIndices: [-1, 0, 0, 0],
    values: [0, 10, 20, 30],
    attributes: {},
  };
  const { blocks } = partitionBlocks(scan, 1000);
  expect(blocks.length).toBe(1);
  expect(blocks[0].globalRows).toEqual([0, 1, 2, 3]);
  expect(blocks[0].stubs).toEqual([]);
});

test('partitionBlocks: aggValue sums leaf values up the tree', () => {
  // Tree:  root → (a → (a1, a2), b)
  const scan = {
    labels: ['root', 'a', 'a1', 'a2', 'b'],
    parentIndices: [-1, 0, 1, 1, 0],
    values: [0, 0, 100, 200, 50],
    attributes: {},
  };
  const { aggValue } = partitionBlocks(scan, 1000);
  expect(aggValue[2]).toBe(100);
  expect(aggValue[3]).toBe(200);
  expect(aggValue[4]).toBe(50);
  expect(aggValue[1]).toBe(300);    // a = a1 + a2
  expect(aggValue[0]).toBe(350);    // root = a + b
});

test('partitionBlocks: oversized subtree becomes a stub with a child block', () => {
  // Build root → big-dir → 20 leaves
  const labels = ['root', 'big'];
  const parentIndices = [-1, 0];
  const values = [0, 0];
  for (let i = 0; i < 20; i++) {
    labels.push('leaf-' + i);
    parentIndices.push(1);
    values.push(1);
  }
  const scan = { labels, parentIndices, values, attributes: {} };
  // targetSize=10 means root+big can't include 20 leaves; big-dir becomes a stub
  // and the 20 leaves live in a separate child block.
  const { blocks } = partitionBlocks(scan, 10);
  expect(blocks.length).toBe(2);

  // Block 0 holds root + big (as a stub).
  expect(blocks[0].globalRows).toEqual([0, 1]);
  expect(blocks[0].stubs.length).toBe(1);
  expect(blocks[0].stubs[0].gi).toBe(1);
  expect(blocks[0].stubs[0].localRow).toBe(1);
  expect(blocks[0].stubs[0].childBlockId).toBe(1);

  // Block 1 holds big + its 20 leaves.
  expect(blocks[1].globalRows[0]).toBe(1);
  expect(blocks[1].globalRows.length).toBe(21);
  expect(blocks[1].stubs.length).toBe(0);
});

// ---- encodeBlock round-trip ----

test('encodeBlock: round-trip preserves labels, values, parent indices, attributes', () => {
  const scan = {
    labels: ['root', 'a', 'b'],
    parentIndices: [-1, 0, 0],
    values: [0, 100, 200],
    attributes: {
      cat:  { kind: 'categorical', values: ['x', 'y', 'x'] },
      num:  { kind: 'numeric',     values: [0, 1.5, 2.5] },
    },
  };
  const { blocks, aggValue } = partitionBlocks(scan, 1000);
  const encoded = encodeBlock(scan, blocks[0], { aggValue });

  expect(encoded.labels).toEqual(['root', 'a', 'b']);
  expect(encoded.values).toEqual([300, 100, 200]); // root aggregated

  // piB64 → Int32Array of local parent indices
  const piBuf = Buffer.from(encoded.piB64, 'base64');
  const localPI = new Int32Array(piBuf.buffer, piBuf.byteOffset, piBuf.byteLength / 4);
  expect(Array.from(localPI)).toEqual([-1, 0, 0]);

  // grB64 → Int32Array of global ids
  const grBuf = Buffer.from(encoded.grB64, 'base64');
  const gr = new Int32Array(grBuf.buffer, grBuf.byteOffset, grBuf.byteLength / 4);
  expect(Array.from(gr)).toEqual([0, 1, 2]);

  // Categorical attr: enum-indexed, names sorted
  const catAttr = encoded.attributes.cat;
  expect(catAttr.kind).toBe('categorical');
  expect(catAttr.names).toEqual(['x', 'y']);
  const catBuf = Buffer.from(catAttr.b64, 'base64');
  const catIdx = new Uint16Array(catBuf.buffer, catBuf.byteOffset, catBuf.byteLength / 2);
  expect(Array.from(catIdx).map(i => catAttr.names[i])).toEqual(['x', 'y', 'x']);

  // Numeric attr: Float64Array round-trip
  const numAttr = encoded.attributes.num;
  expect(numAttr.kind).toBe('numeric');
  const numBuf = Buffer.from(numAttr.b64, 'base64');
  const num = new Float64Array(numBuf.buffer, numBuf.byteOffset, numBuf.byteLength / 8);
  expect(Array.from(num)).toEqual([0, 1.5, 2.5]);
});

test('encodeBlock: stub records carry per-stub field values in declared order', () => {
  // Force a stub by oversizing a subtree.
  const labels = ['root', 'big'];
  const parentIndices = [-1, 0];
  const values = [0, 0];
  const stubFieldA = [0, 100];
  const stubFieldB = [0, 7];
  for (let i = 0; i < 5; i++) {
    labels.push('leaf-' + i);
    parentIndices.push(1);
    values.push(1);
    stubFieldA.push(0);
    stubFieldB.push(0);
  }
  const scan = {
    labels, parentIndices, values,
    attributes: {},
    stubFields: { aggA: stubFieldA, aggB: stubFieldB },
  };
  const { blocks, aggValue } = partitionBlocks(scan, 3);
  expect(blocks.length).toBeGreaterThan(1);

  // Block 0 holds root + big (stub).
  const enc0 = encodeBlock(scan, blocks[0], { aggValue });
  expect(enc0.stubFieldNames).toEqual(['aggA', 'aggB']);
  expect(enc0.stubs.length).toBe(1);
  // Stub layout: [localRow, childBlockId, ...stubFieldValues]
  expect(enc0.stubs[0]).toEqual([1, 1, 100, 7]);
});

// ---- humanBytes ----

test('humanBytes: scales across unit boundaries', () => {
  expect(humanBytes(0)).toBe('0.00 B');
  expect(humanBytes(512)).toBe('512 B');
  expect(humanBytes(1024)).toBe('1.00 KB');
  expect(humanBytes(1024 * 1024)).toBe('1.00 MB');
  expect(humanBytes(1.5 * 1024 * 1024)).toBe('1.50 MB');
  expect(humanBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
});

// ---- escapeHtml ----

test('escapeHtml: escapes the canonical five entities', () => {
  expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  expect(escapeHtml("It's & it's")).toBe('It&#39;s &amp; it&#39;s');
});
