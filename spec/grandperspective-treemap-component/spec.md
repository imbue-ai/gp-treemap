Now I have enough context to write the spec. Let me also quickly check the mapping files for hash color logic:# `<gp-treemap>` Web Component — Implementation Specification

## Overview

`gp-treemap` is a standards-compliant Custom Element (`<gp-treemap>`) that renders interactive treemap visualizations with the look and feel of GrandPerspective: saturated flat colors with a "dome" light/dark gradient shading, a balanced binary-partition layout, and smooth zoom animations.

Built with **Stencil**, a single source produces:
- A native Custom Element usable in any HTML page or Electron/Tauri WebView
- An auto-generated **Vue 3 wrapper** (`@gp-treemap/vue`)
- An auto-generated **React wrapper** (`@gp-treemap/react`)

**Key UX summary:**
- Drop `<gp-treemap>` into a page, bind either tabular (`labels`/`parents`/`values`) or tree-root props, and a pixel-filled treemap renders immediately
- Cells are colored by `colorMode` prop; hovering shows a floating tooltip and highlights the toolbar info panel; clicking locks the selection
- The optional toolbar (on by default) provides breadcrumb, zoom in/out/reset, depth controls, and a color legend
- Arrow keys navigate siblings and parent/child; scroll wheel shifts selection depth; keyboard shortcuts drive zoom
- Zooming changes the visible root, animating via CSS transitions; the host app can subscribe to `zoom-change` events or drive `visibleRootId` as a controlled prop

---

## Expected Behavior

### Rendering
- Every leaf node below `minCellArea` threshold is silently merged into a synthetic `other` sibling node; no separate cell is rendered
- Each rendered cell is an SVG `<rect>` with a `<linearGradient>` fill that approximates GP's upper-left-bright / lower-right-dark dome shading
- `gradientIntensity=0` → flat fill; `gradientIntensity=1` → maximum contrast; default `0.5`
- Cell labels render only when the rectangle is wide/tall enough for legible text (minimum configurable via CSS custom property); off by default
- Nodes below `visibleRootId` and up to `displayDepth` levels deep are rendered; parent boundaries are shown as inset borders

### Interactions
| Trigger | Behavior |
|---|---|
| Mouse move over cell | Tooltip near cursor + toolbar info update; fires `gp-hover` CustomEvent |
| Mouse click | Locks selection; fires `gp-select`, `gp-click` CustomEvents |
| Double-click | Fires `gp-dblclick`; component internally zooms in |
| Arrow keys (when selection locked) | Navigate among siblings / into children / up to parent |
| Scroll wheel | Shifts selection depth focus |
| `+` / `=` / `-` / `0` keys | Zoom in / zoom out / reset zoom (configurable) |
| Resize | CSS-scale the existing SVG immediately; debounce 150 ms then re-layout in Worker |

### Zoom
- `visibleRootId` can be set externally (controlled) or managed internally (uncontrolled); both modes work simultaneously
- Every zoom action fires a `gp-zoom-change` CustomEvent: `{ nodeId, label, value, colorValue, depth, ancestorIds, isLocated }`
- Zoom transitions use CSS `transition` on SVG `transform`; `zoomDuration=0` → instant

### Data Flow
```
data prop change
    │
    ▼
  Web Worker: buildTree() + layoutTree()
    │
    ▼
  Main thread: animate old rects → new rects (FLIP)
    │
    ▼
  SVG DOM updated; CustomEvents fired
```

---

## Data Model

### Internal Node Object
```
TreeNode {
  id:           string          // stable; auto from path columns or getId() callback
  label:        string
  value:        number          // always size/area
  colorValue:   number | string // drives color (may differ from value)
  depth:        number
  parentId:     string | null
  childIds:     string[]
  isOther:      boolean         // synthetic collapsed node
  isLocated:    boolean         // in locatedNodeIds set
  rect:         { x, y, w, h } // computed by layout worker
  colorIndex:   number          // resolved palette index
}
```

### Layout Node (Worker-internal)
```
LayoutNode {
  id:    string
  size:  number
  // Binary-tree children (internal balancing nodes)
  left:  LayoutNode | null
  right: LayoutNode | null
  // Final rect
  rect:  { x, y, w, h }
}
```

### Tabular Input (Plotly-style)
```typescript
interface TabularData {
  labels:  string[]           // one entry per row
  parents: string[]           // "" for root rows
  values:  number[]           // area/size
  color?:  (number|string)[]  // color column; defaults to values
  ids?:    string[]           // optional stable IDs; auto-generated if absent
}
```

### Tree-root Input (accessor-based)
```typescript
interface TreeAccessors<T> {
  getChildren:  (node: T) => T[]
  getValue:     (node: T) => number
  getLabel:     (node: T) => string
  getColor?:    (node: T) => number | string
  getId:        (node: T) => string   // required; must be stable
}
```

### Color Configuration
```typescript
type ColorMode = 'categorical' | 'quantitative' | 'depth'
type ColorScale = 'linear' | 'log' | 'diverging' | 'quantile'

interface Palette {
  name?: 'gp-default' | 'heatmap' | 'rainbow' | string
  colors?: CSSColor[]   // override; length ≥ 2
}

// diverging domain: [minVal, midVal, maxVal] → [palette[0], palette[mid], palette[last]]
type ColorDomain = [number, number, number]

// categorical explicit map; absent keys use hash-based palette assignment
type ColorMap = Record<string, CSSColor>
```

### Toolbar Config
```typescript
interface ToolbarConfig {
  zoom?:    boolean | { keys: boolean }
  breadcrumb?: boolean
  info?:    boolean | { formatter: (node: TreeNode) => string }
  depth?:   boolean
  legend?:  boolean | { maxRows: number; slot: boolean }
}
```

### CustomEvent Payload
```typescript
interface TreemapEventDetail {
  nodeId:      string
  label:       string
  value:       number
  colorValue:  number | string
  depth:       number
  ancestorIds: string[]
  isLocated:   boolean
}
```

---

## Implementation Plan

### Repository Layout
```
packages/
  core/                     # Stencil component + worker
    src/
      components/
        gp-treemap/
          gp-treemap.tsx          # Stencil component root
          gp-treemap.css          # Shadow DOM styles
        gp-toolbar/
          gp-toolbar.tsx
        gp-tooltip/
          gp-tooltip.tsx
        gp-legend/
          gp-legend.tsx
      worker/
        treemap.worker.ts         # Runs in Web Worker
        layout.ts                 # BSP layout algorithm
        balancer.ts               # Binary tree balancer
        builder.ts                # Tabular → tree conversion
        color-resolver.ts         # Color index computation
      color/
        palettes.ts               # Built-in named palettes
        color-scale.ts            # linear/log/diverging/quantile
        gradient.ts               # SVG gradient definition generator
      types.ts                    # All exported TypeScript types
      utils/
        hash.ts                   # FNV-1a string hash
        format.ts                 # valueFormat d3-format-style
  vue/                      # Auto-generated by Stencil + thin wrapper
  react/                    # Auto-generated by Stencil + thin wrapper
tests/
  unit/
    layout.test.ts
    balancer.test.ts
    builder.test.ts
    color-scale.test.ts
  e2e/
    basic-render.spec.ts
    interactions.spec.ts
    zoom.spec.ts
    keyboard.spec.ts
    data-change.spec.ts
  visual/
    snapshots/              # Chromium golden images
    visual.spec.ts
```

### `layout.ts` — Clean-room BSP Layout Engine
**Concept** (inspired by GP's `TreeLayoutBuilder`):
- `layoutTree(root: LayoutNode, rect: Rect, minArea: number): void`
  - Recursively split rect based on `left.size / root.size` ratio
  - If `rect.w > rect.h`: split along X axis (divide width); else split along Y axis (divide height)
  - Visibility threshold: rect must contain at least one integer pixel center (`floor(x + w + 0.5) - floor(x + 0.5) > 0`)
  - Stop recursion when `rect.w * rect.h < minArea`
  - Stores computed `rect` on each `LayoutNode` in place
- This is a **clean-room slice-and-dice on a balanced binary tree**, not a port of GP code; the algorithm concept is the standard BSP treemap technique

### `balancer.ts` — Binary Tree Balancer
**Concept** (inspired by GP's `TreeBalancer`):
- `balanceChildren(children: SizedItem[]): BinaryNode`
  - Sort children by `value` ascending
  - Use a min-heap to merge pairs: always combine the two smallest remaining subtrees
  - Produces a roughly balanced binary tree; ensures rectangles tend toward square
  - No reuse of GP's ObjC object pool — uses plain JS objects

### `builder.ts` — Data Ingestion
- `buildFromTabular(data: TabularData, opts): TreeNode[]`
  - Validates `labels`, `parents`, `values` arrays are same length
  - Builds adjacency list, then topologically sorts
  - Aggregates parent values via `aggregateFn` (default: sum)
  - Aggregates color values via `colorAggregateFn` (default: mean for quantitative, first-child for categorical)
  - Auto-generates stable `id` as `ancestor1\x00ancestor2\x00label` path string
  - Nodes below `minCellArea` threshold are collapsed into a synthetic `other` node per parent
- `buildFromTree<T>(root: T, accessors: TreeAccessors<T>): TreeNode[]`
  - DFS traversal; calls `getChildren`, `getValue`, `getLabel`, `getColor`, `getId`
  - Same collapse logic for small nodes

### `treemap.worker.ts` — Worker Entry Point
- Receives `WorkerRequest` messages: `{ type: 'layout', data, props, bounds }`
- Calls `builder.ts` → `balancer.ts` → `layout.ts` → `color-resolver.ts`
- Posts back `WorkerResponse`: `{ nodes: RenderedNode[], gradientDefs: GradientDef[] }`
- Worker is instantiated once per component; reused across data/resize changes

### `color-resolver.ts` — Color Index Resolution
- `resolveColors(nodes: TreeNode[], mode: ColorMode, opts): void`
  - `'categorical'`: look up `colorMap[node.colorValue]` → exact CSS color, or hash `colorValue` string → palette index; `fnv1a(str) % palette.length`
  - `'quantitative'`: build scale (linear/log/quantile/diverging) mapping numeric `colorValue` → palette index; diverging uses explicit `colorDomain` triple
  - `'depth'`: `node.depth % palette.length`
  - Custom `colorFn` callback short-circuits all of the above

### `gradient.ts` — SVG Gradient Generator
- Per palette color, generates one SVG `<linearGradient>` with:
  - `x1="0%" y1="0%" x2="100%" y2="100%"` (upper-left to lower-right)
  - Stop at 0%: HSL(h, s, min(1, l + gradientIntensity*0.35)) (lighter)
  - Stop at 50%: base color
  - Stop at 100%: HSL(h, s, max(0, l - gradientIntensity*0.35)) (darker)
  - This approximates GP's triangular shading without replicating its pixel-painting algorithm
- `gradientIntensity=0` → all stops equal base color (flat)

### `gp-treemap.tsx` — Stencil Component
**Props:**
| Prop | Type | Default |
|---|---|---|
| `labels` | `string[]` | – |
| `parents` | `string[]` | – |
| `values` | `number[]` | – |
| `color` | `(number\|string)[]` | – |
| `ids` | `string[]` | – |
| `root` | `object` | – |
| `getChildren` | `Function` | – |
| `getValue` | `Function` | – |
| `getLabel` | `Function` | – |
| `getColor` | `Function` | – |
| `getId` | `Function` | – |
| `aggregateFn` | `(vals: number[]) => number` | sum |
| `colorAggregateFn` | `(vals: number[]) => number\|string` | mean |
| `colorMode` | `ColorMode` | `'categorical'` |
| `colorScale` | `ColorScale` | `'linear'` |
| `colorDomain` | `[n,n,n]` | auto |
| `colorMap` | `Record<string,CSSColor>` | `{}` |
| `colorFn` | `(node) => CSSColor` | – |
| `palette` | `Palette` | `'gp-default'` |
| `gradientIntensity` | `number` | `0.5` |
| `visibleRootId` | `string` | – |
| `displayDepth` | `number` | unlimited |
| `locatedNodeIds` | `string[]` | `[]` |
| `minCellArea` | `number` | `16` |
| `showLabels` | `boolean` | `false` |
| `valueFormat` | `string` | – |
| `valueFormatter` | `(v: number) => string` | – |
| `toolbar` | `ToolbarConfig \| boolean` | `true` |
| `zoomDuration` | `number` | `350` |
| `tooltip` | `boolean` | `true` |
| `tooltipInToolbar` | `boolean` | `true` |

**Events fired (CustomEvent):**
- `gp-select`, `gp-click`, `gp-dblclick`, `gp-hover`, `gp-mouseover`, `gp-zoom-change`
- Each carries `detail: TreemapEventDetail`

**Methods exposed on element:**
- `locateNode(id: string): void` — sets `locatedNodeIds` internally
- `findRenderedAncestor(id: string): TreeNode | null` — returns deepest currently rendered ancestor

**Internal state:**
- `_internalVisibleRootId` — used when host does not control `visibleRootId`
- `_renderedNodes: RenderedNode[]` — last layout result from worker
- `_prevRects: Map<string, Rect>` — for FLIP transition on data change
- `_worker: Worker` — singleton Web Worker

**Resize handling:**
- `ResizeObserver` on host element
- On resize: immediately `transform: scale(newW/oldW, newH/oldH)` on the `<svg>`
- Debounce 150 ms, then post new bounds to Worker; on response, replace SVG and remove scale

**Data-change animation (FLIP):**
- Before Worker response: snapshot all current `rect` values into `_prevRects`
- After response: assign new rects to SVG elements, then use Web Animations API to play from old position/size to new
- Leaf nodes in both old and new trees: position tween
- Nodes only in old tree: opacity 0 fade-out
- Nodes only in new tree: opacity 0 → 1 fade-in
- Duration matches `zoomDuration`

### `gp-toolbar.tsx`
- Sections: breadcrumb, info panel, depth stepper, zoom buttons, legend slot
- Each section conditionally rendered based on `ToolbarConfig`
- Breadcrumb: array of `{id, label}` from `visibleRootId` to root; each item clickable
- Legend: default renders up to `maxRows` (default 8) swatches; when categories > `maxRows`, shows palette swatches only with no labels; host can replace entirely via named slot `legend`

### `gp-tooltip.tsx`
- `position: fixed` overlay following cursor; `pointer-events: none`
- Shows `label` + formatted `value` for hovered node
- Toggled by `tooltip` prop

### `palettes.ts`
- `gp-default`: 8 colors matching GP's default (blue, red, green, cyan, magenta, orange, yellow, purple)
- `heatmap`, `rainbow`, `viridis`, `plasma` as additional built-ins
- All palettes stored as arrays of CSS `hsl()` strings for easy gradient manipulation

### `color-scale.ts`
- `buildLinearScale(domain, palette)` → `(v) => paletteIndex`
- `buildLogScale(domain, palette)` → same
- `buildQuantileScale(values, palette)` → same
- `buildDivergingScale(domain: [min, mid, max], palette)` → same; `palette[0]` at `min`, `palette[floor(n/2)]` at `mid`, `palette[n-1]` at `max`

### `hash.ts`
- `fnv1a(str: string): number` — 32-bit FNV-1a; used for deterministic categorical color assignment

### `format.ts`
- `applyFormat(value: number, fmt: string): string`
- Supports d3-format-style patterns for `valueFormat` prop
- Falls back to `valueFormatter` callback if provided

---

## Open Questions

1. **Layout algorithm choice**: GP uses slice-and-dice on a pre-balanced binary tree. Squarified treemap produces more square cells and may look better for non-file data. Should we offer `layoutAlgorithm: 'gp-bsp' | 'squarified'` prop, defaulting to `'gp-bsp'` to match the GP aesthetic, with squarified as an option?

2. **SVG vs Canvas for millions of nodes**: Spec requires SVG for native hit-testing, but at 1 M+ nodes only ~1,000 cells will be visible after `minCellArea` pruning in practice. Need to validate in benchmarks whether 10 k–50 k SVG rects (a realistic upper bound after pruning) triggers jank on lower-end devices.

3. **FLIP animation when tree topology changes drastically**: When all path columns are reordered, few node IDs may match between old and new layout. The fade-out/fade-in fallback will fire for nearly all cells — this may look jarring rather than "fluid". Consider a cross-fade full-SVG approach as a fallback when matched-node count < 20%.

4. **Diverging `colorDomain` auto-detection**: When `colorScale='diverging'` but no `colorDomain` is provided, should the component auto-detect `[min, 0, max]` from the data, or throw a validation warning? The spec says explicit `colorDomain` is required, but a sensible auto-default would reduce common-case friction.

5. **Stencil's Vue 3 output target stability**: Stencil's `@stencil/vue-output-target` v2 is still maturing. Need to confirm it handles complex prop types (callbacks, tuples) without losing type safety in the generated wrapper. If not, a hand-written thin Vue composable wrapper may be needed.

6. **Worker-based layout for small datasets**: Spinning up a Worker for a 50-row dataset adds latency (~5–15 ms) with no benefit. Consider a threshold (e.g., < 500 nodes) below which layout runs synchronously on the main thread, with the Worker as a lazy-initialized fallback.

7. **`findRenderedAncestor` and collapsed `other` nodes**: If a node is collapsed into a synthetic `other`, `findRenderedAncestor` should return the parent. But `other` is a rendered node itself — should the API expose it as a locatable/highlightable target?

8. **Stencil Shadow DOM vs Light DOM**: Shadow DOM isolates styles but makes the legend slot more complex and complicates Playwright test selectors. Should the component use `shadow: { mode: 'open' }` for full encapsulation, or expose a `shadowMode` prop, or default to Light DOM?

---

## Testing Strategy

### Layer 1 — Pure JS Unit Tests (`tests/unit/`, Vitest, no browser)

- **`layout.test.ts`**
  - Correctness: given root node with `value=100` and two children `40`/`60`, verify rects sum to parent rect, non-overlapping, correct axis split
  - Edge cases: single child, all-equal values, zero-value nodes, very thin rectangles (1 px wide), `minArea` threshold correctly prunes
  - Property-based: generate random tree with 100–10 k nodes, assert total rect area = bounds area (within floating-point epsilon)
  - Performance: 1 M node layout completes in < 2 s on CI

- **`balancer.test.ts`**
  - Given sorted array `[1, 2, 4, 8, 16]`, verify resulting binary tree is balanced (max depth ≤ ceil(log2(n)) + 1)
  - Single item returns leaf with no children
  - Two items returns compound with correct size

- **`builder.test.ts`**
  - Tabular → tree: parent IDs wired correctly; orphan rows raise error; auto-generated IDs are stable across invocations
  - `aggregateFn` override: max aggregation produces correct parent values
  - `other` node created when children below `minCellArea`; `other.isOther === true`
  - Tree accessor mode: DFS order correct; `getId` collision raises error

- **`color-scale.test.ts`**
  - Linear: min value → `paletteIndex=0`, max → last; midpoint → middle palette
  - Log: negative values raise error; zero raises error
  - Diverging: `domain[1]` maps exactly to `palette[floor(n/2)]`; values outside domain clamped
  - Quantile: 10 values, 5 palette entries → each palette index assigned exactly 2 values

### Layer 2 — Playwright Browser Tests (`tests/e2e/`)
Run on Chromium, Firefox, WebKit (except visual snapshots).

- **`basic-render.spec.ts`**
  - Component renders `<svg>` with correct number of `<rect>` elements for sample dataset
  - Resize: after `setViewportSize`, SVG has `transform: scale(...)` applied immediately, then new layout applied after debounce
  - `minCellArea=1000` collapses small nodes into `other` cell

- **`interactions.spec.ts`**
  - Hover: `gp-hover` CustomEvent fires with correct `nodeId`; tooltip element appears near cursor
  - Click: `gp-select` and `gp-click` fire; selection indicator rect drawn around cell
  - Double-click: `gp-dblclick` fires; `visibleRootId` changes; breadcrumb updates
  - `locateNode('some-id')`: corresponding rect gets `data-located="true"` attribute

- **`zoom.spec.ts`**
  - `zoomDuration=0`: zoom completes synchronously (no animation frame delay)
  - `zoomDuration=300`: intermediate frame shows partial CSS transition
  - External `visibleRootId` prop: setting it drives zoom without firing internal state change
  - Reset zoom: `visibleRootId` returns to root; `gp-zoom-change` event carries `ancestorIds: []`
  - Breadcrumb: items match `ancestorIds` from last `gp-zoom-change` event

- **`keyboard.spec.ts`**
  - After click (path locked): arrow keys change `gp-select` event's `nodeId` to sibling/child/parent
  - Scroll wheel: delta accumulates; selection depth shifts at threshold
  - `+` / `-` keys: trigger zoom in/out; `0` resets

- **`data-change.spec.ts`**
  - Replace `values` prop: old and new `<rect>` elements animate (check `getAnimations().length > 0`)
  - Path column reorder: nodes present in both old/new trees tween; removed nodes fade out
  - Switching from tabular to tree-root mode: layout re-runs; all cells re-render

### Layer 3 — Playwright Visual Regression Tests (`tests/visual/`)
Chromium only. Golden images stored in `tests/visual/snapshots/`.

- **Fixture datasets**: (a) file system sample (categorical, GP default palette), (b) budget data (quantitative, heatmap), (c) 5-level hierarchy (depth mode)
- `visual.spec.ts`
  - `gp-default` palette + `gradientIntensity=0.5`: screenshot matches golden
  - `gradientIntensity=0`: all cells flat-colored, no gradient visible
  - `gradientIntensity=1`: maximum contrast shading visible
  - `colorMode='quantitative'` + `colorScale='diverging'`: midpoint cells match `palette[mid]` color
  - `showLabels=true`: text visible inside sufficiently large cells; absent in small cells
  - `toolbar=true`: all toolbar sections present and non-overlapping
  - `locatedNodeIds=['node-5']`: that cell renders with highlight border
  - Update goldens with `npx playwright test --update-snapshots` on intentional visual changes

### CI Matrix
```
pull_request:
  unit tests:     vitest (Node 20, no browser)
  e2e tests:      Playwright Chromium + Firefox + WebKit
  visual tests:   Playwright Chromium only
  bundle size:    assert < 80 KB gzipped (core only, no framework)
```