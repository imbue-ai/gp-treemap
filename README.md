# gp-treemap: Beautiful, interactive, large-scale treemaps for the web

Treemaps are often the best way to quickly hone in on the "mass" in large,
hierarchical datasets.  You can think of them as "hierarchical pie charts".

For example, they're great for interactive visualizions of disk usage.

With this package, you can run:

```sh
# TODO: sample npx command line to generate disk-usage report of CWD.
```

And see this visualization:

TODO: Screenshot.  Or even better -- embed from gallery in an iframe if that's possible?


But it's not just for disk usage. gp-treemap is a general web component,
great for any time you have hierarchical counts to wrap your head around!

* Spending reports (they never looked so beautiful!)
* Budgets
* Profiling
* Resource usage (Disk, RAM, electricity)

Don't forget that lots of tabular data can be made hierarchical with GROUP BY on a list of columns.

Check out the [gallery of more examples](TODO: Link to our gallery web page).

## A hat tip to GrandPerspective

Most treemap implementations we've seen are boring and don't scale well
to millions of nodes, with [GrandPerspective](https://grandperspectiv.sourceforge.net/)
being a wonderful exception.

`<gp-treemap>` is a standards-compliant Custom Element that renders interactive
treemaps with GrandPerspective's signature "raised tile" pixel shading — bright
upper-left, dark lower-right, with a crisp diagonal seam between the two halves
of every cell.

This project is a JavaScript/Canvas port of the treemap view from
[GrandPerspective](https://grandperspectiv.sourceforge.net/), the macOS disk
visualizer by Erwin Bonsma (and contributors). GrandPerspective is released
under the GNU General Public License, version 2, and so is `gp-treemap`.

The upstream 3.6.4 source is bundled under `GrandPerspective-3_6_4/` for
reference. The treemap layout, the raised-tile shader, and the HSV brightness
ramp were all translated from that source — this is a derivative work in the
GPL sense, not a clean-room reimplementation. If you want the original tool,
or want to see where these algorithms came from, go support that project.

If you use `gp-treemap`, please keep the attribution to Erwin Bonsma visible.

## Quick start

No install required — run directly from GitHub:

```sh
# TODO: Update to run from npm package with gpdu
npx github:imbue-ai/gp-treemap ~/Downloads
```

Scans `~/Downloads`, writes a self-contained HTML file, and opens it in your
default browser. Pass a second argument to choose the output path:


## Scanning a real directory
TODO: Move this section into the relevant code.

`tools/scan.js` walks any local folder and writes a single self-contained
HTML file that renders its size treemap — the bundle and dataset are inlined
so the output works under `file://`.

```sh
# Produce /tmp/gp-treemap-<name>-<ts>.html for ~/Downloads:
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

wrote /tmp/gp-treemap-Pictures-1776569124346.html  (5.1 MB)
```

Symlinks are not followed and unreadable entries are counted and skipped.

## Profiling an HTML file's load
TODO: Move this section into the relevant code.

Large `gp-treemap` outputs (or any local HTML page) can be profiled
headlessly using Chromium's V8 CPU profiler, then visualized as a treemap
of CPU time bucketed by thread and call stack.

Two tools, both runnable via `npx`:

```sh
# 1. Capture a standard Chrome DevTools .cpuprofile for the page load.
npx -p github:imbue-ai/gp-treemap gp-treemap-profile-load \
    ~/big-scan.html  ~/big-scan.cpuprofile

# 2. Convert that .cpuprofile into a self-contained treemap HTML.
npx -p github:imbue-ai/gp-treemap gp-treemap-profile-to-html \
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
has no runtime dependencies and just needs `dist/gp-treemap.bundle.js`
from `node tools/build.js`.

## Repo layout

```
src/                    component source (ES modules)
  gp-treemap.js           custom element: canvas render + hit-testing + toolbar
  painter.js              per-pixel raised-tile painter
  lut.js                  brightness-ramp LUT
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
  gp-treemap.bundle.js        single-file IIFE; defines the custom element

tests/                  Playwright suite (Chromium)
  visual.spec.js          screenshots → tests/screenshots/*.png
  units.spec.js           core module unit tests (browser-run)
  file-url.spec.js        smoke test that file:// renders correctly
  unit-fixture.html       loader that exposes bundle helpers on window
  screenshots/            committed PNGs — browse offline

tools/
  build.js                concatenates src/ → dist/gp-treemap.bundle.js
  server.js               tiny static server (used by Playwright & local dev)
  scan.js                 recursive directory scan → self-contained treemap HTML
  profile-load.js         Playwright+CDP CPU profile capture → .cpuprofile
  profile-to-html.js      .cpuprofile → treemap HTML (thread / call-stack)

GrandPerspective-3_6_4/ upstream source bundled for reference (GPL v2)
```

## Tests

```sh
npm run test:install     # one-time: download Chromium
npm test                 # run units + visual snapshots
```

## Spec deltas from upstream GrandPerspective

- **Web Component, not a Cocoa view.** Rendering is a per-pixel loop on a
  single `<canvas>`. Paint of a full 1280×720 canvas with a few thousand cells
  takes ~10–30 ms; WASM could give 5–20× headroom for 100k+ cells or per-frame
  animation, not needed for MVP.
- **Plain ES modules + IIFE bundle** — no Stencil, no generated React/Vue
  wrappers. A Stencil wrapper can be grafted on later without API churn.
- **FLIP data-change animations** are not yet implemented; a data change
  rerenders the whole canvas.
- **Resize** immediately CSS-scales the canvas, then re-paints after a
  150 ms debounce.
- Toolbar, palettes, color scales, keyboard / wheel / double-click behavior,
  and FNV-1a categorical hashing are all new to this port.

## License

GNU General Public License, version 2. See [`LICENSE`](LICENSE).

