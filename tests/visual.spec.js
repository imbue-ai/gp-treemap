// Captures a PNG of each sample page into tests/screenshots/ so you can
// see at a glance what the component looks like. Checked into the repo.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

async function waitForRender(page) {
  await page.waitForLoadState('networkidle');
  // give the component time for rAF + microtask render, and any ResizeObserver pass
  await page.waitForTimeout(300);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function snap(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
}

test.describe('visual snapshots', () => {
  test('filesystem · categorical', async ({ page }) => {
    await page.goto('/samples/filesystem.html');
    await waitForRender(page);
    await expect(page.locator('raised-treemap')).toBeVisible();
    await snap(page, '01-filesystem-categorical');
    const cellCount = await page.locator('raised-treemap').evaluate((el) => el._leaves.length);
    expect(cellCount).toBeGreaterThan(10);
  });

  test('filesystem · labels on, intensity 1', async ({ page }) => {
    await page.goto('/samples/filesystem.html');
    await waitForRender(page);
    await page.evaluate(() => {
      const tm = document.getElementById('tm');
      tm.gradientIntensity = 1;
      tm.showLabels = true;
    });
    await waitForRender(page);
    await snap(page, '02-filesystem-labeled-max-intensity');
  });

  test('budget · diverging quantitative', async ({ page }) => {
    await page.goto('/samples/budget.html');
    await waitForRender(page);
    await snap(page, '03-budget-diverging');
  });

  test('deep hierarchy · depth palette', async ({ page }) => {
    await page.goto('/samples/depth.html');
    await waitForRender(page);
    await snap(page, '04-depth-hierarchy');
    const cellCount = await page.locator('raised-treemap').evaluate((el) => el._leaves.length);
    expect(cellCount).toBeGreaterThan(100);
  });

  test('gradient intensities · 0 / 0.5 / 1', async ({ page }) => {
    await page.goto('/samples/gradients.html');
    await waitForRender(page);
    await snap(page, '05-gradient-intensities');
  });

  test('min-cell-area comparison', async ({ page }) => {
    await page.goto('/samples/min-cell.html');
    await waitForRender(page);
    await snap(page, '06-min-cell-area');
  });

  test('located node highlight', async ({ page }) => {
    await page.goto('/samples/located.html');
    await waitForRender(page);
    await snap(page, '07-located-node');
    const hasLocated = await page.locator('raised-treemap').evaluate((el) =>
      !!el.shadowRoot.querySelector('.overlay .loc'));
    expect(hasLocated).toBe(true);
  });

  test('interactions · click selects and fires events', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);
    // click a cell
    const box = await page.locator('raised-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);
    await snap(page, '08-interactions-after-click');
    const logText = await page.locator('#log').textContent();
    expect(logText).toMatch(/rt-click/);
    expect(logText).toMatch(/rt-target/);
  });

  test('interactions · double click zooms in (info line updates)', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);
    const box = await page.locator('raised-treemap').boundingBox();
    // Hover first so the info line populates, then double-click to zoom
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3);
    await waitForRender(page);
    await page.mouse.dblclick(box.x + box.width * 0.7, box.y + box.height * 0.3);
    await waitForRender(page);
    await snap(page, '09-interactions-after-zoom');
    // After zooming, the info line should contain the root icon
    const hasRootIcon = await page.locator('raised-treemap').evaluate((el) =>
      el.shadowRoot.querySelector('.info-line .root-icon') !== null);
    expect(hasRootIcon).toBe(true);
  });

  test('hover shows tooltip', async ({ page }) => {
    await page.goto('/samples/filesystem.html');
    await waitForRender(page);
    const box = await page.locator('raised-treemap').boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.waitForTimeout(80);
    await page.mouse.move(box.x + box.width * 0.2 + 1, box.y + box.height * 0.2 + 1);
    await waitForRender(page);
    await snap(page, '10-hover-tooltip');
    const hasTip = await page.locator('raised-treemap').evaluate((el) => {
      const t = el.shadowRoot.querySelector('.tooltip');
      return t && !t.hidden;
    });
    expect(hasTip).toBe(true);
  });
});
