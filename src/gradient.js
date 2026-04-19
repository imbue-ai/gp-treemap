// Per-palette SVG <linearGradient> generator. Produces ids like `gp-grad-<n>-<intensity>`.
import { parseHsl, toHsl } from './palettes.js';

export function gradientIdFor(paletteIndex, intensity) {
  const k = Math.round(intensity * 100);
  return `gp-grad-${paletteIndex}-${k}`;
}

/**
 * Build a <defs> SVG fragment string for a palette.
 * gradientIntensity=0 → flat (all stops equal base); 1 → maximum contrast (±35% L).
 */
export function buildGradientDefs(palette, intensity) {
  const clampIntensity = Math.max(0, Math.min(1, intensity));
  const delta = clampIntensity * 35;
  const out = [];
  for (let i = 0; i < palette.length; i++) {
    const base = parseHsl(palette[i]);
    const lighter = toHsl({ h: base.h, s: base.s, l: base.l + delta });
    const darker = toHsl({ h: base.h, s: base.s, l: base.l - delta });
    const id = gradientIdFor(i, clampIntensity);
    out.push(
      `<linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%" gradientUnits="objectBoundingBox">` +
      `<stop offset="0%" stop-color="${lighter}"/>` +
      `<stop offset="50%" stop-color="${palette[i]}"/>` +
      `<stop offset="100%" stop-color="${darker}"/>` +
      `</linearGradient>`
    );
  }
  return out.join('');
}
