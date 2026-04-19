// Exercises tools/scan.js on a real directory, loads the generated HTML
// over file:// (the primary way a user will open it), and snapshots the
// result to tests/screenshots/.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

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
