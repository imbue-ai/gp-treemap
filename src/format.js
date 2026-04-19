// Small d3-format-ish subset sufficient for valueFormat: we handle `,d`,
// SI suffixes (`.2s`), percent (`.1%`), fixed (`.2f`) and bytes (`b`).
export function applyFormat(value, fmt) {
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
