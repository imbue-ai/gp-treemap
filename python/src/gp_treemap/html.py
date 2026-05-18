"""Splice the JS bundle, scan-loader, gpdu config, and envelope into a
self-contained HTML page. Output mirrors what the Node ``gpdu-*`` tools
emit, modulo any tool-specific chrome.
"""

from __future__ import annotations

import json
from importlib import resources
from typing import Any

# Themes + palettes match the gpdu-* defaults so the Python output's
# look-and-feel lines up with the Node tools' look-and-feel.
THEMES: dict[str, dict[str, str]] = {
    "nord":          {"label": "Nord",            "bg": "#2e3440", "surface": "#3b4252", "border": "#4c566a", "fg": "#d8dee9", "fgMuted": "#81a1c1", "accent": "#88c0d0"},
    "solarized":     {"label": "Solarized Dark",  "bg": "#002b36", "surface": "#073642", "border": "#586e75", "fg": "#839496", "fgMuted": "#657b83", "accent": "#268bd2"},
    "dracula":       {"label": "Dracula",         "bg": "#282a36", "surface": "#44475a", "border": "#6272a4", "fg": "#f8f8f2", "fgMuted": "#6272a4", "accent": "#bd93f9"},
    "catppuccin":    {"label": "Catppuccin Mocha","bg": "#1e1e2e", "surface": "#313244", "border": "#45475a", "fg": "#cdd6f4", "fgMuted": "#a6adc8", "accent": "#cba6f7"},
    "gruvbox":       {"label": "Gruvbox Dark",    "bg": "#282828", "surface": "#3c3836", "border": "#504945", "fg": "#ebdbb2", "fgMuted": "#a89984", "accent": "#fabd2f"},
    "tokyo-night":   {"label": "Tokyo Night",     "bg": "#1a1b26", "surface": "#16161e", "border": "#0f0f14", "fg": "#c0caf5", "fgMuted": "#787c99", "accent": "#7aa2f7"},
    "rose-pine":     {"label": "Rosé Pine",       "bg": "#191724", "surface": "#1f1d2e", "border": "#26233a", "fg": "#e0def4", "fgMuted": "#908caa", "accent": "#c4a7e7"},
    "one-dark":      {"label": "One Dark",        "bg": "#282c34", "surface": "#2c313a", "border": "#3e4452", "fg": "#abb2bf", "fgMuted": "#828997", "accent": "#61afef"},
}

PALETTE_PICKS = {
    "viridis": "Viridis", "plasma": "Plasma", "inferno": "Inferno", "magma": "Magma",
    "turbo": "Turbo", "heatmap": "Heatmap", "coolwarm": "Cool–Warm", "rainbow": "Rainbow",
    "tokyo-night": "Tokyo Night (categorical)", "gp-default": "Default 8-hue",
}


def _read_bundle(name: str) -> str:
    return (resources.files("gp_treemap") / "_bundle" / name).read_text(encoding="utf-8")


def _escape_html(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_html(
    *,
    envelope: dict[str, Any],
    title: str,
    color_column: str | None,
    color_kind: str | None,   # "categorical" | "numeric" | None
    theme: str = "tokyo-night",
    palette: str | None = None,
    node_count: int | None = None,
    leaf_count: int | None = None,
) -> str:
    """Build the full standalone HTML page string."""
    bundle_js = _read_bundle("gp-treemap.bundle.js")
    loader_js = _read_bundle("scan-loader.js")

    # Default colour mode + palette. [Level 1] is the gpdu-table default
    # when no explicit colour column is chosen; otherwise we drive the
    # viewer with the user's column name.
    if color_column is None or color_column == "[Level 1]":
        default_color = "[Level 1]"
        tm_color_mode = "level1"
        categorical_modes: list[str] = []
        quantitative_modes: list[str] = []
    elif color_kind == "numeric":
        default_color = color_column
        tm_color_mode = "quantitative"
        categorical_modes = []
        quantitative_modes = [color_column]
    else:
        default_color = color_column
        tm_color_mode = "categorical"
        categorical_modes = [color_column]
        quantitative_modes = []

    cat_palette_default = "tokyo-night"
    q_palette_default = "viridis"
    tm_palette = palette or (cat_palette_default if tm_color_mode != "quantitative" else q_palette_default)

    cfg = {
        "defaultColorMode": default_color,
        "categoricalModes": categorical_modes,
        "quantitativeModes": quantitative_modes,
        "catColorMaps": {},
        "defaultTheme": theme,
        "themes": THEMES,
        "palettePicks": PALETTE_PICKS,
        "catPaletteDefault": cat_palette_default,
        "qPaletteDefault": q_palette_default,
    }

    envelope_json = json.dumps(envelope, separators=(",", ":"))
    cfg_json = json.dumps(cfg, separators=(",", ":"))

    theme_options = "\n".join(
        f'<option value="{k}">{_escape_html(v["label"])}</option>' for k, v in THEMES.items()
    )
    palette_options = "\n".join(
        f'<option value="{k}">{_escape_html(v)}</option>' for k, v in PALETTE_PICKS.items()
    )

    stat_bits = []
    if node_count is not None:
        stat_bits.append(f'<span class="stat"><b>{node_count:,}</b> nodes</span>')
    if leaf_count is not None:
        stat_bits.append(f'<span class="stat"><b>{leaf_count:,}</b> leaves</span>')
    stats_html = "\n".join(stat_bits)

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{_escape_html(title)}</title>
<style>
  html, body {{ margin: 0; padding: 0; height: 100%; font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--page-bg, #fafafa); color: var(--page-fg, #111); transition: background .15s, color .15s; }}
  body {{ display: flex; flex-direction: column; }}
  .title-row {{ padding: 8px 14px; border-bottom: 1px solid var(--page-border, #0002);
    display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap;
    background: var(--page-surface, #fff); }}
  .title-row h1 {{ margin:0; font-size:14px; font-weight:600; font-family: ui-monospace, SF Mono, Menlo, monospace;
    color: var(--page-fg, #222); }}
  .title-row .stat {{ color: var(--page-fg-muted, #555); font-size:13px; font-variant-numeric: tabular-nums; }}
  .title-row .stat b {{ color: var(--page-fg, #000); font-weight:600; }}
  .app-toolbar {{ padding: 4px 14px; border-bottom: 1px solid var(--page-border, #0002);
    display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
    background: var(--page-surface, #fff); font-size: 12px; color: var(--page-fg-muted, #666); }}
  .app-toolbar select {{ font-size: 12px; padding: 2px 4px; }}
  .app-toolbar .spacer {{ flex: 1; }}
  #tm {{ flex: 1 1 auto; min-height: 0; }}
  #bottom-bar {{ padding: 4px 14px; border-top: 1px solid var(--page-border, #0002);
    display: flex; gap: 14px; align-items: center; background: var(--page-surface, #fff);
    font-size: 12px; color: var(--page-fg-muted, #666); }}
</style>
</head>
<body>
<div class="title-row">
  <h1>{_escape_html(title)}</h1>
  {stats_html}
</div>
<div class="app-toolbar">
  <span>theme
    <select id="theme-sel">
      <option value="">Default (light)</option>
      {theme_options}
    </select>
  </span>
  <span>palette
    <select id="palette-sel">
      <option value="">(theme default)</option>
      {palette_options}
    </select>
  </span>
  <span class="spacer"></span>
</div>
<gp-treemap id="tm"
  color-mode="{tm_color_mode}"
  palette="{tm_palette}"
  gradient-intensity="0.6"
  min-cell-area="30"></gp-treemap>
<div id="bottom-bar">
  <div id="stats-bar"></div>
</div>

<script type="application/json" id="tmdata">{envelope_json}</script>
<script>
{bundle_js}
</script>
<script>
window._gpduConfig = {cfg_json};
</script>
<script>
{loader_js}
</script>
</body>
</html>
"""
