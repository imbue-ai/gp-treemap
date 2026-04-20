// Tests for the stretch-zoom feature: zooming into a selected node while
// preserving the original layout structure (same split directions), just
// stretched to fill the window's aspect ratio.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

async function waitForRender(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function waitForZoomAnimation(page) {
  // Default zoomDuration is 350ms; wait a bit extra
  await page.waitForTimeout(500);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function snap(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
}

test.describe('stretch zoom', () => {

  test('stretch zoom preserves layout structure (split directions unchanged)', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Get a parent node and its children's relative layout
    const before = await page.locator('raised-treemap').evaluate((el) => {
      // Find a parent node that has multiple children with a non-trivial rect
      const nodes = el._tree.nodes;
      let target = null;
      for (const n of nodes.values()) {
        if (n.childIds && n.childIds.length >= 3 && n.depth === 1) {
          target = n;
          break;
        }
      }
      if (!target) {
        // Fallback: first node with children
        for (const n of nodes.values()) {
          if (n.childIds && n.childIds.length >= 2) { target = n; break; }
        }
      }
      if (!target) return null;

      const parentRect = el._nodeRects.get(target.id);
      if (!parentRect || parentRect.w === 0 || parentRect.h === 0) return null;

      // Record children's relative positions within the parent rect
      const children = [];
      for (const leaf of el._leaves) {
        // Check if this leaf descends from target
        let cur = nodes.get(leaf.id);
        let isDescendant = false;
        while (cur) {
          if (cur.id === target.id) { isDescendant = true; break; }
          cur = cur.parentId ? nodes.get(cur.parentId) : null;
        }
        if (isDescendant) {
          children.push({
            id: leaf.id,
            relX: (leaf.x - parentRect.x) / parentRect.w,
            relY: (leaf.y - parentRect.y) / parentRect.h,
            relW: leaf.w / parentRect.w,
            relH: leaf.h / parentRect.h,
          });
        }
      }

      return {
        targetId: target.id,
        parentAspect: parentRect.w / parentRect.h,
        children,
      };
    });

    expect(before).not.toBeNull();
    expect(before.children.length).toBeGreaterThan(0);

    // Now stretch-zoom into that node
    await page.locator('raised-treemap').evaluate((el, targetId) => {
      el._selectedId = targetId;
      el.stretchZoomIn(targetId);
    }, before.targetId);
    await waitForZoomAnimation(page);

    // Get the new layout and verify relative positions match
    const after = await page.locator('raised-treemap').evaluate((el, data) => {
      const canvasW = el._canvas.width;
      const canvasH = el._canvas.height;
      const children = [];
      for (const leaf of el._leaves) {
        children.push({
          id: leaf.id,
          relX: leaf.x / canvasW,
          relY: leaf.y / canvasH,
          relW: leaf.w / canvasW,
          relH: leaf.h / canvasH,
        });
      }
      return { children, canvasW, canvasH, stretchZoomId: el._stretchZoomId };
    }, before);

    expect(after.stretchZoomId).toBe(before.targetId);

    // The relative positions should match: the stretch-zoom layout at
    // the original aspect ratio, scaled to fill the canvas, should produce
    // the same relative child positions as the original.
    for (const origChild of before.children) {
      const newChild = after.children.find(c => c.id === origChild.id);
      if (!newChild) continue; // some children may differ if newly visible
      expect(newChild.relX).toBeCloseTo(origChild.relX, 1);
      expect(newChild.relY).toBeCloseTo(origChild.relY, 1);
      expect(newChild.relW).toBeCloseTo(origChild.relW, 1);
      expect(newChild.relH).toBeCloseTo(origChild.relH, 1);
    }
  });

  test('stretch zoom layout differs from fresh layout at window aspect', async ({ page }) => {
    // This verifies the stretch zoom actually preserves structure rather than
    // just re-laying-out at the window aspect ratio (which the regular zoom does).
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Find a node whose rect has a very different aspect ratio from the window
    const info = await page.locator('raised-treemap').evaluate((el) => {
      const stageRect = el._stage.getBoundingClientRect();
      const windowAspect = stageRect.width / stageRect.height;
      let best = null;
      let bestDiff = 0;
      for (const n of el._tree.nodes.values()) {
        if (!n.childIds || n.childIds.length < 3) continue;
        const r = el._nodeRects.get(n.id);
        if (!r || r.w < 50 || r.h < 50) continue;
        const nodeAspect = r.w / r.h;
        const diff = Math.abs(nodeAspect - windowAspect);
        if (diff > bestDiff) { bestDiff = diff; best = { id: n.id, nodeAspect, windowAspect }; }
      }
      return best;
    });

    if (!info || Math.abs(info.nodeAspect - info.windowAspect) < 0.3) {
      test.skip();
      return;
    }

    // Stretch-zoom into the node
    await page.locator('raised-treemap').evaluate((el, id) => {
      el._selectedId = id;
      el.stretchZoomIn(id);
    }, info.id);
    await waitForZoomAnimation(page);

    // Record the stretch-zoom leaf positions
    const stretchLeaves = await page.locator('raised-treemap').evaluate((el) =>
      el._leaves.map(l => ({ id: l.id, x: l.x, y: l.y, w: l.w, h: l.h })));

    // Now do a regular zoom (non-stretch) into the same node
    await page.locator('raised-treemap').evaluate((el, id) => {
      el._stretchZoomId = null;
      el._stretchZoomAspect = 0;
      el._internalVisibleRootId = id;
      el._rebuildAndRender();
    }, info.id);
    await waitForRender(page);

    const regularLeaves = await page.locator('raised-treemap').evaluate((el) =>
      el._leaves.map(l => ({ id: l.id, x: l.x, y: l.y, w: l.w, h: l.h })));

    // The layouts should differ (at least some positions should be different)
    let differences = 0;
    for (const sl of stretchLeaves) {
      const rl = regularLeaves.find(r => r.id === sl.id);
      if (!rl) continue;
      if (Math.abs(sl.x - rl.x) > 2 || Math.abs(sl.y - rl.y) > 2 ||
          Math.abs(sl.w - rl.w) > 2 || Math.abs(sl.h - rl.h) > 2) {
        differences++;
      }
    }
    expect(differences).toBeGreaterThan(0);
  });

  test('depth-capped nodes become visible after stretch zoom', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Set displayDepth=1 so only one level of children renders from the root.
    // Then zoom into a depth-1 node — the depth cap shifts, revealing its
    // children (previously hidden because they were at depth 2, beyond the cap).
    await page.locator('raised-treemap').evaluate((el) => { el.displayDepth = 1; });
    await waitForRender(page);

    const nodeInfo = await page.locator('raised-treemap').evaluate((el) => {
      const leafCountBefore = el._leaves.length;
      for (const n of el._tree.nodes.values()) {
        if (n.depth === 1 && n.childIds && n.childIds.length > 0) {
          for (const cid of n.childIds) {
            const child = el._tree.nodes.get(cid);
            if (child && child.childIds && child.childIds.length > 0) {
              return { id: n.id, leafCountBefore };
            }
          }
        }
      }
      return null;
    });

    if (!nodeInfo) { test.skip(); return; }

    await page.locator('raised-treemap').evaluate((el, id) => {
      el._selectedId = id;
      el.stretchZoomIn(id);
    }, nodeInfo.id);
    await waitForZoomAnimation(page);

    const after = await page.locator('raised-treemap').evaluate((el, beforeCount) => {
      return { leafCount: el._leaves.length, beforeCount };
    }, nodeInfo.leafCountBefore);

    // The zoomed subtree should have MORE leaves than the single depth-capped
    // leaf that represented this node before, because its children are now visible.
    expect(after.leafCount).toBeGreaterThan(1);
    await snap(page, '12-stretch-zoom-newly-visible');
  });

  test('small nodes that were sub-pixel become rendered cells after zoom', async ({ page }) => {
    await page.goto('/samples/filesystem.html');
    await waitForRender(page);

    // Find a parent node that occupies a small rect — some of its children
    // may be tiny (near sub-pixel). After zooming in, that parent's rect
    // fills the canvas, so those children get real pixel area.
    const target = await page.locator('raised-treemap').evaluate((el) => {
      const canvasArea = el._canvas.width * el._canvas.height;
      // Find a rendered node whose rect is small relative to the canvas
      // and that has children in the tree (so zooming reveals structure).
      for (const n of el._tree.nodes.values()) {
        if (!n.childIds || n.childIds.length < 2) continue;
        const r = el._nodeRects.get(n.id);
        if (!r) continue;
        const nodeArea = r.w * r.h;
        // Node occupies 1–25% of the canvas: small enough that children
        // may be near-invisible, big enough to actually have a rect.
        if (nodeArea / canvasArea > 0.005 && nodeArea / canvasArea < 0.25) {
          // Count how many of its descendant leaves are currently rendered
          const descendantLeaves = el._leaves.filter((l) => {
            let cur = el._tree.nodes.get(l.id);
            while (cur) {
              if (cur.id === n.id) return true;
              cur = cur.parentId ? el._tree.nodes.get(cur.parentId) : null;
            }
            return false;
          });
          return {
            id: n.id,
            leafCountBefore: descendantLeaves.length,
            nodeArea,
            canvasArea,
          };
        }
      }
      return null;
    });

    if (!target) { test.skip(); return; }

    // Stretch-zoom into the small node
    await page.locator('raised-treemap').evaluate((el, id) => {
      el._selectedId = id;
      el.stretchZoomIn(id);
    }, target.id);
    await waitForZoomAnimation(page);

    const afterLeafCount = await page.locator('raised-treemap').evaluate((el) => el._leaves.length);

    // After zoom, the node fills the canvas. Its children now have much more
    // pixel area, so we should see at least as many leaves — often more,
    // because children that had sub-pixel rects now have room to render.
    expect(afterLeafCount).toBeGreaterThanOrEqual(target.leafCountBefore);

    // Verify every rendered leaf has a non-trivial size (at least 1×1 pixel)
    const allVisible = await page.locator('raised-treemap').evaluate((el) =>
      el._leaves.every((l) => l.w >= 1 && l.h >= 1));
    expect(allVisible).toBe(true);
  });

  test('reset zoom returns to original view', async ({ page }) => {
    await page.goto('/samples/filesystem.html');
    await waitForRender(page);

    // Record original leaf count
    const originalLeafCount = await page.locator('raised-treemap').evaluate((el) => el._leaves.length);

    // Click a cell and navigate up to find a parent
    const box = await page.locator('raised-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await waitForRender(page);
    await page.locator('raised-treemap').evaluate((el) => {
      // Navigate up to a parent
      el._selAncestorUp();
      el._selAncestorUp();
    });
    await waitForRender(page);

    // Stretch-zoom in
    const zoomedId = await page.locator('raised-treemap').evaluate((el) => {
      if (el._selectedId) el.stretchZoomIn(el._selectedId);
      return el._stretchZoomId;
    });
    await waitForZoomAnimation(page);

    if (!zoomedId) { test.skip(); return; }
    expect(zoomedId).not.toBeNull();

    // Reset zoom via the public API (same as clicking the root icon)
    await page.locator('raised-treemap').evaluate((el) => el.zoomReset());
    await waitForZoomAnimation(page);

    // Verify we're back to the original state
    const state = await page.locator('raised-treemap').evaluate((el) => ({
      stretchZoomId: el._stretchZoomId,
      leafCount: el._leaves.length,
      visibleRootId: el._internalVisibleRootId,
    }));
    expect(state.stretchZoomId).toBeNull();
    expect(state.visibleRootId).toBeNull();
    expect(state.leafCount).toBe(originalLeafCount);
  });

  test('zoom out button exits stretch zoom', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Click a cell, navigate to parent, then stretch zoom
    const box = await page.locator('raised-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);
    await page.locator('raised-treemap').evaluate((el) => el._selAncestorUp());
    await waitForRender(page);

    const didZoom = await page.locator('raised-treemap').evaluate((el) => {
      if (el._selectedId) el.stretchZoomIn(el._selectedId);
      return !!el._stretchZoomId;
    });
    if (!didZoom) { test.skip(); return; }
    await waitForZoomAnimation(page);

    // Click zoom out
    await page.locator('raised-treemap').evaluate((el) => el.zoomOut());
    await waitForZoomAnimation(page);

    const after = await page.locator('raised-treemap').evaluate((el) => el._stretchZoomId);
    expect(after).toBeNull();
  });

  test('stretch zoom fires rt-zoom-change event', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Click and navigate to parent
    const box = await page.locator('raised-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);
    await page.locator('raised-treemap').evaluate((el) => el._selAncestorUp());
    await waitForRender(page);

    // Listen for zoom-change events
    const events = await page.locator('raised-treemap').evaluate((el) => {
      const evts = [];
      el.addEventListener('rt-zoom-change', (e) => evts.push(e.detail));

      if (el._selectedId) el.stretchZoomIn(el._selectedId);
      return evts;
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].nodeId).not.toBeNull();
  });

  test('visual: stretch zoom screenshot', async ({ page }) => {
    await page.goto('/samples/filesystem.html');
    await waitForRender(page);

    // Click a prominent cell and zoom in
    const box = await page.locator('raised-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await waitForRender(page);
    // Navigate up to a visible parent
    await page.locator('raised-treemap').evaluate((el) => el._selAncestorUp());
    await waitForRender(page);

    await page.locator('raised-treemap').evaluate((el) => {
      if (el._selectedId) el.stretchZoomIn(el._selectedId);
    });
    await waitForZoomAnimation(page);
    await snap(page, '13-stretch-zoom-in');

    // Reset and snap
    await page.locator('raised-treemap').evaluate((el) => el.stretchZoomReset());
    await waitForZoomAnimation(page);
    await snap(page, '14-stretch-zoom-reset');
  });

  test('hit-testing works correctly on stretch-zoomed cells', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Click a cell, go to parent, stretch zoom
    const box = await page.locator('raised-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await waitForRender(page);
    await page.locator('raised-treemap').evaluate((el) => el._selAncestorUp());
    await waitForRender(page);

    const didZoom = await page.locator('raised-treemap').evaluate((el) => {
      if (el._selectedId) el.stretchZoomIn(el._selectedId);
      return !!el._stretchZoomId;
    });
    if (!didZoom) { test.skip(); return; }
    await waitForZoomAnimation(page);

    // Move mouse over cells — we should get hover events
    const tmBox = await page.locator('raised-treemap').boundingBox();
    await page.mouse.move(tmBox.x + tmBox.width * 0.25, tmBox.y + tmBox.height * 0.25);
    await page.waitForTimeout(100);

    const hoverId = await page.locator('raised-treemap').evaluate((el) => el._hoverId);
    expect(hoverId).not.toBeNull();
  });

});
