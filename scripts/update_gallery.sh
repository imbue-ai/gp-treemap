#!/usr/bin/env bash
# Regenerate every file under gallery/.
#
# Each gallery entry is a self-contained HTML file produced by one of our
# tools (gpdu-scan.js for the disk-usage entry, table-treemap.js for the
# tabular entries) — open it in any browser (or host it on GitHub Pages)
# and the treemap renders with no server, no CORS, no bundler.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
DATA="$ROOT/samples/data/table"

# Make sure the bundle is current; the tools inline it into their output.
node tools/build.js

# If node_modules is missing, install so the self-scan includes the npm deps.
if [ ! -d node_modules ]; then
  npm install
fi

# --- Disk-usage entry: self-scan of the repo.
node tools/gpdu-scan.js --no-open --color=extension "$ROOT" "$ROOT/gallery/gp-treemap-source-tree-disk-usage.html"

# --- LLM continuation-density entry: regenerate the HTML from the cached
# scan JSON. The original scan was a ~24-hour depth-6, top-p=0.98 run; we
# down-sampled it to depth-4 + top-p=0.80 (via tools/repack-scan.js) to
# keep both the cache (~1.7 MB) and the rendered HTML (~2.5 MB) small
# enough to commit comfortably. The full source scan lives outside the
# repo on Dropbox.
node tools/gpdu-llm-density.js --no-open \
  --scan-in="$ROOT/samples/data/llm-density/fruit-flies-d4-p80.json.gz" \
  --prompt='Time flies like an arrow. Fruit flies like a' \
  --model=/tmp/llama-3.2-1b-f16.gguf \
  "$ROOT/gallery/llm-density-fruit-flies.html"

# --- Table-treemap entries. Each line pairs a dataset with the defaults
# baked into its viewer HTML.
node tools/table-treemap.js --no-open \
  --size=Generation_TWh --color='[Level 1]' --path=Fuel,Continent,Country \
  --theme=catppuccin \
  --title="Global electricity generation (2023, TWh) — colored by fuel" \
  "$DATA/energy-2023.jsonl" \
  "$ROOT/gallery/table-treemap-energy-fuel.html"

node tools/table-treemap.js --no-open \
  --size=Gross_Outlays --color='[Level 1]' --path=Category,Agency,Bureau \
  --palette=viridis \
  --title="US federal outlays FY2024 — Treasury MTS (USD)" \
  "$DATA/us-outlays-fy2024.jsonl" \
  "$ROOT/gallery/table-treemap-us-outlays.html"

node tools/table-treemap.js --no-open \
  --size=Gross_Outlays --color=YoY_Change_Pct --path=Category,Agency \
  --palette=coolwarm --color-scale=diverging \
  --title="US federal outlays FY2024 — colored by YoY % change" \
  "$DATA/us-outlays-fy2024.jsonl" \
  "$ROOT/gallery/table-treemap-us-outlays-yoy.html"

# UC + city wages come from the public GCC raw-export zips we keep under
# samples/data/table/ca-raw/ (the website is Cloudflare-gated so checking
# the zips in makes the pipeline reproducible). Unzip to a temp dir and
# point table-treemap.js at the CSVs directly.
CA_TMP=$(mktemp -d -t gp-treemap-ca-XXXXXX)
trap 'rm -rf "$CA_TMP"' EXIT
KEEP_COLS=EmployerType,EmployerName,DepartmentOrSubdivision,Position,TotalWages,RegularPay,OvertimePay,OtherPay,TotalRetirementAndHealthContribution,EmployerCounty,PensionFormula

if [ -f "$DATA/ca-raw/2024_UniversityOfCalifornia.zip" ]; then
  unzip -o -q "$DATA/ca-raw/2024_UniversityOfCalifornia.zip" -d "$CA_TMP"
  node tools/table-treemap.js --no-open \
    --size=TotalWages --color='[Level 1]' --path=EmployerName,DepartmentOrSubdivision \
    --palette=turbo --keep-cols="$KEEP_COLS" \
    --title="UC employee wages 2024 (California)" \
    "$CA_TMP/2024_UniversityOfCalifornia.csv" \
    "$ROOT/gallery/table-treemap-ca-uc.html"
fi
if [ -f "$DATA/ca-raw/2024_City.zip" ]; then
  unzip -o -q "$DATA/ca-raw/2024_City.zip" -d "$CA_TMP"
  node tools/table-treemap.js --no-open \
    --size=TotalWages --color='[Level 1]' \
    --path=DepartmentOrSubdivision,EmployerCounty,EmployerName,Position,_row \
    --theme=one-dark --keep-cols="$KEEP_COLS" \
    --title="California city government wages 2024" \
    "$CA_TMP/2024_City.csv" \
    "$ROOT/gallery/table-treemap-ca-city.html"
fi

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
