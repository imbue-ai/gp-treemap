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
import { resolvePalette, THEMES } from './palettes.js';
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
  palette: 'tokyo-night', gradientIntensity: 0.5,
  visibleRootId: null, displayDepth: Infinity, locatedNodeIds: [],
  minCellArea: 16, showLabels: false, groupPadding: 0,
  valueFormat: null, valueFormatter: null,
  toolbar: true, zoomDuration: 350, tooltip: true, tooltipInToolbar: true,
  background: '#111',
};

const STYLE = `
:host { display:flex; flex-direction:column; position:relative; overflow:hidden;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; font-size:12px;
  color: var(--rt-fg, #222); background: var(--rt-bg, #f4f4f4);
  --rt-selected:#ffffff; --rt-located:#ff1fa3; }
.toolbar { display:flex; gap:8px; align-items:center; padding:6px 8px;
  border-bottom:1px solid var(--rt-border, #0001);
  background: var(--rt-surface, #fafafa); user-select:none; flex-wrap:wrap; min-height:34px; }
.toolbar .sep { width:1px; height:20px; background: var(--rt-border, #0002); }
.toolbar button { padding:2px 8px; background: var(--rt-bg, #fff);
  border:1px solid var(--rt-border, #0003); border-radius:4px; cursor:pointer;
  font:inherit; color: var(--rt-fg, inherit); }
.toolbar button:hover { background: var(--rt-surface, #eef); }
.toolbar button:disabled { opacity:0.35; cursor:default; }
.toolbar button:disabled:hover { background: var(--rt-bg, #fff); }
.info-line { padding:3px 8px; border-bottom:1px solid var(--rt-border, #0001);
  background: var(--rt-surface, #fafafa); font-variant-numeric: tabular-nums;
  color: var(--rt-fg, #333); font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-height:22px;
  display:flex; align-items:center; gap:0; }
.info-line .root-icon { cursor:pointer; margin-right:4px; color: var(--rt-fg-muted, #999); flex-shrink:0; text-decoration:none; }
.info-line .root-icon:hover { color: var(--rt-accent, #0645ad); text-decoration:none; }
.info-line .root-icon.focused { color: var(--rt-fg, #000); }
.info-line a { cursor:pointer; color: var(--rt-accent, #0645ad); text-decoration:none; }
.info-line a:hover { text-decoration:underline; }
.info-line a.focused { font-weight:700; color: var(--rt-fg, #000); text-decoration:underline; text-underline-offset:2px; }
.info-line .sep-slash { color: var(--rt-fg-muted, #999); padding:0 1px; }
.info-line .val { color: var(--rt-fg-muted, #555); margin-left:6px; }
.stage { position:relative; flex:1; overflow:hidden; background: var(--rt-stage-bg, #0b0b0b); cursor: default; outline: none;
  padding: var(--rt-stage-margin, 4px); }
.stage canvas { position:absolute; inset: var(--rt-stage-margin, 4px); width:calc(100% - 2 * var(--rt-stage-margin, 4px)); height:calc(100% - 2 * var(--rt-stage-margin, 4px)); display:block; image-rendering: pixelated;
  transform-origin: 0 0; transition: transform var(--rt-zoom-ms, 350ms) ease; }
.overlay { position:absolute; inset: var(--rt-stage-margin, 4px); pointer-events:none; transform-origin:0 0; overflow:visible; }
.overlay .sel, .overlay .loc { position:absolute; box-sizing:border-box; pointer-events:none; }
.overlay .sel { border:2px solid var(--rt-selected); box-sizing:border-box; }
.overlay .loc { border:2px solid var(--rt-located); box-shadow: 0 0 0 1px #fff8; }
.overlay .lbl { position:absolute; font-size:11px; font-weight:500; line-height:1; padding:1px 3px;
  color: var(--rt-fg, #111);
  text-shadow: 0 0 2px var(--rt-bg, #ffffffcc), 0 0 2px var(--rt-bg, #ffffffcc);
  white-space:nowrap; pointer-events:none; transform: translate(-50%, -50%); }
.tooltip { position:fixed; pointer-events:none; padding:6px 10px;
  background: var(--rt-surface, #111d); color: var(--rt-fg, #fff);
  border:1px solid var(--rt-border, transparent);
  border-radius:4px; font-size:12px; line-height:1.4; z-index:1000; max-width:480px; box-shadow:0 2px 6px #0006; }
.tooltip b { display:block; font-size:11px; font-weight:600; margin-bottom:2px; overflow-wrap:break-word; }
.spinner { position:absolute; top:8px; right:8px; pointer-events:none; z-index:100;
  width:18px; height:18px; border:2px solid #fff3; border-top-color:#fffa;
  border-radius:50%; animation: rt-spin 0.8s linear infinite; }
.spinner[hidden] { display:none; }
@keyframes rt-spin { to { transform: rotate(360deg); } }
`;

export class RaisedTreemap extends HTMLElement {
  static get observedAttributes() {
    return [
      'color-mode','color-scale','palette','gradient-intensity','visible-root-id',
      'display-depth','min-cell-area','show-labels','value-format','toolbar',
      'zoom-duration','tooltip','background','group-padding','theme',
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

    this._infoLine = document.createElement('div');
    this._infoLine.className = 'info-line';
    this._infoLine.innerHTML = '<span>(click a cell)</span>';
    root.appendChild(this._infoLine);

    // Delegated handlers on the info-line. Single click focuses; double-click
    // zooms.  Because focusing can make a link bold (changing its width and
    // shifting siblings), the second click of a double-click may not land on
    // the same <a>.  We track the last-clicked node ID so the dblclick can
    // always act on the right node.
    this._lastBreadcrumbClickId = null;
    this._lastBreadcrumbClickTime = 0;
    this._infoLine.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-node-id]');
      if (!a) return;
      e.preventDefault();
      const nid = a.dataset.nodeId;
      const coerced = /^\d+$/.test(nid) ? Number(nid) : nid;
      this._lastBreadcrumbClickId = coerced;
      this._lastBreadcrumbClickTime = Date.now();
      this._lastBreadcrumbIsRoot = !!a.dataset.isRoot;
      if (a.dataset.isRoot) { this._setFocus(coerced); this._stage.focus(); }
      else this._setFocus(coerced);
    });
    this._infoLine.addEventListener('dblclick', (e) => {
      e.preventDefault();
      // Use tracked ID from the first click (may not match current e.target).
      const id = this._lastBreadcrumbClickId;
      if (id == null) return;
      if (this._lastBreadcrumbIsRoot) this.zoomReset();
      else this.stretchZoomIn(id);
    });

    this._stage = document.createElement('div');
    this._stage.className = 'stage';
    this._stage.tabIndex = 0;
    root.appendChild(this._stage);

    this._canvas = document.createElement('canvas');
    this._stage.appendChild(this._canvas);

    this._overlay = document.createElement('div');
    this._overlay.className = 'overlay';
    this._stage.appendChild(this._overlay);

    this._spinner = document.createElement('div');
    this._spinner.className = 'spinner';
    this._spinner.hidden = true;
    this._stage.appendChild(this._spinner);

    this._tooltip = document.createElement('div');
    this._tooltip.className = 'tooltip';
    this._tooltip.hidden = true;
    root.appendChild(this._tooltip);

    this._props = { ...DEFAULT_PROPS };
    this._tree = null;
    this._leaves = [];                     // flat leaves with rect + lutIndex
    this._leafById = new Map();
    this._targetId = null;      // leaf cell the user clicked
    this._focusId = null;       // ancestor (or target itself) being highlighted
    this._hoverId = null;
    this._internalVisibleRootId = null;
    this._visibleRootPath = null;  // array of IDs from tree root → zoom target
    this._wheelAcc = 0;
    this._selectionLocked = false;
    this._hoverRaf = 0;
    this._stretchZoomId = null;   // node zoomed into with preserved aspect
    this._stretchZoomAspect = 0;  // original w/h ratio of zoomed node's rect
    this._zoomAnimating = false;  // true during zoom animation

    this._onResize = this._onResize.bind(this);
    this._onStageMouse = this._onStageMouse.bind(this);
    this._onClick = this._onClick.bind(this);

    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    this._resizeObserver = new ResizeObserver(this._onResize);
    this._stage.addEventListener('mousemove', this._onStageMouse);
    this._stage.addEventListener('mouseleave', () => { this._hideTooltip(); this._setHover(null); });
    this._stage.addEventListener('click', this._onClick);

    this._stage.addEventListener('wheel', this._onWheel, { passive: true });
    this._stage.addEventListener('keydown', this._onKeyDown);
  }

  connectedCallback() {
    this._resizeObserver.observe(this._stage);
    // Apply default theme if none was set via attribute.
    if (!this.hasAttribute('theme')) this._applyTheme('tokyo-night');
    requestAnimationFrame(() => this._queueRender());
  }
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
      case 'theme': this._applyTheme(val); break;
    }
    this._queueRender();
  }

  _applyTheme(name) {
    const host = this.shadowRoot.host;
    const theme = name ? THEMES[name] : null;
    if (!theme) {
      // Clear theme vars — revert to defaults.
      for (const v of ['--rt-bg','--rt-surface','--rt-border','--rt-fg','--rt-fg-muted','--rt-accent','--rt-stage-bg'])
        host.style.removeProperty(v);
      this._props.palette = this._props._userPalette || 'gp-default';
      this._props.background = this._props._userBackground || '#111';
      // Restore original colorMap so extension-specific colors come back.
      if (this._props._userColorMap !== undefined) this._props.colorMap = this._props._userColorMap;
      return;
    }
    host.style.setProperty('--rt-bg', theme.bg);
    host.style.setProperty('--rt-surface', theme.surface);
    host.style.setProperty('--rt-border', theme.border);
    host.style.setProperty('--rt-fg', theme.fg);
    host.style.setProperty('--rt-fg-muted', theme.fgMuted);
    host.style.setProperty('--rt-accent', theme.accent);
    host.style.setProperty('--rt-stage-bg', theme.stageBg);
    this._props._userPalette = this._props._userPalette || this._props.palette;
    this._props._userBackground = this._props._userBackground || this._props.background;
    // Stash the original colorMap and clear it so all categories use the
    // theme palette instead of hardcoded per-category overrides.
    if (this._props._userColorMap === undefined) this._props._userColorMap = this._props.colorMap;
    this._props.colorMap = {};
    this._props.palette = name;
    this._props.background = theme.stageBg;
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
    let nodeRect = this._nodeRects.get(id);

    // If the target isn't in the current subtree (e.g. it's an ancestor of
    // the zoom root, or a node in another branch), reset the zoom so the
    // full tree is laid out and the target's rect becomes available.
    if (!nodeRect && this._stretchZoomId && this._tree.nodes.has(id)) {
      this._stretchZoomId = null;
      this._stretchZoomAspect = 0;
      this._rebuildAndRender();
      nodeRect = this._nodeRects.get(id);
    }

    if (!nodeRect || nodeRect.w <= 0 || nodeRect.h <= 0) return;

    this._stretchZoomId = id;
    this._stretchZoomAspect = nodeRect.w / nodeRect.h;
    this._zoomAnimating = true;

    // Build zoom path for hash persistence / lazy restore.
    const chain = [];
    let cur = this._tree.nodes.get(id);
    while (cur) { chain.unshift(cur.id); cur = cur.parentId != null ? this._tree.nodes.get(cur.parentId) : null; }
    this._visibleRootPath = chain;

    // Animate: CSS-transform the current canvas to expand the node rect to fill the canvas area
    const { cssW: canvasW, cssH: canvasH, dpr } = this._canvasMetrics();
    const sx = canvasW / (nodeRect.w / dpr);
    const sy = canvasH / (nodeRect.h / dpr);
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

    this._dispatch('rt-zoom-change', id);
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
      const { cssW: canvasW, cssH: canvasH, dpr } = this._canvasMetrics();
      const sx = canvasW / (nodeRect.w / dpr);
      const sy = canvasH / (nodeRect.h / dpr);
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

    this._dispatch('rt-zoom-change', null);
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
    // In lazy mode, keep the tree across renders — nodes persist and only
    // unexpanded stubs get new children when their blocks inflate.
    // Rebuild from scratch only on the first render or when data changes.
    if (!this._tree || !this._tree._lazy) {
      try { this._tree = this._buildTree(); }
      catch (e) { this._tree = null; this._showErrorToolbar(e.message); return; }
    }
    if (!this._tree) { this._clearCanvas(); this._renderToolbar(); return; }
    // Auto-focus root on first successful render so Home starts highlighted.
    if (!this._hasRendered && this._tree.roots[0] != null) {
      this._hasRendered = true;
      if (this._focusId == null && this._targetId == null) {
        this._focusId = this._tree.roots[0];
      }
    }
    this._renderToolbar();
    this._paint();
  }

  _buildTree() {
    const p = this._props;
    const minRelArea = p.minCellArea > 0 ? Math.max(0, p.minCellArea / 100000) : 0;
    if (p.root != null && p.getChildren && p.getValue && p.getLabel && p.getId) {
      // Lazy mode: start with just the root. Children are discovered on
      // demand during _paint() → layoutSubtree() by calling getChildren.
      // Rebuilt from scratch each render — the data source (page script)
      // decides what's available. No caching, no stale-data bugs.
      const rootItem = p.root;
      const rootId = p.getId(rootItem);
      const v = Number(p.getValue(rootItem)) || 0;
      const nodes = new Map();
      nodes.set(rootId, {
        id: rootId, label: p.getLabel(rootItem), value: v,
        colorValue: p.getColor ? p.getColor(rootItem) : v,
        depth: 0, parentId: null, childIds: null,
        isOther: false, isLocated: false, rect: null, colorIndex: 0,
        _item: rootItem, _hasExplicitValue: true,
      });
      return { nodes, roots: [rootId], _lazy: true };
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
    const stageRect = this._stage.getBoundingClientRect();
    const marginStr = getComputedStyle(this._stage).getPropertyValue('--rt-stage-margin') || '4px';
    const margin = parseFloat(marginStr) || 4;
    const cssW = Math.max(1, Math.floor(stageRect.width - 2 * margin));
    const cssH = Math.max(1, Math.floor(stageRect.height - 2 * margin));
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    if (this._canvas.width !== w) this._canvas.width = w;
    if (this._canvas.height !== h) this._canvas.height = h;
    this._canvas.style.width = cssW + 'px';
    this._canvas.style.height = cssH + 'px';
    this._canvas.style.setProperty('--rt-zoom-ms', `${p.zoomDuration}ms`);

    const activeRoot = this._activeVisibleRootId();
    const nodes = this._tree.nodes;

    // Lazy mode: if the zoom target isn't in the tree yet, eagerly expand
    // along the stored zoom path so the target can be used as layout root.
    if (activeRoot != null && !nodes.has(activeRoot) && this._tree._lazy
        && this._visibleRootPath && p.getChildren && p.getId && p.getValue && p.getLabel) {
      for (const pathId of this._visibleRootPath) {
        if (!nodes.has(pathId)) break;  // path broken — stop
        const nd = nodes.get(pathId);
        if (nd.childIds != null || nd._item == null) continue;  // already expanded or no item
        const items = p.getChildren(nd._item);
        if (items == null) break;  // data not yet available (e.g. stub block not inflated) — retry next render
        if (items.length === 0) { nd.childIds = []; continue; }
        nd.childIds = [];
        for (let ci = 0; ci < items.length; ci++) {
          const cItem = items[ci];
          const cId = p.getId(cItem);
          const cVal = Number(p.getValue(cItem)) || 0;
          if (!nodes.has(cId)) {
            nodes.set(cId, {
              id: cId, label: p.getLabel(cItem), value: cVal,
              colorValue: p.getColor ? p.getColor(cItem) : cVal,
              depth: nd.depth + 1, parentId: pathId, childIds: null,
              isOther: false, isLocated: false, rect: null, colorIndex: 0,
              _item: cItem, _hasExplicitValue: true,
            });
          }
          nd.childIds.push(cId);
        }
        if (nodes.has(activeRoot)) break;  // found it
      }
    }

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
    let pendingStubs = 0; // count of nodes whose data isn't available yet

    // When stretch-zoomed, layout at full canvas size but bias split decisions
    // to match the original aspect ratio. This preserves tile structure (split
    // directions) while avoiding the sub-pixel visibility holes that occur when
    // laying out in a tiny space and scaling afterward.
    //
    // The bias is capped so extreme aspect ratios don't produce all-vertical
    // (or all-horizontal) layouts where tiny cells are sub-pixel in the
    // compressed dimension.  A cap of 4 preserves the first few levels of
    // split structure while allowing the perpendicular direction at deeper
    // levels, which redistributes area and keeps cells visible.
    let splitBias = 1;
    if (this._stretchZoomId && this._stretchZoomAspect > 0) {
      const narrowW = Math.max(1, Math.round(h * this._stretchZoomAspect));
      const rawBias = w / narrowW;
      splitBias = rawBias > 1 ? Math.min(rawBias, 4) : Math.max(rawBias, 0.25);
    }

    // Lazy accessor expansion: when the tree is in lazy mode (_lazy flag),
    // childIds starts as null. We call the user's getChildren accessor to
    // discover children on demand — only for nodes that the layout actually
    // recurses into. Sub-pixel nodes are pruned by visible() in layoutTree,
    // so getChildren is never called for them.
    const lazy = this._tree._lazy;
    const _gc = lazy ? p.getChildren : null;
    const _gv = lazy ? p.getValue : null;
    const _gl = lazy ? p.getLabel : null;
    const _gcol = lazy ? p.getColor : null;
    const _gid = lazy ? p.getId : null;

    const layoutSubtree = (nodeId, rect) => {
      inSubtree.add(nodeId);
      nodeRects.set(nodeId, rect);
      const node = nodes.get(nodeId);
      const atCap = node.depth >= cap;

      // Lazy expansion: only expand nodes whose childIds is still null
      // (unexpanded stubs or first-visit nodes). Already-expanded nodes
      // keep their children across renders — no redundant getChildren calls.
      if (lazy && node._item != null && node.childIds == null) {
        const items = _gc(node._item);
        if (items == null) {
          // Data not yet available (stub block not inflated).
          // Leave childIds as null — will retry on next render.
          pendingStubs++;
        } else if (items.length > 0) {
          node.childIds = [];
          for (let ci = 0; ci < items.length; ci++) {
            const cItem = items[ci];
            const cId = _gid(cItem);
            const cVal = Number(_gv(cItem)) || 0;
            if (!nodes.has(cId)) {
              nodes.set(cId, {
                id: cId, label: _gl(cItem), value: cVal,
                colorValue: _gcol ? _gcol(cItem) : cVal,
                depth: node.depth + 1, parentId: nodeId, childIds: null,
                isOther: false, isLocated: false, rect: null, colorIndex: 0,
                _item: cItem, _hasExplicitValue: true,
              });
            }
            node.childIds.push(cId);
          }
        } else {
          node.childIds = [];  // true leaf — no children
        }
      }

      if (atCap || !node.childIds || node.childIds.length === 0) {
        leafCap.add(nodeId);
        leavesCollect.push({ node, rect });
        return;
      }
      const kids = node.childIds.map((cid) => nodes.get(cid));
      const balRoot = balanceChildren(kids.map((k) => ({ id: k.id, size: Math.max(0, k.value) })));
      const childRects = new Map();
      if (balRoot) {
        layoutTree(balRoot, rect, (id, r) => childRects.set(id, r), splitBias);
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
    layoutSubtree(rootId, { x: 0, y: 0, w, h });

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

    // Show spinner while blocks are still inflating (pending stubs exist).
    if (this._spinner) this._spinner.hidden = pendingStubs === 0;
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
    const focusId = this._focusId != null ? this._focusId : this._targetId;
    if (focusId != null) {
      const bounds = this._selectionBounds(focusId);
      if (bounds) this._overlay.appendChild(overlayBox('sel', bounds, dpr));
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
    if (!cfg) {
      this._toolbar.style.display = 'none';
      this._infoLine.style.display = 'none';
      return;
    }
    this._toolbar.style.display = 'none'; // toolbar row no longer has visible controls
    const want = {
      info: cfg.info !== false,
    };

    if (want.info) {
      this._infoEl = this._infoLine;
      this._infoLine.style.display = '';
    } else {
      this._infoEl = null;
      this._infoLine.style.display = 'none';
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
    const id = this._targetId;
    if (id == null || !this._tree) {
      this._infoEl.innerHTML = '<span>(click a cell)</span>';
      return;
    }
    const n = this._tree.nodes.get(id);
    if (!n) return;
    // Build ancestor chain (skip root — its label is in the page header).
    const chain = [];
    let cur = this._tree.nodes.get(id);
    while (cur) {
      if (cur.parentId !== null) chain.unshift(cur);
      cur = cur.parentId !== null ? this._tree.nodes.get(cur.parentId) : null;
    }
    this._infoEl.innerHTML = '';
    // Root sentinel icon — behaves like a breadcrumb element (click to focus root, dblclick to zoom).
    const rootId = this._tree.roots[0];
    const rootIcon = document.createElement('a');
    rootIcon.className = 'root-icon';
    rootIcon.title = 'Click to focus root, double-click to zoom';
    rootIcon.dataset.nodeId = rootId != null ? rootId : '';
    rootIcon.dataset.isRoot = '1';
    rootIcon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:-2px"><path d="M8 1.5L1 7h2.5v6.5h4V10h1v3.5h4V7H15z" fill="currentColor"/></svg>';
    const focusId = this._focusId != null ? this._focusId : this._targetId;
    if (rootId != null && focusId === rootId) rootIcon.classList.add('focused');
    this._infoEl.appendChild(rootIcon);
    chain.forEach((node, i) => {
      if (i > 0) {
        const slash = document.createElement('span');
        slash.className = 'sep-slash';
        slash.textContent = '/';
        this._infoEl.appendChild(slash);
      }
      const a = document.createElement('a');
      a.textContent = node.label;
      a.title = 'Click to focus, double-click to zoom';
      a.dataset.nodeId = node.id;
      if (node.id === focusId) a.classList.add('focused');
      this._infoEl.appendChild(a);
    });
    // Show value for the focused node (if set), otherwise the target/hovered node.
    const valNode = (focusId != null && this._tree.nodes.get(focusId)) || n;
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = '· ' + this._formatValue(valNode.value);
    this._infoEl.appendChild(val);
  }
  _formatValue(v) {
    if (typeof this._props.valueFormatter === 'function') return this._props.valueFormatter(v);
    if (this._props.valueFormat) return applyFormat(v, this._props.valueFormat);
    return v.toLocaleString();
  }

  // ----- hit testing / interactions -----
  _hitTest(e) {
    const canvasRect = this._canvas.getBoundingClientRect();
    const cssX = e.clientX - canvasRect.left;
    const cssY = e.clientY - canvasRect.top;
    const dpr = this._canvas.width / canvasRect.width;
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
        this._dispatch('rt-hover', id);
        this._dispatch('rt-mouseover', id);
      }
    });
  }
  _setHover(id) {
    if (this._hoverId === id) return;
    this._hoverId = id;
  }
  _onClick(e) {
    const id = this._hitTest(e);
    if (id == null) return;
    this._targetId = id;
    this._focusId = id;
    this._selectionLocked = true;
    this._stage.focus();
    const { cssW, cssH, dpr } = this._canvasMetrics();
    this._renderOverlay(cssW, cssH, dpr);
    this._updateToolbarInfo();
    this._dispatch('rt-click', id);
    this._dispatch('rt-target', id);
    this._dispatch('rt-focus', id);
  }

  _onWheel(e) {
    if (this._targetId == null || !this._tree) return;
    this._wheelAcc += e.deltaY;
    if (Math.abs(this._wheelAcc) < 80) return;
    const dir = this._wheelAcc > 0 ? 1 : -1;
    this._wheelAcc = 0;
    // Build ancestor chain from target to root
    const chain = [this._targetId];
    let cur = this._tree.nodes.get(this._targetId);
    while (cur && cur.parentId != null) {
      chain.push(cur.parentId);
      cur = this._tree.nodes.get(cur.parentId);
    }
    // chain[0] = target (deepest), chain[last] = root (shallowest)
    const focusId = this._focusId != null ? this._focusId : this._targetId;
    const idx = chain.indexOf(focusId);
    // dir < 0 (scroll up/away) = toward target (deeper), dir > 0 (scroll down/toward you) = toward root (shallower)
    const nextIdx = idx === -1 ? 0 : idx + (dir > 0 ? 1 : -1);
    if (nextIdx >= 0 && nextIdx < chain.length) this._setFocus(chain[nextIdx]);
  }
  _onKeyDown(e) {
    const focusId = this._focusId != null ? this._focusId : this._targetId;
    if (e.key === '+' || e.key === '=') { if (focusId != null) this._setVisibleRoot(focusId); return; }
    if (e.key === '-') { this.zoomOut(); return; }
    if (e.key === '0') { this.zoomReset(); return; }
    if (!this._selectionLocked || !this._tree || focusId == null) return;
    const n = this._tree.nodes.get(focusId);
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
      this._focusUp(); return;
    } else { return; }
    if (next != null) this._setFocus(next);
  }
  _showTooltip(e, id) {
    if (!this._tree) return;
    const n = this._tree.nodes.get(id);
    if (!n) return;
    this._tooltip.hidden = false;
    const pathHtml = escapeHtml(this._buildPath(id)).replace(/\//g, '/<wbr>');
    this._tooltip.innerHTML = `<b>${pathHtml}</b><br>${escapeHtml(this._formatValue(n.value))}${n.isOther ? ' (collapsed)' : ''}`;
    const gap = 12;
    const vw = window.innerWidth;
    const tt = this._tooltip;
    // Measure tooltip width: temporarily show off-screen to get actual size
    tt.style.left = '-9999px'; tt.style.top = '-9999px';
    const tw = tt.offsetWidth;
    const flipX = e.clientX + gap + tw > vw;
    const x = flipX ? e.clientX - gap - tw : e.clientX + gap;
    tt.style.left = x + 'px';
    tt.style.top = (e.clientY + gap) + 'px';
  }
  _hideTooltip() { this._tooltip.hidden = true; }

  _fireDepthChange() {
    const d = this._props.displayDepth;
    this.dispatchEvent(new CustomEvent('rt-depth-change', { detail: { displayDepth: d }, bubbles: true, composed: true }));
  }

  _canvasMetrics() {
    const r = this._canvas.getBoundingClientRect();
    const cssW = Math.max(1, r.width);
    const cssH = Math.max(1, r.height);
    const dpr = this._canvas.width / cssW;
    return { cssW, cssH, dpr };
  }
  _setFocus(id) {
    this._focusId = id;
    const { cssW, cssH, dpr } = this._canvasMetrics();
    this._renderOverlay(cssW, cssH, dpr);
    this._updateInfoFocus();
    this._dispatch('rt-focus', id);
  }
  // Light update: toggle .focused class on existing breadcrumb links
  // without rebuilding the DOM (preserves elements for dblclick).
  _updateInfoFocus() {
    if (!this._infoEl) return;
    const focusId = this._focusId != null ? this._focusId : this._targetId;
    for (const a of this._infoEl.querySelectorAll('a[data-node-id]')) {
      const nid = a.dataset.nodeId;
      const coerced = /^\d+$/.test(nid) ? Number(nid) : nid;
      a.classList.toggle('focused', coerced === focusId);
    }
    // Update displayed value to match focused node.
    const valSpan = this._infoEl.querySelector('.val');
    if (valSpan && focusId != null && this._tree) {
      const n = this._tree.nodes.get(focusId);
      if (n) valSpan.textContent = '· ' + this._formatValue(n.value);
    }
  }

  _setVisibleRoot(id, path) {
    if (this._props.visibleRootId != null) {
      this._dispatch('rt-zoom-change', id, { intendedRoot: true });
      return;
    }
    this._internalVisibleRootId = id;
    // Build zoom path from tree if available and no explicit path given.
    if (path) {
      this._visibleRootPath = path;
    } else if (id != null && this._tree && this._tree.nodes.has(id)) {
      const chain = [];
      let cur = this._tree.nodes.get(id);
      while (cur) { chain.unshift(cur.id); cur = cur.parentId != null ? this._tree.nodes.get(cur.parentId) : null; }
      this._visibleRootPath = chain;
    } else {
      this._visibleRootPath = null;
    }
    this._dispatch('rt-zoom-change', id);
    this._queueRender();
  }
  _dispatch(name, nodeId, extra = {}) {
    if (!this._tree) return;
    if (nodeId && !this._tree.nodes.has(nodeId)) {
      if (name !== 'rt-zoom-change') return;
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
      ...(name === 'rt-zoom-change' && this._visibleRootPath ? { zoomPath: this._visibleRootPath.slice() } : {}),
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
    if (this._nodeRects) {
      const r = this._nodeRects.get(nodeId);
      if (r) return r;
      // If the node is an ancestor of the current zoom root, its bounds
      // encompass the entire visible area (the zoom root's rect).
      const activeRoot = this._activeVisibleRootId();
      if (activeRoot != null && this._tree) {
        let cur = this._tree.nodes.get(activeRoot);
        while (cur && cur.parentId != null) {
          if (cur.parentId === nodeId) return this._nodeRects.get(activeRoot);
          cur = this._tree.nodes.get(cur.parentId);
        }
      }
    }
    return null;
  }

  _treeMaxDepth() {
    if (!this._tree) return 10;
    let max = 0;
    for (const n of this._tree.nodes.values()) if (n.depth > max) max = n.depth;
    return max;
  }

  _focusUp() {
    const cur = this._focusId != null ? this._focusId : this._targetId;
    if (cur == null || !this._tree) return;
    const n = this._tree.nodes.get(cur);
    if (!n || n.parentId === null) return;
    this._setFocus(n.parentId);
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
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function overlayBox(cls, leaf, dpr) {
  const el = document.createElement('div');
  el.className = cls;
  const cssW = leaf.w / dpr, cssH = leaf.h / dpr;
  if (cls === 'sel') {
    const t = Math.max(2, Math.round(Math.max(cssW, cssH) * 0.01));
    el.style.left = (leaf.x / dpr - t) + 'px';
    el.style.top = (leaf.y / dpr - t) + 'px';
    el.style.width = (cssW + 2 * t) + 'px';
    el.style.height = (cssH + 2 * t) + 'px';
    el.style.borderWidth = t + 'px';
  } else {
    el.style.left = leaf.x / dpr + 'px';
    el.style.top = leaf.y / dpr + 'px';
    el.style.width = cssW + 'px';
    el.style.height = cssH + 'px';
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

// Properties that define the data source — changing these invalidates the
// cached lazy tree so it gets rebuilt from scratch on the next render.
const DATA_PROPS = new Set(['root', 'labels', 'parents', 'parentIndices', 'values', 'ids', 'getChildren', 'getValue', 'getLabel', 'getId', 'getColor']);
for (const p of Object.keys(DEFAULT_PROPS)) {
  Object.defineProperty(RaisedTreemap.prototype, p, {
    configurable: true,
    get() { return this._props[p]; },
    set(v) {
      this._props[p] = v;
      if (DATA_PROPS.has(p)) this._tree = null;
      this._queueRender();
    },
  });
}

if (!customElements.get('raised-treemap')) customElements.define('raised-treemap', RaisedTreemap);
