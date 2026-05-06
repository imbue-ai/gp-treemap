// A small set of pure-JS unit tests that exercise the core modules through a
// blank page. We import via absolute paths served from the webServer so the
// same ES modules the component uses are covered, without any bundler.
import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.goto('/tests/unit-fixture.html');
  await page.waitForFunction(() => window.__mods);
}

test('layout: rects sum to parent area', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const { balanceChildren, layoutTree } = window.__mods;
    const items = [
      { id: 'a', size: 40 }, { id: 'b', size: 60 },
      { id: 'c', size: 25 }, { id: 'd', size: 75 },
    ];
    const root = balanceChildren(items);
    const got = [];
    layoutTree(root, { x: 0, y: 0, w: 800, h: 400 }, (id, r) => got.push({ id, r }));
    const total = got.reduce((s, x) => s + x.r.w * x.r.h, 0);
    return { got, total };
  });
  expect(result.got.length).toBe(4);
  expect(Math.abs(result.total - 800 * 400)).toBeLessThan(1);
});

test('layout: covers the whole parent rect with no background holes', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const { balanceChildren, layoutTree } = window.__mods;
    // One dominant sibling and a small sibling whose rect is well above
    // sub-pixel but well below any plausible min-area threshold (400 px²
    // inside a 40,000-px² parent). GrandPerspective-style layout only
    // culls sub-pixel rects, so this small cell must still be drawn and
    // the parent rect must be fully covered with no black gaps.
    const items = [{ id: 'big', size: 99 }, { id: 'small', size: 1 }];
    const root = balanceChildren(items);
    const rect = { x: 0, y: 0, w: 200, h: 200 };
    const got = [];
    layoutTree(root, rect, (id, r) => got.push({ id, r }));
    const covered = got.reduce((s, x) => s + x.r.w * x.r.h, 0);
    return { parentArea: rect.w * rect.h, covered, leaves: got.length };
  });
  expect(result.leaves).toBe(2);
  expect(Math.abs(result.covered - result.parentArea)).toBeLessThan(1);
});

test('balancer: equal-size items produce a perfectly balanced tree', async ({ page }) => {
  await setup(page);
  const depth = await page.evaluate(() => {
    const { balanceChildren, maxDepth } = window.__mods;
    const items = Array.from({ length: 16 }, (_, i) => ({ id: 'n' + i, size: 1 }));
    return maxDepth(balanceChildren(items));
  });
  // 16 equal-sized leaves → perfectly balanced binary tree of depth log2(16)+1 = 5
  expect(depth).toBe(5);
});

test('balancer: single item returns a leaf', async ({ page }) => {
  await setup(page);
  const r = await page.evaluate(() => {
    const { balanceChildren } = window.__mods;
    const n = balanceChildren([{ id: 'x', size: 7 }]);
    return { isLeaf: n.isLeaf, id: n.id, size: n.size };
  });
  expect(r).toEqual({ isLeaf: true, id: 'x', size: 7 });
});

test('builder: tabular with explicit ids, value aggregation', async ({ page }) => {
  await setup(page);
  const res = await page.evaluate(() => {
    const { buildFromTabular } = window.__mods;
    const { nodes, roots } = buildFromTabular({
      labels:  ['A','B','C','D'],
      parents: ['','A','A','B'],
      values:  [0, 0, 10, 7],
      ids:     ['A','B','C','D'],
    }, {});
    return {
      rootValue: nodes.get('A').value,
      bValue: nodes.get('B').value,
      rootId: roots[0],
    };
  });
  expect(res.rootId).toBe('A');
  expect(res.bValue).toBe(7);
  expect(res.rootValue).toBe(17);
});

test('color-scale: linear maps min→0, max→last', async ({ page }) => {
  await setup(page);
  const res = await page.evaluate(() => {
    const { buildLinearScale } = window.__mods;
    const s = buildLinearScale([0, 100], 5);
    return { lo: s(0), mid: s(50), hi: s(100), over: s(200), under: s(-10) };
  });
  expect(res.lo).toBe(0);
  expect(res.hi).toBe(4);
  expect(res.over).toBe(4);
  expect(res.under).toBe(0);
});

test('color-scale: diverging mid→palette[mid]', async ({ page }) => {
  await setup(page);
  const res = await page.evaluate(() => {
    const { buildDivergingScale } = window.__mods;
    const s = buildDivergingScale([-5, 0, 5], 7);
    return { mid: s(0), min: s(-5), max: s(5) };
  });
  expect(res.mid).toBe(3);
  expect(res.min).toBe(0);
  expect(res.max).toBe(6);
});

test('fnv1a: deterministic and bounded', async ({ page }) => {
  await setup(page);
  const res = await page.evaluate(() => {
    const { fnv1a } = window.__mods;
    return { a: fnv1a('hello'), b: fnv1a('hello'), c: fnv1a('world') };
  });
  expect(res.a).toBe(res.b);
  expect(res.a).not.toBe(res.c);
  expect(res.a).toBeGreaterThanOrEqual(0);
});

// Regression: clicking a parent in the breadcrumb must draw the focused-cell
// overlay box. Earlier the click handler unconditionally coerced numeric-
// looking id strings to Number(), so when a caller passed string ids like
// '0','1','2' (e.g. from buildToGptm in scripts/build-comparison.mjs) the
// resulting Map.get(numberKey) missed and no rect was drawn.
// Mount a small tree using string ids ('0','1','2',...) wired through the
// labels/parents API \u2014 the path that hit the breadcrumb-coercion bug.
async function mountGptmStrings(page) {
  await page.goto('/tests/unit-fixture.html');
  await page.evaluate(() => {
    const tm = document.createElement('gp-treemap');
    tm.id = 'tm';
    tm.style.cssText = 'display:block; width:600px; height:400px;';
    document.body.appendChild(tm);
    tm.ids     = ['0','1','2','3','4','5','6','7','8'];
    tm.labels  = ['root','A','B','a1','a2','a3','b1','b2','b3'];
    tm.parents = ['','0','0','1','1','1','2','2','2'];
    tm.values  = [0, 0, 0, 10, 20, 30, 15, 25, 35];
  });
  await page.waitForFunction(() => {
    const tm = document.getElementById('tm');
    return tm && tm._tree && tm._nodeRects && tm._nodeRects.size > 0;
  });
}

// Same shape but via parentIndices \u2014 the fast path that uses integer
// row indices as tree node ids.
async function mountGptmIntegers(page) {
  await page.goto('/tests/unit-fixture.html');
  await page.evaluate(() => {
    const tm = document.createElement('gp-treemap');
    tm.id = 'tm';
    tm.style.cssText = 'display:block; width:600px; height:400px;';
    document.body.appendChild(tm);
    tm.labels         = ['root','A','B','a1','a2','a3','b1','b2','b3'];
    tm.parentIndices  = [-1, 0, 0, 1, 1, 1, 2, 2, 2];
    tm.values         = [0, 0, 0, 10, 20, 30, 15, 25, 35];
  });
  await page.waitForFunction(() => {
    const tm = document.getElementById('tm');
    return tm && tm._tree && tm._nodeRects && tm._nodeRects.size > 0;
  });
}

test('breadcrumb: clicking a parent draws the focus overlay (string ids)', async ({ page }) => {
  await mountGptmStrings(page);
  // Simulate clicking a leaf so the breadcrumb populates its ancestor chain.
  await page.locator('gp-treemap').evaluate((tm) => {
    tm._targetId = '3'; tm._focusId = '3'; tm._updateToolbarInfo();
  });
  // Now click the parent ('A' = id '1') in the breadcrumb.
  const r = await page.locator('gp-treemap').evaluate((tm) => {
    tm.shadowRoot.querySelector('a[data-node-id="1"]').click();
    return {
      focusId: tm._focusId,
      hasOverlayBox: !!tm.shadowRoot.querySelector('.overlay .sel'),
      breadcrumbFocused: !!tm.shadowRoot.querySelector('a[data-node-id="1"].focused'),
    };
  });
  expect(r.focusId).toBe('1');
  expect(r.hasOverlayBox).toBe(true);
  expect(r.breadcrumbFocused).toBe(true);
});

test('breadcrumb: clicking a parent draws the focus overlay (parentIndices/integer ids)', async ({ page }) => {
  await mountGptmIntegers(page);
  await page.locator('gp-treemap').evaluate((tm) => {
    tm._targetId = 3; tm._focusId = 3; tm._updateToolbarInfo();
  });
  const r = await page.locator('gp-treemap').evaluate((tm) => {
    tm.shadowRoot.querySelector('a[data-node-id="1"]').click();
    return {
      focusId: tm._focusId,
      hasOverlayBox: !!tm.shadowRoot.querySelector('.overlay .sel'),
      breadcrumbFocused: !!tm.shadowRoot.querySelector('a[data-node-id="1"].focused'),
    };
  });
  // With integer-id tree, _coerceTreeId resolves '1' back to 1.
  expect(r.focusId).toBe(1);
  expect(r.hasOverlayBox).toBe(true);
  expect(r.breadcrumbFocused).toBe(true);
});

test('_coerceTreeId: prefers the type the tree actually uses', async ({ page }) => {
  await mountGptmStrings(page);
  const stringCase = await page.locator('gp-treemap').evaluate((tm) => ({
    coerced: tm._coerceTreeId('1'),
    type: typeof tm._coerceTreeId('1'),
  }));
  expect(stringCase.coerced).toBe('1');
  expect(stringCase.type).toBe('string');

  await mountGptmIntegers(page);
  const numericCase = await page.locator('gp-treemap').evaluate((tm) => ({
    coerced: tm._coerceTreeId('1'),
    type: typeof tm._coerceTreeId('1'),
  }));
  expect(numericCase.coerced).toBe(1);
  expect(numericCase.type).toBe('number');
});
