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
    const before = await page.locator('gp-treemap').evaluate((el) => {
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
    await page.locator('gp-treemap').evaluate((el, targetId) => {
      el._targetId = targetId;
      el.stretchZoomIn(targetId);
    }, before.targetId);
    await waitForZoomAnimation(page);

    // Get the new layout and verify relative positions match
    const after = await page.locator('gp-treemap').evaluate((el, data) => {
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
    const info = await page.locator('gp-treemap').evaluate((el) => {
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
    await page.locator('gp-treemap').evaluate((el, id) => {
      el._targetId = id;
      el.stretchZoomIn(id);
    }, info.id);
    await waitForZoomAnimation(page);

    // Record the stretch-zoom leaf positions
    const stretchLeaves = await page.locator('gp-treemap').evaluate((el) =>
      el._leaves.map(l => ({ id: l.id, x: l.x, y: l.y, w: l.w, h: l.h })));

    // Now do a regular zoom (non-stretch) into the same node
    await page.locator('gp-treemap').evaluate((el, id) => {
      el._stretchZoomId = null;
      el._stretchZoomAspect = 0;
      el._internalVisibleRootId = id;
      el._rebuildAndRender();
    }, info.id);
    await waitForRender(page);

    const regularLeaves = await page.locator('gp-treemap').evaluate((el) =>
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
    await page.locator('gp-treemap').evaluate((el) => { el.displayDepth = 1; });
    await waitForRender(page);

    const nodeInfo = await page.locator('gp-treemap').evaluate((el) => {
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

    await page.locator('gp-treemap').evaluate((el, id) => {
      el._targetId = id;
      el.stretchZoomIn(id);
    }, nodeInfo.id);
    await waitForZoomAnimation(page);

    const after = await page.locator('gp-treemap').evaluate((el, beforeCount) => {
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
    const target = await page.locator('gp-treemap').evaluate((el) => {
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
    await page.locator('gp-treemap').evaluate((el, id) => {
      el._targetId = id;
      el.stretchZoomIn(id);
    }, target.id);
    await waitForZoomAnimation(page);

    const afterLeafCount = await page.locator('gp-treemap').evaluate((el) => el._leaves.length);

    // After zoom, the node fills the canvas. Its children now have much more
    // pixel area, so we should see at least as many leaves — often more,
    // because children that had sub-pixel rects now have room to render.
    expect(afterLeafCount).toBeGreaterThanOrEqual(target.leafCountBefore);

    // Verify every rendered leaf has a non-trivial size (at least 1×1 pixel)
    const allVisible = await page.locator('gp-treemap').evaluate((el) =>
      el._leaves.every((l) => l.w >= 1 && l.h >= 1));
    expect(allVisible).toBe(true);
  });

  test('reset zoom returns to original view', async ({ page }) => {
    await page.goto('/samples/filesystem.html');
    await waitForRender(page);

    // Record original leaf count
    const originalLeafCount = await page.locator('gp-treemap').evaluate((el) => el._leaves.length);

    // Click a cell and navigate up to find a parent
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await waitForRender(page);
    await page.locator('gp-treemap').evaluate((el) => {
      // Navigate up to a parent
      el._focusUp();
      el._focusUp();
    });
    await waitForRender(page);

    // Stretch-zoom in
    const zoomedId = await page.locator('gp-treemap').evaluate((el) => {
      { var id = el._focusId || el._targetId; if (id) el.stretchZoomIn(id); }
      return el._stretchZoomId;
    });
    await waitForZoomAnimation(page);

    if (!zoomedId) { test.skip(); return; }
    expect(zoomedId).not.toBeNull();

    // Reset zoom via the public API (same as clicking the root icon)
    await page.locator('gp-treemap').evaluate((el) => el.zoomReset());
    await waitForZoomAnimation(page);

    // Verify we're back to the original state
    const state = await page.locator('gp-treemap').evaluate((el) => ({
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
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);
    await page.locator('gp-treemap').evaluate((el) => el._focusUp());
    await waitForRender(page);

    const didZoom = await page.locator('gp-treemap').evaluate((el) => {
      { var id = el._focusId || el._targetId; if (id) el.stretchZoomIn(id); }
      return !!el._stretchZoomId;
    });
    if (!didZoom) { test.skip(); return; }
    await waitForZoomAnimation(page);

    // Click zoom out
    await page.locator('gp-treemap').evaluate((el) => el.zoomOut());
    await waitForZoomAnimation(page);

    const after = await page.locator('gp-treemap').evaluate((el) => el._stretchZoomId);
    expect(after).toBeNull();
  });

  test('stretch zoom fires gp-zoom-change event', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Click and navigate to parent
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await waitForRender(page);
    await page.locator('gp-treemap').evaluate((el) => el._focusUp());
    await waitForRender(page);

    // Listen for zoom-change events
    const events = await page.locator('gp-treemap').evaluate((el) => {
      const evts = [];
      el.addEventListener('gp-zoom-change', (e) => evts.push(e.detail));

      { var id = el._focusId || el._targetId; if (id) el.stretchZoomIn(id); }
      return evts;
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].nodeId).not.toBeNull();
  });

  test('visual: stretch zoom screenshot', async ({ page }) => {
    await page.goto('/samples/filesystem.html');
    await waitForRender(page);

    // Click a prominent cell and zoom in
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await waitForRender(page);
    // Navigate up to a visible parent
    await page.locator('gp-treemap').evaluate((el) => el._focusUp());
    await waitForRender(page);

    await page.locator('gp-treemap').evaluate((el) => {
      { var id = el._focusId || el._targetId; if (id) el.stretchZoomIn(id); }
    });
    await waitForZoomAnimation(page);
    await snap(page, '13-stretch-zoom-in');

    // Reset and snap
    await page.locator('gp-treemap').evaluate((el) => el.stretchZoomReset());
    await waitForZoomAnimation(page);
    await snap(page, '14-stretch-zoom-reset');
  });

  // Reproduces the "black holes" bug: stretch-zooming into a narrow node
  // lays out children at the original (narrow) aspect ratio, then scales
  // the rects to fill the canvas. The visible() check in layoutTree drops
  // cells that are sub-pixel in the narrow layout space BEFORE the stretch-
  // scale is applied — those cells would have been visible after scaling.
  // The result is background-colored "holes" with no hit-testing.
  //
  // This test uses a fixture with a deliberately narrow node ("narrow")
  // that contains many tiny children. The narrow layout space (~13 px wide)
  // produces sub-pixel balanced-tree rects that visible() discards.
  // A regular (non-stretch) zoom into the same node renders all children
  // at full canvas width, so no cells are dropped.
  test('stretch zoom into narrow node drops cells that regular zoom keeps (holes bug)', async ({ page }) => {
    await page.goto('/tests/stretch-zoom-holes.html');
    await waitForRender(page);

    // Find the "narrow" node by label. With parentIndices (scan-like fast
    // path), node IDs are integers — row indices, not string labels.
    const setup = await page.locator('gp-treemap').evaluate((el) => {
      let narrowId = null;
      for (const [id, n] of el._tree.nodes) {
        if (n.label === 'narrow') { narrowId = id; break; }
      }
      if (narrowId == null) return null;
      const nr = el._nodeRects.get(narrowId);
      if (!nr) return null;
      const canvasW = el._canvas.width;
      const canvasH = el._canvas.height;
      // Count tree leaf descendants of "narrow".
      let treeChildCount = 0;
      const stack = [narrowId];
      while (stack.length) {
        const nid = stack.pop();
        const nd = el._tree.nodes.get(nid);
        if (!nd) continue;
        if (!nd.childIds || nd.childIds.length === 0) treeChildCount++;
        else for (const c of nd.childIds) stack.push(c);
      }
      return {
        narrowId,
        narrowW: nr.w,
        narrowH: nr.h,
        aspect: nr.w / nr.h,
        canvasW,
        canvasH,
        treeChildCount,
      };
    });

    expect(setup).not.toBeNull();
    // The narrow node should be thin (much less than half canvas width).
    expect(setup.narrowW).toBeLessThan(setup.canvasW * 0.1);
    expect(setup.treeChildCount).toBeGreaterThan(20);

    // --- Stretch-zoom into "narrow" ---
    await page.locator('gp-treemap').evaluate((el, nid) => {
      el._targetId = nid;
      el.stretchZoomIn(nid);
    }, setup.narrowId);
    await waitForZoomAnimation(page);

    const stretchResult = await page.locator('gp-treemap').evaluate((el) => {
      return {
        leafCount: el._leaves.length,
        leafIds: el._leaves.map((l) => l.id),
        stretchZoomId: el._stretchZoomId,
      };
    });
    expect(stretchResult.stretchZoomId).toBe(setup.narrowId);

    // --- Regular zoom into same node (for comparison) ---
    await page.locator('gp-treemap').evaluate((el, nid) => {
      // Clear stretch-zoom state and do a regular zoom.
      el._stretchZoomId = null;
      el._stretchZoomAspect = 0;
      el._zoomAnimating = false;
      el._internalVisibleRootId = nid;
      el._rebuildAndRender();
    }, setup.narrowId);
    await page.evaluate(() =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const regularResult = await page.locator('gp-treemap').evaluate((el) => {
      return {
        leafCount: el._leaves.length,
        leafIds: el._leaves.map((l) => l.id),
      };
    });

    // The bug: stretch zoom renders FEWER leaves than regular zoom because
    // visible() drops sub-pixel cells before the stretch-scale is applied.
    // All tree leaf descendants of "narrow" should be rendered in both cases.
    //
    // This assertion documents the bug — it will FAIL until the layout is
    // fixed to account for the post-layout stretch scaling.
    const missingInStretch = regularResult.leafIds.filter(
      (id) => !stretchResult.leafIds.includes(id),
    );
    expect(
      missingInStretch,
      `stretch zoom dropped ${missingInStretch.length} cells that regular zoom renders — these are the "holes"`,
    ).toHaveLength(0);
  });

  // Reproduces the "can't zoom out to ancestor" bug: when stretch-zoomed into
  // a deep node, double-clicking a higher-level breadcrumb entry calls
  // stretchZoomIn(ancestorId). But stretchZoomIn looks up the ancestor in
  // _nodeRects, which only contains nodes in the CURRENT visible subtree.
  // Since the ancestor is above the zoom root, its rect isn't there, and the
  // call silently returns — the zoom doesn't change.
  //
  // Only double-clicking "home" works because it calls zoomReset() →
  // stretchZoomReset(), which doesn't need _nodeRects.
  test('stretchZoomIn to ancestor of current zoom root is a no-op (zoom-out bug)', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Find a node at depth >= 2 that has children, so we can zoom into it
    // and then try to zoom to its grandparent.
    const setup = await page.locator('gp-treemap').evaluate((el) => {
      const nodes = el._tree.nodes;
      for (const n of nodes.values()) {
        if (n.depth >= 2 && n.childIds && n.childIds.length >= 2) {
          // Find its ancestors
          const parent = nodes.get(n.parentId);
          if (!parent || parent.parentId === null) continue;
          const grandparent = nodes.get(parent.parentId);
          if (!grandparent) continue;
          return {
            deepId: n.id,
            parentId: parent.id,
            grandparentId: grandparent.id,
          };
        }
      }
      return null;
    });

    if (!setup) { test.skip(); return; }

    // Stretch-zoom into the deep node.
    await page.locator('gp-treemap').evaluate((el, id) => {
      el._targetId = id;
      el.stretchZoomIn(id);
    }, setup.deepId);
    await waitForZoomAnimation(page);

    const zoomedIn = await page.locator('gp-treemap').evaluate((el) => ({
      stretchZoomId: el._stretchZoomId,
      activeRoot: el._activeVisibleRootId(),
    }));
    expect(zoomedIn.stretchZoomId).toBe(setup.deepId);

    // Now try to zoom OUT to the grandparent — this is what double-clicking
    // a breadcrumb entry does. The bug: stretchZoomIn can't find the
    // grandparent in _nodeRects (it's above the current zoom root), so
    // nothing happens.
    await page.locator('gp-treemap').evaluate((el, id) => {
      el.stretchZoomIn(id);
    }, setup.grandparentId);
    await waitForZoomAnimation(page);

    const afterZoomOut = await page.locator('gp-treemap').evaluate((el) => ({
      stretchZoomId: el._stretchZoomId,
      activeRoot: el._activeVisibleRootId(),
    }));

    // The zoom SHOULD have changed to the grandparent, but it didn't.
    // This assertion documents the bug — it will FAIL until stretchZoomIn
    // is fixed to handle ancestors outside the current subtree.
    expect(
      afterZoomOut.activeRoot,
      'stretchZoomIn to ancestor should change the zoom root (currently a no-op)',
    ).toBe(setup.grandparentId);
  });

  // When stretch-zoomed, clicking the home icon sets _focusId to root, but
  // _selectionBounds returns null because root isn't in _nodeRects (only the
  // zoom subtree is). The selection box disappears, so the user sees no
  // visual feedback that the focus changed — it looks like the click did nothing.
  test('focusing root while stretch-zoomed shows a selection box', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Click a cell and navigate to a parent with children, then zoom in.
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await waitForRender(page);
    await page.locator('gp-treemap').evaluate((el) => el._focusUp());
    await waitForRender(page);

    const didZoom = await page.locator('gp-treemap').evaluate((el) => {
      const id = el._focusId || el._targetId;
      if (id) el.stretchZoomIn(id);
      return !!el._stretchZoomId;
    });
    if (!didZoom) { test.skip(); return; }
    await waitForZoomAnimation(page);

    // Focus root (what clicking the home icon does).
    await page.locator('gp-treemap').evaluate((el) => {
      const rootId = el._tree.roots[0];
      el._setFocus(rootId);
    });
    await page.evaluate(() =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const state = await page.locator('gp-treemap').evaluate((el) => {
      const rootId = el._tree.roots[0];
      return {
        focusId: el._focusId,
        rootId,
        hasSelectionBox: el.shadowRoot.querySelector('.overlay .sel') !== null,
      };
    });

    expect(state.focusId).toBe(state.rootId);
    // The selection box must render — it should cover the entire visible area
    // since the root encompasses the zoom subtree.
    expect(
      state.hasSelectionBox,
      'selection box should be visible when root is focused while zoomed',
    ).toBe(true);
  });

  test('hit-testing works correctly on stretch-zoomed cells', async ({ page }) => {
    await page.goto('/samples/interactions.html');
    await waitForRender(page);

    // Click a cell, go to parent, stretch zoom
    const box = await page.locator('gp-treemap').boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await waitForRender(page);
    await page.locator('gp-treemap').evaluate((el) => el._focusUp());
    await waitForRender(page);

    const didZoom = await page.locator('gp-treemap').evaluate((el) => {
      { var id = el._focusId || el._targetId; if (id) el.stretchZoomIn(id); }
      return !!el._stretchZoomId;
    });
    if (!didZoom) { test.skip(); return; }
    await waitForZoomAnimation(page);

    // Move mouse over cells — we should get hover events
    const tmBox = await page.locator('gp-treemap').boundingBox();
    await page.mouse.move(tmBox.x + tmBox.width * 0.25, tmBox.y + tmBox.height * 0.25);
    await page.waitForTimeout(100);

    const hoverId = await page.locator('gp-treemap').evaluate((el) => el._hoverId);
    expect(hoverId).not.toBeNull();
  });

});
