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
export function paintCell(data, stride, x, y, w, h, lut) {
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
export function paintAll(image, cells, luts, background) {
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
