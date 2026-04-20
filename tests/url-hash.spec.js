// Tests that zoom and depth state is persisted in the URL hash and restored
// when the page loads with hash parameters. The hash sync logic lives in the
// page (samples/interactions.html), not in the component itself.
import { test, expect } from '@playwright/test';

async function waitForRender(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.describe('URL hash state', () => {

  test('zoom writes hash and reloading restores it', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Click a cell to select it
    const box = await page.locator('raised-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);
    const clickedId = await page.locator('raised-treemap').evaluate((el) => el._targetId);
    expect(clickedId).not.toBeNull();

    // Zoom to the clicked node's parent
    await page.locator('raised-treemap').evaluate((el) => {
      const n = el._tree.nodes.get(el._targetId);
      if (n && n.parentId !== null) el.zoomTo(n.parentId);
    });
    await waitForRender(page);

    // Verify the hash was updated by the page-level script
    const hash1 = await page.evaluate(() => window.location.hash);
    expect(hash1).toMatch(/zoom=/);

    const zoomedId = await page.locator('raised-treemap').evaluate((el) => el._activeVisibleRootId());

    // Reload the page with the same hash — the page script should restore it
    await page.goto('/samples/interactions.html' + hash1);
    await waitForRender(page);

    const restoredId = await page.locator('raised-treemap').evaluate((el) => el._activeVisibleRootId());
    expect(restoredId).toBe(zoomedId);
  });

  test('depth buttons write hash and reloading restores it', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Click the depth minus button (fires rt-depth-change → page updates hash)
    await page.locator('raised-treemap').evaluate((el) => {
      const btn = el.shadowRoot.querySelector('.depth button');
      if (btn) btn.click();
    });
    await waitForRender(page);

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toMatch(/depth=\d+/);

    const depth = await page.locator('raised-treemap').evaluate((el) => el.displayDepth);
    expect(depth).not.toBe(Infinity);

    // Reload with the hash
    await page.goto('/samples/interactions.html' + hash);
    await waitForRender(page);

    const restoredDepth = await page.locator('raised-treemap').evaluate((el) => el.displayDepth);
    expect(restoredDepth).toBe(depth);
  });

  test('combined zoom + depth in hash', async ({ page }) => {
    await page.goto('/samples/interactions.html#zoom=src&depth=3');
    await waitForRender(page);

    const state = await page.locator('raised-treemap').evaluate((el) => ({
      visibleRootId: el._activeVisibleRootId(),
      displayDepth: el.displayDepth,
    }));
    expect(state.visibleRootId).toBe('src');
    expect(state.displayDepth).toBe(3);
  });

  test('resetting zoom clears zoom from hash', async ({ page }) => {
    await page.goto('/samples/interactions.html#zoom=src');
    await waitForRender(page);

    await page.locator('raised-treemap').evaluate((el) => el.zoomReset());
    await waitForRender(page);

    const hash = await page.evaluate(() => window.location.hash);
    // Hash should be empty (no zoom, depth is default)
    expect(hash === '' || hash === '#').toBe(true);
  });

  test('clicking a cell writes target to hash', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    const box = await page.locator('raised-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toMatch(/target=/);
  });

  test('target and focus restored from hash', async ({ page }) => {
    await page.goto('/samples/interactions.html#target=src&focus=src');
    await waitForRender(page);

    const state = await page.locator('raised-treemap').evaluate((el) => ({
      targetId: el._targetId,
      focusId: el._focusId,
    }));
    expect(state.targetId).toBe('src');
    expect(state.focusId).toBe('src');
  });

  test('focus differs from target in hash round-trip', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Click a cell to set target
    const box = await page.locator('raised-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);

    // Move focus up
    await page.locator('raised-treemap').evaluate((el) => el._focusUp());
    await waitForRender(page);

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toMatch(/target=/);
    expect(hash).toMatch(/focus=/);

    // Reload and verify
    await page.goto('/samples/interactions.html' + hash);
    await waitForRender(page);

    const state = await page.locator('raised-treemap').evaluate((el) => ({
      targetId: el._targetId,
      focusId: el._focusId,
    }));
    expect(state.targetId).not.toBeNull();
    expect(state.focusId).not.toBeNull();
    expect(state.focusId).not.toBe(state.targetId);
  });

});
