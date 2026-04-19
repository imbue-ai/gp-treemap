import { fnv1a } from './hash.js';
import {
  buildLinearScale,
  buildLogScale,
  buildDivergingScale,
  buildQuantileScale,
  autoDomain,
} from './color-scale.js';

/**
 * Assigns `colorIndex` (and an optional `colorOverride` CSS color) to every
 * rendered node.
 *
 * @param {TreeNode[]} nodes flat array
 * @param {string} mode 'categorical' | 'quantitative' | 'depth'
 * @param {Object} opts
 */
export function resolveColors(nodes, mode, opts = {}) {
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
