// Exercises tools/scan.js on a synthetic directory tree, loads the generated
// HTML over file:// (the primary way a user will open it), and snapshots the
// result to tests/screenshots/.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

// Parse the embedded data out of a scan HTML file. Returns { labels, parentIndices, values, color }.
// Parse the embedded data out of a scan HTML file. Handles the v2 block format
// (reads only block 0 — the root block containing the top-level tree).
function parseScanHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script type="application\/json" id="tmdata">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('tmdata script tag not found');
  const envelope = JSON.parse(m[1]);
  // v2 block format: data is in envelope.block0.
  const raw = envelope.v === 2 ? envelope.block0 : envelope;
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
    fs.writeFileSync(path.join(parent, name), 'x'.repeat(size));
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
