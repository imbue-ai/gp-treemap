// Built-in palettes. All stored as hsl(h,s%,l%) strings so the gradient generator
// can nudge l up/down to produce lighter/darker stops without parsing RGB.
export const PALETTES = {
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

export const THEMES = {
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

export function resolvePalette(spec) {
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
export function parseHsl(str) {
  const m = /hsl\(\s*([\-\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i.exec(str);
  if (!m) return { h: 0, s: 0, l: 50, raw: str };
  return { h: +m[1], s: +m[2], l: +m[3] };
}

export function toHsl({ h, s, l }) {
  const clampPct = (v) => Math.max(0, Math.min(100, v));
  return `hsl(${h}, ${clampPct(s)}%, ${clampPct(l)}%)`;
}
