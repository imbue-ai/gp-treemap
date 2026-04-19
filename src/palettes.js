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

export function resolvePalette(spec) {
  if (!spec) return PALETTES['gp-default'];
  if (typeof spec === 'string') return PALETTES[spec] || PALETTES['gp-default'];
  if (Array.isArray(spec.colors) && spec.colors.length >= 2) return spec.colors;
  if (spec.name && PALETTES[spec.name]) return PALETTES[spec.name];
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
