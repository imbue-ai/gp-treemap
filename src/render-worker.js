// Worker entry. Bundled by tools/build.js as a string constant that
// the main bundle turns into a Blob-URL Worker at runtime. Lives in
// its own bundle (no DOM, no <gp-treemap> element) — just the pure
// computation modules (balancer, layout, builder, color-resolver,
// color-scale, lut, painter, hash, palettes, format).

let workerTree = null;  // { nodes: Map<id, node>, roots: id[] } — set by 'set-tree'

// Layout body — non-lazy version of the closure inside gp-treemap.js's
// _paint. Walks the visible subtree from `rootId`, balancing each
// non-leaf's children into a binary split tree and tiling its rect.
// Returns the per-node rect map + the leaves the painter will draw.
function layoutSubtreeWorker(nodes, rootId, baseDepth, cap, pad, splitBias, w, h) {
  const leavesCollect = [];
  const inSubtree = new Set();
  const nodeRects = new Map();
  function walk(nodeId, rect) {
    inSubtree.add(nodeId);
    nodeRects.set(nodeId, rect);
    const node = nodes.get(nodeId);
    if (!node) return;
    const atCap = node.depth >= cap;
    if (atCap || !node.childIds || node.childIds.length === 0) {
      leavesCollect.push({ node, rect });
      return;
    }
    const kids = node.childIds.map((cid) => nodes.get(cid)).filter(Boolean);
    let balRoot = node._balRoot;
    if (!balRoot) {
      balRoot = balanceChildren(kids.map((k) => ({ id: k.id, size: Math.max(0, k.value) })));
      node._balRoot = balRoot;
    }
    const childRects = new Map();
    if (balRoot) layoutTree(balRoot, rect, (id, r) => childRects.set(id, r), splitBias);
    for (const kid of kids) {
      const r = childRects.get(kid.id);
      if (!r) continue;
      let sub = r;
      if (pad > 0 && kid.childIds && kid.childIds.length > 0) {
        const px = Math.min(pad, r.w / 2 - 1);
        const py = Math.min(pad, r.h / 2 - 1);
        if (px > 0 && py > 0) sub = { x: r.x + px, y: r.y + py, w: r.w - 2 * px, h: r.h - 2 * py };
      }
      walk(kid.id, sub);
    }
  }
  walk(rootId, { x: 0, y: 0, w, h });
  return { leavesCollect, inSubtree, nodeRects };
}

// Run the full eager render: layout → colors → LUTs → paint → idGrid.
// Returns the response payload the main thread expects (plus the typed-
// array buffers that should be transferred zero-copy).
function eagerRender(params) {
  if (!workerTree) throw new Error('no tree posted to worker (call set-tree first)');
  const { nodes, roots } = workerTree;
  const {
    width, height, visibleRootId, displayDepth,
    groupPaddingPx, splitBias, palette, gradientIntensity,
    background, colorMode, colorScale, colorDomain, colorMap, level1, locatedNodeIds,
  } = params;
  const rootId = visibleRootId != null && nodes.has(visibleRootId) ? visibleRootId : roots[0];
  if (rootId == null) {
    const empty = new ImageData(width, height);
    return { imageData: empty, idGrid: new Uint32Array(width * height), leaves: [], nodeRects: [] };
  }
  const rootNode = nodes.get(rootId);
  const baseDepth = rootNode.depth | 0;
  const cap = baseDepth + (displayDepth === 'Infinity' || displayDepth == null ? 99 : Math.max(0, displayDepth | 0));
  const { leavesCollect, inSubtree, nodeRects } =
    layoutSubtreeWorker(nodes, rootId, baseDepth, cap, groupPaddingPx, splitBias || 1, width, height);

  let activePalette = palette;
  if (colorMode === 'quantitative' && activePalette.length < 64) {
    activePalette = interpolatePalette(activePalette, 64);
  }
  const subtree = Array.from(inSubtree).map((id) => nodes.get(id));
  let effectiveColorMode = colorMode;
  // [Level 1] overrides colorValue with the ancestor's id. Save originals
  // so a subsequent render under a different colorMode sees the real
  // colorValues — the worker tree persists across renders.
  let level1Originals = null;
  if (colorMode === 'level1') {
    level1Originals = new Map();
    for (const nd of subtree) {
      level1Originals.set(nd.id, nd.colorValue);
      let cur = nd;
      while (cur && cur.id !== rootId && cur.parentId != null && cur.parentId !== rootId) {
        cur = nodes.get(cur.parentId);
        if (!cur) break;
      }
      nd.colorValue = cur ? cur.id : nd.id;
    }
    effectiveColorMode = 'categorical';
  }
  resolveColors(subtree, effectiveColorMode, {
    palette: activePalette, colorScale, colorDomain, colorMap: colorMap || {},
  });
  if (level1Originals) {
    for (const nd of subtree) nd.colorValue = level1Originals.get(nd.id);
  }

  const assigned = new Map();
  for (const { node, rect } of leavesCollect) assigned.set(node.id, rect);
  const luts = buildLUTs(activePalette, gradientIntensity);
  const overrideIndex = new Map();
  const located = new Set(locatedNodeIds || []);
  const renderLeaves = [];
  for (const { node: n } of leavesCollect) {
    if (!assigned.has(n.id)) continue;
    const r = assigned.get(n.id);
    let lutIndex;
    if (n.colorOverride) {
      let idx = overrideIndex.get(n.colorOverride);
      if (idx === undefined) {
        idx = luts.length;
        luts.push(buildLUTForCssColor(n.colorOverride, gradientIntensity));
        overrideIndex.set(n.colorOverride, idx);
      }
      lutIndex = idx;
    } else {
      lutIndex = n.colorIndex;
    }
    renderLeaves.push({
      id: n.id, label: n.label, value: n.value, depth: n.depth,
      parentId: n.parentId, isOther: n.isOther,
      isLocated: located.has(n.id),
      x: r.x, y: r.y, w: r.w, h: r.h, lutIndex,
    });
  }

  const image = new ImageData(width, height);
  paintAll(image, renderLeaves, luts, background);
  const idGrid = new Uint32Array(width * height);
  paintIdGrid(idGrid, width, height, renderLeaves);

  // Serialize nodeRects as a flat array — worker→main structured clone of
  // a Map of small objects is slower than a single array of [id, x, y, w, h].
  const nodeRectsFlat = [];
  for (const [id, r] of nodeRects) nodeRectsFlat.push(id, r.x, r.y, r.w, r.h);

  return { imageData: image, idGrid, leaves: renderLeaves, nodeRects: nodeRectsFlat };
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'ping': {
      // Bounce back so the main thread can verify the worker bundle
      // is wired up correctly. Includes the count of exported symbols
      // we expect to be available — a smoke check that the painter +
      // layout modules made it into the worker bundle.
      const symbols = [
        typeof balanceChildren, typeof layoutTree, typeof buildFromTabular,
        typeof resolveColors, typeof buildLUTs, typeof paintAll,
        typeof fnv1a, typeof resolvePalette,
      ];
      self.postMessage({
        type: 'pong',
        id: msg.id,
        symbolsAvailable: symbols.every((t) => t === 'function'),
      });
      return;
    }
    case 'set-tree': {
      // Receives the eager-built tree from the main thread once after
      // buildFromTabular runs. We rebuild a fresh Map here so the worker
      // owns mutable per-node fields (`_balRoot` cache, `colorValue` etc.)
      // independent of the main-thread copy.
      const nodes = new Map();
      for (const n of msg.nodes) nodes.set(n.id, { ...n });
      workerTree = { nodes, roots: msg.roots };
      self.postMessage({ type: 'tree-set', id: msg.id, nodeCount: nodes.size });
      return;
    }
    case 'render': {
      // Full eager pipeline: layout → colors → LUTs → paintAll → idGrid.
      // Uses the cached worker tree (set via 'set-tree'). Returns ImageData
      // + idGrid as transferables plus the rendered-leaves array and a
      // flat nodeRects list for the main thread's overlay/breadcrumb.
      try {
        const out = eagerRender(msg.params);
        self.postMessage(
          {
            type: 'rendered', id: msg.id,
            imageData: out.imageData, idGrid: out.idGrid,
            leaves: out.leaves, nodeRects: out.nodeRects,
          },
          [out.imageData.data.buffer, out.idGrid.buffer],
        );
      } catch (err) {
        self.postMessage({ type: 'error', id: msg.id, error: String(err && err.message || err) });
      }
      return;
    }
    case 'paint': {
      // Inputs:
      //   width, height: canvas pixels.
      //   cells:        Array<{x, y, w, h, lutIndex}> — already-laid-out leaves.
      //   luts:         Array<Uint8ClampedArray> — one 256×4 ramp per LUT slot.
      //   background:   {r, g, b} (0..255) — fill colour for uncovered pixels.
      // Output:
      //   imageData: ImageData (transferable via its data.buffer).
      //   idGrid:    Uint32Array (width*height) — `cellIndex + 1` per pixel,
      //              0 = background. Lets the main thread do O(1) hit-test
      //              with a single memory read.
      try {
        const image = new ImageData(msg.width, msg.height);
        paintAll(image, msg.cells, msg.luts, msg.background);
        const idGrid = new Uint32Array(msg.width * msg.height);
        paintIdGrid(idGrid, msg.width, msg.height, msg.cells);
        self.postMessage(
          { type: 'painted', id: msg.id, imageData: image, idGrid },
          [image.data.buffer, idGrid.buffer],
        );
      } catch (err) {
        self.postMessage({ type: 'error', id: msg.id, error: String(err && err.message || err) });
      }
      return;
    }
    default:
      self.postMessage({ type: 'error', id: msg.id, error: 'unknown message type: ' + msg.type });
  }
};
