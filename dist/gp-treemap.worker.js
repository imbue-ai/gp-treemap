/* gp-treemap render-worker — built by tools/build.js */
(function(){ "use strict";
/* ---- src/hash.js ---- */
// FNV-1a 32-bit. Deterministic across runs; used for hash-based color assignment.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/* ---- src/palettes.js ---- */
// Built-in palettes. All stored as hsl(h,s%,l%) strings so the gradient generator
// can nudge l up/down to produce lighter/darker stops without parsing RGB.
const PALETTES = {
  // Default palette: 8 saturated hues, one per file-kind category.
  'gp-default': [
    'hsl(211, 70%, 52%)',  // blue
    'hsl(354, 70%, 53%)',  // red
    'hsl(138, 55%, 45%)',  // green
    'hsl(188, 70%, 48%)',  // cyan
    'hsl(300, 55%, 55%)',  // magenta
    'hsl(26,  85%, 55%)',  // orange
    'hsl(48,  85%, 55%)',  // yellow
    'hsl(264, 55%, 58%)',  // purple
  ],
  heatmap: [
    'hsl(240, 70%, 55%)',
    'hsl(200, 70%, 55%)',
    'hsl(150, 65%, 50%)',
    'hsl(60,  80%, 55%)',
    'hsl(30,  85%, 55%)',
    'hsl(0,   80%, 55%)',
  ],
  rainbow: [
    'hsl(0,   75%, 55%)',
    'hsl(40,  80%, 55%)',
    'hsl(80,  65%, 50%)',
    'hsl(140, 60%, 48%)',
    'hsl(200, 70%, 50%)',
    'hsl(260, 60%, 58%)',
    'hsl(320, 60%, 58%)',
  ],
  viridis: [
    'hsl(276, 55%, 26%)',
    'hsl(254, 50%, 38%)',
    'hsl(210, 40%, 44%)',
    'hsl(170, 40%, 46%)',
    'hsl(130, 50%, 50%)',
    'hsl(80,  70%, 55%)',
    'hsl(55,  85%, 65%)',
  ],
  plasma: [
    'hsl(260, 70%, 30%)',
    'hsl(295, 70%, 40%)',
    'hsl(330, 75%, 50%)',
    'hsl(15,  85%, 55%)',
    'hsl(45,  90%, 60%)',
    'hsl(55,  95%, 70%)',
  ],
  // Inferno — "glowing metal": black → indigo → red → orange → yellow → white.
  // Approximates matplotlib's inferno colormap; great for file age, heat, etc.
  inferno: [
    'hsl(270, 50%, 8%)',
    'hsl(270, 65%, 22%)',
    'hsl(310, 70%, 32%)',
    'hsl(345, 80%, 42%)',
    'hsl(15,  90%, 50%)',
    'hsl(40,  92%, 58%)',
    'hsl(55,  95%, 75%)',
    'hsl(60,  80%, 92%)',
  ],
  // Magma — dark → purple → pink → peach → pale.
  // Perceptually uniform; good for density or magnitude data.
  magma: [
    'hsl(270, 50%, 8%)',
    'hsl(270, 60%, 24%)',
    'hsl(295, 55%, 38%)',
    'hsl(330, 60%, 52%)',
    'hsl(355, 65%, 65%)',
    'hsl(20,  75%, 78%)',
    'hsl(50,  70%, 92%)',
  ],
  // Turbo — Google's improved rainbow: blue → cyan → green → yellow → red.
  // Higher perceptual uniformity than classic rainbow; great for general use.
  turbo: [
    'hsl(240, 80%, 32%)',
    'hsl(210, 90%, 48%)',
    'hsl(180, 75%, 48%)',
    'hsl(130, 65%, 48%)',
    'hsl(60,  88%, 52%)',
    'hsl(30,  92%, 50%)',
    'hsl(0,   80%, 38%)',
  ],
  // Cool–warm diverging: blue → neutral → red.
  // Ideal for values centered on a midpoint (e.g., change since baseline).
  coolwarm: [
    'hsl(220, 70%, 42%)',
    'hsl(220, 55%, 62%)',
    'hsl(220, 25%, 82%)',
    'hsl(0,   5%,  92%)',
    'hsl(10,  25%, 82%)',
    'hsl(10,  55%, 62%)',
    'hsl(10,  70%, 42%)',
  ],
};

// ---------------------------------------------------------------------------
// Themes — full-page color schemes combining a categorical treemap palette
// with chrome/page colors. Each theme uses ALL of its source palette colors.
//
// Attribution:
//   Nord            — Arctic Ice Studio & Sven Greb · github.com/nordtheme/nord (MIT)
//   Solarized       — Ethan Schoonover · github.com/altercation/solarized (MIT)
//   Dracula         — Zeno Rocha · github.com/dracula/dracula-theme (MIT)
//   Catppuccin      — Catppuccin Org · github.com/catppuccin/catppuccin (MIT)
//   Gruvbox         — Pavel Pertsev (morhetz) · github.com/morhetz/gruvbox (MIT)
//   Tokyo Night     — enkia · github.com/enkia/tokyo-night-vscode-theme (MIT)
//   Rosé Pine       — Rosé Pine · github.com/rose-pine/rose-pine-theme (MIT)
//   One Dark        — GitHub (Atom) · github.com/atom/one-dark-syntax (MIT)
// ---------------------------------------------------------------------------
const THEMES = {
  // ── Nord ────────────────────────────────────────────────────────────────
  // Polar Night: nord0–nord3  |  Snow Storm: nord4–nord6
  // Frost: nord7–nord10       |  Aurora: nord11–nord15
  nord: {
    label: 'Nord',
    dark: true,
    bg:      '#2e3440', // nord0
    surface: '#3b4252', // nord1
    border:  '#4c566a', // nord3
    fg:      '#d8dee9', // nord4
    fgMuted: '#81a1c1', // nord9
    accent:  '#88c0d0', // nord8
    stageBg: '#2e3440', // nord0
    palette: [
      '#5e81ac', // nord10 — blue
      '#bf616a', // nord11 — red
      '#a3be8c', // nord14 — green
      '#88c0d0', // nord8  — frost cyan
      '#b48ead', // nord15 — purple
      '#d08770', // nord12 — orange
      '#ebcb8b', // nord13 — yellow
      '#8fbcbb', // nord7  — frost teal
      '#81a1c1', // nord9  — frost grey-blue
    ],
  },

  // ── Solarized Dark ─────────────────────────────────────────────────────
  // Base tones: base03–base3  |  Accent: yellow–green
  solarized: {
    label: 'Solarized Dark',
    dark: true,
    bg:      '#002b36', // base03
    surface: '#073642', // base02
    border:  '#586e75', // base01
    fg:      '#839496', // base0
    fgMuted: '#657b83', // base00
    accent:  '#268bd2', // blue
    stageBg: '#002b36', // base03
    palette: [
      '#268bd2', // blue
      '#dc322f', // red
      '#859900', // green
      '#2aa198', // cyan
      '#d33682', // magenta
      '#cb4b16', // orange
      '#b58900', // yellow
      '#6c71c4', // violet
    ],
  },

  // ── Dracula ────────────────────────────────────────────────────────────
  // Background · Current Line · Foreground · Comment + 8 accents
  dracula: {
    label: 'Dracula',
    dark: true,
    bg:      '#282a36', // Background
    surface: '#44475a', // Current Line
    border:  '#6272a4', // Comment
    fg:      '#f8f8f2', // Foreground
    fgMuted: '#6272a4', // Comment
    accent:  '#bd93f9', // Purple
    stageBg: '#282a36', // Background
    palette: [
      '#bd93f9', // Purple
      '#ff5555', // Red
      '#50fa7b', // Green
      '#8be9fd', // Cyan
      '#ff79c6', // Pink
      '#ffb86c', // Orange
      '#f1fa8c', // Yellow
      '#6272a4', // Comment (blue-grey)
    ],
  },

  // ── Catppuccin Mocha ───────────────────────────────────────────────────
  // 14 accent hues + 12 base tones (Base → Crust, Text → Overlay)
  catppuccin: {
    label: 'Catppuccin Mocha',
    dark: true,
    bg:      '#1e1e2e', // Base
    surface: '#313244', // Surface0
    border:  '#45475a', // Surface1
    fg:      '#cdd6f4', // Text
    fgMuted: '#a6adc8', // Subtext0
    accent:  '#cba6f7', // Mauve
    stageBg: '#181825', // Mantle
    palette: [
      '#89b4fa', // Blue
      '#f38ba8', // Red
      '#a6e3a1', // Green
      '#89dceb', // Sky
      '#cba6f7', // Mauve
      '#fab387', // Peach
      '#f9e2af', // Yellow
      '#f5c2e7', // Pink
      '#94e2d5', // Teal
      '#74c7ec', // Sapphire
      '#b4befe', // Lavender
      '#eba0ac', // Maroon
      '#f5e0dc', // Rosewater
      '#f2cdcd', // Flamingo
    ],
  },

  // ── Gruvbox Dark ───────────────────────────────────────────────────────
  // Dark bg0–bg4 · Light fg0–fg4 · Bright accents (dark-mode foreground)
  gruvbox: {
    label: 'Gruvbox Dark',
    dark: true,
    bg:      '#282828', // bg0
    surface: '#3c3836', // bg1
    border:  '#504945', // bg2
    fg:      '#ebdbb2', // fg1
    fgMuted: '#a89984', // fg4
    accent:  '#fabd2f', // bright yellow
    stageBg: '#1d2021', // bg0_h
    palette: [
      '#83a598', // bright blue
      '#fb4934', // bright red
      '#b8bb26', // bright green
      '#8ec07c', // bright aqua
      '#d3869b', // bright purple
      '#fe8019', // bright orange
      '#fabd2f', // bright yellow
      '#928374', // gray
    ],
  },

  // ── Tokyo Night ────────────────────────────────────────────────────────
  // Deep indigo bg · Cool-toned syntax across the full hue range
  'tokyo-night': {
    label: 'Tokyo Night',
    dark: true,
    bg:      '#1a1b26', // editor bg
    surface: '#16161e', // sidebar bg
    border:  '#0f0f14', // borders
    fg:      '#c0caf5', // foreground
    fgMuted: '#787c99', // muted fg
    accent:  '#7aa2f7', // blue
    stageBg: '#1a1b26', // editor bg
    palette: [
      '#7aa2f7', // blue — functions
      '#f7768e', // red — tags, keywords
      '#9ece6a', // green — strings
      '#7dcfff', // cyan — properties
      '#bb9af7', // purple — storage/keywords
      '#ff9e64', // orange — constants
      '#e0af68', // yellow — parameters
      '#73daca', // teal — object keys
      '#0db9d7', // dark cyan — types
      '#9d7cd8', // dark purple — modifiers
      '#89ddff', // ice blue — operators
      '#b4f9f8', // mint — regexp
    ],
  },

  // ── Rosé Pine ──────────────────────────────────────────────────────────
  // Soho vibes — muted warm tones over a dusky base
  'rose-pine': {
    label: 'Rosé Pine',
    dark: true,
    bg:      '#191724', // Base
    surface: '#1f1d2e', // Surface
    border:  '#26233a', // Overlay
    fg:      '#e0def4', // Text
    fgMuted: '#908caa', // Subtle
    accent:  '#c4a7e7', // Iris
    stageBg: '#191724', // Base
    palette: [
      '#31748f', // Pine
      '#eb6f92', // Love
      '#9ccfd8', // Foam
      '#c4a7e7', // Iris
      '#ebbcba', // Rose
      '#f6c177', // Gold
    ],
  },

  // ── One Dark ───────────────────────────────────────────────────────────
  // Atom's signature dark theme — balanced hues on a cool neutral bg
  'one-dark': {
    label: 'One Dark',
    dark: true,
    bg:      'hsl(220, 13%, 18%)',   // syntax-bg
    surface: 'hsl(220, 13%, 22%)',   // slightly lighter
    border:  'hsl(220, 10%, 30%)',   // mid-tone
    fg:      'hsl(220, 14%, 71%)',   // mono-1
    fgMuted: 'hsl(220, 9%, 55%)',    // mono-2
    accent:  'hsl(207, 82%, 66%)',   // hue-2 (blue)
    stageBg: 'hsl(220, 13%, 16%)',   // slightly darker than bg
    palette: [
      'hsl(207, 82%, 66%)', // hue-2  — blue
      'hsl(355, 65%, 65%)', // hue-5  — red
      'hsl(95,  38%, 62%)', // hue-4  — green
      'hsl(187, 47%, 55%)', // hue-1  — cyan
      'hsl(286, 60%, 67%)', // hue-3  — purple
      'hsl(29,  54%, 61%)', // hue-6  — orange
      'hsl(39,  67%, 69%)', // hue-6-2 — yellow
      'hsl(5,   48%, 51%)', // hue-5-2 — dark red
    ],
  },
};
function resolvePalette(spec) {
  if (!spec) return PALETTES['gp-default'];
  if (typeof spec === 'string') {
    if (PALETTES[spec]) return PALETTES[spec];
    if (THEMES[spec]) return THEMES[spec].palette;
    return PALETTES['gp-default'];
  }
  if (Array.isArray(spec.colors) && spec.colors.length >= 2) return spec.colors;
  if (spec.name) {
    if (PALETTES[spec.name]) return PALETTES[spec.name];
    if (THEMES[spec.name]) return THEMES[spec.name].palette;
  }
  return PALETTES['gp-default'];
}

// Parse 'hsl(h, s%, l%)' → {h, s, l}. Falls through to a mid-gray for other forms.
function parseHsl(str) {
  const m = /hsl\(\s*([\-\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i.exec(str);
  if (!m) return { h: 0, s: 0, l: 50, raw: str };
  return { h: +m[1], s: +m[2], l: +m[3] };
}
function toHsl({ h, s, l }) {
  const clampPct = (v) => Math.max(0, Math.min(100, v));
  return `hsl(${h}, ${clampPct(s)}%, ${clampPct(l)}%)`;
}

/* ---- src/color-scale.js ---- */
// Scale builders. Each returns (value) => integer palette index.
function buildLinearScale(domain, paletteLen) {
  const [min, max] = domain;
  const n = paletteLen;
  if (max === min) return () => 0;
  return (v) => {
    const t = (v - min) / (max - min);
    const clamped = Math.max(0, Math.min(1, t));
    return Math.min(n - 1, Math.floor(clamped * n));
  };
}
function buildLogScale(domain, paletteLen) {
  const [min, max] = domain;
  if (min <= 0 || max <= 0) {
    throw new Error('log scale requires positive domain');
  }
  const lmin = Math.log(min), lmax = Math.log(max);
  const n = paletteLen;
  if (lmax === lmin) return () => 0;
  return (v) => {
    if (v <= 0) throw new Error('log scale value must be > 0');
    const t = (Math.log(v) - lmin) / (lmax - lmin);
    const clamped = Math.max(0, Math.min(1, t));
    return Math.min(n - 1, Math.floor(clamped * n));
  };
}

// Diverging: [min, mid, max] → [0, floor(n/2), n-1].
function buildDivergingScale(domain, paletteLen) {
  const [min, mid, max] = domain;
  const n = paletteLen;
  const midIdx = Math.floor(n / 2);
  return (v) => {
    if (v <= mid) {
      if (mid === min) return 0;
      const t = (v - min) / (mid - min);
      const clamped = Math.max(0, Math.min(1, t));
      return Math.round(clamped * midIdx);
    } else {
      if (max === mid) return n - 1;
      const t = (v - mid) / (max - mid);
      const clamped = Math.max(0, Math.min(1, t));
      return Math.min(n - 1, midIdx + Math.round(clamped * (n - 1 - midIdx)));
    }
  };
}
function buildQuantileScale(values, paletteLen) {
  const sorted = values.slice().sort((a, b) => a - b);
  const n = paletteLen;
  return (v) => {
    // rank of v in sorted (first index >= v); binary search
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1; else hi = mid;
    }
    const rank = lo / Math.max(1, sorted.length - 1);
    return Math.min(n - 1, Math.floor(rank * n));
  };
}
function autoDomain(values) {
  let min = +Infinity, max = -Infinity;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  return [min, max];
}

/* ---- src/color-resolver.js ---- */


/**
 * Assigns `colorIndex` (and an optional `colorOverride` CSS color) to every
 * rendered node.
 *
 * @param {TreeNode[]} nodes flat array
 * @param {string} mode 'categorical' | 'quantitative' | 'depth'
 * @param {Object} opts
 */
function resolveColors(nodes, mode, opts = {}) {
  const {
    palette,
    colorScale = 'linear',
    colorDomain, // [min, max] or [min, mid, max]
    colorMap = {},
    colorFn,
  } = opts;
  const n = palette.length;

  if (typeof colorFn === 'function') {
    for (const node of nodes) {
      const v = colorFn(node);
      if (typeof v === 'string') node.colorOverride = v;
      else if (Number.isFinite(v)) node.colorIndex = ((v | 0) % n + n) % n;
    }
    return;
  }

  if (mode === 'depth') {
    for (const node of nodes) node.colorIndex = node.depth % n;
    return;
  }

  if (mode === 'categorical') {
    for (const node of nodes) {
      const key = String(node.colorValue);
      if (Object.prototype.hasOwnProperty.call(colorMap, key)) {
        node.colorOverride = colorMap[key];
      } else {
        node.colorIndex = fnv1a(key) % n;
      }
    }
    return;
  }

  // quantitative
  const numericValues = nodes.map((nd) => +nd.colorValue).filter(Number.isFinite);
  let scale;
  if (colorScale === 'linear') {
    const d = colorDomain || autoDomain(numericValues);
    scale = buildLinearScale(d, n);
  } else if (colorScale === 'log') {
    const d = colorDomain || autoDomain(numericValues);
    scale = buildLogScale(d, n);
  } else if (colorScale === 'quantile') {
    scale = buildQuantileScale(numericValues, n);
  } else if (colorScale === 'diverging') {
    const d = colorDomain || (() => {
      const [mn, mx] = autoDomain(numericValues);
      return [mn, (mn + mx) / 2, mx];
    })();
    scale = buildDivergingScale(d, n);
  } else {
    throw new Error('unknown colorScale: ' + colorScale);
  }
  for (const node of nodes) {
    const v = +node.colorValue;
    node.colorIndex = Number.isFinite(v) ? scale(v) : 0;
  }
}

/* ---- src/balancer.js ---- */
// Balanced binary grouping of sized items, GP-style: always merge the two
// smallest remaining subtrees. Result is a binary tree whose leaves are the
// original items and whose internal nodes carry cumulative size.

// A tiny index-based min-heap keyed by `size` (ties broken by insertion order
// to keep the ordering deterministic for tests).
class MinHeap {
  constructor() { this.arr = []; this.counter = 0; }
  push(node) {
    const entry = { node, seq: this.counter++ };
    this.arr.push(entry);
    this._up(this.arr.length - 1);
  }
  pop() {
    const top = this.arr[0];
    const last = this.arr.pop();
    if (this.arr.length) { this.arr[0] = last; this._down(0); }
    return top ? top.node : null;
  }
  size() { return this.arr.length; }
  _lt(a, b) {
    if (a.node.size !== b.node.size) return a.node.size < b.node.size;
    return a.seq < b.seq;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._lt(this.arr[i], this.arr[p])) {
        [this.arr[i], this.arr[p]] = [this.arr[p], this.arr[i]];
        i = p;
      } else break;
    }
  }
  _down(i) {
    const n = this.arr.length;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let best = i;
      if (l < n && this._lt(this.arr[l], this.arr[best])) best = l;
      if (r < n && this._lt(this.arr[r], this.arr[best])) best = r;
      if (best === i) break;
      [this.arr[i], this.arr[best]] = [this.arr[best], this.arr[i]];
      i = best;
    }
  }
}

/**
 * @param {{id:string, size:number}[]} items
 * @returns {BalancerNode|null}
 */
function balanceChildren(items) {
  if (!items.length) return null;
  if (items.length === 1) {
    const it = items[0];
    return { id: it.id, size: it.size, isLeaf: true, left: null, right: null };
  }
  const heap = new MinHeap();
  for (const it of items) {
    heap.push({ id: it.id, size: it.size, isLeaf: true, left: null, right: null });
  }
  while (heap.size() > 1) {
    const a = heap.pop();
    const b = heap.pop();
    heap.push({
      id: null,
      size: a.size + b.size,
      isLeaf: false,
      // left = the smaller-or-equal one so child ordering is stable
      left: a, right: b,
    });
  }
  return heap.pop();
}

// Max depth of the balancer tree (for tests).
function maxDepth(node) {
  if (!node) return 0;
  if (node.isLeaf) return 1;
  return 1 + Math.max(maxDepth(node.left), maxDepth(node.right));
}

/* ---- src/layout.js ---- */
// Slice-and-dice layout on a pre-balanced binary tree.
//
// Each call assigns a rect to the subtree. Internal (balancer) nodes are split;
// the ratio is (left.size / node.size). We split along the longer axis.
// Visibility check: the rect must enclose at least one integer pixel
// center, i.e. floor(x + w + 0.5) - floor(x + 0.5) > 0. This matches
// GrandPerspective's TreeLayoutBuilder — we deliberately avoid any area-based
// cutoff because an area check applied to internal balancer nodes drops whole
// buckets of children and leaves uncovered (background-coloured) holes.

/**
 * @param {BalancerNode} root
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {(leafId:string, rect:{x,y,w,h}) => void} onLeaf
 * @param {number} [splitBias=1] — ratio > 1 biases toward vertical splits,
 *   < 1 toward horizontal. Used by stretch-zoom to preserve the original
 *   aspect ratio's split directions while laying out at full canvas size.
 *   The split criterion becomes `w > h * splitBias` instead of `w > h`.
 */
function layoutTree(root, rect, onLeaf, splitBias) {
  if (!root) return;
  if (!visible(rect)) return;
  if (root.isLeaf) {
    onLeaf(root.id, rect);
    return;
  }
  const ratio = root.size > 0 ? root.left.size / root.size : 0.5;
  let r1, r2;
  if (rect.w > rect.h * (splitBias || 1)) {
    const w1 = ratio * rect.w;
    r1 = { x: rect.x, y: rect.y, w: w1, h: rect.h };
    r2 = { x: rect.x + w1, y: rect.y, w: rect.w - w1, h: rect.h };
  } else {
    const h1 = ratio * rect.h;
    r1 = { x: rect.x, y: rect.y, w: rect.w, h: h1 };
    r2 = { x: rect.x, y: rect.y + h1, w: rect.w, h: rect.h - h1 };
  }
  layoutTree(root.left, r1, onLeaf, splitBias);
  layoutTree(root.right, r2, onLeaf, splitBias);
}

function visible(rect) {
  const dx = Math.floor(rect.x + rect.w + 0.5) - Math.floor(rect.x + 0.5);
  const dy = Math.floor(rect.y + rect.h + 0.5) - Math.floor(rect.y + 0.5);
  return dx > 0 && dy > 0;
}

/* ---- src/builder.js ---- */
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
function buildFromTabular(data, opts = {}) {
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
function buildFromTree(root, accessors, opts = {}) {
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

/* ---- src/lut.js ---- */
// Brightness-ramp lookup tables (LUTs) for treemap cell shading.
//
// A LUT is a 256-entry RGBA byte array:
//   * index 0    — darkest shade of the base color
//   * index 128  — approximately the base color itself
//   * index 255  — lightest shade of the base color
//
// Ramp construction:
//   Work in linear RGB (sRGB decoded to the 0..1 linear domain). Pick a dark
//   target T_dark = (0,0,0) and a light target T_light = (1,1,1). For the
//   bottom half, linearly interpolate from T_dark to the base color. For the
//   top half, linearly interpolate from the base color to T_light. Multiply
//   the span by `intensity` so that:
//      intensity = 0  → every entry equals the base color (flat LUT)
//      intensity = 1  → index 0 is black, index 255 is white
//   Finally re-encode each linear sample to sRGB and store as bytes.
//
// Working in linear RGB (instead of raw gamma-encoded sRGB) keeps the
// mid-tones from looking muddy when the intensity is high: the perceived
// brightness changes smoothly from one end of the ramp to the other.

const MID = 128;

/**
 * Build one LUT per palette entry.
 *
 * @param {string[]} palette   CSS `hsl(h, s%, l%)` color strings
 * @param {number}   intensity in [0,1]; 0 = flat, 1 = full black→white range
 * @returns {Uint8ClampedArray[]}
 */
function buildLUTs(palette, intensity) {
  const k = clamp01(intensity);
  const out = new Array(palette.length);
  for (let i = 0; i < palette.length; i++) {
    const rgb = parseCssColor(palette[i]) || [128, 128, 128];
    out[i] = buildRamp(rgb[0], rgb[1], rgb[2], k);
  }
  return out;
}

/**
 * Build a LUT from an arbitrary CSS color string. Falls back to medium gray
 * for anything we can't parse.
 *
 * @param {string} css
 * @param {number} intensity in [0,1]
 * @returns {Uint8ClampedArray}
 */
function buildLUTForCssColor(css, intensity) {
  const rgb = parseCssColor(css) || [128, 128, 128];
  return buildRamp(rgb[0], rgb[1], rgb[2], clamp01(intensity));
}

// ---------------------------------------------------------------------------
// LUT core
// ---------------------------------------------------------------------------

function buildRamp(r8, g8, b8, intensity) {
  const lut = new Uint8ClampedArray(256 * 4);

  // Convert base color to linear RGB once.
  const br = srgbToLinear(r8 / 255);
  const bg = srgbToLinear(g8 / 255);
  const bb = srgbToLinear(b8 / 255);

  for (let i = 0; i < 256; i++) {
    let lr, lg, lb;
    if (i <= MID) {
      // Dark half: index 0 → dark target (0); index 128 → base color.
      // t runs from 0 (at i=0) to 1 (at i=128).
      const t = i / MID;
      // Lerp a reduced-intensity dark target toward the base color.
      // We scale the travel by `intensity`: at intensity 0 we stay on base,
      // at intensity 1 we reach pure black at i=0.
      const mix = 1 - intensity * (1 - t);
      lr = br * mix;
      lg = bg * mix;
      lb = bb * mix;
    } else {
      // Light half: index 128 → base, index 255 → light target (1).
      // t runs from 0 (at i=128) to 1 (at i=255).
      const t = (i - MID) / (255 - MID);
      const s = intensity * t;
      lr = br + (1 - br) * s;
      lg = bg + (1 - bg) * s;
      lb = bb + (1 - bb) * s;
    }
    const off = i * 4;
    lut[off]     = Math.round(linearToSrgb(lr) * 255);
    lut[off + 1] = Math.round(linearToSrgb(lg) * 255);
    lut[off + 2] = Math.round(linearToSrgb(lb) * 255);
    lut[off + 3] = 255;
  }
  return lut;
}

// ---------------------------------------------------------------------------
// sRGB <-> linear
// ---------------------------------------------------------------------------

function srgbToLinear(c) {
  // c is in [0,1]. Standard sRGB EOTF.
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ---------------------------------------------------------------------------
// CSS color parsing (a tiny self-contained parser; no regex backrefs needed)
// ---------------------------------------------------------------------------

/**
 * Parse a CSS color string into an [r, g, b] triple of 0..255 integers.
 * Returns null if the input isn't recognized. Accepts:
 *   hsl(h, s%, l%)
 *   rgb(r, g, b)
 *   #rgb  or  #rrggbb
 */
function parseCssColor(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();

  if (s.charAt(0) === '#') return parseHex(s);

  const lower = s.toLowerCase();
  if (lower.startsWith('hsl')) return parseFnHsl(s);
  if (lower.startsWith('rgb')) return parseFnRgb(s);
  return null;
}

function parseHex(s) {
  const hex = s.slice(1);
  if (hex.length === 3) {
    const r = hexByte(hex[0] + hex[0]);
    const g = hexByte(hex[1] + hex[1]);
    const b = hexByte(hex[2] + hex[2]);
    if (r < 0 || g < 0 || b < 0) return null;
    return [r, g, b];
  }
  if (hex.length === 6) {
    const r = hexByte(hex.slice(0, 2));
    const g = hexByte(hex.slice(2, 4));
    const b = hexByte(hex.slice(4, 6));
    if (r < 0 || g < 0 || b < 0) return null;
    return [r, g, b];
  }
  return null;
}

function hexByte(pair) {
  const v = parseInt(pair, 16);
  return Number.isFinite(v) && /^[0-9a-fA-F]{2}$/.test(pair) ? v : -1;
}

function parseFnRgb(s) {
  const args = extractArgs(s);
  if (!args || args.length < 3) return null;
  const r = parseByte(args[0]);
  const g = parseByte(args[1]);
  const b = parseByte(args[2]);
  if (r == null || g == null || b == null) return null;
  return [r, g, b];
}

function parseFnHsl(s) {
  const args = extractArgs(s);
  if (!args || args.length < 3) return null;
  const h = parseFloat(args[0]);
  const ss = parsePercent(args[1]);
  const ll = parsePercent(args[2]);
  if (!isFinite(h) || ss == null || ll == null) return null;
  return hslToRgb(((h % 360) + 360) % 360 / 360, ss, ll);
}

function extractArgs(s) {
  const open = s.indexOf('(');
  const close = s.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  return s.slice(open + 1, close).split(',').map((t) => t.trim());
}

function parseByte(token) {
  if (token.endsWith('%')) {
    const p = parseFloat(token);
    if (!isFinite(p)) return null;
    return Math.round(clamp01(p / 100) * 255);
  }
  const v = parseFloat(token);
  if (!isFinite(v)) return null;
  return Math.max(0, Math.min(255, Math.round(v)));
}

function parsePercent(token) {
  const v = parseFloat(token);
  if (!isFinite(v)) return null;
  return clamp01(v / 100);
}

/**
 * HSL (each channel in [0,1]) → RGB (each in 0..255 ints).
 * Classic piecewise formula.
 */
function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueSlice(p, q, h + 1 / 3) * 255),
    Math.round(hueSlice(p, q, h) * 255),
    Math.round(hueSlice(p, q, h - 1 / 3) * 255),
  ];
}

function hueSlice(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/* ---- src/painter.js ---- */
// Pixel-level "raised tile" renderer for treemap cells.
//
// Each cell is split along its TL→BR diagonal into two triangular halves:
//
//     .----------------.
//     |\     upper    .|
//     | \    right   . |
//     |  \          .  |
//     |   \        .   |
//     |    \      .    |  diagonal from (0,0) to (w-1,h-1)
//     |     \    .     |
//     |      \  .      |
//     |  lower\.       |
//     |  left  \       |
//     '----------------'
//
// For a pixel at (i,j) inside a cell of size (w,h), the side is chosen by
// comparing the two normalized coordinates i/w and j/h:
//   * i/w  >  j/h   →  upper-right triangle; brightness comes from i (horizontal)
//   * i/w  <= j/h   →  lower-left  triangle; brightness comes from j (vertical)
// The leftmost column (i=0) and the topmost row (j=0) both map to the
// brightest LUT entry (255); the rightmost column and bottom row map to the
// darkest (0). The two triangles meet along the diagonal at a matching index,
// which yields a crisp seam from top-left to bottom-right.
//
// The LUT is an RGBA byte table with 256 entries, so we read 4 bytes per
// pixel from it and copy them straight into the destination buffer.

/**
 * Paint a single cell into the ImageData backing buffer.
 *
 * @param {Uint8ClampedArray} data   destination RGBA buffer
 * @param {number} stride            pixels per row in `data`
 * @param {number} x,y,w,h           integer rect (already clipped to buffer)
 * @param {Uint8ClampedArray} lut    256 RGBA entries (1024 bytes)
 */
function paintCell(data, stride, x, y, w, h, lut) {
  if (w <= 0 || h <= 0) return;

  // Precompute the scale factors that map an in-cell coordinate in [0, w-1]
  // or [0, h-1] to a LUT index in [0, 255]. We want:
  //    i = 0     -> 255  (brightest)
  //    i = w-1   -> 0    (darkest)
  // which is   idx = 255 * (w - 1 - i) / (w - 1).
  // For w = 1 the single column uses the mid-LUT (index 128) so a 1-pixel
  // cell looks like the base color rather than pure bright or pure dark.
  const xScale = w > 1 ? 255 / (w - 1) : 0;
  const yScale = h > 1 ? 255 / (h - 1) : 0;
  const xMid = w > 1 ? 0 : 128;  // offset added when w == 1
  const yMid = h > 1 ? 0 : 128;

  // Hoist as much as possible out of the inner loop.
  const rowStride = stride * 4;
  let rowBase = (y * stride + x) * 4;

  for (let j = 0; j < h; j++) {
    // Normalized vertical position in [0,1].
    const jNorm = h > 1 ? j / (h - 1) : 0;
    const jIdx = h > 1 ? ((h - 1 - j) * yScale + 0.5) | 0 : yMid;

    let p = rowBase;
    for (let i = 0; i < w; i++) {
      const iNorm = w > 1 ? i / (w - 1) : 0;
      let idx;
      if (iNorm > jNorm) {
        // Upper-right triangle: brightness depends on horizontal position.
        idx = w > 1 ? ((w - 1 - i) * xScale + 0.5) | 0 : xMid;
      } else {
        // Lower-left triangle (includes the diagonal).
        idx = jIdx;
      }
      const lp = idx << 2;  // idx * 4
      data[p]     = lut[lp];
      data[p + 1] = lut[lp + 1];
      data[p + 2] = lut[lp + 2];
      data[p + 3] = lut[lp + 3];
      p += 4;
    }
    rowBase += rowStride;
  }
}

/**
 * Fill the background then paint every cell.
 *
 * @param {ImageData} image
 * @param {Array<{x:number,y:number,w:number,h:number,lutIndex:number}>} cells
 * @param {Uint8ClampedArray[]} luts
 * @param {{r:number,g:number,b:number}} background
 */
function paintAll(image, cells, luts, background) {
  const data = image.data;
  const width = image.width;
  const height = image.height;

  const bg = background || { r: 0, g: 0, b: 0 };
  const br = bg.r | 0, bg2 = bg.g | 0, bb = bg.b | 0;

  // Paint the background. Unrolled to copy a 4-pixel "pattern" into the
  // remainder of the buffer via Uint8ClampedArray.set — this is much faster
  // than a plain byte-by-byte loop on large canvases.
  const seed = 16; // bytes = 4 pixels
  for (let p = 0; p < seed && p < data.length; p += 4) {
    data[p]     = br;
    data[p + 1] = bg2;
    data[p + 2] = bb;
    data[p + 3] = 255;
  }
  let filled = Math.min(seed, data.length);
  while (filled < data.length) {
    const chunk = Math.min(filled, data.length - filled);
    data.copyWithin(filled, 0, chunk);
    filled += chunk;
  }

  // Paint every cell. Cell rects may be fractional; we snap edges to integer
  // pixel boundaries using round(edge) so adjacent cells meet exactly.
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k];
    const x0 = Math.round(c.x);
    const y0 = Math.round(c.y);
    const x1 = Math.round(c.x + c.w);
    const y1 = Math.round(c.y + c.h);
    const rx = x0 < 0 ? 0 : x0;
    const ry = y0 < 0 ? 0 : y0;
    const rxEnd = x1 > width  ? width  : x1;
    const ryEnd = y1 > height ? height : y1;
    const rw = rxEnd - rx;
    const rh = ryEnd - ry;
    if (rw <= 0 || rh <= 0) continue;
    paintCell(data, width, rx, ry, rw, rh, luts[c.lutIndex]);
  }
}

/* ---- src/format.js ---- */
// Small d3-format-ish subset sufficient for valueFormat: we handle `,d`,
// SI suffixes (`.2s`), percent (`.1%`), fixed (`.2f`) and bytes (`b`).
function applyFormat(value, fmt) {
  if (!fmt) return String(value);
  // Custom 'b' for bytes.
  if (fmt === 'b' || fmt === 'bytes') return humanBytes(value);
  // ,d
  if (fmt === ',d') return Number(value).toLocaleString();
  const m = /^\.(\d+)([sfp%])$/.exec(fmt);
  if (m) {
    const p = +m[1], kind = m[2];
    if (kind === 'f') return Number(value).toFixed(p);
    if (kind === '%') return (Number(value) * 100).toFixed(p) + '%';
    if (kind === 'p') return (Number(value) * 100).toFixed(p) + '%';
    if (kind === 's') return siPrefix(value, p);
  }
  return String(value);
}

function humanBytes(v) {
  const abs = Math.abs(v);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let n = abs;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  const s = (v < 0 ? '-' : '') + (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
  return s + ' ' + units[i];
}

function siPrefix(v, p) {
  const abs = Math.abs(v);
  const units = ['', 'k', 'M', 'G', 'T', 'P'];
  let i = 0;
  let n = abs;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  const s = (v < 0 ? '-' : '') + n.toFixed(p);
  return s + units[i];
}

/* ---- src/render-worker.js ---- */
// Worker entry. Bundled by tools/build.js as a string constant that
// the main bundle turns into a Blob-URL Worker at runtime. Lives in
// its own bundle (no DOM, no <gp-treemap> element) — just the pure
// computation modules (balancer, layout, builder, color-resolver,
// color-scale, lut, painter, hash, palettes, format).
//
// Phase A.0: scaffolding only. Responds to a `ping` message so the
// main thread can confirm the worker boots. Subsequent phases move
// paint → layout → tree-build → block-inflation in here.

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'ping': {
      // Bounce back so the main thread can verify the worker bundle
      // is wired up correctly. Includes the count of exported symbols
      // we expect to be available — a smoke check that the painter +
      // layout modules made it into the worker bundle.
      const symbols = [
        typeof balanceChildren, typeof layoutTree, typeof buildFromTabular,
        typeof resolveColors, typeof buildLUTs, typeof paintAll,
        typeof fnv1a, typeof resolvePalette,
      ];
      self.postMessage({
        type: 'pong',
        id: msg.id,
        symbolsAvailable: symbols.every((t) => t === 'function'),
      });
      return;
    }
    default:
      self.postMessage({ type: 'error', id: msg.id, error: 'unknown message type: ' + msg.type });
  }
};

})();