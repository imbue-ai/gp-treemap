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
    case 'paint': {
      // Inputs:
      //   width, height: canvas pixels.
      //   cells:        Array<{x, y, w, h, lutIndex}> — already-laid-out leaves.
      //   luts:         Array<Uint8ClampedArray> — one 256×4 ramp per LUT slot.
      //   background:   {r, g, b} (0..255) — fill colour for uncovered pixels.
      // Output:
      //   imageData: ImageData (transferable via its data.buffer).
      try {
        const image = new ImageData(msg.width, msg.height);
        paintAll(image, msg.cells, msg.luts, msg.background);
        self.postMessage(
          { type: 'painted', id: msg.id, imageData: image },
          [image.data.buffer],
        );
      } catch (err) {
        self.postMessage({ type: 'error', id: msg.id, error: String(err && err.message || err) });
      }
      return;
    }
    default:
      self.postMessage({ type: 'error', id: msg.id, error: 'unknown message type: ' + msg.type });
  }
};
