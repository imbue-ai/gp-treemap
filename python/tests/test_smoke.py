"""Smoke tests: round-trip a small DataFrame through the Python encoder
and sanity-check the rendered HTML."""

from __future__ import annotations

import base64
import json
import re
import zlib

import pandas as pd
import pytest

from gp_treemap import treemap
from gp_treemap.encoder import build_envelope, build_tree


@pytest.fixture
def energy_df() -> pd.DataFrame:
    # Six rows, two continents, four countries, three fuels.
    return pd.DataFrame(
        {
            "continent": ["EU", "EU", "EU", "AS", "AS", "AS"],
            "country":   ["FR", "DE", "DE", "CN", "JP", "JP"],
            "fuel":      ["nuclear", "coal", "solar", "coal", "nuclear", "solar"],
            "twh":       [380.0, 280.0, 60.0, 5400.0, 70.0, 90.0],
        }
    )


def _inflate_block(b64: str) -> dict:
    raw = base64.b64decode(b64)
    return json.loads(zlib.decompress(raw, -15).decode("utf-8"))


def test_build_tree_aggregates_values_at_leaves(energy_df):
    scan = build_tree(energy_df, path=["continent", "country", "fuel"], values="twh", color="fuel")
    # 1 root + 2 continents + 4 countries + 6 (continent, country, fuel) leaves
    # (DE has coal+solar, JP has nuclear+solar, the other two countries have one fuel each).
    assert len(scan.labels) == 1 + 2 + 4 + 6
    # Root + internals start at 0 — the partitioner reverse-aggregates them.
    assert scan.values[0] == 0.0


def test_build_envelope_round_trip(energy_df):
    scan = build_tree(energy_df, path=["continent", "country", "fuel"], values="twh", color="fuel")
    env = build_envelope(scan, block_size=500_000)
    assert env["v"] == 4
    assert isinstance(env["blocks"], list) and len(env["blocks"]) == 1

    # Inflate and verify the block has the expected shape.
    block = _inflate_block(env["blocks"][0])
    assert "labels" in block and "values" in block
    assert "pgB64" in block and "grB64" in block
    assert block["attributes"]["fuel"]["kind"] == "categorical"
    # Sum of block values across all depth-levels = (depth+1) × total.
    # Each depth slice (root, continent, country, fuel-leaf) sums to the
    # full row-total, so a 3-column path with everyone reaching the leaf
    # level multiplies the total by 4.
    total = sum(block["values"])
    assert abs(total - 4 * float(energy_df["twh"].sum())) < 1e-6


def test_treemap_returns_self_contained_html(energy_df):
    fig = treemap(energy_df, path=["continent", "country", "fuel"], values="twh", color="fuel")
    assert isinstance(fig.html, str)
    assert "<gp-treemap" in fig.html
    assert "tmdata" in fig.html
    assert "window._gpduConfig" in fig.html
    # The inlined bundle should bring the custom element with it.
    assert "customElements.define" in fig.html or "GpTreemap" in fig.html


def test_treemap_level1_default(energy_df):
    """``color=None`` (or the literal ``"[Level 1]"``) should drive the
    viewer into ``level1`` mode."""
    fig = treemap(energy_df, path=["continent", "country"], values="twh")
    # The component's color-mode attribute is rendered into the HTML.
    m = re.search(r'<gp-treemap[^>]*color-mode="([^"]+)"', fig.html)
    assert m is not None
    assert m.group(1) == "level1"


def test_treemap_numeric_color(energy_df):
    fig = treemap(energy_df, path=["continent", "country"], values="twh", color="twh")
    m = re.search(r'<gp-treemap[^>]*color-mode="([^"]+)"', fig.html)
    assert m and m.group(1) == "quantitative"


def test_treemap_repr_html_uses_iframe_srcdoc(energy_df):
    fig = treemap(energy_df, path=["continent", "country"], values="twh")
    out = fig._repr_html_()
    assert out.startswith("<iframe srcdoc=")
    assert "sandbox=" in out
