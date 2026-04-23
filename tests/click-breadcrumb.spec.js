// Regression test: clicking a treemap cell should immediately update the breadcrumb.
import { test, expect } from '@playwright/test';

test('click immediately updates breadcrumb info-line', async ({ page }) => {
  await page.goto('/samples/interactions.html');
  await page.waitForFunction(() => {
    const el = document.querySelector('gp-treemap');
    return el && el._leaves && el._leaves.length > 0;
  }, { timeout: 10000 });
  await page.waitForTimeout(300);

  // Block _queueRender so no incidental re-render masks the bug
  await page.evaluate(() => {
    const el = document.querySelector('gp-treemap');
    el._queueRender = () => {};
  });

  // Click center of treemap
  const box = await page.locator('gp-treemap').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(50);

  const after = await page.evaluate(() => {
    const el = document.querySelector('gp-treemap');
    const info = el.shadowRoot.querySelector('.info-line');
    const focused = info.querySelector('a.focused');
    return {
      text: info.textContent,
      focusedLabel: focused ? focused.textContent : null,
      targetLabel: el._tree.nodes.get(el._targetId)?.label,
    };
  });

  // The breadcrumb should show the clicked cell's path, not "(click a cell)"
  expect(after.text).not.toContain('click a cell');
  expect(after.focusedLabel).toBe(after.targetLabel);
});
