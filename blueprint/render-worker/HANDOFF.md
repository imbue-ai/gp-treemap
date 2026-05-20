# Render-Worker — handoff

Goal: get the gp-treemap rendering pipeline (decompress → parse →
tree-build → layout → paint) off the main thread so giant scans
(`home_2.html`, ~7M nodes, 359 MB) stay interactive during load.

## What's shipped

Three commits on `main` (origin is up to date as of `8bae413`).

| Phase | Commit | What it does |
|-------|--------|--------------|
| A.0 | `210516c` | Worker scaffold. `dist/gp-treemap.worker.js` is the worker bundle; the main bundle inlines it as a string constant (`window.__gpTreemapWorkerSrc`) so the existing single-script HTML distribution still works. `<gp-treemap>` lazily instantiates the worker via Blob URL on mount; `_workerRequest(msg)` is the request/response helper. |
| A.1 | `5534524` | `paintAll` runs in the worker. Component still owns layout + colours + LUTs; it ships the cell list + LUT array, gets back `ImageData` (transferable), blits. Stale-paint suppression via `_paintSeq`. Sync fallback if worker errors. |
| A.3 | `8bae413` | The same paint call also writes a canvas-pixel-sized `Uint32Array` (cellIndex + 1 per pixel, 0 = background). Hit-test on the main thread is `idGrid[y * width + x] - 1` — O(1), no scan, no float-seam gaps. Old linear-scan stays as a one-frame fallback before paint lands. |

`tools/build.js` emits both `dist/gp-treemap.bundle.js` (main, IIFE)
and `dist/gp-treemap.worker.js` (worker, IIFE), plus the embed wrappers
that the `gpdu-*` CLIs splat into HTML.

Tests: 133 passing. The relevant new tests live in `tests/units.spec.js`
under `worker:` and `hit-test:`.

## What's NOT shipped (A.2 — the actual main-thread unblocking)

A.2 is "move layout + tree-build into the worker." It got most of the
way there but hit a structural snag and the dispatch from the
component is disabled. The worker-side handlers and helpers are
already in the bundle, so picking this up is a matter of getting the
serialisation right.

### What landed code-side (callable but unwired)

In `src/render-worker.js`:
- `let workerTree = null` — module-level tree cache.
- `case 'set-tree'` — receives `{nodes: Array<plain-obj>, roots: id[]}`,
  builds a Map.
- `case 'render'` — does the full pipeline:
  `layoutSubtreeWorker → resolveColors (with [Level 1] save/restore) →
   buildLUTs → paintAll → paintIdGrid`. Returns
  `{imageData, idGrid, leaves, nodeRects}` (nodeRects is a flat
  `[id, x, y, w, h, ...]` array).
- `layoutSubtreeWorker(nodes, rootId, baseDepth, cap, pad, splitBias, w, h)`
  — a non-lazy clone of the closure in `gp-treemap.js _paint`. Caches
  `_balRoot` on each node so subsequent renders skip `balanceChildren`.

In `src/painter.js`:
- `paintIdGrid(idGrid, width, height, cells)` — same rounding as
  `paintAll`, writes `cellIndex + 1`.

In `src/palettes.js`:
- `interpolatePalette(palette, count)` — moved out of `gp-treemap.js`
  so the worker bundle can see it.

In `src/gp-treemap.js`:
- `this._workerHasTree`, `this._postTreeToWorker()`,
  `this._paintEagerViaWorker(...)` — present, not called.

### Why it's not wired up

`_postTreeToWorker` builds a plain-object array of every node and
posts it via structured-clone. For ca-city (439k nodes) that's
~60 MB of `{...n}` spreads on the main thread, then another
spread per node in the worker. The `set-tree` message sits in the
worker's queue **ahead of paint** because workers process onmessage
serially — so the first paint stalls for several seconds while the
worker chews through the tree.

The test suite passes because it uses small trees where this is
imperceptible, but a real run on ca-city was hanging at >30 s waiting
for `set-tree` to complete. Hence the revert.

## What "doing A.2 right" looks like

Two paths, both viable.

### Option 1: tighten the wire format (smaller change)

Replace the array-of-objects `set-tree` payload with typed arrays:

```js
postMessage({
  type: 'set-tree',
  ids,                  // Array<string|number>  — can't be typed
  labels,               // Array<string>         — can't be typed
  parentIndicesBuf,     // Int32Array.buffer, transferable
  valuesBuf,            // Float64Array.buffer, transferable
  depthsBuf,            // Int32Array.buffer, transferable
  colorValues,          // Array<string|number>  — can't be typed
  // optional: isOther packed into a Uint8Array
}, [parentIndicesBuf, valuesBuf, depthsBuf]);
```

Worker reconstructs the Map (or, better, keeps it as parallel typed
arrays and rewrites `layoutSubtreeWorker` to index by integer slot
instead of `nodes.get(id)`). For ca-city this drops the message to
~10 MB and the cost to <50 ms.

For `gpdu-scan` (lazy), each block already has typed-array fields in
its envelope (`piB64`, `pgB64`, `grB64`, etc.). The loader inflates a
block, decodes it, posts to the worker — no rebuilding of plain
objects.

### Option 2: tree-build in the worker (bigger but cleaner)

Move `buildFromTabular` into the worker. The component's
labels/parents/values setters just stash the raw data and post to the
worker; the worker calls `buildFromTabular` internally and answers
`render` requests. Main thread loses direct access to `_tree.nodes`,
which breaks tests that poke at it.

Either keep a tiny main-thread shadow (just `_leaves` + `_nodeRects`
+ a leaf-id → ancestor-id-chain map, populated from each `render`
reply) or update tests to query the worker via a proper API.

This is the cleaner long-term shape but a bigger change. For the lazy
`gpdu-scan` case, `tools/scan-loader.source.js` also needs to be
refactored so blocks go straight to the worker instead of being
decoded into a main-thread store first.

### Recommendation

Do Option 1 first. The diff is much smaller, ships a real win for big
eager loads (ca-city), and proves the design works end-to-end. Once
you've measured wins there, decide if Option 2 is worth the surgery.

## Constraints / gotchas worth knowing

- **The `<gp-treemap>` element is the public API.** Tests + the gpdu-*
  CLIs assume `tm._tree.nodes`, `tm._nodeRects`, `tm._leaves` exist
  and reflect the most-recent render. Whatever you do, keep those
  populated (worker reply → main-thread shadow).
- **`tools/scan-loader.source.js` is the lazy path's whole runtime.**
  It owns the in-browser store today. To move to a worker, the loader
  itself (or its block-decoding half) needs to live in the worker.
  Inflation via `DecompressionStream` is fine in a worker — that's
  where it should run anyway.
- **`gpdu-scan` HTMLs inline the loader source from
  `dist/scan-loader.embed.js`.** Don't break the embed shape — each
  gpdu CLI does `import { LOADER_JS } from '.../scan-loader.embed.js'`
  and splats it into a `<script>`.
- **Tests `tests/gpdu-llm-density.spec.js`** use a `parseScanHtml`
  helper that reads `pgB64` (v=4) or `piB64` (v=3) from the first
  block. If you change the wire format, update there too.
- **Stretch-zoom uses `_stretchZoomId` + `_stretchZoomAspect`** to
  bias layout splits. `_paintEagerViaWorker` already computes the
  `splitBias` and passes it; preserve that.
- **`[Level 1]` color mode** mutates `colorValue` per node and must
  restore after a render so subsequent renders under a different
  color mode see the original values. `eagerRender` already does the
  save/restore in `level1Originals`.
- **`_paintSeq`** must be incremented at the start of every paint so
  stale replies are dropped. The current pattern is right; keep it.
- **`_idGrid` is sized to `_canvas.width × _canvas.height`** in
  canvas pixels (DPR-scaled). Hit-test maps clientX/Y to canvas
  pixels and reads the index. Don't ship a CSS-pixel idGrid by
  accident.

## Suggested first commit on this thread

1. Add a `set-tree-flat` worker message that accepts the typed-array
   shape from Option 1. Keep the existing `set-tree` for now.
2. Reactivate `_postTreeToWorker` (renaming the new one
   `_postTreeFlatToWorker`) using the typed-array shape.
3. Re-enable the dispatch in `_paint`. Verify the ca-city profile
   drops below ~150 ms ScriptDuration.
4. If win confirmed, delete the old `set-tree` and rename `-flat`
   away.

Aim for one shippable commit per step. The full suite is the
regression gate; visual snapshot tests under `tests/visual.spec.js`
catch most rendering regressions.

## Reference files

- `src/gp-treemap.js` — web component, `_paint`, worker glue.
- `src/render-worker.js` — worker entry + dormant A.2 code.
- `src/painter.js` — `paintAll`, `paintIdGrid`.
- `src/layout.js`, `src/balancer.js` — pure layout (used by both sides).
- `tools/build.js` — bundle emitter.
- `tools/scan-loader.source.js` — lazy `gpdu-scan` loader (the next
  big refactor target).
- `blueprint/render-worker/HANDOFF.md` — this file.

Good luck.
