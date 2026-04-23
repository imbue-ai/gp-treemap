#!/usr/bin/env node
// Load a gallery HTML in headless Chromium, wait for _allBlocksReady, and
// screenshot it. Used by scripts/update_gallery.sh to keep the README image
// in sync with gallery/.
//
// Usage: node scripts/screenshot-gallery.mjs <url> <output.png>

import { chromium } from 'playwright';

const [,, url, out] = process.argv;
if (!url || !out) {
  console.error('Usage: node scripts/screenshot-gallery.mjs <url> <output.png>');
  process.exit(2);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'load' });
await page.evaluate(async () => {
  if (window._allBlocksReady && typeof window._allBlocksReady.then === 'function') {
    await window._allBlocksReady;
  }
});
await page.waitForTimeout(800);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log('wrote ' + out);
