// Regression test: double-clicking a breadcrumb link should zoom in and stay zoomed.
import { test, expect } from '@playwright/test';

test('double-click breadcrumb zooms in and stays zoomed', async ({ page }) => {
  await page.goto('/samples/interactions.html');
  await page.waitForFunction(() => {
    const el = document.querySelector('raised-treemap');
    return el && el._leaves && el._leaves.length > 0;
  }, { timeout: 10000 });
  await page.waitForTimeout(300);

  // Click a cell to populate the breadcrumb
  const box = await page.locator('raised-treemap').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(200);

  // Find an ancestor breadcrumb link (not the focused leaf)
  const linkInfo = await page.evaluate(() => {
    const el = document.querySelector('raised-treemap');
    const links = el.shadowRoot.querySelectorAll('.info-line a[data-node-id]:not(.root-icon):not(.focused)');
    if (links.length === 0) return null;
    const link = links[0];
    const rect = link.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, nodeId: link.dataset.nodeId };
  });
  if (!linkInfo) { test.skip(); return; }

  // Double-click the breadcrumb to zoom
  await page.mouse.dblclick(linkInfo.x, linkInfo.y);
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const el = document.querySelector('raised-treemap');
    return {
      stretchZoomId: el._stretchZoomId,
      zoomAnimating: el._zoomAnimating,
      visibleRootPath: el._visibleRootPath,
    };
  });

  expect(state.stretchZoomId).not.toBeNull();
  expect(state.zoomAnimating).toBe(false);
  expect(state.visibleRootPath).toBeTruthy();
  expect(state.visibleRootPath.length).toBeGreaterThan(1);
});
