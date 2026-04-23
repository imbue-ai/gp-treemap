#!/usr/bin/env bash
# Regenerate the files under gallery/.
#
# Each gallery entry is a self-contained HTML file produced by tools/gpdu-scan.js —
# open it in any browser (or host it on GitHub Pages) and the treemap renders
# with no server, no CORS, no bundler.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

# Make sure the bundle is current; gpdu-scan.js inlines it into the output.
node tools/build.js

# If node_modules is missing, install so the self-scan includes the npm deps.
if [ ! -d node_modules ]; then
  npm install
fi

# Self-scan: the repo looking at itself, .git and node_modules included.
node tools/gpdu-scan.js --no-open --color=extension "$ROOT" "$ROOT/gallery/gp-treemap-source-tree-disk-usage.html"

# Regenerate the README screenshot from the gallery HTML.
# Spin up the local static server in the background, screenshot via headless
# Chromium, then tear it down.
node tools/server.js >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
# Wait for the server to accept connections (up to ~5s).
for _ in $(seq 1 50); do
  if curl -sSf http://localhost:4173/ -o /dev/null 2>&1; then break; fi
  sleep 0.1
done
node scripts/screenshot-gallery.mjs \
  http://localhost:4173/gallery/gp-treemap-source-tree-disk-usage.html \
  "$ROOT/tests/screenshots/gallery-source-tree.png"
kill $SERVER_PID 2>/dev/null || true
trap - EXIT

echo ""
echo "gallery/ updated:"
ls -lh "$ROOT/gallery"/*.html
echo ""
echo "screenshot updated:"
ls -lh "$ROOT/tests/screenshots/gallery-source-tree.png"
