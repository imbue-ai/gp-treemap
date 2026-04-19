// Smoke test: load a sample via file:// and verify it renders. This is the
// mode the user cares about when double-clicking an HTML file.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FS_SAMPLE = 'file://' + path.join(__dirname, '..', 'samples', 'filesystem.html');

test('samples/filesystem.html renders over file://', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(FS_SAMPLE);
  await page.waitForTimeout(400);
  const cells = await page.locator('raised-treemap').evaluate((el) => el._leaves ? el._leaves.length : 0);
  expect(errs, 'no page errors under file://').toEqual([]);
  expect(cells, 'cells should render under file://').toBeGreaterThan(10);
});
