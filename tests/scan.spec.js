// Exercises tools/scan.js on a real directory, loads the generated HTML
// over file:// (the primary way a user will open it), and snapshots the
// result to tests/screenshots/.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

// Parse the embedded data out of a scan HTML file. Returns { labels, parentIndices, values, color }.
function parseScanHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script type="application\/json" id="tmdata">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('tmdata script tag not found');
  const raw = JSON.parse(m[1]);
  const piBuf = Buffer.from(raw.piB64, 'base64');
  const parentIndices = Array.from(new Int32Array(piBuf.buffer, piBuf.byteOffset, piBuf.byteLength / 4));
  const cBuf = Buffer.from(raw.colorB64, 'base64');
  const colorIdx = new Uint16Array(cBuf.buffer, cBuf.byteOffset, cBuf.byteLength / 2);
  const color = Array.from(colorIdx).map(i => raw.colorNames[i]);
  return { labels: raw.labels, values: raw.values, parentIndices, color };
}

function runScan(srcDir, outFile) {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'scan.js'), srcDir, outFile], {
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

test('scan.js produces a self-contained HTML that renders', async ({ page }) => {
  const target = path.join(ROOT, 'GrandPerspective-3_6_4');
  const out = path.join(os.tmpdir(), 'raised-treemap-scan-' + Date.now() + '.html');
  const res = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'scan.js'), target, out], {
    encoding: 'utf8',
  });
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
    path: path.join(__dirname, 'screenshots', '11-scan-grandperspective.png'),
    fullPage: false,
  });
  fs.unlinkSync(out);
});
