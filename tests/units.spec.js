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
