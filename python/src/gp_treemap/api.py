"""Public Python surface: ``treemap(df, ...)`` → ``Treemap`` object.

Mirrors the spirit of ``plotly.express.treemap`` for the path/values/color
arguments. No Plotly Figure intermediate — the returned ``Treemap``
wraps a self-contained HTML string that can be written to a file, opened
in a browser, or displayed inline in Jupyter (via an iframe srcdoc).
"""

from __future__ import annotations

import html as _html
import os
import tempfile
import webbrowser
from typing import Iterable

import pandas as pd

from .encoder import build_envelope, build_tree
from .html import render_html


class Treemap:
    """A rendered treemap. Holds a self-contained HTML string."""

    def __init__(self, html_str: str, node_count: int, leaf_count: int):
        self._html = html_str
        self.node_count = node_count
        self.leaf_count = leaf_count

    @property
    def html(self) -> str:
        """The raw HTML string."""
        return self._html

    def to_html(self) -> str:
        """Return the standalone HTML as a string. Alias for ``.html``
        for compatibility with the Plotly Figure API shape."""
        return self._html

    def write_html(self, path: str | os.PathLike) -> None:
        """Write the HTML to ``path``."""
        with open(path, "w", encoding="utf-8") as f:
            f.write(self._html)

    def show(self, browser: str | None = None) -> None:
        """Open in a browser. Writes the HTML to a temp file and opens
        it via :mod:`webbrowser`. ``browser`` is forwarded to
        :func:`webbrowser.get`."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".html", delete=False, encoding="utf-8"
        ) as f:
            f.write(self._html)
            tmp_path = f.name
        url = "file://" + tmp_path
        if browser is None:
            webbrowser.open(url)
        else:
            webbrowser.get(browser).open(url)

    def _repr_html_(self) -> str:
        """Jupyter / IPython display hook. Wraps the page in an iframe
        with ``srcdoc`` so its inline ``<script>`` tags don't fight the
        notebook's own scripts and module registry."""
        escaped = _html.escape(self._html, quote=True)
        return (
            '<iframe srcdoc="' + escaped + '" '
            'style="width:100%; height:600px; border:1px solid #0002; border-radius:4px;" '
            'sandbox="allow-scripts" loading="lazy"></iframe>'
        )

    def __repr__(self) -> str:
        return f"<Treemap nodes={self.node_count:,} leaves={self.leaf_count:,}>"


def treemap(
    data_frame: pd.DataFrame,
    path: str | Iterable[str],
    values: str | None = None,
    color: str | None = None,
    *,
    title: str | None = None,
    theme: str = "tokyo-night",
    palette: str | None = None,
    block_size: int = 500_000,
) -> Treemap:
    """Build a treemap from a DataFrame.

    Args:
        data_frame: source rows. Each row is a leaf of the tree once the
            path columns have been grouped.
        path: column names (or a single column name) describing the
            hierarchy, outermost first.
        values: numeric column whose per-group sum drives cell size. If
            ``None``, every row counts as 1 (so cell size = row count).
        color: column name driving cell colour, OR the literal string
            ``"[Level 1]"`` to colour by the topmost visible ancestor
            under the current zoom (gpdu-table's default). Numeric
            columns get a continuous palette; non-numeric ones get a
            categorical hash.
        title: page title. Defaults to a path-based summary.
        theme: page-chrome theme (one of the gpdu themes; e.g.
            ``"tokyo-night"``, ``"nord"``, ``"catppuccin"``).
        palette: explicit palette override (e.g. ``"viridis"``,
            ``"turbo"``, ``"coolwarm"``). When ``None``, picks a sensible
            default for the color column's dtype.
        block_size: rows per envelope block. Larger blocks → fewer
            decompression streams in the browser; smaller blocks → faster
            first paint. 500k is a good default.

    Returns:
        A :class:`Treemap` holding a self-contained HTML string.
    """
    if isinstance(path, str):
        path_cols = [path]
    else:
        path_cols = list(path)

    if color == "[Level 1]":
        color_arg = "[Level 1]"
    else:
        color_arg = color

    scan = build_tree(data_frame, path=path_cols, values=values, color=color_arg)
    envelope = build_envelope(scan, block_size=block_size)

    # Stats for the title row.
    node_count = len(scan.labels)
    # Leaves = nodes with no children in parent_indices.
    pi = scan.parent_indices
    has_child = set(int(p) for p in pi if p >= 0)
    leaf_count = sum(1 for i in range(node_count) if i not in has_child)

    auto_title = title or f"treemap · {' → '.join(path_cols)}"

    # Determine the color kind for the loader config.
    color_kind = None
    if color_arg and color_arg != "[Level 1]" and color_arg in scan.attributes:
        color_kind = scan.attributes[color_arg]["kind"]

    html_str = render_html(
        envelope=envelope,
        title=auto_title,
        color_column=color_arg,
        color_kind=color_kind,
        theme=theme,
        palette=palette,
        node_count=node_count,
        leaf_count=leaf_count,
    )
    return Treemap(html_str, node_count=node_count, leaf_count=leaf_count)
