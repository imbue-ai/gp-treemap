# raised-treemap — treemap Web Component with raised-tile shading

A standards-compliant Custom Element that renders interactive treemaps with a
"raised tile" pixel-shading look — bright upper-left corner, dark lower-right,
with a crisp diagonal seam between the two halves of every cell. Implements
[`spec/grandperspective-treemap-component/spec.md`](spec/grandperspective-treemap-component/spec.md).

The rendering is **pixel-level on a single `<canvas>`**: for each cell, each
pixel's shade is chosen by comparing its normalized in-cell coordinates
(`i/w` vs `j/h`) to decide which triangle it falls in, then indexing a
256-entry brightness-ramp LUT for the cell's base color. LUTs are built by
linear-RGB interpolation between the base color and black/white targets.

## Quick start

No install required — run directly from GitHub:

```sh
npx github:imbue-ai/raised-treemap ~/Downloads
```

Scans `~/Downloads`, writes a self-contained HTML file, and opens it in your
default browser. Pass a second argument to choose the output path:

```sh
npx github:imbue-ai/raised-treemap ~/Pictures /tmp/pictures.html
```

## Viewing the samples

```sh
node tools/build.js     # (re)generate dist/raised-treemap.bundle.js
open samples/index.html # or just double-click it in Finder
```

Each sample is a plain HTML file loading the bundle with a sibling
`<script src="../dist/raised-treemap.bundle.js">` tag — no ES modules, no CORS,
no server required. `file://` works.

If you prefer to serve over HTTP:

```sh
npm run serve
# → http://localhost:4173/samples/index.html
```

## Scanning a real directory

`tools/scan.js` walks any local folder and writes a single self-contained
HTML file that renders its size treemap — the bundle and dataset are inlined
so the output works under `file://`.

```sh
# Produce /tmp/raised-treemap-<name>-<ts>.html for ~/Downloads:
node tools/scan.js ~/Downloads

# Or pick your own output path:
node tools/scan.js ~/Projects /tmp/projects.html

# Shortcut via the npm script:
npm run scan -- ~/Pictures
```

The scanner prints file/directory counts, total bytes, and the output path
when done:

```
scanned /Users/you/Pictures
  files        14,221
  directories  1,044
  total size   38.6 GB  (41,434,812,100 B)
  scan took    612 ms

wrote /tmp/raised-treemap-Pictures-1776569124346.html  (5.1 MB)
```

Symlinks are not followed and unreadable entries are counted and skipped.

## Profiling an HTML file's load

Large `raised-treemap` outputs (or any local HTML page) can be profiled
headlessly using Chromium's V8 CPU profiler, then visualized as a treemap
of CPU time bucketed by thread and call stack.

Two tools, both runnable via `npx`:

```sh
# 1. Capture a standard Chrome DevTools .cpuprofile for the page load.
npx -p github:imbue-ai/raised-treemap raised-treemap-profile-load \
    ~/big-scan.html  ~/big-scan.cpuprofile

# 2. Convert that .cpuprofile into a self-contained treemap HTML.
npx -p github:imbue-ai/raised-treemap raised-treemap-profile-to-html \
    ~/big-scan.cpuprofile  ~/big-scan.profile.html
```

The first command launches headless Chromium, opens the HTML under `file://`,
records a CPU profile across the whole load, and waits for `window._allBlocksReady`
(the signal `tools/scan.js` exports) before stopping — falling back to
document `load` + a short settle window for arbitrary pages. Useful flags:
`--sampling-us=N` (default 100), `--extra-wait-ms=N` (default 500),
`--timeout-ms=N` (default 600000), `--wait-for=<js-expr>` to override the gate.

The resulting `.cpuprofile` is Chrome's canonical JSON format — you can also
drag it into DevTools → Performance, or load it in
[speedscope](https://www.speedscope.app/), pprof, etc.

The second command reads the profile and writes a self-contained treemap
HTML. The hierarchy is:

```
profile
  └── Renderer Main (thread)
        └── (program) / (idle) / (garbage collector) / your JS ...
              └── call-stack descendants ...
```

Value = CPU microseconds (self-time at leaves, aggregated up to ancestors).
Color = function name (the "deepest function" at each cell) — same function
across the tree shares a color, so hot paths pop visually.

Running both from a clone of the repo works the same:

```sh
node tools/profile-load.js     ~/big-scan.html
node tools/profile-to-html.js  ~/big-scan.cpuprofile
```

Playwright with Chromium must be installed for `profile-load.js`
(`npm install && npx playwright install chromium`). `profile-to-html.js`
has no runtime dependencies and just needs `dist/raised-treemap.bundle.js`
from `node tools/build.js`.

## Repo layout

```
src/                    component source (ES modules)
  raised-treemap.js           custom element: canvas render + hit-testing + toolbar
  painter.js              per-pixel raised-tile painter (clean-room)
  lut.js                  brightness-ramp LUT (clean-room)
  layout.js               BSP slice-and-dice
  balancer.js             balanced-binary-tree merge
  builder.js              tabular + tree accessor ingestion
  color-resolver.js       palette index assignment
  color-scale.js          linear / log / diverging / quantile
  palettes.js             built-in palettes
  hash.js                 FNV-1a for categorical color hashing
  format.js               d3-format-ish value formatter

samples/                one HTML per behavior (load via <script src>)
  index.html              links to all samples
  filesystem.html         categorical, bytes formatter
  budget.html             diverging quantitative
  depth.html              ~960 leaves, categorical by order
  interactions.html       event log + zoom demo
  gradients.html          intensity 0 / 0.5 / 1 side by side
  min-cell.html           pruning comparison
  located.html            highlight-node demo
  data/                   small datasets the samples attach to window.__data

dist/                   build output
  raised-treemap.bundle.js    single-file IIFE; defines the custom element

tests/                  Playwright suite (Chromium)
  visual.spec.js          screenshots → tests/screenshots/*.png
  units.spec.js           core module unit tests (browser-run)
  file-url.spec.js        smoke test that file:// renders correctly
  unit-fixture.html       loader that exposes bundle helpers on window
  screenshots/            committed PNGs — browse offline

tools/
  build.js                concatenates src/ → dist/raised-treemap.bundle.js
  server.js               tiny static server (used by Playwright & local dev)
  scan.js                 recursive directory scan → self-contained treemap HTML
  profile-load.js         Playwright+CDP CPU profile capture → .cpuprofile
  profile-to-html.js      .cpuprofile → treemap HTML (thread / call-stack)
```

## Tests

```sh
npm run test:install     # one-time: download Chromium
npm test                 # run units + visual snapshots
```

## Licensing

The visual effect this component produces is inspired by
[GrandPerspective](https://grandperspectiv.sourceforge.net/) (GPL v2), which is
included under `GrandPerspective-3_6_4/` for reference only and is not shipped
in the build output.

The implementation of the two shading-critical modules — `src/painter.js`
(pixel painter) and `src/lut.js` (brightness ramp) — was written clean-room by
a fresh implementer who had not seen GrandPerspective's source. They were
given only a plain-English description of the visual effect and the API
contract, and chose their own algorithms:

- `painter.js` uses a **single-scanline loop** that decides, per pixel,
  whether to shade from the horizontal or vertical axis based on a normalized
  in-cell coordinate comparison. GrandPerspective uses two separate triangle
  passes with an `xMax`/`yMin` clip. Both produce the same visual family but
  the code expressions are independent.
- `lut.js` ramps from black to the base color to white in **linear sRGB**,
  scaled by `intensity`. GrandPerspective ramps in HSV using a "raise
  brightness toward 1, then desaturate toward white" recipe. Independent
  algorithmic choice.

The rest of the codebase (`layout.js`, `balancer.js`, `builder.js`, color
scales, hash, palettes) uses textbook techniques — slice-and-dice BSP,
Huffman-style pairwise merge, FNV-1a — written without consulting the GP
source. Algorithms are not copyrightable; only specific expressions are.

Given the above, an MIT release is defensible. This is not legal advice — if
it matters commercially, have an attorney do a proper code-provenance review.

## Spec deltas

- **Main thread, not a Worker** — paint of a full 1280×720 canvas with a
  few thousand cells takes ~10–30 ms. WASM could give 5–20× headroom for
  100k+ cells or per-frame animation; not needed for MVP.
- **Plain ES modules + IIFE bundle** instead of Stencil + generated Vue/React
  wrappers. Prop surface, events, and methods match the spec; a Stencil
  wrapper can be grafted on later without API churn.
- **FLIP data-change animations** are not yet implemented; a data change
  rerenders the whole canvas.
- **Resize** immediately CSS-scales the canvas, then re-paints after a
  150 ms debounce (per spec).

Events, prop surface, toolbar sections, palettes, color scales, keyboard /
wheel / double-click behavior, and FNV-1a categorical hashing all match the
spec.
