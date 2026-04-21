# Agent notes for raised-treemap

## Bundle

After editing any file in `src/`, rebuild the bundle:

    node tools/build.js

The scan viewer (`tools/scan.js`) and the unit-fixture test page both load
`dist/raised-treemap.bundle.js`, not the ES modules directly. If you forget
to rebuild, your changes won't appear in scanned HTML output.

A test (`tests/bundle-freshness.spec.js`) will catch a stale bundle.

## URL hash state

UI state is persisted in the URL hash **at the page level**, not inside the
`<raised-treemap>` component. The component fires events; the page script
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
2. Add read/write in the page-level hash script (scan.js template +
   samples/interactions.html).
3. Add a test in `tests/url-hash.spec.js`.

## Falsy node IDs

In lazy-tree mode (scan files), node IDs are numeric and the root node's ID
is `0`. Never use truthiness checks (`!id`, `if (id)`, `!node._item`) to
test whether an ID or item exists — `0` is falsy in JavaScript. Use explicit
null checks instead: `id == null`, `id != null`, `node._item == null`.

This has caused bugs where the root node was silently skipped (e.g. the zoom
path expansion skipping the root because `!0` is `true`).

## Tests

    npx playwright test          # all tests
    npx playwright test <file>   # single file
