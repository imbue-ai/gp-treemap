// Data ingestion. Converts tabular (labels/parents/values) or accessor-based
// tree input into a flat Map<id, TreeNode> plus roots. Also handles:
//   - parent-value aggregation (aggregateFn)
//   - parent-color aggregation (colorAggregateFn)
//   - collapsing children that won't render into a synthetic `other` node
//
// Notes:
// - Tabular mode uses `ids` if supplied, else builds IDs from the ancestor
//   chain joined with \x00 so they are stable across runs.
// - Collapse is *approximate*: we check each node's share of its parent's
//   value against `minRelArea`. True pixel-level pruning happens inside the
//   layout pass; this step just preserves the spec's "synthetic `other`" rule.

export function buildFromTabular(data, opts = {}) {
  const { labels, parents, values, parentIndices } = data;
  const color = data.color;
  const ids = data.ids;
  const n = labels.length;
  if (!Array.isArray(labels) || values == null || typeof values.length !== 'number') {
    throw new Error('buildFromTabular: labels/values required');
  }

  // Fast path: parentIndices is an integer array (or TypedArray) where
  // parentIndices[i] is the row index of node i's parent (-1 for roots).
  // Parents always appear before children, enabling O(n) passes with no
  // string-ID synthesis — critical for large datasets (millions of rows).
  if (parentIndices != null && typeof parentIndices.length === 'number') {
    if (parentIndices.length !== n) throw new Error('buildFromTabular: parentIndices length mismatch');

    const nodes = new Map();
    // Use integer row index as ID. childIds allocated lazily only for parents
    // (leaves keep childIds:null), saving ~400 MB on 10M-file datasets.
    for (let i = 0; i < n; i++) {
      nodes.set(i, {
        id: i, label: labels[i], value: Number(values[i]) || 0,
        colorValue: color ? color[i] : values[i],
        depth: 0, parentId: parentIndices[i] >= 0 ? parentIndices[i] : null,
        childIds: null,
        isOther: false, isLocated: false, rect: null, colorIndex: 0, _hasExplicitValue: true,
      });
    }

    // Wire children — O(n), no hashing.
    for (let i = 0; i < n; i++) {
      const pi = parentIndices[i];
      if (pi < 0) continue;
      const parent = nodes.get(pi);
      if (parent.childIds === null) parent.childIds = [];
      parent.childIds.push(i);
    }

    // Depth: O(n) forward pass (parents guaranteed before children).
    for (let i = 0; i < n; i++) {
      const pi = parentIndices[i];
      if (pi >= 0) nodes.get(i).depth = nodes.get(pi).depth + 1;
    }

    // Value aggregation: O(n) reverse pass — each child adds to its parent.
    for (let i = n - 1; i >= 0; i--) {
      const pi = parentIndices[i];
      if (pi >= 0) nodes.get(pi).value += nodes.get(i).value;
    }

    const roots = [];
    for (let i = 0; i < n; i++) if (parentIndices[i] < 0) roots.push(i);
    return { nodes, roots };
  }

  // Legacy path: parents as string IDs or labels.
  if (!(Array.isArray(parents))) throw new Error('buildFromTabular: parents or parentIndices required');
  if (labels.length !== parents.length || labels.length !== values.length) {
    throw new Error('buildFromTabular: arrays must be same length');
  }

  const idOfRow = new Array(n);
  const byLabelForParent = new Map(); // parent_id → Map<label, rowIndex>
  for (let i = 0; i < n; i++) {
    const key = parents[i] || '';
    if (!byLabelForParent.has(key)) byLabelForParent.set(key, new Map());
    byLabelForParent.get(key).set(labels[i], i);
  }

  // Build id→row index once for O(1) parent lookups.
  const idToRow = ids ? new Map(ids.map((id, i) => [id, i])) : null;

  function resolveId(i, seen = new Set()) {
    if (idOfRow[i] !== undefined) return idOfRow[i];
    if (seen.has(i)) throw new Error('buildFromTabular: parent cycle at row ' + i);
    seen.add(i);
    if (ids && ids[i]) { idOfRow[i] = ids[i]; return ids[i]; }
    const parentKey = parents[i] || '';
    if (!parentKey) { idOfRow[i] = labels[i]; return idOfRow[i]; }
    if (ids) {
      const parentRow = idToRow.get(parentKey);
      if (parentRow == null) throw new Error('buildFromTabular: unknown parent id ' + parentKey);
      const pid = resolveId(parentRow, seen);
      idOfRow[i] = pid + '\x00' + labels[i];
      return idOfRow[i];
    } else {
      if (byLabelForParent.get('').has(parentKey)) {
        const parentRow = byLabelForParent.get('').get(parentKey);
        const pid = resolveId(parentRow, seen);
        idOfRow[i] = pid + '\x00' + labels[i];
        return idOfRow[i];
      }
      idOfRow[i] = parentKey + '\x00' + labels[i];
      return idOfRow[i];
    }
  }
  for (let i = 0; i < n; i++) resolveId(i);

  const nodes = new Map();
  for (let i = 0; i < n; i++) {
    const id = idOfRow[i];
    nodes.set(id, {
      id, label: labels[i], value: Number(values[i]) || 0,
      colorValue: color ? color[i] : values[i],
      depth: 0, parentId: null, childIds: [],
      isOther: false, isLocated: false, rect: null, colorIndex: 0, _hasExplicitValue: true,
    });
  }

  for (let i = 0; i < n; i++) {
    const id = idOfRow[i];
    const pkey = parents[i] || '';
    if (!pkey) continue;
    let parentId;
    if (ids) {
      const parentRow = idToRow.get(pkey);
      if (parentRow == null) throw new Error('buildFromTabular: unknown parent id ' + pkey);
      parentId = idOfRow[parentRow];
    } else if (byLabelForParent.get('').has(pkey)) {
      parentId = idOfRow[byLabelForParent.get('').get(pkey)];
    } else {
      parentId = pkey;
    }
    if (!nodes.has(parentId)) {
      throw new Error('buildFromTabular: orphan row ' + id + ' (parent ' + parentId + ' missing)');
    }
    const node = nodes.get(id);
    node.parentId = parentId;
    nodes.get(parentId).childIds.push(id);
  }

  return finalize(nodes, opts);
}

export function buildFromTree(root, accessors, opts = {}) {
  if (!accessors || typeof accessors.getId !== 'function') {
    throw new Error('buildFromTree: getId is required');
  }
  const { getChildren, getValue, getLabel, getColor, getId } = accessors;
  const nodes = new Map();
  function visit(item, parentId) {
    const id = getId(item);
    if (nodes.has(id)) throw new Error('buildFromTree: duplicate id ' + id);
    const v = Number(getValue(item)) || 0;
    nodes.set(id, {
      id,
      label: getLabel(item),
      value: v,
      colorValue: getColor ? getColor(item) : v,
      depth: 0,
      parentId,
      childIds: [],
      isOther: false,
      isLocated: false,
      rect: null,
      colorIndex: 0,
      _hasExplicitValue: true,
    });
    const children = (getChildren && getChildren(item)) || [];
    for (const c of children) {
      visit(c, id);
      nodes.get(id).childIds.push(getId(c));
    }
  }
  visit(root, null);
  return finalize(nodes, opts);
}

// Post-process: aggregate missing values up, compute depth, collapse small children.
function finalize(nodes, opts) {
  const {
    aggregateFn = (vals) => vals.reduce((a, b) => a + b, 0),
    colorAggregateFn = defaultColorAggregate,
    minRelArea = 0, // children whose (value/parent.value) < minRelArea fold into `other`
  } = opts;

  // Find root(s).
  const roots = [];
  for (const n of nodes.values()) if (n.parentId === null) roots.push(n.id);

  // Topologically compute values (post-order) — iterative to avoid stack overflow.
  const order = [];
  const stack = [...roots];
  const seen = new Set();
  while (stack.length) {
    const id = stack[stack.length - 1];
    if (!seen.has(id)) {
      seen.add(id);
      const children = nodes.get(id).childIds || [];
      for (const c of children) if (!seen.has(c)) stack.push(c);
    } else {
      stack.pop();
      order.push(id);
    }
  }

  // Compute depth top-down — iterative.
  const depthStack = roots.map((r) => [r, 0]);
  while (depthStack.length) {
    const [id, d] = depthStack.pop();
    nodes.get(id).depth = d;
    for (const c of nodes.get(id).childIds || []) depthStack.push([c, d + 1]);
  }

  // Aggregate parent value/color from children if leaf children exist.
  for (const id of order) {
    const n = nodes.get(id);
    if (n.childIds.length === 0) continue;
    const childValues = n.childIds.map((c) => nodes.get(c).value);
    // If parent had no explicit value, replace with aggregation.
    n.value = aggregateFn(childValues);
    if (!n._hasExplicitValue || n.colorValue === undefined || n.colorValue === null) {
      const cvs = n.childIds.map((c) => nodes.get(c).colorValue);
      n.colorValue = colorAggregateFn(cvs);
    }
  }

  // Collapse small siblings into synthetic `other` per parent.
  if (minRelArea > 0) {
    // Iteratively delete a subtree so we don't leave orphan descendants in
    // `nodes` when we collapse a small child.
    function deleteSubtree(nid) {
      const stk = [nid];
      while (stk.length) {
        const cur = stk.pop();
        const nn = nodes.get(cur);
        if (!nn) continue;
        for (const c of nn.childIds || []) stk.push(c);
        nodes.delete(cur);
      }
    }
    for (const id of Array.from(nodes.keys())) {
      const n = nodes.get(id);
      if (!n) continue; // may have been deleted by a prior collapse
      if (n.childIds.length < 2) continue;
      const small = [];
      const kept = [];
      for (const cid of n.childIds) {
        const c = nodes.get(cid);
        if (!c) continue; // ditto
        if (n.value > 0 && c.value / n.value < minRelArea) small.push(cid);
        else kept.push(cid);
      }
      if (small.length >= 2) {
        const otherId = id + '\x00__other__';
        const size = small.reduce((a, cid) => a + nodes.get(cid).value, 0);
        nodes.set(otherId, {
          id: otherId,
          label: 'other',
          value: size,
          colorValue: colorAggregateFn(small.map((cid) => nodes.get(cid).colorValue)),
          depth: n.depth + 1,
          parentId: id,
          childIds: [],
          isOther: true,
          isLocated: false,
          rect: null,
          colorIndex: 0,
          _hasExplicitValue: true,
        });
        for (const cid of small) deleteSubtree(cid);
        n.childIds = kept.concat([otherId]);
      }
    }
  }

  return { nodes, roots };
}

function defaultColorAggregate(vals) {
  if (!vals.length) return 0;
  if (typeof vals[0] === 'number') {
    let sum = 0, n = 0;
    for (const v of vals) if (Number.isFinite(v)) { sum += v; n++; }
    return n ? sum / n : 0;
  }
  return vals[0]; // first-child semantics for categorical values
}
