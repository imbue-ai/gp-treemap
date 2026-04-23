// Tests that UI state is persisted in the URL hash and restored when the page
// loads with hash parameters. The hash sync logic lives in the page
// (samples/interactions.html, scan.js template), not in the component itself.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);
    const clickedId = await page.locator('gp-treemap').evaluate((el) => el._targetId);
    expect(clickedId).not.toBeNull();

    // Zoom to the clicked node's parent
    await page.locator('gp-treemap').evaluate((el) => {
      const n = el._tree.nodes.get(el._targetId);
      if (n && n.parentId !== null) el.zoomTo(n.parentId);
    });
    await waitForRender(page);

    // Verify the hash was updated by the page-level script
    const hash1 = await page.evaluate(() => window.location.hash);
    expect(hash1).toMatch(/zoom=/);

    const zoomedId = await page.locator('gp-treemap').evaluate((el) => el._activeVisibleRootId());

    // Reload the page with the same hash — the page script should restore it
    await page.goto('/samples/interactions.html' + hash1);
    await waitForRender(page);

    const restoredId = await page.locator('gp-treemap').evaluate((el) => el._activeVisibleRootId());
    expect(restoredId).toBe(zoomedId);
  });

  test('depth set via property writes hash and reloading restores it', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Set depth programmatically (depth buttons removed; URL param still supported)
    await page.locator('gp-treemap').evaluate((el) => {
      el.displayDepth = 2;
      el.dispatchEvent(new CustomEvent('gp-depth-change', { detail: { displayDepth: 2 }, bubbles: true, composed: true }));
    });
    await waitForRender(page);

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toMatch(/depth=2/);

    const depth = await page.locator('gp-treemap').evaluate((el) => el.displayDepth);
    expect(depth).toBe(2);

    // Reload with the hash
    await page.goto('/samples/interactions.html' + hash);
    await waitForRender(page);

    const restoredDepth = await page.locator('gp-treemap').evaluate((el) => el.displayDepth);
    expect(restoredDepth).toBe(2);
  });

  test('combined zoom + depth in hash', async ({ page }) => {
    await page.goto('/samples/interactions.html#zoom=src&depth=3');
    await waitForRender(page);

    const state = await page.locator('gp-treemap').evaluate((el) => ({
      visibleRootId: el._activeVisibleRootId(),
      displayDepth: el.displayDepth,
    }));
    expect(state.visibleRootId).toBe('src');
    expect(state.displayDepth).toBe(3);
  });

  test('resetting zoom clears zoom from hash', async ({ page }) => {
    await page.goto('/samples/interactions.html#zoom=src');
    await waitForRender(page);

    await page.locator('gp-treemap').evaluate((el) => el.zoomReset());
    await waitForRender(page);

    const hash = await page.evaluate(() => window.location.hash);
    // Hash should be empty (no zoom, depth is default)
    expect(hash === '' || hash === '#').toBe(true);
  });

  test('clicking a cell writes target to hash', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toMatch(/target=/);
  });

  test('target and focus restored from hash', async ({ page }) => {
    await page.goto('/samples/interactions.html#target=src&focus=src');
    await waitForRender(page);

    const state = await page.locator('gp-treemap').evaluate((el) => ({
      targetId: el._targetId,
      focusId: el._focusId,
    }));
    expect(state.targetId).toBe('src');
    expect(state.focusId).toBe('src');
  });

  test('breadcrumb double-click zoom writes zoom param to hash', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Click a cell to populate the breadcrumb.
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);

    // Find an ancestor breadcrumb link (zooming the leaf itself is a no-op).
    const linkInfo = await page.evaluate(() => {
      const el = document.querySelector('gp-treemap');
      const links = el.shadowRoot.querySelectorAll('.info-line a[data-node-id]:not(.root-icon):not(.focused)');
      if (links.length === 0) return null;
      const link = links[0];
      const rect = link.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    if (!linkInfo) { test.skip(); return; }

    await page.mouse.dblclick(linkInfo.x, linkInfo.y);
    // Wait for the zoom animation (350ms default + buffer).
    await page.waitForTimeout(500);
    await waitForRender(page);

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toMatch(/zoom=/);

    const zoomId = await page.locator('gp-treemap').evaluate((el) => el._activeVisibleRootId());
    expect(zoomId).not.toBeNull();

    // Reload and verify zoom is restored.
    await page.goto('/samples/interactions.html' + hash);
    await waitForRender(page);

    const restored = await page.locator('gp-treemap').evaluate((el) => el._activeVisibleRootId());
    expect(restored).toBe(zoomId);
  });

  test('focus differs from target in hash round-trip', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Click a cell to set target
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);

    // Move focus up
    await page.locator('gp-treemap').evaluate((el) => el._focusUp());
    await waitForRender(page);

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toMatch(/target=/);
    expect(hash).toMatch(/focus=/);

    // Reload and verify
    await page.goto('/samples/interactions.html' + hash);
    await waitForRender(page);

    const state = await page.locator('gp-treemap').evaluate((el) => ({
      targetId: el._targetId,
      focusId: el._focusId,
    }));
    expect(state.targetId).not.toBeNull();
    expect(state.focusId).not.toBeNull();
    expect(state.focusId).not.toBe(state.targetId);
  });

});

// Scan-generated HTML uses numeric node IDs (integers). The hash sync script
// must coerce string params back to numbers so they match the tree's Map keys.
test('scan HTML: numeric IDs round-trip through URL hash', async ({ page }) => {
  // Build a small temp directory for the scan.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-hash-test-'));
  fs.mkdirSync(path.join(target, 'sub'));
  fs.writeFileSync(path.join(target, 'sub', 'a.txt'), 'hello');
  fs.writeFileSync(path.join(target, 'sub', 'b.txt'), 'world');
  fs.writeFileSync(path.join(target, 'c.txt'), 'test');

  const out = path.join(os.tmpdir(), 'gp-hash-test-' + Date.now() + '.html');
  try {
    const res = spawnSync(process.execPath, [
      path.join(ROOT, 'tools', 'scan.js'), '--no-open', target, out,
    ], { encoding: 'utf8' });
    expect(res.status, res.stderr).toBe(0);

    // Load the scan HTML and click a cell to set a target.
    await page.goto('file://' + out);
    await page.waitForTimeout(400);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(200);

    // Verify target is a number (scan uses integer IDs).
    const targetId = await page.locator('gp-treemap').evaluate((el) => el._targetId);
    expect(typeof targetId).toBe('number');

    // Read the hash — it should contain the numeric target as a string.
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toMatch(/target=\d+/);

    // Reload with the same hash and verify the target is restored as a number.
    await page.goto('file://' + out + hash);
    await page.waitForTimeout(400);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const restored = await page.locator('gp-treemap').evaluate((el) => ({
      targetId: el._targetId,
      targetType: typeof el._targetId,
      hasFocusBox: el.shadowRoot.querySelector('.overlay .sel') !== null,
      infoHasLinks: el.shadowRoot.querySelectorAll('.info-line a').length > 0,
    }));
    expect(restored.targetId).toBe(targetId);
    expect(restored.targetType).toBe('number');
    // The focus highlight box and info-line breadcrumbs must render on load.
    expect(restored.hasFocusBox).toBe(true);
    expect(restored.infoHasLinks).toBe(true);
  } finally {
    if (fs.existsSync(out)) fs.unlinkSync(out);
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// Reproduces the user scenario: navigate directly to a scan HTML with
// zoom + target + focus all pre-set in the hash, and verify everything applies.
test('scan HTML: direct navigation with zoom+target+focus hash params', async ({ page }) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-hash-direct-'));
  // Create a deeper tree so we have interesting parent/child IDs.
  fs.mkdirSync(path.join(target, 'aaa'));
  fs.mkdirSync(path.join(target, 'aaa', 'bbb'));
  fs.writeFileSync(path.join(target, 'aaa', 'bbb', 'x.txt'), 'x'.repeat(500));
  fs.writeFileSync(path.join(target, 'aaa', 'bbb', 'y.txt'), 'y'.repeat(500));
  fs.writeFileSync(path.join(target, 'aaa', 'z.txt'), 'z'.repeat(500));
  fs.writeFileSync(path.join(target, 'top.txt'), 't'.repeat(500));

  const out = path.join(os.tmpdir(), 'gp-hash-direct-' + Date.now() + '.html');
  try {
    const res = spawnSync(process.execPath, [
      path.join(ROOT, 'tools', 'scan.js'), '--no-open', target, out,
    ], { encoding: 'utf8' });
    expect(res.status, res.stderr).toBe(0);

    // First load: discover valid node IDs.
    await page.goto('file://' + out);
    await page.waitForTimeout(400);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    // Find a leaf, its parent, and a zoom-worthy ancestor.
    const ids = await page.locator('gp-treemap').evaluate((el) => {
      const leaves = el._leaves;
      if (!leaves.length) return null;
      // Pick the first leaf that has a grandparent.
      for (const l of leaves) {
        const n = el._tree.nodes.get(l.id);
        if (!n || n.parentId == null) continue;
        const parent = el._tree.nodes.get(n.parentId);
        if (!parent || parent.parentId == null) continue;
        return { leaf: l.id, parent: n.parentId, grandparent: parent.parentId };
      }
      return null;
    });
    expect(ids).not.toBeNull();

    // Navigate away first to ensure a fresh page load (not a same-page hash change).
    await page.goto('about:blank');
    // Now load DIRECTLY with all three params in the hash (the user's scenario).
    const hash = `#zoom=${ids.grandparent}&target=${ids.leaf}&focus=${ids.parent}`;
    await page.goto('file://' + out + hash);
    await page.waitForTimeout(500);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const state = await page.locator('gp-treemap').evaluate((el) => ({
      activeRoot: el._activeVisibleRootId(),
      targetId: el._targetId,
      focusId: el._focusId,
      hasFocusBox: el.shadowRoot.querySelector('.overlay .sel') !== null,
      infoLinks: el.shadowRoot.querySelectorAll('.info-line a').length,
      leafCount: el._leaves.length,
    }));

    // Zoom should be applied — activeRoot matches the grandparent.
    expect(state.activeRoot).toBe(ids.grandparent);
    // Target and focus should be restored.
    expect(state.targetId).toBe(ids.leaf);
    expect(state.focusId).toBe(ids.parent);
    // The focus highlight box should render.
    expect(state.hasFocusBox).toBe(true);
    // Info line should have clickable breadcrumb links.
    expect(state.infoLinks).toBeGreaterThan(0);
  } finally {
    if (fs.existsSync(out)) fs.unlinkSync(out);
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// Scan data uses integer IDs starting at 0. ID 0 (the root) is falsy in JS.
// The component must not treat a focusId / hoverId of 0 as "no value".
test('scan HTML: focusing root (id 0) highlights the home icon, not a breadcrumb', async ({ page }) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-focus-root-'));
  fs.mkdirSync(path.join(target, 'sub'));
  fs.writeFileSync(path.join(target, 'sub', 'a.txt'), 'hello');      // 5 B
  fs.writeFileSync(path.join(target, 'sub', 'b.txt'), 'world');      // 5 B
  fs.writeFileSync(path.join(target, 'c.txt'), 'test');               // 4 B
  // Total: 3 files, 1 folder (sub), 14 bytes

  const out = path.join(os.tmpdir(), 'gp-focus-root-' + Date.now() + '.html');
  try {
    const res = spawnSync(process.execPath, [
      path.join(ROOT, 'tools', 'scan.js'), '--no-open', target, out,
    ], { encoding: 'utf8' });
    expect(res.status, res.stderr).toBe(0);

    await page.goto('file://' + out);
    await page.waitForTimeout(400);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    // Click a cell to set a target (so the breadcrumb renders).
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(200);

    // Verify root is id 0 (falsy).
    const rootId = await page.locator('gp-treemap').evaluate((el) => el._tree.roots[0]);
    expect(rootId).toBe(0);

    // Focus root — what clicking the home icon does.
    await page.locator('gp-treemap').evaluate((el) => {
      el._setFocus(el._tree.roots[0]);
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    // --- 1. Home icon focused, no breadcrumb entry focused ---
    const state = await page.locator('gp-treemap').evaluate((el) => {
      const rootIcon = el.shadowRoot.querySelector('.info-line .root-icon');
      const focusedBreadcrumbs = el.shadowRoot.querySelectorAll('.info-line a.focused:not(.root-icon)');
      return {
        focusId: el._focusId,
        rootId: el._tree.roots[0],
        homeHasFocused: rootIcon ? rootIcon.classList.contains('focused') : false,
        focusedBreadcrumbCount: focusedBreadcrumbs.length,
      };
    });
    expect(state.focusId).toBe(0);
    expect(state.homeHasFocused, 'home icon should be focused').toBe(true);
    expect(state.focusedBreadcrumbCount, 'no breadcrumb should be focused').toBe(0);

    // --- 2. Selection box covers the full canvas ---
    const selBox = await page.locator('gp-treemap').evaluate((el) => {
      const sel = el.shadowRoot.querySelector('.overlay .sel');
      if (!sel) return null;
      return {
        left: parseFloat(sel.style.left),
        top: parseFloat(sel.style.top),
        width: parseFloat(sel.style.width),
        height: parseFloat(sel.style.height),
        stageW: el._stage.clientWidth,
        stageH: el._stage.clientHeight,
      };
    });
    expect(selBox, 'selection box should exist').not.toBeNull();
    // The sel box sits outside the focused area by the border width (so the
    // outline surrounds, rather than overlaps, the region). When root is
    // focused the region is the whole stage, so the box covers at least it.
    expect(selBox.left, 'left edge at or outside stage origin').toBeLessThanOrEqual(0);
    expect(selBox.top, 'top edge at or outside stage origin').toBeLessThanOrEqual(0);
    expect(selBox.left + selBox.width, 'right edge at or outside stage').toBeGreaterThanOrEqual(selBox.stageW);
    expect(selBox.top + selBox.height, 'bottom edge at or outside stage').toBeGreaterThanOrEqual(selBox.stageH);

    // --- 3. Stats bar shows root totals (all files & folders) ---
    const barText = await page.locator('#stats-bar').textContent();
    expect(barText, 'stats bar should mention 3 files').toMatch(/3 files/);
    // 2 folders: root + sub (subtreeStats counts both as directories).
    expect(barText, 'stats bar should mention folders').toMatch(/2 folders/);
    expect(barText, 'stats bar should show total size').toMatch(/14/);
  } finally {
    if (fs.existsSync(out)) fs.unlinkSync(out);
    fs.rmSync(target, { recursive: true, force: true });
  }
});
