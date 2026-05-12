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

// [Level 1] color mode: every leaf inherits its top-most-ancestor's color
// hash (relative to the current zoom root), so direct children of the zoom
// root get distinct colors and their descendants share with their parent.
test('color-mode level1: descendants share color with their top-level ancestor', async ({ page }) => {
  await page.goto('/tests/unit-fixture.html');
  const r = await page.evaluate(() => {
    const { fnv1a } = window.__mods;
    const tm = document.createElement('gp-treemap');
    tm.id = 'tm';
    tm.style.cssText = 'display:block; width:600px; height:400px;';
    tm.setAttribute('color-mode', 'level1');
    document.body.appendChild(tm);
    // root → A,B; A → a1,a2; B → b1,b2
    tm.ids     = ['root','A','B','a1','a2','b1','b2'];
    tm.labels  = ['root','A','B','a1','a2','b1','b2'];
    tm.parents = ['','root','root','A','A','B','B'];
    tm.values  = [0, 0, 0, 10, 20, 15, 25];
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const get = (id) => tm._tree.nodes.get(id).colorIndex;
        resolve({
          aHash: fnv1a('A') % 8,
          bHash: fnv1a('B') % 8,
          A: get('A'), B: get('B'),
          a1: get('a1'), a2: get('a2'),
          b1: get('b1'), b2: get('b2'),
        });
      }));
    });
  });
  // A and its descendants share one color; B and its descendants share another.
  expect(r.A).toBe(r.a1);
  expect(r.A).toBe(r.a2);
  expect(r.B).toBe(r.b1);
  expect(r.B).toBe(r.b2);
  // Top-level ancestors get distinct colors (different hashes here).
  expect(r.A).not.toBe(r.B);
});

// Re-colors on zoom: when zoomed into a subtree, the level-1 hash is computed
// relative to the *new* zoom root, so each direct child of that root becomes
// its own color group.
test('color-mode level1: recolors relative to the current zoom root', async ({ page }) => {
  await page.goto('/tests/unit-fixture.html');
  const r = await page.evaluate(() => {
    const tm = document.createElement('gp-treemap');
    tm.id = 'tm';
    tm.style.cssText = 'display:block; width:600px; height:400px;';
    tm.setAttribute('color-mode', 'level1');
    document.body.appendChild(tm);
    // root → A,B; A → a1,a2; a1 → x,y; a2 → p,q
    tm.ids     = ['root','A','B','a1','a2','x','y','p','q'];
    tm.labels  = ['root','A','B','a1','a2','x','y','p','q'];
    tm.parents = ['','root','root','A','A','a1','a1','a2','a2'];
    tm.values  = [0, 0, 0, 0, 0, 10, 20, 15, 25];
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        // Zoom into A: a1 and a2 are now the top-level children.
        tm.visibleRootId = 'A';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const get = (id) => tm._tree.nodes.get(id).colorIndex;
          resolve({
            a1: get('a1'), a2: get('a2'),
            x: get('x'), y: get('y'),
            p: get('p'), q: get('q'),
          });
        }));
      }));
    });
  });
  // After zooming to A, a1 and a2 become the top-level groups.
  expect(r.x).toBe(r.a1);
  expect(r.y).toBe(r.a1);
  expect(r.p).toBe(r.a2);
  expect(r.q).toBe(r.a2);
  expect(r.a1).not.toBe(r.a2);
});

// Ancestor highlighting: when enabled, every cell along the target→root chain
// gets a dim outline + corner label, and the focused cell keeps its bright
// .sel outline. Labels stack vertically when an inner ancestor's natural
// upper-left position collides with an outer ancestor's label.
test('show-ancestors: outlines + corner labels along target→root chain', async ({ page }) => {
  await page.goto('/tests/unit-fixture.html');
  await page.evaluate(() => {
    const tm = document.createElement('gp-treemap');
    tm.id = 'tm';
    tm.style.cssText = 'width:600px; height:400px;';
    tm.setAttribute('show-ancestors', 'true');
    document.body.appendChild(tm);
    // root -> A -> a1 -> x ; root -> B -> b1
    tm.ids     = ['root','A','B','a1','x','b1'];
    tm.labels  = ['root','A','B','a1','x','b1'];
    tm.parents = ['','root','root','A','a1','B'];
    tm.values  = [0, 0, 0, 0, 100, 50];
  });
  await page.waitForFunction(() => {
    const tm = document.getElementById('tm');
    return tm && tm._nodeRects && tm._nodeRects.size > 0;
  });
  const r = await page.evaluate(() => {
    const tm = document.getElementById('tm');
    tm._targetId = 'x'; tm._focusId = 'x';
    const { cssW, cssH, dpr } = tm._canvasMetrics();
    tm._renderOverlay(cssW, cssH, dpr);
    const ancBoxes = tm.shadowRoot.querySelectorAll('.overlay .anc');
    const ancLbls = tm.shadowRoot.querySelectorAll('.overlay .anc-lbl');
    const lblTexts = Array.from(ancLbls).map((el) => el.textContent);
    const selBox = tm.shadowRoot.querySelector('.overlay .sel');
    return {
      ancBoxCount: ancBoxes.length,
      ancLblCount: ancLbls.length,
      lblTexts,
      hasFocusedSel: !!selBox,
    };
  });
  // Target→root (exclusive) chain for 'x' = [x, a1, A]. Focused cell 'x' gets
  // the white .sel and skips the dim .anc box but still gets its corner label.
  expect(r.ancBoxCount).toBe(2);  // a1 and A
  expect(r.ancLblCount).toBe(3);  // x, a1, A
  expect(r.lblTexts).toEqual(expect.arrayContaining(['x', 'a1', 'A']));
  expect(r.hasFocusedSel).toBe(true);
});

test('show-ancestors: nested labels stack downward when upper-left corners collide', async ({ page }) => {
  await page.goto('/tests/unit-fixture.html');
  await page.evaluate(() => {
    const tm = document.createElement('gp-treemap');
    tm.id = 'tm';
    tm.style.cssText = 'width:600px; height:400px;';
    tm.setAttribute('show-ancestors', 'true');
    document.body.appendChild(tm);
    // Three deeply-nested ancestors that share the upper-left corner.
    tm.ids     = ['root','outer','mid','inner','leaf'];
    tm.labels  = ['root','OuterAncestorLabel','MiddleAncestorLabel','InnerAncestorLabel','leaf'];
    tm.parents = ['','root','outer','mid','inner'];
    tm.values  = [0, 0, 0, 0, 100];
  });
  await page.waitForFunction(() => {
    const tm = document.getElementById('tm');
    return tm && tm._nodeRects && tm._nodeRects.size > 0;
  });
  const r = await page.evaluate(() => {
    const tm = document.getElementById('tm');
    tm._targetId = 'leaf'; tm._focusId = 'leaf';
    const { cssW, cssH, dpr } = tm._canvasMetrics();
    tm._renderOverlay(cssW, cssH, dpr);
    const lbls = Array.from(tm.shadowRoot.querySelectorAll('.overlay .anc-lbl'));
    const tops = {};
    for (const l of lbls) tops[l.textContent] = parseFloat(l.style.top);
    return { tops, count: lbls.length };
  });
  // With all four cells sharing the same upper-left, labels must stack
  // strictly downward in outer-to-inner order. Outer < Middle < Inner < leaf.
  expect(r.count).toBe(4);
  expect(r.tops.OuterAncestorLabel).toBeLessThan(r.tops.MiddleAncestorLabel);
  expect(r.tops.MiddleAncestorLabel).toBeLessThan(r.tops.InnerAncestorLabel);
  expect(r.tops.InnerAncestorLabel).toBeLessThan(r.tops.leaf);
});

test('show-ancestors: disabled by default — no overlay added', async ({ page }) => {
  await page.goto('/tests/unit-fixture.html');
  await page.evaluate(() => {
    const tm = document.createElement('gp-treemap');
    tm.id = 'tm';
    tm.style.cssText = 'width:600px; height:400px;';
    document.body.appendChild(tm);
    tm.ids     = ['root','A','x'];
    tm.labels  = ['root','A','x'];
    tm.parents = ['','root','A'];
    tm.values  = [0, 0, 100];
  });
  await page.waitForFunction(() => {
    const tm = document.getElementById('tm');
    return tm && tm._nodeRects && tm._nodeRects.size > 0;
  });
  const count = await page.evaluate(() => {
    const tm = document.getElementById('tm');
    tm._targetId = 'x'; tm._focusId = 'x';
    const { cssW, cssH, dpr } = tm._canvasMetrics();
    tm._renderOverlay(cssW, cssH, dpr);
    return tm.shadowRoot.querySelectorAll('.overlay .anc, .overlay .anc-lbl').length;
  });
  expect(count).toBe(0);
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
