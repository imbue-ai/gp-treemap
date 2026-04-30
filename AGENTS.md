# Agent notes for gp-treemap

## Bundle

After editing any file in `src/`, rebuild the bundle:

    node tools/build.js

The scan viewer (`tools/gpdu-scan.js`) and the unit-fixture test page both load
`dist/gp-treemap.bundle.js`, not the ES modules directly. If you forget
to rebuild, your changes won't appear in scanned HTML output.

A test (`tests/bundle-freshness.spec.js`) will catch a stale bundle.

## Releases & the README's deno command

When you bump the package version (e.g. `npm version patch`), update the
pinned version in the README's "Sandboxed usage" block too —
`npm:@imbue-ai/gp-treemap@X.Y.Z/tools/gpdu-scan.js`. Deno caches npm:
specifiers indefinitely, so an unpinned spec keeps running the first
version it ever resolved, masking newer releases.

`tests/readme-deno-command.spec.js` checks that (a) the README pin
matches `package.json`, and (b) the documented `--allow-*` flags are
still sufficient for the script as it stands today (so adding a syscall
that needs new perms breaks the test before publish).

## URL hash state

UI state is persisted in the URL hash **at the page level**, not inside the
`<gp-treemap>` component. The component fires events; the page script
reads/writes the hash. Hash params:

| Param    | Meaning                          | Omitted when          |
|----------|----------------------------------|-----------------------|
| `zoom`   | `visibleRootId` (zoomed-in node) | at root (no zoom)     |
| `depth`  | `displayDepth`                   | Infinity (default)    |
| `target` | `_targetId` (clicked leaf cell)  | no cell clicked       |
| `focus`  | `_focusId` (highlighted ancestor)| same as target        |

Example: `#zoom=src&depth=3&target=src/foo/bar.js&focus=src/foo`

The component events that trigger hash writes:
`rt-zoom-change`, `rt-depth-change`, `rt-target`, `rt-focus`

When adding new UI state to the URL:
1. Add the event to the component (`_dispatch` or `dispatchEvent`).
2. Add read/write in the page-level hash script (gpdu-scan.js template +
   samples/interactions.html).
3. Add a test in `tests/url-hash.spec.js`.

## Falsy node IDs

In lazy-tree mode (scan files), node IDs are numeric and the root node's ID
is `0`. Never use truthiness checks (`!id`, `if (id)`, `!node._item`) to
test whether an ID or item exists — `0` is falsy in JavaScript. Use explicit
null checks instead: `id == null`, `id != null`, `node._item == null`.

This has caused bugs where the root node was silently skipped (e.g. the zoom
path expansion skipping the root because `!0` is `true`).

## CLIs

The `gpdu-*` family of CLI tools (`tools/gpdu-*.js`) all share the same
plumbing in `tools/scan-core.js`:

- `partitionBlocks(scan, targetSize)` — splits a flat `(labels,
  parentIndices, values)` scan into block-partition structures, with
  oversized subtrees becoming "stubs" (leaf placeholders) whose real
  children live in a child block, inflated lazily in the browser.
- `encodeBlock(scan, block, ctx)` — encodes one block to a JSON envelope
  with categorical attributes packed as enum-indexed `Uint16Array` and
  numeric attributes as `Float64Array`, both base64-encoded.
- `LOADER_JS` — a string containing the browser-side IIFE that decompresses
  blocks, builds the in-memory node store, exposes `<gp-treemap>` accessor
  functions, and handles theme/palette/`#s=...` URL-hash sync. Source
  lives in `tools/scan-loader.source.js`; the build step (`tools/build.js`)
  emits `dist/scan-loader.embed.js` exporting it as a string constant so
  Deno doesn't need `--allow-read` on its npm cache directory.

Each tool writes its own complete HTML — title row, app toolbar, stats
bar, help modal, page-script — calling `partitionBlocks` / `encodeBlock`
for the heavy mechanics and inlining `LOADER_JS` once. The shared loader
expects `window._gpduConfig` to be set before it runs (default color
mode, which modes are categorical vs. quantitative, themes, etc.).

`tools/gpdu-scan.js` is the canonical example; the other `gpdu-*` tools
follow the same template.

### `gpdu-json`

Visualizes a JSON5 file. Cell area is the byte size of that node's
serialized form in the source. Internal nodes carry a synthetic
`(leftover)` leaf to absorb structural-overhead bytes (braces, commas,
whitespace, comments), so `parent.value === sum(child.value)` at every
level and the tree's total reconciles to the source file size — see
`tests/gpdu-json.spec.js` for the invariant. Tricky bit: parsing is via
`@babel/parser`'s `parseExpression` and there's no JSON5-grammar
enforcement — whatever Babel parses, we render (single-quoted strings,
unquoted keys, trailing commas, comments all just work because they're
valid JS expression syntax).

### `gpdu-sqlite`

Visualizes a SQLite database via `better-sqlite3` (`optionalDependency`).
Hierarchy is `db → <table> → [<column>..., <index>...]`; system tables,
views, and triggers appear at the top level alongside user tables (views
& triggers as 0-byte cells). Total bytes per table/index come from the
`dbstat` virtual table (sum of `payload` over all pages of that name).
Per-column byte estimates use a JS-side reimplementation of SQLite's
serial-type encoding rules (`serialBytes` in `tools/gpdu-sqlite.js`) over
sampled rows, scaled up by row count. The
`--include-row-elements-for-all-columns` flag forces a full table scan
and emits one leaf per (row, column) — slow on big DBs but exact.

### `gpdu-sqlite` testability gotcha

`tools/gpdu-sqlite.js` exports `serialBytes` so unit tests can exercise
the encoder. To prevent `main()` from running at import time, the file
gates its top-level call on
`import.meta.url === url.pathToFileURL(process.argv[1]).href`. Apply the
same pattern in any future `gpdu-*` tool that wants to export helpers.

## Tests

    npx playwright test          # all tests
    npx playwright test <file>   # single file
