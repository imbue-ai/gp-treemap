#!/usr/bin/env bash
# Regenerate the files under gallery/.
#
# Each gallery entry is a self-contained HTML file produced by tools/scan.js —
# open it in any browser (or host it on GitHub Pages) and the treemap renders
# with no server, no CORS, no bundler.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

# Make sure the bundle is current; scan.js inlines it into the output.
node tools/build.js

# If node_modules is missing, install so the self-scan includes the npm deps.
if [ ! -d node_modules ]; then
  npm install
fi

# Self-scan: the repo looking at itself, .git and node_modules included.
node tools/scan.js --no-open --color=extension "$ROOT" "$ROOT/gallery/self.html"

echo ""
echo "gallery/ updated:"
ls -lh "$ROOT/gallery"/*.html
