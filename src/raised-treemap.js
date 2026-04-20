// <raised-treemap> — a standards-compliant Custom Element rendering an
// interactive treemap with a "raised tile" look: bright upper-left, dark
// lower-right, with a crisp diagonal seam between the two halves of every
// cell.
//
// Rendering: a single <canvas> is painted pixel-by-pixel (see
// src/painter.js). Cells have no explicit stroke borders — the shading
// gradient alone defines the edge between neighbours. A parallel flat array
// of cell rects powers hit-testing, so hover/click still work without
// per-cell SVG nodes. The toolbar and tooltip are plain DOM.
//
// The spec describes a Stencil/Worker pipeline. This is a single-file
// ES-module realization; layout and painting run on the main thread, which
// is fine up to a few thousand visible cells — see Open Question #6 in
// spec.md and the README.

import { buildFromTabular, buildFromTree } from './builder.js';
import { balanceChildren } from './balancer.js';
import { layoutTree } from './layout.js';
import { resolveColors } from './color-resolver.js';
import { resolvePalette } from './palettes.js';
import { buildLUTs, buildLUTForCssColor } from './lut.js';
import { paintAll } from './painter.js';
import { applyFormat } from './format.js';

const DEFAULT_PROPS = {
  labels: null, parents: null, parentIndices: null, values: null, color: null, ids: null,
  root: null, getChildren: null, getValue: null, getLabel: null,
  getColor: null, getId: null,
  aggregateFn: null, colorAggregateFn: null,
  colorMode: 'categorical', colorScale: 'linear', colorDomain: null,
  colorMap: {}, colorFn: null,
  palette: 'gp-default', gradientIntensity: 0.5,
  visibleRootId: null, displayDepth: Infinity, locatedNodeIds: [],
  minCellArea: 16, showLabels: false, groupPadding: 0,
  valueFormat: null, valueFormatter: null,
  toolbar: true, zoomDuration: 350, tooltip: true, tooltipInToolbar: true,
  background: '#111',
};

const STYLE = `
:host { display:flex; flex-direction:column; position:relative; overflow:hidden;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; font-size:12px;
  color:#222; background:#f4f4f4;
  --gp-selected:#ffffff; --gp-located:#ff1fa3; }
.toolbar { display:flex; gap:8px; align-items:center; padding:6px 8px; border-bottom:1px solid #0001;
  background:#fafafa; user-select:none; flex-wrap:wrap; min-height:34px; }
.toolbar .sep { width:1px; height:20px; background:#0002; }
.toolbar button { padding:2px 8px; background:#fff; border:1px solid #0003; border-radius:4px; cursor:pointer; font:inherit; }
.toolbar button:hover { background:#eef; }
.toolbar button:disabled { opacity:0.35; cursor:default; }
.toolbar button:disabled:hover { background:#fff; }
.toolbar .info { flex:1; min-width:120px; font-variant-numeric: tabular-nums; color:#333; }
.toolbar .info b { color:#000; }
.toolbar .crumbs { display:flex; align-items:center; gap:2px; flex-wrap:wrap; }
.toolbar .crumbs a { cursor:pointer; color:#0645ad; text-decoration:none; }
.toolbar .crumbs a:hover { text-decoration:underline; }
.toolbar .crumbs span.sep-arrow { color:#999; padding:0 2px; }
.toolbar .depth { display:flex; gap:2px; align-items:center; }
.toolbar .legend { display:flex; gap:6px; align-items:center; flex-wrap:wrap; max-width:320px; }
.toolbar .legend i { width:12px; height:12px; border-radius:2px; display:inline-block; box-shadow:inset 0 0 0 1px #0002; }
.stage { position:relative; flex:1; overflow:hidden; background:#0b0b0b; cursor: default; outline: none; }
.stage canvas { position:absolute; inset:0; width:100%; height:100%; display:block; image-rendering: pixelated;
  transform-origin: 0 0; transition: transform var(--gp-zoom-ms, 350ms) ease; }
.overlay { position:absolute; inset:0; pointer-events:none; transform-origin:0 0; }
.overlay .sel, .overlay .loc { position:absolute; box-sizing:border-box; pointer-events:none; }
.overlay .sel { border:2px solid var(--gp-selected); box-sizing:border-box; }
.overlay .loc { border:2px solid var(--gp-located); box-shadow: 0 0 0 1px #fff8; }
.overlay .lbl { position:absolute; color:#111; font-size:11px; font-weight:500; line-height:1; padding:1px 3px;
  text-shadow: 0 0 2px #ffffffcc, 0 0 2px #ffffffcc; white-space:nowrap; pointer-events:none;
  transform: translate(-50%, -50%); }
.tooltip { position:fixed; pointer-events:none; background:#111d; color:#fff; padding:4px 8px;
  border-radius:4px; font-size:12px; line-height:1.3; z-index:1000; max-width:260px; box-shadow:0 2px 6px #0006; }
.tooltip b { display:block; font-size:11px; font-weight:600; margin-bottom:1px; }
`;

export class RaisedTreemap extends HTMLElement {
  static get observedAttributes() {
    return [
      'color-mode','color-scale','palette','gradient-intensity','visible-root-id',
      'display-depth','min-cell-area','show-labels','value-format','toolbar',
      'zoom-duration','tooltip','background','group-padding',
    ];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);

    this._toolbar = document.createElement('div');
    this._toolbar.className = 'toolbar';
    root.appendChild(this._toolbar);

    this._stage = document.createElement('div');
    this._stage.className = 'stage';
    this._stage.tabIndex = 0;
    root.appendChild(this._stage);

    this._canvas = document.createElement('canvas');
    this._stage.appendChild(this._canvas);

    this._overlay = document.createElement('div');
    this._overlay.className = 'overlay';
    this._stage.appendChild(this._overlay);

    this._tooltip = document.createElement('div');
    this._tooltip.className = 'tooltip';
    this._tooltip.hidden = true;
    root.appendChild(this._tooltip);

    this._props = { ...DEFAULT_PROPS };
    this._tree = null;
    this._leaves = [];                     // flat leaves with rect + lutIndex
    this._leafById = new Map();
    this._selectedId = null;
    this._hoverId = null;
    this._internalVisibleRootId = null;
    this._wheelAcc = 0;
    this._selectionLocked = false;
    this._hoverRaf = 0;
    this._leafSelectedId = null;  // original clicked leaf; used by focus-down navigation
    this._focusValEl = null;
    this._zoomInBtn = null;       // reference to the magnifying-glass button
    this._stretchZoomId = null;   // node zoomed into with preserved aspect
    this._stretchZoomAspect = 0;  // original w/h ratio of zoomed node's rect
    this._zoomAnimating = false;  // true during zoom animation

    this._onResize = this._onResize.bind(this);
    this._onStageMouse = this._onStageMouse.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onDblClick = this._onDblClick.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    this._resizeObserver = new ResizeObserver(this._onResize);
    this._stage.addEventListener('mousemove', this._onStageMouse);
    this._stage.addEventListener('mouseleave', () => { this._hideTooltip(); this._setHover(null); });
    this._stage.addEventListener('click', this._onClick);
    this._stage.addEventListener('dblclick', this._onDblClick);
    this._stage.addEventListener('wheel', this._onWheel, { passive: true });
    this._stage.addEventListener('keydown', this._onKeyDown);
  }

  connectedCallback() { this._resizeObserver.observe(this._stage); requestAnimationFrame(() => this._queueRender()); }
  disconnectedCallback() { this._resizeObserver.disconnect(); }

  attributeChangedCallback(name, _old, val) {
    switch (name) {
      case 'color-mode': this._props.colorMode = val || 'categorical'; break;
      case 'color-scale': this._props.colorScale = val || 'linear'; break;
      case 'palette': this._props.palette = val || 'gp-default'; break;
      case 'gradient-intensity': this._props.gradientIntensity = Number(val); break;
      case 'visible-root-id': this._props.visibleRootId = val || null; break;
      case 'display-depth': this._props.displayDepth = val == null ? Infinity : Number(val); break;
      case 'min-cell-area': this._props.minCellArea = Number(val); break;
      case 'show-labels': this._props.showLabels = val != null && val !== 'false'; break;
      case 'value-format': this._props.valueFormat = val; break;
      case 'toolbar': this._props.toolbar = val === 'false' ? false : (val || true); break;
      case 'zoom-duration': this._props.zoomDuration = Number(val); break;
      case 'tooltip': this._props.tooltip = val !== 'false'; break;
      case 'background': this._props.background = val || '#111'; break;
      case 'group-padding': this._props.groupPadding = Number(val) || 0; break;
    }
    this._queueRender();
  }

  // ----- public methods -----
  locateNode(id) {
    const ids = new Set(this._props.locatedNodeIds || []);
    ids.add(id);
    this._props.locatedNodeIds = Array.from(ids);
    this._queueRender();
  }
  findRenderedAncestor(id) {
    if (!this._tree) return null;
    let cur = this._tree.nodes.get(id);
    while (cur) {
      if (this._leafById.has(cur.id)) return cur;
      cur = cur.parentId !== null ? this._tree.nodes.get(cur.parentId) : null;
    }
    return null;
  }
  zoomTo(id) { if (id == null || (this._tree && this._tree.nodes.has(id))) this._setVisibleRoot(id); }
  zoomReset() { if (this._stretchZoomId) { this.stretchZoomReset(); return; } this._setVisibleRoot(null); }
  zoomOut() {
    if (this._stretchZoomId) { this.stretchZoomReset(); return; }
    const vr = this._activeVisibleRootId();
    if (vr == null || !this._tree) return;
    const n = this._tree.nodes.get(vr);
    this._setVisibleRoot(n && n.parentId !== null ? n.parentId : null);
  }

  stretchZoomIn(id) {
    if (!id || !this._tree || !this._nodeRects || this._zoomAnimating) return;
    const nodeRect = this._nodeRects.get(id);
    if (!nodeRect || nodeRect.w <= 0 || nodeRect.h <= 0) return;

    this._stretchZoomId = id;
    this._stretchZoomAspect = nodeRect.w / nodeRect.h;
    this._zoomAnimating = true;

    // Animate: CSS-transform the current canvas to expand the node rect to fill the stage
    const dpr = this._canvas.width / this._stage.clientWidth;
    const stageW = this._stage.clientWidth;
    const stageH = this._stage.clientHeight;
    const sx = stageW / (nodeRect.w / dpr);
    const sy = stageH / (nodeRect.h / dpr);
    const tx = -(nodeRect.x / dpr) * sx;
    const ty = -(nodeRect.y / dpr) * sy;
    this._canvas.style.transform = `matrix(${sx}, 0, 0, ${sy}, ${tx}, ${ty})`;
    // Also scale the overlay to match
    this._overlay.style.transform = `matrix(${sx}, 0, 0, ${sy}, ${tx}, ${ty})`;
    this._overlay.style.transformOrigin = '0 0';

    setTimeout(() => {
      this._canvas.style.transition = 'none';
      this._overlay.style.transition = 'none';
      this._rebuildAndRender();  // renders zoomed content at full resolution
      this._canvas.style.transform = '';
      this._overlay.style.transform = '';
      this._overlay.style.transformOrigin = '';
      this._canvas.offsetHeight; // force reflow
      this._canvas.style.transition = '';
      this._overlay.style.transition = '';
      this._zoomAnimating = false;
    }, this._props.zoomDuration);

    this._dispatch('gp-zoom-change', id);
    this._renderToolbar();
  }

  stretchZoomReset() {
    if (!this._stretchZoomId || this._zoomAnimating) return;
    const oldId = this._stretchZoomId;
    this._stretchZoomId = null;
    this._stretchZoomAspect = 0;
    this._zoomAnimating = true;

    // Re-render the unzoomed layout (synchronous)
    this._canvas.style.transition = 'none';
    this._overlay.style.transition = 'none';
    this._rebuildAndRender();

    // Find where the previously-zoomed node sits in the new layout
    const nodeRect = this._nodeRects && this._nodeRects.get(oldId);
    if (nodeRect && nodeRect.w > 0 && nodeRect.h > 0) {
      const dpr = this._canvas.width / this._stage.clientWidth;
      const stageW = this._stage.clientWidth;
      const stageH = this._stage.clientHeight;
      const sx = stageW / (nodeRect.w / dpr);
      const sy = stageH / (nodeRect.h / dpr);
      const tx = -(nodeRect.x / dpr) * sx;
      const ty = -(nodeRect.y / dpr) * sy;
      // Start zoomed-in, animate to identity
      this._canvas.style.transform = `matrix(${sx}, 0, 0, ${sy}, ${tx}, ${ty})`;
      this._overlay.style.transform = `matrix(${sx}, 0, 0, ${sy}, ${tx}, ${ty})`;
      this._overlay.style.transformOrigin = '0 0';
      this._canvas.offsetHeight; // force reflow
      this._canvas.style.transition = '';
      this._overlay.style.transition = `transform ${this._props.zoomDuration}ms ease`;
      this._canvas.style.transform = '';
      this._overlay.style.transform = '';
    } else {
      this._canvas.style.transition = '';
      this._overlay.style.transition = '';
    }

    setTimeout(() => {
      this._overlay.style.transformOrigin = '';
      this._overlay.style.transition = '';
      this._zoomAnimating = false;
    }, this._props.zoomDuration);

    this._dispatch('gp-zoom-change', null);
    this._renderToolbar();
  }

  // ----- render pipeline -----
  _queueRender() {
    if (this._pending) return;
    this._pending = true;
    queueMicrotask(() => { this._pending = false; this._rebuildAndRender(); });
  }

  _rebuildAndRender() {
    if (!this.isConnected) return;
    try { this._tree = this._buildTree(); }
    catch (e) { this._tree = null; this._showErrorToolbar(e.message); return; }
    if (!this._tree) { this._clearCanvas(); this._renderToolbar(); return; }
    this._renderToolbar();
    this._paint();
  }

  _buildTree() {
    const p = this._props;
    const minRelArea = p.minCellArea > 0 ? Math.max(0, p.minCellArea / 100000) : 0;
    if (p.root && p.getChildren && p.getValue && p.getLabel && p.getId) {
      return buildFromTree(p.root, {
        getChildren: p.getChildren, getValue: p.getValue, getLabel: p.getLabel,
        getColor: p.getColor, getId: p.getId,
      }, {
        aggregateFn: p.aggregateFn || undefined,
        colorAggregateFn: p.colorAggregateFn || undefined,
        minRelArea,
      });
    }
    if (p.labels && (p.parents || p.parentIndices) && p.values) {
      return buildFromTabular(
        { labels: p.labels, parents: p.parents, parentIndices: p.parentIndices, values: p.values, color: p.color, ids: p.ids },
        {
          aggregateFn: p.aggregateFn || undefined,
          colorAggregateFn: p.colorAggregateFn || undefined,
          minRelArea,
        },
      );
    }
    return null;
  }

  _activeVisibleRootId() {
    if (this._stretchZoomId) return this._stretchZoomId;
    return this._props.visibleRootId != null ? this._props.visibleRootId : this._internalVisibleRootId;
  }
  _resolvedPalette() { return resolvePalette(this._props.palette); }

  _paint() {
    const p = this._props;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = this._stage.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    if (this._canvas.width !== w) this._canvas.width = w;
    if (this._canvas.height !== h) this._canvas.height = h;
    this._canvas.style.width = cssW + 'px';
    this._canvas.style.height = cssH + 'px';
    this._canvas.style.setProperty('--gp-zoom-ms', `${p.zoomDuration}ms`);

    const activeRoot = this._activeVisibleRootId();
    const nodes = this._tree.nodes;
    const rootId = activeRoot != null && nodes.has(activeRoot) ? activeRoot : this._tree.roots[0];
    if (rootId == null) { this._clearCanvas(); return; }
    const rootNode = nodes.get(rootId);
    const baseDepth = rootNode.depth;
    const cap = baseDepth + (p.displayDepth === Infinity ? 99 : Math.max(0, p.displayDepth));

    // Hierarchical layout: at each non-leaf node we balance its direct
    // children into a binary tree and lay that out inside the node's rect.
    // This keeps siblings grouped, so the parent-structure is visible in the
    // layout the way GrandPerspective's is (no need for explicit borders).
    // `groupPadding` (css pixels, inset per parent level) lets the user make
    // the grouping more obvious; default 0 matches GP's flush-tile look.
    const leavesCollect = [];
    const inSubtree = new Set();
    const leafCap = new Set(); // ids that are rendered as leaves (at cap or true leaves)
    const pad = Math.max(0, (p.groupPadding || 0) * dpr);
    const nodeRects = new Map(); // rect for every node in the subtree — used for selection highlight

    const layoutSubtree = (nodeId, rect) => {
      inSubtree.add(nodeId);
      nodeRects.set(nodeId, rect);
      const node = nodes.get(nodeId);
      const atCap = node.depth >= cap;
      if (atCap || !node.childIds || node.childIds.length === 0) {
        leafCap.add(nodeId);
        leavesCollect.push({ node, rect });
        return;
      }
      const kids = node.childIds.map((cid) => nodes.get(cid));
      const balRoot = balanceChildren(kids.map((k) => ({ id: k.id, size: Math.max(0, k.value) })));
      const childRects = new Map();
      if (balRoot) {
        layoutTree(balRoot, rect, (id, r) => childRects.set(id, r));
      }
      for (const kid of kids) {
        const r = childRects.get(kid.id);
        if (!r) continue;
        // Inset this group's rect so sibling groups get a visible gutter.
        // Only apply padding to non-leaf groups (a leaf's rect is its own).
        let sub = r;
        if (pad > 0 && kid.childIds && kid.childIds.length > 0) {
          const px = Math.min(pad, r.w / 2 - 1);
          const py = Math.min(pad, r.h / 2 - 1);
          if (px > 0 && py > 0) {
            sub = { x: r.x + px, y: r.y + py, w: r.w - 2 * px, h: r.h - 2 * py };
          }
        }
        layoutSubtree(kid.id, sub);
      }
    };
    // If stretch-zoomed, layout at the original aspect ratio then scale to fill the canvas.
    // This preserves the tile structure (split directions) from the original view.
    let layoutW = w, layoutH = h;
    if (this._stretchZoomId && this._stretchZoomAspect > 0) {
      layoutH = h;
      layoutW = Math.round(h * this._stretchZoomAspect);
    }
    layoutSubtree(rootId, { x: 0, y: 0, w: layoutW, h: layoutH });

    // Stretch-scale all rects to fill the actual canvas
    if (layoutW !== w || layoutH !== h) {
      const sx = w / layoutW, sy = h / layoutH;
      for (const r of nodeRects.values()) { r.x *= sx; r.w *= sx; r.y *= sy; r.h *= sy; }
    }
    this._nodeRects = nodeRects;

    const palette = this._resolvedPalette();
    const subtree = Array.from(inSubtree).map((id) => nodes.get(id));
    resolveColors(subtree, p.colorMode, {
      palette,
      colorScale: p.colorScale,
      colorDomain: p.colorDomain,
      colorMap: p.colorMap || {},
      colorFn: p.colorFn,
    });

    // Build the flat `assigned` map that the rest of the pipeline expects.
    const leaves = leavesCollect.map((x) => x.node);
    const assigned = new Map();
    for (const { node, rect } of leavesCollect) assigned.set(node.id, rect);

    // Build LUTs (one per palette color; extras appended for each unique colorOverride).
    const luts = buildLUTs(palette, p.gradientIntensity);
    const overrideIndex = new Map();
    const renderLeaves = [];
    this._leafById = new Map();
    for (const n of leaves) {
      if (!assigned.has(n.id)) continue;
      const r = assigned.get(n.id);
      let lutIndex;
      if (n.colorOverride) {
        let idx = overrideIndex.get(n.colorOverride);
        if (idx === undefined) {
          idx = luts.length;
          luts.push(buildLUTForCssColor(n.colorOverride, p.gradientIntensity));
          overrideIndex.set(n.colorOverride, idx);
        }
        lutIndex = idx;
      } else {
        lutIndex = n.colorIndex;
      }
      const leaf = {
        id: n.id, label: n.label, value: n.value, depth: n.depth,
        parentId: n.parentId, isOther: n.isOther,
        x: r.x, y: r.y, w: r.w, h: r.h, lutIndex,
      };
      renderLeaves.push(leaf);
      this._leafById.set(n.id, leaf);
    }
    this._leaves = renderLeaves;

    // Paint into the canvas in one ImageData allocation.
    const ctx = this._canvas.getContext('2d', { alpha: false });
    const image = ctx.createImageData(w, h);
    paintAll(image, renderLeaves, luts, parseBgColor(p.background));
    ctx.putImageData(image, 0, 0);

    this._renderOverlay(cssW, cssH, dpr);
    this._updateToolbarInfo();
  }

  _renderOverlay(cssW, cssH, dpr) {
    const p = this._props;
    this._overlay.innerHTML = '';
    const located = new Set(p.locatedNodeIds || []);
    for (const l of this._leaves) {
      if (located.has(l.id)) {
        this._overlay.appendChild(overlayBox('loc', l, dpr));
      }
    }
    if (this._selectedId) {
      const bounds = this._selectionBounds(this._selectedId);
      if (bounds) this._overlay.appendChild(overlayBox('sel', bounds, dpr));
    }
    this._updateFocusUI();
    if (this._zoomInBtn) {
      this._zoomInBtn.disabled = !this._selectedId || !this._nodeRects || !this._nodeRects.has(this._selectedId);
    }
    if (p.showLabels) {
      for (const l of this._leaves) {
        if (l.w < 48 * dpr || l.h < 16 * dpr) continue;
        const el = document.createElement('div');
        el.className = 'lbl';
        el.style.left = (l.x + l.w / 2) / dpr + 'px';
        el.style.top = (l.y + l.h / 2) / dpr + 'px';
        el.textContent = l.label;
        this._overlay.appendChild(el);
      }
    }
  }

  _clearCanvas() {
    const ctx = this._canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = this._props.background;
    ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
    this._overlay.innerHTML = '';
    this._leaves = [];
    this._leafById = new Map();
  }

  // ----- toolbar -----
  _renderToolbar() {
    const p = this._props;
    const cfg = p.toolbar === false ? false : (typeof p.toolbar === 'object' ? p.toolbar : {});
    this._toolbar.innerHTML = '';
    if (!cfg) { this._toolbar.style.display = 'none'; return; }
    this._toolbar.style.display = '';
    const want = {
      zoom: cfg.zoom !== false,
      breadcrumb: cfg.breadcrumb !== false,
      info: cfg.info !== false,
      depth: cfg.depth !== false,
      focus: cfg.focus !== false,
      legend: cfg.legend !== false,
    };

    if (want.zoom) {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex'; wrap.style.gap = '2px';
      const bZoom = document.createElement('button');
      bZoom.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:-2px"><circle cx="6.5" cy="6.5" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="10" x2="14.5" y2="14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="4.5" y1="6.5" x2="8.5" y2="6.5" stroke="currentColor" stroke-width="1.2"/><line x1="6.5" y1="4.5" x2="6.5" y2="8.5" stroke="currentColor" stroke-width="1.2"/></svg>';
      bZoom.title = 'Zoom into selected node';
      bZoom.disabled = !this._selectedId || !this._nodeRects || !this._nodeRects.has(this._selectedId);
      bZoom.addEventListener('click', () => { if (this._selectedId) this.stretchZoomIn(this._selectedId); });
      this._zoomInBtn = bZoom;
      const b1 = document.createElement('button'); b1.textContent = 'zoom out'; b1.title = 'Zoom to parent';
      b1.addEventListener('click', () => this.zoomOut());
      const b2 = document.createElement('button'); b2.textContent = 'reset'; b2.title = 'Reset zoom';
      b2.addEventListener('click', () => { this._stretchZoomId = null; this._stretchZoomAspect = 0; this._internalVisibleRootId = null; this._queueRender(); this._dispatch('gp-zoom-change', null); });
      wrap.appendChild(bZoom); wrap.appendChild(b1); wrap.appendChild(b2);
      this._toolbar.appendChild(wrap);
      this._toolbar.appendChild(sep());
    }
    if (want.breadcrumb && this._tree) {
      const active = this._activeVisibleRootId();
      const rootId = this._tree.roots[0];
      const chain = [];
      let cur = active ? this._tree.nodes.get(active) : this._tree.nodes.get(rootId);
      while (cur) { chain.unshift(cur); cur = cur.parentId !== null ? this._tree.nodes.get(cur.parentId) : null; }
      // Drop the root node — its label is already in the page header.
      const crumbChain = chain.filter(n => n.parentId !== null);
      if (crumbChain.length > 0) {
        const crumbs = document.createElement('div');
        crumbs.className = 'crumbs';
        crumbChain.forEach((n, i) => {
          if (i > 0) {
            const s = document.createElement('span'); s.className = 'sep-arrow'; s.textContent = '›';
            crumbs.appendChild(s);
          }
          const isLast = i === crumbChain.length - 1;
          if (isLast) {
            const span = document.createElement('span');
            span.textContent = n.label;
            span.style.fontWeight = '600';
            span.style.color = '#222';
            crumbs.appendChild(span);
          } else {
            const a = document.createElement('a');
            a.textContent = n.label; a.dataset.id = n.id;
            a.addEventListener('click', (e) => { e.preventDefault(); this._setVisibleRoot(n.id); });
            crumbs.appendChild(a);
          }
        });
        this._toolbar.appendChild(crumbs);
        this._toolbar.appendChild(sep());
      }
    }
    if (want.info) {
      const info = document.createElement('div'); info.className = 'info';
      info.innerHTML = '<span>(hover a cell)</span>';
      this._toolbar.appendChild(info);
      this._infoEl = info;
      this._toolbar.appendChild(sep());
    }
    if (want.depth) {
      const d = document.createElement('div'); d.className = 'depth';
      d.append(document.createTextNode('depth '));
      const m = document.createElement('button'); m.textContent = '−';
      const maxD = this._treeMaxDepth();
      const val = document.createElement('span');
      val.textContent = this._props.displayDepth === Infinity ? '∞' : String(this._props.displayDepth);
      val.style.padding = '0 6px';
      const pl = document.createElement('button'); pl.textContent = '+';
      m.addEventListener('click', () => {
        const max = this._treeMaxDepth();
        const cur = this._props.displayDepth === Infinity ? max : this._props.displayDepth;
        this._props.displayDepth = Math.max(1, cur - 1); this._queueRender();
      });
      pl.addEventListener('click', () => {
        const max = this._treeMaxDepth();
        const cur = this._props.displayDepth === Infinity ? max : this._props.displayDepth;
        const next = cur + 1;
        this._props.displayDepth = next > max ? Infinity : next; this._queueRender();
      });
      d.appendChild(m); d.appendChild(val); d.appendChild(pl);
      this._toolbar.appendChild(d);
      this._toolbar.appendChild(sep());
    }
    if (want.focus) {
      const f = document.createElement('div'); f.className = 'depth';
      f.append(document.createTextNode('focus '));
      const fm = document.createElement('button'); fm.textContent = '−'; fm.title = 'Select parent (broader view)';
      fm.addEventListener('click', () => this._selAncestorUp());
      const fval = document.createElement('span'); fval.style.padding = '0 6px';
      const fpl = document.createElement('button'); fpl.textContent = '+'; fpl.title = 'Select child (narrower view)';
      fpl.addEventListener('click', () => this._selAncestorDown());
      f.appendChild(fm); f.appendChild(fval); f.appendChild(fpl);
      this._toolbar.appendChild(f);
      this._toolbar.appendChild(sep());
      this._focusValEl = fval;
      this._updateFocusUI();
    }
    if (want.legend) {
      const lg = document.createElement('div'); lg.className = 'legend';
      const palette = this._resolvedPalette();
      const maxRows = (typeof cfg.legend === 'object' && cfg.legend.maxRows) || 8;
      palette.slice(0, maxRows).forEach((c) => {
        const i = document.createElement('i'); i.style.background = c;
        lg.appendChild(i);
      });
      this._toolbar.appendChild(lg);
    }
  }

  _showErrorToolbar(msg) {
    this._toolbar.innerHTML = '';
    const s = document.createElement('span');
    s.textContent = 'raised-treemap: ' + msg;
    s.style.color = '#b00';
    this._toolbar.appendChild(s);
    this._clearCanvas();
  }
  _updateToolbarInfo() {
    if (!this._infoEl) return;
    const id = this._hoverId || this._selectedId;
    if (id == null || !this._tree) { this._infoEl.innerHTML = '<span>(hover a cell)</span>'; return; }
    const n = this._tree.nodes.get(id);
    if (!n) return;
    this._infoEl.innerHTML = `<b>${escapeHtml(this._buildPath(id))}</b> · ${escapeHtml(this._formatValue(n.value))}`;
  }
  _formatValue(v) {
    if (typeof this._props.valueFormatter === 'function') return this._props.valueFormatter(v);
    if (this._props.valueFormat) return applyFormat(v, this._props.valueFormat);
    return v.toLocaleString();
  }

  // ----- hit testing / interactions -----
  _hitTest(e) {
    const rect = this._stage.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const dpr = this._canvas.width / rect.width;
    const px = cssX * dpr;
    const py = cssY * dpr;
    // linear scan; cells are not overlapping so first hit wins
    for (const l of this._leaves) {
      if (px >= l.x && px < l.x + l.w && py >= l.y && py < l.y + l.h) return l.id;
    }
    return null;
  }

  _onStageMouse(e) {
    if (this._hoverRaf) return;
    this._hoverRaf = requestAnimationFrame(() => {
      this._hoverRaf = 0;
      const id = this._hitTest(e);
      this._setHover(id);
      if (this._props.tooltip && id) this._showTooltip(e, id); else this._hideTooltip();
      if (id) {
        this._dispatch('gp-hover', id);
        this._dispatch('gp-mouseover', id);
      }
    });
  }
  _setHover(id) {
    if (this._hoverId === id) return;
    this._hoverId = id;
    this._updateToolbarInfo();
  }
  _onClick(e) {
    const id = this._hitTest(e);
    if (id == null) return;
    this._selectedId = id;
    this._leafSelectedId = id;
    this._selectionLocked = true;
    this._stage.focus();
    this._renderOverlay(this._stage.clientWidth, this._stage.clientHeight, this._canvas.width / this._stage.clientWidth);
    this._dispatch('gp-click', id);
    this._dispatch('gp-select', id);
  }
  _onDblClick(e) {
    const id = this._hitTest(e);
    if (id == null) return;
    this._dispatch('gp-dblclick', id);
    this._setVisibleRoot(id);
  }
  _onWheel(e) {
    if (this._selectedId == null || !this._tree) return;
    this._wheelAcc += e.deltaY;
    if (Math.abs(this._wheelAcc) < 80) return;
    const dir = this._wheelAcc > 0 ? 1 : -1;
    this._wheelAcc = 0;
    const n = this._tree.nodes.get(this._selectedId);
    if (!n) return;
    let next = null;
    if (dir < 0) next = n.parentId;
    else if (n.childIds && n.childIds.length) next = n.childIds[0];
    if (next != null) { this._selectedId = next; this._renderOverlay(this._stage.clientWidth, this._stage.clientHeight, this._canvas.width / this._stage.clientWidth); this._dispatch('gp-select', next); }
  }
  _onKeyDown(e) {
    if (e.key === '+' || e.key === '=') { if (this._selectedId != null) this._setVisibleRoot(this._selectedId); return; }
    if (e.key === '-') { this.zoomOut(); return; }
    if (e.key === '0') { this.zoomReset(); return; }
    if (!this._selectionLocked || !this._tree || this._selectedId == null) return;
    const n = this._tree.nodes.get(this._selectedId);
    if (!n) return;
    const parent = n.parentId !== null ? this._tree.nodes.get(n.parentId) : null;
    let next = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (parent) { const i = parent.childIds.indexOf(n.id); next = parent.childIds[Math.max(0, i - 1)]; }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (parent) { const i = parent.childIds.indexOf(n.id); next = parent.childIds[Math.min(parent.childIds.length - 1, i + 1)]; }
    } else if (e.key === 'Enter') {
      if (n.childIds && n.childIds.length) next = n.childIds[0];
    } else if (e.key === 'Escape') {
      this._selAncestorUp(); return;
    } else { return; }
    if (next != null) {
      this._selectedId = next;
      this._renderOverlay(this._stage.clientWidth, this._stage.clientHeight, this._canvas.width / this._stage.clientWidth);
      this._dispatch('gp-select', next);
    }
  }
  _showTooltip(e, id) {
    if (!this._tree) return;
    const n = this._tree.nodes.get(id);
    if (!n) return;
    this._tooltip.hidden = false;
    this._tooltip.innerHTML = `<b>${escapeHtml(this._buildPath(id))}</b><br>${escapeHtml(this._formatValue(n.value))}${n.isOther ? ' (collapsed)' : ''}`;
    const x = e.clientX + 12, y = e.clientY + 12;
    this._tooltip.style.left = x + 'px';
    this._tooltip.style.top = y + 'px';
  }
  _hideTooltip() { this._tooltip.hidden = true; }

  _setVisibleRoot(id) {
    if (this._props.visibleRootId != null) {
      this._dispatch('gp-zoom-change', id, { intendedRoot: true });
      return;
    }
    this._internalVisibleRootId = id;
    this._dispatch('gp-zoom-change', id);
    this._queueRender();
  }

  _dispatch(name, nodeId, extra = {}) {
    if (!this._tree) return;
    if (nodeId && !this._tree.nodes.has(nodeId)) {
      if (name !== 'gp-zoom-change') return;
    }
    const node = nodeId ? this._tree.nodes.get(nodeId) : null;
    const ancestorIds = [];
    if (node) { let cur = node; while (cur && cur.parentId) { ancestorIds.push(cur.parentId); cur = this._tree.nodes.get(cur.parentId); } }
    const located = new Set(this._props.locatedNodeIds || []);
    const detail = {
      nodeId: nodeId || null,
      label: node ? node.label : null,
      value: node ? node.value : null,
      colorValue: node ? node.colorValue : null,
      depth: node ? node.depth : null,
      ancestorIds,
      isLocated: nodeId ? located.has(nodeId) : false,
      ...extra,
    };
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  // ----- path / focus helpers -----
  _buildPath(nodeId) {
    if (!this._tree) return '';
    const chain = [];
    let cur = this._tree.nodes.get(nodeId);
    while (cur) {
      if (cur.parentId !== null) chain.unshift(cur.label); // skip root (shown in header)
      cur = cur.parentId !== null ? this._tree.nodes.get(cur.parentId) : null;
    }
    return chain.join('/');
  }

  _selectionBounds(nodeId) {
    // The rect for any node is captured during the layout pass — a parent's rect is
    // exactly the union of its children's rects because the tiling is perfect.
    return (this._nodeRects && this._nodeRects.get(nodeId)) || null;
  }

  _treeMaxDepth() {
    if (!this._tree) return 10;
    let max = 0;
    for (const n of this._tree.nodes.values()) if (n.depth > max) max = n.depth;
    return max;
  }

  _selAncestorUp() {
    if (this._selectedId == null || !this._tree) return;
    const n = this._tree.nodes.get(this._selectedId);
    if (!n || n.parentId === null) return;
    this._selectedId = n.parentId;
    const dpr = this._canvas.width / this._stage.clientWidth;
    this._renderOverlay(this._stage.clientWidth, this._stage.clientHeight, dpr);
    this._updateToolbarInfo();
    this._dispatch('gp-select', this._selectedId);
  }

  _selAncestorDown() {
    if (this._selectedId == null || this._leafSelectedId == null || !this._tree) return;
    if (this._selectedId === this._leafSelectedId) return;
    // Walk up from _leafSelectedId to find the direct child of _selectedId on that path.
    let cur = this._tree.nodes.get(this._leafSelectedId);
    let found = null;
    while (cur) {
      if (cur.parentId === null) break;
      if (cur.parentId === this._selectedId) { found = cur; break; }
      cur = this._tree.nodes.get(cur.parentId);
    }
    if (!found) return;
    this._selectedId = found.id;
    const dpr = this._canvas.width / this._stage.clientWidth;
    this._renderOverlay(this._stage.clientWidth, this._stage.clientHeight, dpr);
    this._updateToolbarInfo();
    this._dispatch('gp-select', this._selectedId);
  }

  _updateFocusUI() {
    if (!this._focusValEl) return;
    if (this._selectedId == null || !this._tree) { this._focusValEl.textContent = '∞'; return; }
    const n = this._tree.nodes.get(this._selectedId);
    this._focusValEl.textContent = n ? String(n.depth) : '∞';
  }

  _onResize() {
    // Immediate CSS scale, then debounce repaint.
    const rect = this._stage.getBoundingClientRect();
    if (this._lastCssSize && this._lastCssSize.w && this._lastCssSize.h) {
      const sx = rect.width / this._lastCssSize.w;
      const sy = rect.height / this._lastCssSize.h;
      if (sx !== 1 || sy !== 1) this._canvas.style.transform = `scale(${sx}, ${sy})`;
    }
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      this._canvas.style.transform = '';
      this._lastCssSize = { w: rect.width, h: rect.height };
      this._rebuildAndRender();
    }, 150);
  }
}

// ---- helpers ----
function sep() { const s = document.createElement('div'); s.className = 'sep'; return s; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function overlayBox(cls, leaf, dpr) {
  const el = document.createElement('div');
  el.className = cls;
  const cssW = leaf.w / dpr, cssH = leaf.h / dpr;
  el.style.left = leaf.x / dpr + 'px';
  el.style.top = leaf.y / dpr + 'px';
  el.style.width = cssW + 'px';
  el.style.height = cssH + 'px';
  if (cls === 'sel') {
    const t = Math.max(2, Math.round(Math.max(cssW, cssH) * 0.01));
    el.style.borderWidth = t + 'px';
  }
  return el;
}
function parseBgColor(css) {
  if (typeof css !== 'string') return { r: 20, g: 20, b: 20 };
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  const m2 = /^#([0-9a-f]{3})$/i.exec(css.trim());
  if (m2) return { r: parseInt(m2[1][0] + m2[1][0], 16), g: parseInt(m2[1][1] + m2[1][1], 16), b: parseInt(m2[1][2] + m2[1][2], 16) };
  return { r: 16, g: 16, b: 16 };
}

for (const p of Object.keys(DEFAULT_PROPS)) {
  Object.defineProperty(RaisedTreemap.prototype, p, {
    configurable: true,
    get() { return this._props[p]; },
    set(v) { this._props[p] = v; this._queueRender(); },
  });
}

if (!customElements.get('raised-treemap')) customElements.define('raised-treemap', RaisedTreemap);
