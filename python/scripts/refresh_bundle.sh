#!/usr/bin/env bash
# Copy the freshly-built JS bundle + loader into the Python package data
# directory. Run after rebuilding the JS side (`node tools/build.js` from
# the repo root). The Python wheel ships these as package data.
set -euo pipefail

cd "$(dirname "$0")/.."          # → python/
REPO_ROOT="$(cd .. && pwd)"
DEST="src/gp_treemap/_bundle"

# Copy the raw IIFEs — not the *.embed.js wrappers, which export them as
# ESM template strings for the Node-side tools that splat them into HTML.
# We need the plain browser-runnable bodies because we splice them directly
# into a <script> tag.
cp "$REPO_ROOT/dist/gp-treemap.bundle.js"       "$DEST/gp-treemap.bundle.js"
cp "$REPO_ROOT/tools/scan-loader.source.js"     "$DEST/scan-loader.js"

ls -lh "$DEST"
