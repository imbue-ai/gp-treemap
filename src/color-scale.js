// Scale builders. Each returns (value) => integer palette index.

export function buildLinearScale(domain, paletteLen) {
  const [min, max] = domain;
  const n = paletteLen;
  if (max === min) return () => 0;
  return (v) => {
    const t = (v - min) / (max - min);
    const clamped = Math.max(0, Math.min(1, t));
    return Math.min(n - 1, Math.floor(clamped * n));
  };
}

export function buildLogScale(domain, paletteLen) {
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
export function buildDivergingScale(domain, paletteLen) {
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

export function buildQuantileScale(values, paletteLen) {
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

export function autoDomain(values) {
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
