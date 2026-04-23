// Verifies that dist/gp-treemap.bundle.js is up-to-date with the source
// files in src/. Runs `node tools/build.js` into a temp file and diffs it
// against the checked-in bundle.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'dist', 'gp-treemap.bundle.js');

test('dist bundle is not stale', () => {
  const before = fs.readFileSync(BUNDLE, 'utf8');

  // Rebuild into the same path (build.js always writes there).
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.js')], {
    cwd: ROOT,
    stdio: 'pipe',
  });

  const after = fs.readFileSync(BUNDLE, 'utf8');
  expect(after).toBe(before);
});
