import { test, expect } from '@playwright/test';

test('debug scan rendering', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  await page.goto('file:///Users/thad/zz.html');
  await page.waitForTimeout(3000);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  const info = await page.locator('raised-treemap').evaluate((el) => {
    return {
      hasTree: !!el._tree,
      nodesCount: el._tree ? el._tree.nodes.size : 0,
      leavesCount: el._leaves.length,
      sampleLeaves: el._leaves.slice(0, 3).map(l => ({id: l.id, label: l.label, w: Math.round(l.w), h: Math.round(l.h)})),
      canvasW: el._canvas.width,
      canvasH: el._canvas.height,
    };
  });
  console.log('Component state:', JSON.stringify(info, null, 2));
  console.log('Errors:', JSON.stringify(errs));

  expect(errs).toEqual([]);
  expect(info.leavesCount).toBeGreaterThan(5);
});
