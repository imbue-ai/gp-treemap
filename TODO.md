# TODO

## Cross-cutting

### Iterative deepening + graceful SIGINT (port from `gpdu-llm-density`)

`tools/gpdu-llm-density.js` is gaining an iterative-deepening traversal:
depth-1 BFS → snapshot → depth-2 BFS → snapshot → … and a SIGINT handler
that emits the most recent complete-depth snapshot as HTML before exiting.
The same pattern would be a clear win in the other `gpdu-*` tools where a
scan can take a while:

- **`tools/gpdu-scan.js`** (recursive directory walk). Ctrl-C today
  produces nothing. With depth-by-depth scanning + per-depth snapshots,
  a user who interrupts a 20-minute disk scan would still get a
  treemap-able partial tree of whatever depth completed. Within a depth
  layer, processing siblings before cousins also helps cache locality on
  spinning disks (less seeking).
- **`tools/gpdu-s3.js`** (LIST pagination). Even more important — long
  S3 enumerations are common and the current "all or nothing" outcome
  is unfriendly. Iterative deepening maps cleanly to the
  prefix-fanout structure (`Delimiter=/`).
- **`tools/gpdu-sqlite.js`** is fast enough that this is probably not
  worth the code; flag.

Pattern to replicate: at end of each depth pass, snapshot the
`(labels, parentIndices, values, attributes)` arrays plus aggregate
counters. SIGINT handler restores the most recent snapshot and jumps to
HTML emission. See `tools/gpdu-llm-density.js` once the refactor lands.
