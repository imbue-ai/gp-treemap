# Plan: gpdu-s3, gpdu-sqlite, gpdu-json — multi-source treemap CLIs

## Refined feature description

Build three new CLI programs that produce treemap utilization visualizations for non-disk sources, plus a shared core extracted from the existing `gpdu-scan.js`. Goal is local trial — nothing publishes until the user has kicked the tires.

### Tools

- **`gpdu-s3`** — recursive S3 enumeration via `@aws-sdk/client-s3` (added as both `optionalDependency` and `devDependency`). Default credential chain; `--region`, `--no-sign-request`, `--include-versions`. Async Promise pool on the main thread, prefix-fanout via `Delimiter=/`, `--workers=16` default. Visible tree synthesizes a directory hierarchy from `/`-separated keys. Color modes: extension (default) / storage class / last-modified. Stats bar: objects / "folders" / total bytes (+ versions indicator). Tests use `aws-sdk-client-mock`.
- **`gpdu-sqlite`** — `better-sqlite3` (`optional` + `dev`, ships `dbstat`). Hierarchy `db → <table> → [<col-1>, ..., <index-1>, ...]`; system tables/indices/views/triggers shown alongside user tables (views & triggers as 0-byte cells, *not* skipped). Per-column sizes via JS-side serial-type encoder, sampled with `--sample-rows=N` (default 10 000). `--include-row-elements-for-all-columns` opt-in forces a full scan and ignores `--sample-rows`. Open WAL-flagged DBs in plain `readonly` (sqlite consults WAL transparently). Color modes: kind (default) / parent-table / value-type. Stats bar: tables / indices / columns / total bytes.
- **`gpdu-json`** — JSON5 via `@babel/parser` (no grammar enforcement). Tree reconciles to exact source byte count; comments fall into `(leftover)` leaves. Root scalars render as a single-leaf tree; empty objects/arrays render as a single-`(leftover)` child carrying their byte size; comments-only / whitespace-only files error with line/col. Color modes: type (default) / depth / key. Pruning: `--min-bytes` (off), `--max-array-children` (off; when set, exceeded arrays show first N + `[…M more]` rollup leaf).

### Shared `tools/scan-core.js` (composable, *not* a full HTML generator)

Exports `partitionBlocks`, `encodeBlock`, `humanBytes`, `escapeHtml`, plus a `LOADER_JS` string carrying the browser-side IIFE (block decompression, node store, `<gp-treemap>` accessors, URL-hash sync). Each tool writes its own complete HTML — title row, app toolbar, stats bar, help modal (inline in tool source), per-tool color/theme/hash logic — and inlines `LOADER_JS`. Build step emits `dist/scan-loader.embed.js` (mirroring `gp-treemap.bundle.embed.js`).

### Cross-cutting

- URL hash schema uniform across all four tools: `#s={...}` JSON with universal `color`/`theme`/`palette`/`viewer` keys; tool-specific keys layer alongside.
- CLI base flags every `gpdu-*` tool implements: `--help`/`-h`, `--no-open`, `--block-size=N` (default 500 000), `--color=<mode>`, `--version`. `--workers=N` only where it makes sense (gpdu, gpdu-s3 — not sqlite/json).
- Output filenames default to `os.tmpdir() + '/gpdu-<tool>-<source-slug>-<ts>.html'`.
- Live `\r ...` progress line per tool, tuned to its primary entities.
- Friendly one-line error messages for common failure modes (bad creds, not-a-sqlite-db, JSON parse error with line/col, etc.); exit 1.
- Test fixtures generated at test time — JSON5 string literals, sqlite via `better-sqlite3` `beforeAll`, S3 mocked via `aws-sdk-client-mock`. Nothing committed as binary.
- `AGENTS.md` gets a per-tool subsection — three sentences each: data shape, color modes, the one tricky bit.
- README gets a usage section per tool. Deno-sandbox invariant test deferred until publish.

### Phasing — local trial only, nothing publishes

1. Extract `tools/scan-core.js` + restructure `gpdu-scan.js`'s chrome.
2. `gpdu-json`.
3. `gpdu-sqlite`.
4. `gpdu-s3`.

---

## Components

### `tools/scan-core.js` (new)

Composable Node module; pure logic, no HTML page chrome. Exports:

- `partitionBlocks(scan, blockSize) → { blocks, childIds, aggValue, aggFiles, aggDirs }` — moved verbatim from current `gpdu-scan.js`. Splits a flat `(labels, parentIndices, values)` scan into block-partition structures with stub references for lazy inflation.
- `encodeBlock(scan, block, agg) → { labels, values, piB64, grB64, /* color arrays */, ctimeB64, mtimeB64, atimeB64, stubs }` — moved from `gpdu-scan.js`. Encodes one block to a JSON-serializable shape with `Uint16Array` enum-indexed categoricals and `Float64Array` timestamps, both base64-encoded.
- `humanBytes(v) → string`, `escapeHtml(s) → string` — small utilities currently duplicated in `gpdu-scan.js` / `table-treemap.js`.
- `LOADER_JS` constant — the browser-side IIFE source that decompresses blocks, builds the in-memory node store (`Map<id, { label, value, parentId, childIds, /* color attrs */ }>`), exposes `<gp-treemap>` accessor functions (`getId` / `getChildren` / `getValue` / `getLabel` / `getColor`), and implements URL-hash sync (`#s={...}`). Imported from `dist/scan-loader.embed.js` so Deno doesn't need `--allow-read` on its npm cache.

Important: the loader is generic over color modes. The browser-side `getColor` reads from a per-node attribute bag; each tool decides what attributes to populate (e.g. `colorExt` / `colorKind` / `colorFolder` for gpdu, `colorJsonType` / `colorDepth` / `colorKey` for gpdu-json). The dropdown is wired by each tool's page script, not by the loader.

### `tools/build.js` (modified)

Already emits `dist/gp-treemap.bundle.embed.js` for the bundle. Add a second emission for `dist/scan-loader.embed.js` exporting `LOADER_JS` as a string constant. The loader source itself lives in a new `tools/scan-loader.source.js` (or inlined directly inside `tools/scan-core.js` — pick whichever is more readable; if separate, the build reads it and re-exports as a string constant). `package.json` `files` adds `dist/scan-loader.embed.js`.

### `tools/gpdu-scan.js` (refactored, Phase 1)

- Imports `partitionBlocks`, `encodeBlock`, `humanBytes`, `escapeHtml`, `LOADER_JS` from `tools/scan-core.js`.
- Keeps its own walker (`worker_threads` + inline `WORKER_SRC`).
- Owns its own page chrome: title row, app toolbar (color / theme / palette dropdowns), stats bar, help modal HTML — restructured to match a per-tool template the new tools will follow. Visual snapshots intentionally drift; re-baselined as a deliberate step in this phase.
- `gpdu-scan.js` is the canonical example; the new tools mirror its structure.

### `tools/gpdu-json.js` (new, Phase 2)

- Parses input via `@babel/parser` (added as a regular `dependency`) using `parseExpression` with permissive options to accept JSON5 grammar: comments, trailing commas, unquoted keys, single-quoted strings. Babel's AST nodes carry `start` / `end` offsets into the source buffer, which is what we need for byte reconciliation.
- Walks the AST in a single recursive pass, producing `(labels, parentIndices, values)` arrays plus per-node color attributes:
  - `colorJsonType ∈ { object, array, string, number, boolean, null, leftover }`
  - `colorDepth` (integer)
  - `colorKey` (the object key that pointed at this node, or array index `[N]`, or `(root)`)
- For every non-leaf node: insert a synthetic `(leftover)` leaf as the last child, with bytes = `parent.end - parent.start - sum(child.end - child.start for each real child)`. Value is the byte difference; if zero, omit.
- Pruning:
  - `--min-bytes=N` (default 0): drop leaves below threshold; their bytes roll up into the parent's leftover.
  - `--max-array-children=N` (default ∞): for arrays, keep first N children; the remainder roll up into a single leaf labeled `[…M more]` with summed bytes.
- Edge cases:
  - Root scalar (`42`, `"hi"`, `null`, `true`): single-leaf tree (value = file size, no children).
  - Empty `{}` / `[]` (or with only comments inside): leaf rendered with a single `(leftover)` child carrying the bytes — keeps "leaf has no real children" invariant clean across the codebase.
  - Comments-only / whitespace-only file: error with `line:col`, exit 1.
- Stats bar: objects / arrays / strings / numbers / total bytes. Computed during AST walk.
- Help modal: tool-specific copy explaining `(leftover)` semantics, JSON5 features supported, color modes.
- Page script: applies color mode by reading the appropriate per-node attribute; theme/palette/hash sync; bottom-bar updater that walks the focused subtree using the loader's node store.

### `tools/gpdu-sqlite.js` (new, Phase 3)

- Opens DB via `better-sqlite3` (`optional` + `dev`) in `readonly` mode. WAL is consulted transparently.
- Builds the hierarchy:
  - `db (root) → <table-or-system-table>` for every entry in `sqlite_master` (kind ∈ {table, index, view, trigger}).
  - For `table` rows: children are `<column>` cells (one per `pragma_table_info`) and `<index>` cells (one per index attached to that table, looked up via `pragma_index_list` / `pragma_index_info`). The shape is `db → <table> → [col-1, col-2, ..., index-1, index-2, ...]`.
  - For `index` rows attached to no table (rare — none exist in stock SQLite, but defensively skip in case of attached-DB oddities).
  - For `view` / `trigger`: 0-byte cells alongside tables (visible but flat).
- Total bytes per table-or-index from `dbstat`:
  ```sql
  SELECT name, SUM(payload + ovfl + (pgsize - payload - ovfl)) AS bytes
  FROM dbstat GROUP BY name;
  ```
  (or whichever `dbstat` columns sum cleanly — verify during implementation).
- Per-column bytes: JS-side serial-type estimator. For each sampled row, sum bytes per column according to SQLite's record format:
  - NULL: 0 bytes for value (1 byte for serial-type header is shared across columns; we attribute it to "leftover" at the table level if we want exact reconciliation, otherwise per-column estimates are approximate).
  - Integer: 0 / 1 / 2 / 3 / 4 / 6 / 8 bytes depending on magnitude (serial types 0–6).
  - Real: 8 bytes (serial type 7).
  - Text/blob: `length(value)` bytes (serial type ≥ 12).
  - Sample size: `--sample-rows=N` (default 10 000). Extrapolate column total = (sampled bytes / sample row count) × table row count.
- `--include-row-elements-for-all-columns`: opt-in. Forces a full scan, ignoring `--sample-rows`. Each `(row, column)` cell becomes a leaf under the column. Leaf label = primary-key value when there is one, falling back to `rowid`. Tree depth grows by one level under affected columns.
- Stats bar: tables / indices / columns / total bytes.
- Color modes: `kind` (table-cell / column / index — three well-separated hues), `parent-table` (categorical hash), `value-type` (text/int/real/blob; only meaningful at column-level cells, falls back to neutral elsewhere). Default: `kind`.
- Help modal: tool-specific copy explaining sample-vs-full-scan trade-off, what indices contain, column-bytes estimation rules.

### `tools/gpdu-s3.js` (new, Phase 4)

- AWS SDK loaded via `await import('@aws-sdk/client-s3')` so the import is deferred (graceful failure if `optional` install was skipped).
- CLI args: one or more `s3://bucket` or `s3://bucket/prefix`. `--region`, `--no-sign-request` (forwards into `S3Client({ signer: () => ({ sign: r => r }) })` or the SDK's anonymous-mode helper), `--include-versions`, `--workers=16`.
- Walker: async Promise pool on the main thread (no `worker_threads`). Each worker pulls from a queue of "explore this prefix" tasks. Each task:
  - Calls `ListObjectsV2` (or `ListObjectVersions` if `--include-versions`) with `Delimiter=/`, `Prefix=<task-prefix>`.
  - For each `CommonPrefixes` entry → enqueue as a new task (synthesized "directory" node).
  - For each `Contents` entry → leaf. Capture `Size`, `Key`, `LastModified`, `StorageClass`, `VersionId` (when versioning).
- Visible tree synthesizes a directory hierarchy from `/`-separated keys, mirroring gpdu's mental model.
- Per-node color attributes:
  - `colorExt` (file extension lowercased, or `(none)`).
  - `colorStorage` (storage class: `STANDARD`, `IA`, `GLACIER`, etc.).
  - `colorMtime` (last-modified ms since epoch).
- Stats bar: objects / "folders" (synthesized prefixes) / total bytes (+ "all versions" indicator if `--include-versions`).
- Color modes: extension (default) / storage class / last-modified.
- Help modal: tool-specific copy explaining synthesized folders, storage-class color, version listing.
- Errors: `NoSuchBucket`, `AccessDenied` → friendly one-line messages; everything else bubbles as a stack trace.

### `package.json` (modified)

- `dependencies`: add `@babel/parser`.
- `devDependencies`: add `better-sqlite3`, `@aws-sdk/client-s3`, `aws-sdk-client-mock`.
- `optionalDependencies`: add `better-sqlite3`, `@aws-sdk/client-s3`.
- `bin`: **unchanged** during local-trial period (per Q&A round 6, answer 4b). Tools invoked via `node tools/gpdu-X.js` until the user decides to ship.
- `files`: add `dist/scan-loader.embed.js`.

### `tests/scan-core.spec.js` (new, Phase 1)

Unit tests for the shared core:

- `partitionBlocks` correctness on tiny synthetic trees (3 tests):
  - All-fits-in-one-block tree → exactly 1 block, 0 stubs.
  - One oversized subtree → root block with 1 stub, child block with the subtree.
  - Deep chain forcing multi-stub recursion → block count + stub `localRow` placement match expectations.
- `encodeBlock` round-trip: build a tiny scan, encode, decode the resulting `piB64` / `grB64` / categorical `b64` arrays, assert the decoded arrays match input.
- `humanBytes`: spot checks on byte-MB-GB boundaries.

### `tests/gpdu-json.spec.js` (new, Phase 2)

- Aggregate consistency invariant: for several JSON5 fixture strings, parse, build the tree, walk it, and assert `parent.value === sum(children.values)` at every level — including for trees with comments, trailing commas, weird whitespace, deeply nested objects, large arrays.
- Pruning behavior: `--max-array-children=10` on a 100-element array → first 10 + `[…90 more]` rollup carrying the right bytes.
- Edge cases: root scalar, empty `{}`, empty `[]`, comments-only file (error), unquoted keys, single-quoted strings.
- Smoke test (Playwright): generated HTML loads `file://`, `<gp-treemap>` renders cells, no console errors.

### `tests/gpdu-sqlite.spec.js` (new, Phase 3)

- `beforeAll`: build a fixture `.sqlite` with `better-sqlite3` containing 2 tables, 1 index, a view, a trigger, and ~5000 rows of mixed-type data.
- Sample-based column sizes match expectations on a known-distribution column (within sampling tolerance).
- `--include-row-elements-for-all-columns` produces leaves whose count equals (rows × non-system-table-columns).
- Tree shape: each table's children are its columns + its indices; indices have no further children.
- System tables visible (named `sqlite_*`).
- Smoke test (Playwright): renders + no errors.

### `tests/gpdu-s3.spec.js` (new, Phase 4)

- Mock the SDK with `aws-sdk-client-mock`. Inject canned `ListObjectsV2` responses with `Contents` + `CommonPrefixes` over multiple page tokens.
- Synthesized directory hierarchy matches expected shape (e.g. `photos/2024/foo.jpg` ends up as `photos → 2024 → foo.jpg`).
- `--include-versions` switches to `ListObjectVersions` and produces per-version leaves.
- `--workers=4` produces same tree as `--workers=1` (concurrency-correctness).
- Friendly error: a mocked `NoSuchBucket` exits 1 with a one-line message.

### `tests/visual.spec.js` and `tests/gpdu-scan.spec.js` (touched, Phase 1)

Visual snapshots regenerated after the chrome restructure. Existing scan-correctness tests (parent indices, file sizes, color buckets) stay green — they probe the encoded HTML data, which is shape-stable across the chrome refactor.

### `AGENTS.md` (modified, end of each phase)

A new `## CLIs` top-level section, with one subsection per tool (~3 sentences each). Tricky bits to record:

- `gpdu-scan.js`: the canonical template; uses `worker_threads` because directory I/O is parallel-syscall-bound.
- `gpdu-json.js`: JSON5 parsed via `@babel/parser`; `(leftover)` leaves reconcile each node's bytes to its serialized span; comments live in leftovers.
- `gpdu-sqlite.js`: per-column byte estimator implements SQLite's serial-type encoding rules in JS; `--include-row-elements-for-all-columns` performs a full scan and is opt-in for cost reasons.
- `gpdu-s3.js`: async Promise pool on the main thread (I/O-bound, threads buy nothing); fans out by `Delimiter=/`.

### `README.md` (modified, end of each tool phase)

A new top-level "Other gpdu-* tools" section, with one subsection per tool: a short description, the canonical CLI invocation, and a screenshot or animated GIF (deferred — placeholder for now). The deno-sandbox invariant test pattern from the existing gpdu section is **not** added per tool until publish (per Q&A round 6).

---

## Task list

### Phase 1 — Extract `tools/scan-core.js`, restructure `gpdu-scan.js`'s chrome

1. Create `tools/scan-core.js`. Move `partitionBlocks`, `encodeBlock`, `humanBytes`, `escapeHtml` from `tools/gpdu-scan.js` verbatim.
2. Lift the browser-side IIFE source out of `tools/gpdu-scan.js` into a `LOADER_JS` constant inside `tools/scan-core.js` (or a sibling source file the build reads — pick whichever reads cleaner). Generalize: drop all gpdu-specific assumptions about which color attributes a node carries; the loader's `getColor` reads `currentColorMode` and looks up a tool-supplied attribute key from each node.
3. Update `tools/build.js` to emit `dist/scan-loader.embed.js` exporting `LOADER_JS` as a string constant. Update `package.json#files` accordingly.
4. Restructure `tools/gpdu-scan.js`'s page-chrome HTML into a clearly factored shape (title-row builder, toolbar builder, stats-bar template, help-modal markup, page-script template) — this becomes the model for the next three tools to copy. Existing scan correctness preserved.
5. Update `tests/visual.spec.js` snapshots after restructure (`npm run test:update` then commit the new PNGs).
6. Add `tests/scan-core.spec.js` with the unit tests listed above.
7. Update `AGENTS.md`: add the `## CLIs` section with a single `gpdu` subsection covering the new template structure.
8. Sanity check: existing `tests/gpdu-scan.spec.js` and `tests/readme-deno-command.spec.js` still pass; `tests/scan-core.spec.js` passes. **Do not** bump version. **Do not** publish.

### Phase 2 — `gpdu-json`

1. Add `@babel/parser` to `dependencies`. `npm install`.
2. Create `tools/gpdu-json.js`, modeled on the restructured `gpdu-scan.js`.
3. Implement the AST-to-`(labels, parentIndices, values)` walker, including the `(leftover)` leaf insertion at every non-leaf node and the `colorJsonType` / `colorDepth` / `colorKey` per-node attributes.
4. Implement the edge cases (root scalar, empty `{}` / `[]`, comments-only error).
5. Implement `--min-bytes` and `--max-array-children` pruning, with the `[…M more]` rollup leaf for the latter.
6. Wire stats bar (objects/arrays/strings/numbers/total bytes), tool-specific help modal, color/theme/palette/hash page script.
7. Add `tests/gpdu-json.spec.js`. Aggregate-consistency invariant is the centerpiece. Plus pruning, edge cases, file:// smoke test.
8. Update `README.md`: add a top-level "Other gpdu-* tools" section with a `gpdu-json` subsection, usage example, what its color modes mean.
9. Update `AGENTS.md` `## CLIs`: add `gpdu-json` subsection.
10. Sanity check: all tests pass. **Do not** bump version. **Do not** publish.

### Phase 3 — `gpdu-sqlite`

1. Add `better-sqlite3` to `devDependencies` and `optionalDependencies`. `npm install`.
2. Create `tools/gpdu-sqlite.js`, modeled on the restructured `gpdu-scan.js`.
3. Implement DB introspection: walk `sqlite_master`, collect per-table column lists via `PRAGMA table_info`, per-table indices via `PRAGMA index_list` + `PRAGMA index_info`.
4. Implement `dbstat` query for total bytes per table-or-index.
5. Implement the JS-side serial-type byte estimator (its own pure function, separately unit-tested).
6. Implement sample-based column-bytes estimation (`--sample-rows=N`) and the full-scan path under `--include-row-elements-for-all-columns`.
7. For row-element leaves, label by primary-key value when one exists (look up via `PRAGMA table_info` for `pk != 0` columns), else `rowid`.
8. Wire stats bar (tables/indices/columns/total bytes), tool-specific help modal, color/theme/palette/hash page script. Color modes: kind / parent-table / value-type.
9. Add `tests/gpdu-sqlite.spec.js` per the spec above. Include a unit test for the serial-type estimator on hand-crafted values.
10. Update `README.md`: add `gpdu-sqlite` subsection.
11. Update `AGENTS.md` `## CLIs`: add `gpdu-sqlite` subsection.
12. Sanity check. **Do not** bump version. **Do not** publish.

### Phase 4 — `gpdu-s3`

1. Add `@aws-sdk/client-s3` and `aws-sdk-client-mock` to `devDependencies`; `@aws-sdk/client-s3` to `optionalDependencies`. `npm install`.
2. Create `tools/gpdu-s3.js`, modeled on the restructured `gpdu-scan.js`.
3. Implement the async Promise pool walker. Prefix-fanout by `Delimiter=/`. Default `--workers=16`.
4. Implement `--region`, `--no-sign-request`, `--include-versions`. Multiple `s3://...` args allowed; combined into one tree if a single common bucket prefix is given, else multiple top-level entries (one per arg).
5. Map `Contents` and `CommonPrefixes` into the `(labels, parentIndices, values)` arrays plus `colorExt` / `colorStorage` / `colorMtime` attributes.
6. Wire stats bar, tool-specific help modal, color/theme/palette/hash page script.
7. Friendly error handling for `NoSuchBucket` / `AccessDenied`.
8. Add `tests/gpdu-s3.spec.js`. Use `aws-sdk-client-mock` to stub the SDK; no live S3 in CI.
9. Update `README.md`: add `gpdu-s3` subsection.
10. Update `AGENTS.md` `## CLIs`: add `gpdu-s3` subsection.
11. Sanity check. **Do not** bump version. **Do not** publish.

---

## Open questions / things to revisit

These don't block kickoff but should be settled during implementation:

- **Loader source location**: `LOADER_JS` inline in `tools/scan-core.js` (a JS template literal — readable enough for a few hundred lines) vs. separate `tools/scan-loader.source.js` read by the build. Pick whichever reads cleaner once the actual size is known after the move from `gpdu-scan.js`.
- **`@babel/parser` JSON5 mode plugins**: the `parseExpression` API doesn't gate JSON5-grammar specifically; will need to verify the right plugin combination handles single-quoted strings + unquoted keys in objects without dragging in template literals or other JS-only features. If any leak through cleanly without breaking, fine — per Q&A round 7, no validation pass is required.
- **`dbstat` column semantics**: confirm the right summation for "bytes used per table" — `pgsize` vs. `payload + ovfl` vs. one-per-page accounting. Verify with a fixture DB whose total adds up to file size minus freelist.
- **`--no-sign-request` mechanism**: the AWS SDK v3 doesn't have a single anonymous-mode flag; the cleanest path is creating an `S3Client` with a stub credentials provider that returns empty access-key/secret. Worth a small comment in code citing the SDK doc reference.
- **`gpdu-s3` multiple-arg semantics**: if user passes two URIs from different buckets, should they share a common synthetic root (label `multiple buckets`)? Or should each become a top-level entry under a synthetic root? Default to the latter; document in `--help`.
- **Visual-snapshot drift in Phase 1**: the restructured `gpdu-scan.js` chrome should *not* be a visual redesign — same look, same controls, same layout. Only the underlying source organization changes. Snapshots drift only because of incidental DOM-text differences (inlined script tag positions, etc.). If the rendered output is byte-identical, no snapshot update is needed.
