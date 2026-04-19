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
export function buildLUTs(palette, intensity) {
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
export function buildLUTForCssColor(css, intensity) {
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
