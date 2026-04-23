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
    await expect(page.locator('gp-treemap')).toBeVisible();
    await snap(page, '01-filesystem-categorical');
    const cellCount = await page.locator('gp-treemap').evaluate((el) => el._leaves.length);
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
    const cellCount = await page.locator('gp-treemap').evaluate((el) => el._leaves.length);
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
    const hasLocated = await page.locator('gp-treemap').evaluate((el) =>
      !!el.shadowRoot.querySelector('.overlay .loc'));
    expect(hasLocated).toBe(true);
  });

  test('interactions · click selects and fires events', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);
    // click a cell
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);
    await snap(page, '08-interactions-after-click');
    const logText = await page.locator('#log').textContent();
    expect(logText).toMatch(/gp-click/);
    expect(logText).toMatch(/gp-target/);
    // Breadcrumb should immediately reflect the clicked cell's path.
    // Verify synchronously inside the click handler — patch _onClick to
    // capture the info-line state right after the native handler runs,
    // before any microtask re-render.
    const info = await page.locator('gp-treemap').evaluate((el) => {
      const infoLine = el.shadowRoot.querySelector('.info-line');
      const focusedLink = infoLine.querySelector('a.focused');
      return {
        focusedLabel: focusedLink ? focusedLink.textContent : null,
        targetLabel: el._tree.nodes.get(el._targetId).label,
      };
    });
    expect(info.focusedLabel).toBe(info.targetLabel);
  });

  test('interactions · wheel scrolls focus along ancestor chain', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);
    const box = await page.locator('gp-treemap').boundingBox();
    // Click a cell to set target
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);
    const initial = await page.locator('gp-treemap').evaluate((el) => ({
      targetId: el._targetId,
      focusId: el._focusId,
      depth: el._tree.nodes.get(el._focusId).depth,
    }));
    // Scroll down (positive deltaY) to move focus toward root (shallower / zoom out)
    await page.mouse.wheel(0, 100);
    await waitForRender(page);
    const afterUp = await page.locator('gp-treemap').evaluate((el) => ({
      focusId: el._focusId,
      depth: el._tree.nodes.get(el._focusId).depth,
      targetId: el._targetId,
    }));
    expect(afterUp.depth).toBeLessThan(initial.depth);
    expect(afterUp.targetId).toBe(initial.targetId);
    // Scroll up (negative deltaY) to move focus back toward target (deeper / zoom in)
    await page.mouse.wheel(0, -100);
    await waitForRender(page);
    const afterDown = await page.locator('gp-treemap').evaluate((el) => ({
      focusId: el._focusId,
      depth: el._tree.nodes.get(el._focusId).depth,
    }));
    expect(afterDown.depth).toBeGreaterThan(afterUp.depth);
    // Focus must always stay on the target's ancestor chain
    const onAncestorChain = await page.locator('gp-treemap').evaluate((el) => {
      let cur = el._tree.nodes.get(el._targetId);
      while (cur) {
        if (cur.id === el._focusId) return true;
        cur = cur.parentId != null ? el._tree.nodes.get(cur.parentId) : null;
      }
      return false;
    });
    expect(onAncestorChain).toBe(true);
  });

  test('hover shows tooltip', async ({ page }) => {
    await page.goto('/samples/filesystem.html');
    await waitForRender(page);
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.waitForTimeout(80);
    await page.mouse.move(box.x + box.width * 0.2 + 1, box.y + box.height * 0.2 + 1);
    await waitForRender(page);
    await snap(page, '10-hover-tooltip');
    const hasTip = await page.locator('gp-treemap').evaluate((el) => {
      const t = el.shadowRoot.querySelector('.tooltip');
      return t && !t.hidden;
    });
    expect(hasTip).toBe(true);
  });
});
