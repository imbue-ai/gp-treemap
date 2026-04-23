#!/usr/bin/env node
// Profile the loading phase of a local HTML file using Chromium's V8 CPU
// profiler (via CDP) and write a standard Chrome DevTools CPU profile
// (.cpuprofile) to disk.
//
// Usage:  node tools/profile-load.js <input.html> [output.cpuprofile]
//                [--wait-for=<js-expr-returning-truthy>]  (default waits for
//                 window._allBlocksReady, else 'load', else 15s timeout)
//                [--extra-wait-ms=N]  (settle time after ready signal)
//                [--sampling-us=N]    (default 100us)
//
// The .cpuprofile format is Chrome/V8's canonical JSON profile (drag-and-drop
// into DevTools → Performance → load profile). It's also what
// speedscope / pprof-js / flamebearer understand.
//
// This profiles the renderer's main thread, which is where HTML/JS load work
// happens for our self-contained treemap outputs.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { chromium } from 'playwright';

function parseArgs() {
  const argv = process.argv.slice(2);
  const positional = [];
  const opts = { waitFor: null, extraWaitMs: 500, samplingUs: 100, timeoutMs: 600000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--wait-for=')) opts.waitFor = a.slice('--wait-for='.length);
    else if (a.startsWith('--extra-wait-ms=')) opts.extraWaitMs = Number(a.slice('--extra-wait-ms='.length)) || 0;
    else if (a.startsWith('--sampling-us=')) opts.samplingUs = Number(a.slice('--sampling-us='.length)) || 100;
    else if (a.startsWith('--timeout-ms=')) opts.timeoutMs = Number(a.slice('--timeout-ms='.length)) || 120000;
    else if (a === '-h' || a === '--help') {
      console.error('Usage: node tools/profile-load.js <input.html> [output.cpuprofile] [--wait-for=<expr>] [--extra-wait-ms=N] [--sampling-us=N] [--timeout-ms=N]');
      process.exit(0);
    }
    else positional.push(a);
  }
  if (positional.length < 1) {
    console.error('Usage: node tools/profile-load.js <input.html> [output.cpuprofile]');
    process.exit(2);
  }
  return { input: positional[0], output: positional[1], ...opts };
}

async function main() {
  const args = parseArgs();
  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error('input file not found: ' + inputPath);
    process.exit(1);
  }
  const outputPath = path.resolve(args.output || inputPath.replace(/\.html?$/i, '') + '.cpuprofile');
  const fileUrl = url.pathToFileURL(inputPath).href;

  console.error('launching headless chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const client = await context.newCDPSession(page);
  await client.send('Profiler.enable');
  // Sampling interval in microseconds (smaller = more samples = more detail + overhead).
  await client.send('Profiler.setSamplingInterval', { interval: args.samplingUs });

  // Default "ready" gate — tuned for our gpdu-scan.js output but falls back to load.
  const defaultReady = `
    (function(){
      if (typeof window === 'undefined') return false;
      if (window._allBlocksReady && window._allBlocksReady._done) return true;
      return false;
    })()
  `;

  // Track readiness via exposed callback; auto-resolve when _allBlocksReady
  // resolves, or when document is 'complete' + extra wait.
  await page.addInitScript(() => {
    window.__profileReady = false;
    const markReady = () => { window.__profileReady = true; };
    // Prefer the treemap-specific ready signal when it's present.
    const hook = () => {
      if (window._allBlocksReady && typeof window._allBlocksReady.then === 'function') {
        window._allBlocksReady.then(markReady, markReady);
        return true;
      }
      return false;
    };
    // Poll until the hook attaches (the page script may not have run yet).
    const t0 = Date.now();
    (function attach() {
      if (hook()) return;
      if (document.readyState === 'complete' && Date.now() - t0 > 3000) {
        // No treemap-specific signal — fall back to a short settle period
        // after document load.
        setTimeout(markReady, 300);
        return;
      }
      setTimeout(attach, 50);
    })();
  });

  // Start profiler BEFORE navigation so we capture boot + parse + inflate.
  await client.send('Profiler.start');
  const tStart = Date.now();

  // Don't wait for 'load' — it may already have fired before our poll; just go.
  // Use 'commit' — a 300MB HTML can keep DCL pending for minutes.
  await page.goto(fileUrl, { waitUntil: 'commit', timeout: args.timeoutMs });

  // Wait for readiness signal (custom expr, treemap signal, or load).
  const readyExpr = args.waitFor
    ? `(function(){ try { return !!(${args.waitFor}); } catch(_) { return false; } })()`
    : `(function(){ return !!window.__profileReady; })()`;

  try {
    await page.waitForFunction(readyExpr, null, { timeout: args.timeoutMs, polling: 50 });
  } catch (e) {
    console.error('warning: ready gate timed out — profiling what we have. (' + e.message + ')');
  }

  // A little extra settle time so the final render completes inside the profile.
  if (args.extraWaitMs > 0) await page.waitForTimeout(args.extraWaitMs);

  const { profile } = await client.send('Profiler.stop');
  const elapsed = Date.now() - tStart;

  // Write the profile JSON. Chrome's cpuprofile format:
  //   { nodes: [...], startTime, endTime, samples, timeDeltas }
  fs.writeFileSync(outputPath, JSON.stringify(profile));
  console.error('');
  console.error('profiled    ' + fileUrl);
  console.error('  wall      ' + elapsed + ' ms');
  console.error('  samples   ' + (profile.samples ? profile.samples.length.toLocaleString() : 0));
  console.error('  nodes     ' + (profile.nodes ? profile.nodes.length.toLocaleString() : 0));
  console.error('  duration  ' + ((profile.endTime - profile.startTime) / 1000).toFixed(1) + ' ms (profile time)');
  console.error('wrote ' + outputPath + '  (' + fs.statSync(outputPath).size.toLocaleString() + ' bytes)');

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
