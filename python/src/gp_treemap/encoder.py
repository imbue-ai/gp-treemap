"""DataFrame → gp-treemap wire-format envelope.

The wire format is the same JSON shape that the Node-side gpdu-* tools
emit (see ``tools/scan-core.js`` in this repo). The browser-side loader
(``scan-loader.js``) inflates the envelope's blocks and feeds the rows
into the ``<gp-treemap>`` web component.

This module produces v=4 (depth-band) envelopes — every parent reference
is a global id, every block holds a contiguous depth slice, and there are
no stubs. It's the simplest of the three formats to emit and the one the
LLM-density / table tools also default to.

Pipeline:
    DataFrame
       │
       ▼ build_tree   (groupby on the path columns; one node per unique
       │              path prefix; per-node ``value`` plus aggregated
       │              attribute values for whatever ``color`` column was
       │              chosen)
    flat scan dict
       │
       ▼ partition_depth_band   (sort by depth, slice into fixed-size
       │                         blocks)
       │
       ▼ encode_block × N       (one block at a time → JSON dict; the
       │                         array fields are emitted as base64-
       │                         encoded raw-deflate of the underlying
       │                         typed buffers)
       │
       ▼ build_envelope         ({v: 4, blocks: ['b64...', ...]})
"""

from __future__ import annotations

import base64
import json
import zlib
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

WIRE_VERSION = 4
DEFAULT_BLOCK_SIZE = 500_000


@dataclass
class Scan:
    """Flat representation of a tree, mirroring ``scan-core.js``'s shape.

    - ``labels[i]`` is the string label of node *i*.
    - ``parent_indices[i]`` is the index of node *i*'s parent (root = -1).
    - ``values[i]`` is the per-node value; internal nodes are typically 0
      and the partitioner reverse-aggregates leaves up.
    - ``attributes[name]`` is ``{"kind": "categorical"|"numeric",
      "values": [...]}``. ``values`` is a Python list of length
      ``len(labels)``. None marks "no value" for numeric attributes.
    """

    labels: list[str]
    parent_indices: np.ndarray  # int32
    values: np.ndarray  # float64
    attributes: dict[str, dict[str, Any]]


def build_tree(
    df: pd.DataFrame,
    path: list[str],
    values: str | None,
    color: str | None,
) -> Scan:
    """Aggregate ``df`` into a tree keyed by the path columns.

    One node per unique path prefix; the synthetic root sits above the
    first path column. Leaf values are the per-group sum of ``values``;
    internal-node values are 0 (the partitioner re-aggregates them).

    ``color`` is carried as a per-node attribute named after the column:
    numeric columns get a value-weighted mean per node; categorical
    columns get the first-seen value per node (matching the table-treemap
    JS behaviour). Pass ``color=None`` to skip the attribute entirely
    (caller probably wants ``[Level 1]`` mode).
    """
    if not path:
        raise ValueError("path must be a non-empty list of column names")
    for col in path:
        if col not in df.columns:
            raise ValueError(f"path column {col!r} not in DataFrame")
    if values is not None and values not in df.columns:
        raise ValueError(f"values column {values!r} not in DataFrame")
    if color is not None and color not in df.columns and color != "[Level 1]":
        raise ValueError(f"color column {color!r} not in DataFrame")

    # Per-row size. Default to 1 (count) when ``values`` not given —
    # matches Plotly Express's behaviour for treemap(values=None).
    if values is None:
        size = np.ones(len(df), dtype=np.float64)
    else:
        size = pd.to_numeric(df[values], errors="coerce").to_numpy(dtype=np.float64)
        size = np.where(np.isfinite(size) & (size > 0), size, 0.0)

    color_kind = None  # "numeric" | "categorical" | None
    color_vals_per_row = None
    if color and color != "[Level 1]" and color in df.columns:
        col = df[color]
        if pd.api.types.is_numeric_dtype(col):
            color_kind = "numeric"
            color_vals_per_row = pd.to_numeric(col, errors="coerce").to_numpy(dtype=np.float64)
        else:
            color_kind = "categorical"
            color_vals_per_row = col.astype("string").fillna("(blank)").to_numpy()

    # Build the tree by walking each row's path prefix. ``key_to_idx``
    # maps a prefix tuple to its node index. Node 0 is always the
    # synthetic root.
    labels: list[str] = ["(root)"]
    parent: list[int] = [-1]
    val: list[float] = [0.0]
    color_sum: list[float] = [0.0]
    color_cnt: list[float] = [0.0]
    color_cat: list[Any] = [None]
    key_to_idx: dict[tuple, int] = {(): 0}

    # Pre-stringify path-column values once so the loop is just a tuple build.
    seg_arrays = []
    for c in path:
        s = df[c].astype("string").fillna("(blank)").to_numpy()
        seg_arrays.append(s)

    n_rows = len(df)
    for ri in range(n_rows):
        sz = size[ri]
        if sz <= 0:
            continue
        parent_key: tuple = ()
        parent_idx = 0
        for k in range(len(path)):
            seg = seg_arrays[k][ri]
            key = parent_key + (seg,)
            idx = key_to_idx.get(key)
            if idx is None:
                idx = len(labels)
                key_to_idx[key] = idx
                labels.append(str(seg))
                parent.append(parent_idx)
                val.append(0.0)
                color_sum.append(0.0)
                color_cnt.append(0.0)
                color_cat.append(None)
            # Per the table-treemap convention, the per-row size lands on
            # the *leaf* (deepest path-prefix); internals start at 0 and
            # the partitioner's reverse pass aggregates them up. So we
            # only add to ``val`` at the leaf level. (Adding at every
            # level would double-count after aggregation.)
            if k == len(path) - 1:
                val[idx] += sz
            # Color: weighted-mean for numeric, first-seen for categorical,
            # at *every* level of the prefix so internal nodes also carry
            # an aggregate (matches table-treemap.js).
            if color_vals_per_row is not None:
                if color_kind == "numeric":
                    cv = color_vals_per_row[ri]
                    if np.isfinite(cv):
                        color_sum[idx] += cv * sz
                        color_cnt[idx] += sz
                else:
                    if color_cat[idx] is None:
                        color_cat[idx] = color_vals_per_row[ri]
            parent_idx = idx
            parent_key = key

    n_nodes = len(labels)
    parent_arr = np.array(parent, dtype=np.int32)
    val_arr = np.array(val, dtype=np.float64)

    attributes: dict[str, dict[str, Any]] = {}
    if color_kind == "numeric":
        vals = [None] * n_nodes
        for i in range(n_nodes):
            vals[i] = (color_sum[i] / color_cnt[i]) if color_cnt[i] > 0 else float("nan")
        attributes[color] = {"kind": "numeric", "values": vals}
    elif color_kind == "categorical":
        attributes[color] = {"kind": "categorical", "values": color_cat}

    return Scan(labels=labels, parent_indices=parent_arr, values=val_arr, attributes=attributes)


def partition_depth_band(
    scan: Scan, block_size: int = DEFAULT_BLOCK_SIZE
) -> tuple[list[list[int]], np.ndarray, np.ndarray]:
    """Depth-band partition: nodes sorted by (depth, original-id), sliced
    into fixed-size blocks. Mirrors ``partitionBlocksDepthBand`` in
    ``tools/scan-core.js``. Returns ``(blocks, agg_value, depth)``."""
    n = len(scan.labels)
    pi = scan.parent_indices

    # Depth per node (root = 0; parents always precede children in a
    # well-formed scan, so forward pass works).
    depth = np.zeros(n, dtype=np.int32)
    for i in range(n):
        depth[i] = 0 if pi[i] < 0 else depth[pi[i]] + 1

    # Aggregate value, reverse pass.
    agg_value = scan.values.copy()
    for i in range(n - 1, -1, -1):
        if pi[i] >= 0:
            agg_value[pi[i]] += agg_value[i]

    # Permutation by (depth, id). numpy lexsort: last key is primary.
    ids = np.arange(n, dtype=np.int32)
    order = np.lexsort((ids, depth))

    blocks: list[list[int]] = []
    i = 0
    while i < n:
        end = min(i + block_size, n)
        blocks.append(order[i:end].tolist())
        i = end
    return blocks, agg_value, depth


def _to_b64_int32(values: list[int] | np.ndarray) -> str:
    arr = np.asarray(values, dtype=np.int32)
    return base64.b64encode(arr.tobytes()).decode("ascii")


def _to_b64_uint16(values: list[int] | np.ndarray) -> str:
    arr = np.asarray(values, dtype=np.uint16)
    return base64.b64encode(arr.tobytes()).decode("ascii")


def _to_b64_float64(values: list[float] | np.ndarray) -> str:
    arr = np.asarray(values, dtype=np.float64)
    return base64.b64encode(arr.tobytes()).decode("ascii")


def encode_block(scan: Scan, global_rows: list[int], agg_value: np.ndarray) -> dict[str, Any]:
    """Encode one block as a JSON-serialisable dict matching ``encodeBlock``
    in ``scan-core.js`` (parentEncoding='global'). The browser-side loader
    decodes the same shape via ``loadBlock`` in ``scan-loader.js``."""
    gr = np.asarray(global_rows, dtype=np.int32)
    m = len(gr)
    labels = [scan.labels[i] for i in gr]
    values = [float(agg_value[i]) for i in gr]
    pg = scan.parent_indices[gr]

    attributes: dict[str, Any] = {}
    for name, attr in scan.attributes.items():
        kind = attr["kind"]
        col_vals = [attr["values"][i] for i in gr]
        if kind == "categorical":
            # Stable per-block dict: sorted, with None mapped to a sentinel.
            seen = {}
            for v in col_vals:
                key = "(blank)" if v is None else str(v)
                if key not in seen:
                    seen[key] = None
            names = sorted(seen.keys())
            name_to_idx = {n: i for i, n in enumerate(names)}
            u16 = [name_to_idx["(blank)" if v is None else str(v)] for v in col_vals]
            attributes[name] = {
                "kind": "categorical",
                "names": names,
                "b64": _to_b64_uint16(u16),
            }
        else:
            f64 = [float(v) if v is not None and not (isinstance(v, float) and np.isnan(v)) else float("nan") for v in col_vals]
            attributes[name] = {"kind": "numeric", "b64": _to_b64_float64(f64)}

    return {
        "labels": labels,
        "values": values,
        "pgB64": _to_b64_int32(pg),
        "grB64": _to_b64_int32(gr),
        "attributes": attributes,
        "stubFieldNames": [],
        "stubs": [],
    }


def build_envelope(scan: Scan, block_size: int = DEFAULT_BLOCK_SIZE) -> dict[str, Any]:
    """Top-level encoder: scan → envelope (the shape that goes inside the
    HTML's ``<script id="tmdata">``)."""
    blocks, agg_value, _ = partition_depth_band(scan, block_size=block_size)
    block_strings: list[str] = []
    for global_rows in blocks:
        block_obj = encode_block(scan, global_rows, agg_value)
        block_json = json.dumps(block_obj, separators=(",", ":"), ensure_ascii=False)
        # Raw deflate (wbits=-15), matching ``zlib.deflateRawSync`` on the
        # Node side. The browser-side loader uses DecompressionStream
        # ('deflate-raw'), which decodes the same byte stream.
        compressed = zlib.compress(block_json.encode("utf-8"), level=6)
        # ``zlib.compress`` produces zlib-wrapped output. To get raw
        # deflate we use a compressobj with negative wbits.
        co = zlib.compressobj(level=6, wbits=-15)
        raw = co.compress(block_json.encode("utf-8")) + co.flush()
        block_strings.append(base64.b64encode(raw).decode("ascii"))
        _ = compressed  # suppress "unused" — kept above as the API hint.
    return {"v": WIRE_VERSION, "blocks": block_strings}
