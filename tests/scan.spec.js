// Exercises tools/scan.js on a synthetic directory tree, loads the generated
// HTML over file:// (the primary way a user will open it), and snapshots the
// result to tests/screenshots/.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';

// Parse the embedded data out of a scan HTML file. Returns { labels, parentIndices, values, color }.
// Handles v2 (block0 inline) and v3 (all blocks compressed) formats.
function parseScanHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script type="application\/json" id="tmdata">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('tmdata script tag not found');
  const envelope = JSON.parse(m[1]);
  let raw;
  if (envelope.v >= 3) {
    // v3: all blocks compressed. Decompress block 0.
    const compressed = Buffer.from(envelope.blocks[0], 'base64');
    raw = JSON.parse(zlib.inflateRawSync(compressed).toString());
  } else if (envelope.v === 2) {
    raw = envelope.block0;
  } else {
    raw = envelope;
  }
  const piBuf = Buffer.from(raw.piB64, 'base64');
  const parentIndices = Array.from(new Int32Array(piBuf.buffer, piBuf.byteOffset, piBuf.byteLength / 4));
  const cBuf = Buffer.from(raw.extB64, 'base64');
  const colorIdx = new Uint16Array(cBuf.buffer, cBuf.byteOffset, cBuf.byteLength / 2);
  const color = Array.from(colorIdx).map(i => raw.extNames[i]);
  return { labels: raw.labels, values: raw.values, parentIndices, color };
}

function runScan(srcDir, outFile) {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'scan.js'), '--no-open', srcDir, outFile], {
    encoding: 'utf8', timeout: 30000,
  });
  return res;
}

test('scan produces correct tree structure for a known directory', () => {
  // Create hermetic fixture:
  //   <tmp>/
  //     a.txt          100 B   → doc
  //     b.js           200 B   → code
  //     subA/
  //       c.png        300 B   → image
  //       d.mp3        400 B   → audio
  //     subB/
  //       nested/
  //         e.zip      500 B   → archive
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'treemap-fixture-'));
  const out = path.join(os.tmpdir(), 'treemap-fixture-out.html');
  try {
    fs.writeFileSync(path.join(tmp, 'a.txt'), Buffer.alloc(100));
    fs.writeFileSync(path.join(tmp, 'b.js'),  Buffer.alloc(200));
    fs.mkdirSync(path.join(tmp, 'subA'));
    fs.writeFileSync(path.join(tmp, 'subA', 'c.png'), Buffer.alloc(300));
    fs.writeFileSync(path.join(tmp, 'subA', 'd.mp3'), Buffer.alloc(400));
    fs.mkdirSync(path.join(tmp, 'subB'));
    fs.mkdirSync(path.join(tmp, 'subB', 'nested'));
    fs.writeFileSync(path.join(tmp, 'subB', 'nested', 'e.zip'), Buffer.alloc(500));

    const res = runScan(tmp, out);
    expect(res.status, res.stderr).toBe(0);

    const { labels, values, parentIndices, color } = parseScanHtml(out);

    // --- counts ---
    const dirRows  = labels.map((_, i) => i).filter(i => color[i] === 'dir');
    const fileRows = labels.map((_, i) => i).filter(i => color[i] !== 'dir');
    expect(dirRows.length).toBe(4);   // root + subA + subB + nested
    expect(fileRows.length).toBe(5);  // a b c d e

    // --- root ---
    const rootRow = parentIndices.indexOf(-1);
    expect(rootRow).toBe(0);
    expect(labels[rootRow]).toBe(path.basename(tmp));

    // helper: find the unique row with a given label
    const row = (name) => {
      const i = labels.indexOf(name);
      expect(i).toBeGreaterThanOrEqual(0);
      return i;
    };

    // --- parent relationships ---
    expect(parentIndices[row('subA')]).toBe(rootRow);
    expect(parentIndices[row('subB')]).toBe(rootRow);
    expect(parentIndices[row('nested')]).toBe(row('subB'));

    expect(parentIndices[row('a.txt')]).toBe(rootRow);
    expect(parentIndices[row('b.js')]).toBe(rootRow);
    expect(parentIndices[row('c.png')]).toBe(row('subA'));
    expect(parentIndices[row('d.mp3')]).toBe(row('subA'));
    expect(parentIndices[row('e.zip')]).toBe(row('nested'));

    // --- file sizes ---
    expect(values[row('a.txt')]).toBe(100);
    expect(values[row('b.js')]).toBe(200);
    expect(values[row('c.png')]).toBe(300);
    expect(values[row('d.mp3')]).toBe(400);
    expect(values[row('e.zip')]).toBe(500);

    // --- color buckets ---
    expect(color[row('a.txt')]).toBe('doc');
    expect(color[row('b.js')]).toBe('code');
    expect(color[row('c.png')]).toBe('image');
    expect(color[row('d.mp3')]).toBe('audio');
    expect(color[row('e.zip')]).toBe('archive');

    // --- parentIndices[i] < i invariant (required by builder fast path) ---
    for (let i = 1; i < parentIndices.length; i++) {
      expect(parentIndices[i]).toBeGreaterThanOrEqual(0);
      expect(parentIndices[i]).toBeLessThan(i);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (fs.existsSync(out)) fs.unlinkSync(out);
  }
});

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Simple seeded PRNG (mulberry32) for repeatable random directory trees.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Build a deterministic directory tree under `root` using a seeded PRNG.
function buildTree(root, seed) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const exts = ['.js', '.ts', '.py', '.json', '.css', '.html', '.md', '.txt', '.png', '.jpg'];
  const dirs = [root];

  // Create ~8 subdirectories and ~120 files.
  for (let d = 0; d < 8; d++) {
    const parent = pick(dirs);
    const name = 'dir_' + d;
    const p = path.join(parent, name);
    fs.mkdirSync(p, { recursive: true });
    dirs.push(p);
  }
  for (let f = 0; f < 120; f++) {
    const parent = pick(dirs);
    const ext = pick(exts);
    const name = 'file_' + f + ext;
    // Deterministic size: 100–10 000 bytes of repeating ASCII.
    const size = 100 + Math.floor(rand() * 9900);
    const fp = path.join(parent, name);
    fs.writeFileSync(fp, 'x'.repeat(size));
    // Spread timestamps over ~2 years so quantitative color modes have diversity.
    const daysAgo = Math.floor(rand() * 730);
    const ts = new Date(Date.now() - daysAgo * 86400000);
    fs.utimesSync(fp, ts, ts);
  }
}

test('scan.js produces a self-contained HTML that renders', async ({ page }) => {
  // Create a hermetic, repeatable temp directory tree.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-scan-test-'));
  buildTree(target, 42);

  const out = path.join(os.tmpdir(), 'raised-treemap-scan-' + Date.now() + '.html');
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'scan.js'), '--no-open', target, out,
  ], { encoding: 'utf8' });
  expect(res.status, res.stderr).toBe(0);
  expect(fs.existsSync(out)).toBe(true);

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto('file://' + out);
  await page.waitForTimeout(400);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  expect(errs, 'no errors').toEqual([]);
  const cells = await page.locator('raised-treemap').evaluate((el) => el._leaves.length);
  expect(cells).toBeGreaterThan(100);

  await page.screenshot({
    path: path.join(__dirname, 'screenshots', '11-scan-synthetic.png'),
    fullPage: false,
  });

  // Cleanup.
  fs.unlinkSync(out);
  fs.rmSync(target, { recursive: true, force: true });
});

test('color-by dropdown switches between all modes without errors', async ({ page }) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-colorby-'));
  buildTree(target, 99);

  const out = path.join(os.tmpdir(), 'rt-colorby-' + Date.now() + '.html');
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'scan.js'), '--no-open', target, out,
  ], { encoding: 'utf8' });
  expect(res.status, res.stderr).toBe(0);

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto('file://' + out);
  await page.waitForTimeout(400);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const tm = page.locator('raised-treemap');
  const colorSel = page.locator('#color-sel');

  // Default should be extension (raw extension, categorical).
  expect(await tm.getAttribute('color-mode')).toBe('categorical');
  expect(await colorSel.inputValue()).toBe('extension');

  // Switch to each mode and verify the component updates without errors.
  for (const [mode, expectedColorMode, expectedPalette] of [
    ['kind',      'categorical',  'tokyo-night'],
    ['folder',    'categorical',  'tokyo-night'],
    ['ctime',     'quantitative', 'viridis'],
    ['mtime',     'quantitative', 'viridis'],
    ['atime',     'quantitative', 'viridis'],
    ['extension', 'categorical',  'tokyo-night'],
  ]) {
    await colorSel.selectOption(mode);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await tm.getAttribute('color-mode'), mode + ' color-mode').toBe(expectedColorMode);
    // When a theme is active the palette attr tracks the theme name, not the
    // color-mode default, so only check palette when no theme is set.
    const theme = await tm.getAttribute('theme');
    if (!theme) {
      expect(await tm.getAttribute('palette'), mode + ' palette').toBe(expectedPalette);
    }
  }

  // Quantitative modes (ctime/mtime/atime) should produce diverse colors,
  // not map everything to a single bin. Regression: theme palettes with few
  // discrete colors caused all timestamps to land in the same bucket.
  // Use mtime (not ctime) because utimesSync can set mtime but not ctime.
  await colorSel.selectOption('mtime');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const mtimeColors = await tm.evaluate((el) => {
    const indices = new Set();
    for (const l of el._leaves) indices.add(l.lutIndex);
    return indices.size;
  });
  expect(mtimeColors, 'mtime should produce many distinct colors').toBeGreaterThan(5);

  // Switch back to extension for the hash test below.
  await colorSel.selectOption('extension');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // Verify the URL hash recorded the last switch back to the default.
  // (extension is the default so 'color' param should be absent)
  const hash = await page.evaluate(() => location.hash);
  expect(hash).not.toContain('color=');

  // Switch to folder and verify hash contains color=folder.
  await colorSel.selectOption('folder');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const hash2 = await page.evaluate(() => location.hash);
  expect(hash2).toContain('color=folder');

  // Click a cell to focus a leaf node and verify the status bar shows metadata.
  const tmEl = page.locator('raised-treemap');
  const box = await tmEl.boundingBox();
  // Click near center — likely to hit a leaf cell.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const barText = await page.locator('#stats-bar').textContent();
  // For a focused leaf, the bar should include extension/kind and timestamps.
  // Format is ".ext (kind)" or just "kind" when they match, plus timestamps.
  expect(barText).toMatch(/\.\w+\s+\(|code|web|doc|image|audio/);
  expect(barText).toMatch(/modified: \d{4}-/);

  expect(errs, 'no errors during color switching').toEqual([]);

  fs.unlinkSync(out);
  fs.rmSync(target, { recursive: true, force: true });
});

// Forces multi-block partitioning with a tiny block size, then verifies that:
// 1. The initial render shows cells (block 0 renders)
// 2. Stub directories expand after their blocks inflate (progressive loading)
// 3. No JS errors during the entire process
test('multi-block scan: stubs expand progressively after async inflate', async ({ page }) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-multiblock-'));
  buildTree(target, 77);  // ~8 dirs, ~120 files

  const out = path.join(os.tmpdir(), 'rt-multiblock-' + Date.now() + '.html');
  // Use a tiny block size to force multiple blocks from a small fixture.
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'scan.js'), '--no-open', '--block-size=20', target, out,
  ], { encoding: 'utf8' });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stderr).toMatch(/partitioned into \d+ blocks/);
  // Should have more than 1 block.
  const blockCount = Number(res.stderr.match(/partitioned into (\d+) blocks/)[1]);
  expect(blockCount).toBeGreaterThan(1);

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  await page.goto('file://' + out);
  await page.waitForTimeout(400);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(errs, 'no errors on initial load').toEqual([]);

  // After block inflation (async, but fast for small blocks), all ~120 files
  // should be visible. Wait a few extra frames for cascading inflations.
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(100);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  const cells = await page.locator('raised-treemap').evaluate((el) => el._leaves.length);
  expect(cells, 'all files should render after block inflation').toBeGreaterThan(100);

  expect(errs, 'no errors during block inflation').toEqual([]);

  fs.unlinkSync(out);
  fs.rmSync(target, { recursive: true, force: true });
});

test('zoom restores from URL hash in lazy tree', async ({ page }) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-zoomhash-'));
  buildTree(target, 55);

  const out = path.join(os.tmpdir(), 'rt-zoomhash-' + Date.now() + '.html');
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'scan.js'), '--no-open', target, out,
  ], { encoding: 'utf8' });
  expect(res.status, res.stderr).toBe(0);

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  // First load: render, click a cell to zoom via keyboard (+), capture the hash.
  await page.goto('file://' + out);
  await page.waitForTimeout(400);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const box = await page.locator('raised-treemap').boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.waitForTimeout(100);

  // Scroll wheel up a few times to focus an ancestor (non-leaf, non-root)
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);
  }

  // Zoom into the focused node via keyboard
  await page.keyboard.press('+');
  await page.waitForTimeout(100);

  const info = await page.evaluate(() => {
    const el = document.querySelector('raised-treemap');
    return {
      activeRoot: el._activeVisibleRootId(),
      treeRoot: el._tree.roots[0],
      zoomPath: el._visibleRootPath,
      hash: location.hash,
    };
  });

  // Should be zoomed into something other than the tree root
  expect(info.activeRoot).not.toBe(info.treeRoot);
  expect(info.zoomPath).toBeTruthy();
  expect(info.zoomPath.length).toBeGreaterThan(1);
  expect(info.hash).toContain('zoomPath=');

  // Second load: reload with the same hash — zoom should restore.
  const url = 'file://' + out + info.hash;
  await page.goto(url);
  await page.waitForTimeout(400);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const restored = await page.evaluate(() => {
    const el = document.querySelector('raised-treemap');
    return {
      activeRoot: el._activeVisibleRootId(),
      treeRoot: el._tree.roots[0],
    };
  });

  // The zoom root should match what we had before reload
  expect(restored.activeRoot).toBe(info.activeRoot);
  expect(restored.activeRoot).not.toBe(restored.treeRoot);
  expect(errs).toEqual([]);

  fs.unlinkSync(out);
  fs.rmSync(target, { recursive: true, force: true });
});

test('zoom path expansion works when root node ID is 0 (falsy)', async ({ page }) => {
  // Regression: the path expansion skipped the root node because _item was 0
  // and the check `!nd._item` treated 0 as falsy, preventing child expansion.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-falsy-root-'));
  buildTree(target, 42);

  const out = path.join(os.tmpdir(), 'rt-falsy-root-' + Date.now() + '.html');
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'scan.js'), '--no-open', target, out,
  ], { encoding: 'utf8' });
  expect(res.status, res.stderr).toBe(0);

  // First: load normally, zoom into a child of root, capture zoomPath.
  await page.goto('file://' + out);
  await page.waitForFunction(() => {
    const el = document.querySelector('raised-treemap');
    return el && el._leaves && el._leaves.length > 0;
  }, { timeout: 10000 });
  await page.waitForTimeout(300);

  const box = await page.locator('raised-treemap').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(100);
  await page.keyboard.press('+');
  await page.waitForTimeout(200);

  const zoomed = await page.evaluate(() => {
    const el = document.querySelector('raised-treemap');
    return {
      activeRoot: el._activeVisibleRootId(),
      treeRoot: el._tree.roots[0],
      zoomPath: el._visibleRootPath,
      hash: location.hash,
      leavesInSubtree: el._leaves.length,
    };
  });
  expect(zoomed.treeRoot, 'scan root ID must be 0 for this test').toBe(0);
  expect(zoomed.activeRoot).not.toBe(0);
  expect(zoomed.zoomPath[0], 'zoom path must start at root 0').toBe(0);

  // Reload with hash — the path expansion must handle root ID 0 correctly.
  await page.goto('file://' + out + zoomed.hash);
  await page.waitForFunction(() => {
    const el = document.querySelector('raised-treemap');
    return el && el._leaves && el._leaves.length > 0;
  }, { timeout: 10000 });
  await page.waitForTimeout(300);

  const restored = await page.evaluate(() => {
    const el = document.querySelector('raised-treemap');
    // Verify all rendered leaves are under the zoom root.
    const zoomRoot = el._activeVisibleRootId();
    let wrong = 0;
    for (const l of el._leaves) {
      let cur = el._tree.nodes.get(l.id);
      let ok = false;
      while (cur) {
        if (cur.id === zoomRoot) { ok = true; break; }
        cur = cur.parentId != null ? el._tree.nodes.get(cur.parentId) : null;
      }
      if (!ok) wrong++;
    }
    return { activeRoot: zoomRoot, leaves: el._leaves.length, wrongBranch: wrong };
  });
  expect(restored.activeRoot, 'zoom must restore').toBe(zoomed.activeRoot);
  expect(restored.wrongBranch, 'all leaves must be under zoom root').toBe(0);
  // Zoomed view should have fewer leaves than total (unless target is nearly all files)
  expect(restored.leaves).toBeLessThanOrEqual(zoomed.leavesInSubtree);

  fs.unlinkSync(out);
  fs.rmSync(target, { recursive: true, force: true });
});

test('zoom survives async block inflation in multi-block scan', async ({ page }) => {
  // Build a tree, scan with tiny block size to force stubs on the zoom path.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-zoomstub-'));
  buildTree(target, 88);

  const out = path.join(os.tmpdir(), 'rt-zoomstub-' + Date.now() + '.html');
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'scan.js'), '--no-open', '--block-size=20', target, out,
  ], { encoding: 'utf8' });
  expect(res.status, res.stderr).toBe(0);
  const blockCount = Number(res.stderr.match(/partitioned into (\d+) blocks/)?.[1] || 0);
  expect(blockCount, 'must have multiple blocks so stubs exist').toBeGreaterThan(1);

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  // First load: zoom into a non-root node and capture the hash.
  await page.goto('file://' + out);
  await page.waitForFunction(() => {
    const el = document.querySelector('raised-treemap');
    return el && el._leaves && el._leaves.length > 0;
  }, { timeout: 10000 });
  // Let blocks inflate so the full tree is available for interaction.
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(100);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  // Click a cell, navigate up, zoom in via +
  const box = await page.locator('raised-treemap').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(100);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(100);
  await page.keyboard.press('+');
  await page.waitForTimeout(200);

  const zoomed = await page.evaluate(() => {
    const el = document.querySelector('raised-treemap');
    return {
      activeRoot: el._activeVisibleRootId(),
      treeRoot: el._tree.roots[0],
      zoomPath: el._visibleRootPath,
      hash: location.hash,
    };
  });
  expect(zoomed.activeRoot).not.toBe(zoomed.treeRoot);
  expect(zoomed.zoomPath?.length).toBeGreaterThan(1);

  // Reload with the hash. Before blocks inflate, the zoom target may sit
  // behind a stub whose block hasn't loaded yet.  getChildren returns null
  // for stubs, so the eager path expansion can't reach the zoom target on
  // the first render.  The component must NOT permanently mark those nodes
  // as childless — it must leave them unexpanded so subsequent renders
  // (triggered by block inflation) can retry and eventually succeed.
  await page.goto('file://' + out + zoomed.hash);
  await page.waitForFunction(() => {
    const el = document.querySelector('raised-treemap');
    return el && el._leaves && el._leaves.length > 0;
  }, { timeout: 10000 });

  // Check zoom state immediately — before block inflation settles.
  // Even if the zoom target isn't reachable yet (behind a stub), the
  // _internalVisibleRootId must still be set so that once the stub
  // inflates and triggers a re-render, the zoom will take effect.
  const early = await page.evaluate(() => {
    const el = document.querySelector('raised-treemap');
    return { internal: el._internalVisibleRootId, path: el._visibleRootPath };
  });
  expect(early.internal, 'zoom ID must persist even before stubs inflate').toBe(zoomed.activeRoot);
  expect(early.path, 'zoom path must persist').toEqual(zoomed.zoomPath);

  // Now wait for block inflation to settle.
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(100);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  const restored = await page.evaluate(() => {
    const el = document.querySelector('raised-treemap');
    return {
      activeRoot: el._activeVisibleRootId(),
      treeRoot: el._tree.roots[0],
    };
  });
  expect(restored.activeRoot, 'zoom should survive block inflation').toBe(zoomed.activeRoot);
  expect(restored.activeRoot).not.toBe(restored.treeRoot);
  expect(errs).toEqual([]);

  fs.unlinkSync(out);
  fs.rmSync(target, { recursive: true, force: true });
});
