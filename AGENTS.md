# Agent notes for raised-treemap

## Bundle

After editing any file in `src/`, rebuild the bundle:

    node tools/build.js

The scan viewer (`tools/scan.js`) and the unit-fixture test page both load
`dist/raised-treemap.bundle.js`, not the ES modules directly. If you forget
to rebuild, your changes won't appear in scanned HTML output.

A test (`tests/bundle-freshness.spec.js`) will catch a stale bundle.

## Tests

    npx playwright test          # all tests
    npx playwright test <file>   # single file
