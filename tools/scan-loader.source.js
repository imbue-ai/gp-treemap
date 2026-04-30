// Browser-side IIFE shared by all `gpdu-*` CLIs. Inlined into each tool's
// generated HTML via `dist/scan-loader.embed.js` (built by tools/build.js).
//
// Each tool sets `window._gpduConfig` *before* this script runs:
//
//   window._gpduConfig = {
//     defaultColorMode: 'extension',          // initial mode
//     categoricalModes: ['extension', ...],   // which modes are categorical
//     quantitativeModes: ['ctime', ...],      // which modes are quantitative
//     catColorMaps: { kind: {imageM: '#...'}, ... },  // optional per-mode color overrides
//     defaultTheme: 'tokyo-night',
//     themes: { 'tokyo-night': { label, dark, bg, surface, border, fg, fgMuted, accent }, ... },
//     palettePicks: { viridis: 'Viridis', ... },
//     catPaletteDefault: 'tokyo-night',
//     qPaletteDefault:   'viridis',
//   };
//
// Then includes #color-sel / #theme-sel / #palette-sel selects, a #help-btn
// + #help-modal, an empty #stats-bar (the tool's own page-script populates
// the stats bar in a window._bootReady.then handler), and the <gp-treemap>
// element with id="tm".
//
// The loader exposes:
//   window._store          — Map<globalId, { label, value, parentId, childIds,
//                                            <attribute keys>, stubBlockId?, stubAggregates? }>
//   window._rootId         — global id of the tree root
//   window._bootReady      — Promise resolved once block 0 is loaded
//   window._allBlocksReady — Promise resolved once every block is inflated
//   window._currentColorMode
//   window._currentPalette
//   window._applyColorBy(mode)  — switch color mode (cat-vs-quant inferred from config)
//
// Per-tool stats-bar logic, help modal contents, and any extra page chrome
// live in the tool's own emitted HTML, not here.

(function () {
  var cfg = window._gpduConfig || {};
  var categoricalModes = cfg.categoricalModes || [];
  var quantitativeModes = cfg.quantitativeModes || [];
  var catColorMaps = cfg.catColorMaps || {};
  var themes = cfg.themes || {};
  var DEFAULT_THEME = cfg.defaultTheme || '';
  var DEFAULT_COLOR = cfg.defaultColorMode || (categoricalModes[0] || quantitativeModes[0] || '');
  var DEFAULT_PALETTE = '';
  var CAT_PALETTE_DEFAULT = cfg.catPaletteDefault || 'tokyo-night';
  var Q_PALETTE_DEFAULT = cfg.qPaletteDefault || 'viridis';

  var raw = JSON.parse(document.getElementById('tmdata').textContent);
  var envelope = raw;
  var tm = document.getElementById('tm');

  // --- Decode helpers ---
  function _buf(b64) {
    var s = atob(b64), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  }
  function decodeCat(names, b64) {
    var ci = new Uint16Array(_buf(b64));
    var a = new Array(ci.length);
    for (var i = 0; i < ci.length; i++) a[i] = names[ci[i]];
    return a;
  }
  function decodeNum(b64) {
    return new Float64Array(_buf(b64));
  }

  // --- Node store ---
  // id -> {
  //   label, value, parentId, childIds,
  //   <one entry per attribute>,
  //   stubBlockId?, stubAggregates? (object keyed by stubField name)
  // }
  var store = new Map();
  var currentColorMode = DEFAULT_COLOR;
  var currentTheme = DEFAULT_THEME;
  var currentPalette = DEFAULT_PALETTE;

  // Decode a block (already-parsed JSON object) and add its nodes to the store.
  function loadBlock(blk) {
    var m = blk.labels.length;
    var pi = new Int32Array(_buf(blk.piB64));
    var gr = new Int32Array(_buf(blk.grB64));

    // Decode each attribute the encoder produced.
    var attrs = blk.attributes || {};
    var decodedAttrs = {};
    for (var name in attrs) {
      var a = attrs[name];
      if (a.kind === 'categorical') {
        decodedAttrs[name] = decodeCat(a.names, a.b64);
      } else {
        decodedAttrs[name] = decodeNum(a.b64);
      }
    }

    // Build childIds per node (local).
    var localChildren = new Array(m);
    for (var i = 0; i < m; i++) localChildren[i] = null;
    for (var j = 1; j < m; j++) {
      var p = pi[j];
      if (p >= 0) {
        if (!localChildren[p]) localChildren[p] = [];
        localChildren[p].push(j);
      }
    }

    // Stubs: array of [localRow, childBlockId, ...stubFieldValues].
    var stubFieldNames = blk.stubFieldNames || [];
    var stubMap = new Map();
    if (blk.stubs) {
      for (var si = 0; si < blk.stubs.length; si++) {
        var s = blk.stubs[si];
        stubMap.set(s[0], s);
      }
    }

    for (var k = 0; k < m; k++) {
      var gid = gr[k];
      if (store.has(gid)) {
        // Node already exists (it's a stub from a parent block) — update it
        // with real children from this block.
        var existing = store.get(gid);
        if (localChildren[k]) {
          existing.childIds = localChildren[k].map(function (li) { return gr[li]; });
        }
        continue;
      }
      var gp = null;
      if (pi[k] >= 0) gp = gr[pi[k]];
      var nd = {
        label: blk.labels[k],
        value: blk.values[k],
        parentId: gp,
        childIds: localChildren[k] ? localChildren[k].map(function (li) { return gr[li]; }) : null,
      };
      for (var an in decodedAttrs) nd[an] = decodedAttrs[an][k];
      var stubInfo = stubMap.get(k);
      if (stubInfo) {
        nd.stubBlockId = stubInfo[1];
        nd.stubAggregates = {};
        for (var sf = 0; sf < stubFieldNames.length; sf++) {
          // stubInfo layout: [localRow, childBlockId, ...stubFieldValues]
          nd.stubAggregates[stubFieldNames[sf]] = stubInfo[2 + sf];
        }
      }
      store.set(gid, nd);
    }
  }

  // Inflate one compressed block.
  function inflateBlock(blockId) {
    var b64 = envelope.blocks[blockId];
    if (!b64) return Promise.resolve();
    var bytes = new Uint8Array(atob(b64).split('').map(function (c) { return c.charCodeAt(0); }));
    var ds = new DecompressionStream('deflate-raw');
    var writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(ds.readable).text().then(function (text) {
      loadBlock(JSON.parse(text));
      envelope.blocks[blockId] = null;
    });
  }

  // After block-0 renders, inflate all remaining blocks in parallel and
  // re-render once. Two renders total: skeletal first, complete second.
  var allBlocksReady = null;
  function inflateAllBlocks() {
    if (allBlocksReady) return allBlocksReady;
    var promises = [];
    for (var i = 1; i < envelope.blocks.length; i++) {
      if (envelope.blocks[i]) promises.push(inflateBlock(i));
    }
    allBlocksReady = Promise.all(promises).then(function () {
      if (tm._tree) tm._tree._lazy = true;
      tm._queueRender();
    });
    return allBlocksReady;
  }

  // --- <gp-treemap> accessor functions ---
  function getChildren(id) {
    var nd = store.get(id);
    if (!nd) return null;
    if (nd.stubBlockId != null && nd.childIds === null) return null;
    if (!nd.childIds) return [];
    return nd.childIds;
  }
  function getValue(id) { var nd = store.get(id); return nd ? nd.value : 0; }
  function getLabel(id) { var nd = store.get(id); return nd ? nd.label : ''; }
  function getId(id) { return id; }
  function getColor(id) {
    var nd = store.get(id);
    if (!nd) return '';
    return nd[currentColorMode];
  }

  // --- Boot: inflate block 0, wire accessors, kick a render ---
  function inflateBlock0(b64) {
    var bytes = new Uint8Array(atob(b64).split('').map(function (c) { return c.charCodeAt(0); }));
    var ds = new DecompressionStream('deflate-raw');
    var writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(ds.readable).text().then(function (text) {
      return JSON.parse(text);
    });
  }
  var block0Promise = envelope.block0
    ? Promise.resolve(envelope.block0)
    : inflateBlock0(envelope.blocks[0]);

  var bootReady = block0Promise.then(function (block0) {
    loadBlock(block0);
    envelope.blocks[0] = null;
    var rootId = new Int32Array(_buf(block0.grB64))[0];
    tm.root = rootId;
    window._rootId = rootId;
    tm.getId = getId;
    tm.getChildren = getChildren;
    tm.getValue = getValue;
    tm.getLabel = getLabel;
    tm.getColor = getColor;

    var isCat = categoricalModes.indexOf(currentColorMode) >= 0;
    tm.setAttribute('color-mode', isCat ? 'categorical' : 'quantitative');

    window._store = store;
    window._currentColorMode = currentColorMode;

    window._applyColorBy = function (mode) {
      currentColorMode = mode;
      window._currentColorMode = mode;
      var cat = categoricalModes.indexOf(mode) >= 0;
      var newMap = cat ? (catColorMaps[mode] || {}) : {};
      tm._props._userColorMap = newMap;
      tm.colorMap = tm.getAttribute('theme') ? {} : newMap;
      var paletteOverride = window._currentPalette || '';
      if (cat) {
        tm.setAttribute('color-mode', 'categorical');
        var catPal = paletteOverride || CAT_PALETTE_DEFAULT;
        tm._props._userPalette = catPal;
        if (!tm.getAttribute('theme')) tm.setAttribute('palette', catPal);
        tm.colorDomain = undefined;
      } else {
        tm.setAttribute('color-mode', 'quantitative');
        var qPal = paletteOverride || Q_PALETTE_DEFAULT;
        tm._props._userPalette = qPal;
        tm.setAttribute('palette', qPal);
        var lo = Infinity, hi = -Infinity;
        store.forEach(function (nd) {
          var v = nd[mode];
          if (typeof v === 'number' && v > 0) { if (v < lo) lo = v; if (v > hi) hi = v; }
        });
        tm.colorDomain = lo !== Infinity ? [lo, hi] : undefined;
      }
      tm._queueRender();
    };

    if (cfg.valueFormatter) tm.valueFormatter = cfg.valueFormatter;

    // After block-0's render is queued, inflate everything else.
    requestAnimationFrame(function () { inflateAllBlocks(); });
  });

  window._bootReady = bootReady;
  window._allBlocksReady = bootReady.then(function () { return inflateAllBlocks(); });

  // --- Theme / palette / color-by switcher + URL hash sync ---
  bootReady.then(function () {
    var themeSel = document.getElementById('theme-sel');
    var paletteSel = document.getElementById('palette-sel');
    var colorSel = document.getElementById('color-sel');
    var htmlRoot = document.documentElement;

    function applyPageTheme(name) {
      currentTheme = name || '';
      var t = name ? themes[name] : null;
      if (t) {
        htmlRoot.style.setProperty('--page-bg', t.bg);
        htmlRoot.style.setProperty('--page-surface', t.surface);
        htmlRoot.style.setProperty('--page-border', t.border);
        htmlRoot.style.setProperty('--page-fg', t.fg);
        htmlRoot.style.setProperty('--page-fg-muted', t.fgMuted);
        htmlRoot.style.setProperty('--page-accent', t.accent);
      } else {
        ['--page-bg', '--page-surface', '--page-border', '--page-fg', '--page-fg-muted', '--page-accent']
          .forEach(function (v) { htmlRoot.style.removeProperty(v); });
      }
      tm.setAttribute('theme', name || '');
      applyPalette(currentPalette);
      if (themeSel) themeSel.value = currentTheme;
    }
    function applyPalette(name) {
      currentPalette = name || '';
      window._currentPalette = currentPalette;
      var effective = name || currentTheme || 'gp-default';
      tm._props._userPalette = effective;
      tm.setAttribute('palette', effective);
      tm._props.palette = effective;
      tm._queueRender();
      if (paletteSel) paletteSel.value = currentPalette;
    }
    function applyColor(mode) {
      var m = mode || DEFAULT_COLOR;
      window._applyColorBy(m);
      if (colorSel) colorSel.value = m;
      if (currentPalette) applyPalette(currentPalette);
    }
    if (themeSel) themeSel.addEventListener('change', function () { applyPageTheme(themeSel.value); writeHash(); });
    if (paletteSel) paletteSel.addEventListener('change', function () { applyPalette(paletteSel.value); writeHash(); });
    if (colorSel) colorSel.addEventListener('change', function () { applyColor(colorSel.value); writeHash(); });

    // Help modal: open on ?-button, close on backdrop click / ESC / × button.
    var helpBtn = document.getElementById('help-btn');
    var helpModal = document.getElementById('help-modal');
    if (helpBtn && helpModal) {
      helpBtn.addEventListener('click', function () { helpModal.classList.add('open'); });
      helpModal.addEventListener('click', function (e) {
        if (e.target === helpModal || e.target.classList.contains('close')) helpModal.classList.remove('open');
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') helpModal.classList.remove('open');
      });
    }

    // Convert integer node IDs to/from human-readable label paths for the URL hash.
    function idToPath(id) {
      if (id == null) return undefined;
      var rootId = window._rootId;
      var nd = store.get(id);
      if (!nd) return undefined;
      if (id === rootId) return [];
      var parts = [];
      var cur = nd;
      while (cur && cur.parentId != null) {
        parts.unshift(cur.label);
        cur = store.get(cur.parentId);
      }
      return parts;
    }
    function pathToId(path) {
      if (path == null || !Array.isArray(path)) return undefined;
      var rootId = window._rootId;
      if (path.length === 0) return rootId;
      var cur = rootId;
      for (var i = 0; i < path.length; i++) {
        var nd = store.get(cur);
        if (!nd || !nd.childIds) return undefined;
        var found = null;
        for (var j = 0; j < nd.childIds.length; j++) {
          var child = store.get(nd.childIds[j]);
          if (child && child.label === path[i]) { found = nd.childIds[j]; break; }
        }
        if (found == null) return undefined;
        cur = found;
      }
      return cur;
    }
    function readHash() {
      try {
        if (location.hash.length <= 1) return;
        var raw = location.hash.slice(1);
        if (!(raw.charAt(0) === 's' && raw.charAt(1) === '=')) return;
        var obj = JSON.parse(decodeURIComponent(raw.slice(2)));
        applyPageTheme('theme' in obj ? (obj.theme || '') : DEFAULT_THEME);
        applyPalette('palette' in obj ? (obj.palette || '') : '');
        applyColor(obj.color || DEFAULT_COLOR);
        var v = obj.viewer || {};
        applyViewer(v);
        if (window._allBlocksReady) {
          window._allBlocksReady.then(function () { applyViewer(v); });
        }
      } catch (_) {}
    }
    function applyViewer(v) {
      tm.viewerState = {
        zoom: 'zoom' in v ? pathToId(v.zoom) : undefined,
        zoomPath: Array.isArray(v.zoomPath)
          ? v.zoomPath.map(function (p) { return pathToId(p); }).filter(function (id) { return id != null; })
          : undefined,
        depth: v.depth === 'Infinity' ? Infinity : (v.depth != null ? Number(v.depth) : undefined),
        target: 'target' in v ? pathToId(v.target) : undefined,
        focus: 'focus' in v ? pathToId(v.focus) : undefined,
        showLabels: 'showLabels' in v ? !!v.showLabels : undefined,
      };
    }
    function writeHash() {
      try {
        var v = tm.viewerState || {};
        var vOut = {};
        if (v.zoom != null) vOut.zoom = idToPath(v.zoom);
        if (v.zoomPath) vOut.zoomPath = v.zoomPath.map(idToPath).filter(function (p) { return p != null; });
        if (v.target != null) vOut.target = idToPath(v.target);
        if (v.focus != null) vOut.focus = idToPath(v.focus);
        if (v.depth != null) vOut.depth = v.depth === Infinity ? 'Infinity' : v.depth;
        if ('showLabels' in v) vOut.showLabels = v.showLabels;

        var out = {};
        if (currentColor() !== DEFAULT_COLOR) out.color = currentColor();
        if (currentTheme !== DEFAULT_THEME) out.theme = currentTheme;
        if (currentPalette !== DEFAULT_PALETTE) out.palette = currentPalette;
        if (Object.keys(vOut).length) out.viewer = vOut;
        var s = Object.keys(out).length ? 's=' + encodeURIComponent(JSON.stringify(out)) : '';
        history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
      } catch (_) {}
    }
    function currentColor() { return window._currentColorMode || DEFAULT_COLOR; }

    if (colorSel) colorSel.value = DEFAULT_COLOR;
    readHash();
    if (location.hash.length <= 1) {
      applyPageTheme(DEFAULT_THEME);
      applyColor(DEFAULT_COLOR);
    }
    if (location.hash.length > 1) tm._queueRender();
    tm.addEventListener('gp-zoom-change', writeHash);
    tm.addEventListener('gp-depth-change', writeHash);
    tm.addEventListener('gp-target', writeHash);
    tm.addEventListener('gp-focus', writeHash);

    // Expose for tool-side hooks.
    window._applyPageTheme = applyPageTheme;
    window._applyPalette = applyPalette;
    window._applyColor = applyColor;
    window._writeHash = writeHash;
  });
})();
