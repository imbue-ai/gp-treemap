# gp_treemap

Python wrapper around [gp-treemap](https://github.com/imbue-ai/gp-treemap):
turn a pandas DataFrame into a self-contained, interactive treemap HTML
page. Mirrors the spirit of `plotly.express.treemap` for the
`path`/`values`/`color` arguments, but emits the HTML directly — no
Plotly Figure intermediate.

## Install

```sh
pip install gp_treemap
```

The JS bundle and loader ship as package data, so the rendered HTML is
fully offline: no CDN, no network fetch.

## Usage

```python
import pandas as pd
from gp_treemap import treemap

df = pd.DataFrame({
    "continent": ["EU", "EU", "AS", "AS"],
    "country":   ["FR", "DE", "CN", "JP"],
    "fuel":      ["nuclear", "coal", "coal", "nuclear"],
    "twh":       [380, 280, 5400, 70],
})

fig = treemap(df, path=["continent", "country", "fuel"], values="twh",
              color="fuel", title="2023 generation by fuel")
fig.write_html("out.html")   # standalone file
fig.show()                   # open in browser
fig                          # in Jupyter, renders inline (iframe srcdoc)
```

### Arguments

- `path`: column names describing the hierarchy, outermost first.
- `values`: numeric column whose per-group sum drives cell size. Defaults
  to row-count.
- `color`: column name. Numeric → continuous palette; non-numeric →
  categorical hash. Pass `"[Level 1]"` (or leave `color=None`) to colour
  by the topmost visible ancestor — recomputed every time you zoom.
- `theme`, `palette`: gpdu themes / palettes
  (`"tokyo-night"`, `"nord"`, `"viridis"`, `"turbo"`, …).

## Development

This package wraps the JS bundle built from the root of the repo. After
running `node tools/build.js` at the repo root, refresh the bundled
artifacts:

```sh
bash python/scripts/refresh_bundle.sh
```

Then run the tests:

```sh
cd python
python -m venv .venv && .venv/bin/pip install -e . pytest pandas numpy
.venv/bin/pytest
```
