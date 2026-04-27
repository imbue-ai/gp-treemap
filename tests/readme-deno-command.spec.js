// Verifies the README's "Sandboxed usage" deno command stays in sync with
// the codebase: (1) the @version in the npm: specifier matches package.json,
// and (2) running the same command (with the npm: specifier swapped for the
// local tools path) still works under exactly the listed permission flags.
//
// The point: when someone bumps the version or changes the script's syscall
// surface (e.g. adds an os.cpus() call), the README's promised flags will
// stop being sufficient — and this test will catch it before publish.
//
// Skipped automatically if `deno` isn't on PATH, so Node-only CI is fine.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const denoPath = (() => {
  const r = spawnSync('which', ['deno'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
})();

function readReadmeDenoBlock() {
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  // First ```sh fenced block that contains a `deno run` invocation.
  const re = /```sh\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md))) {
    if (m[1].includes('deno run')) return m[1];
  }
  throw new Error('No `deno run` block found in README.md');
}

test('README deno command pin matches package.json version', () => {
  const block = readReadmeDenoBlock();
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const m = block.match(/npm:@imbue-ai\/gp-treemap@([\w.-]+)\//);
  expect(m, 'README deno block must pin a version (npm:@imbue-ai/gp-treemap@X.Y.Z/...)').not.toBeNull();
  expect(m[1], 'README pinned version must match package.json').toBe(pkg.version);
});

test('README deno command runs cleanly with only the flags it documents', () => {
  test.skip(!denoPath, 'deno not on PATH — skipping');

  const block = readReadmeDenoBlock();

  // Sandbox: scan a small fixture, write to a fixed output file. Use absolute
  // paths so the resolved --allow-read entries cover the real targets.
  const SCAN = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-deno-readme-'));
  fs.writeFileSync(path.join(SCAN, 'a.txt'), 'x'.repeat(100));
  fs.mkdirSync(path.join(SCAN, 'sub'));
  fs.writeFileSync(path.join(SCAN, 'sub', 'b.png'), Buffer.alloc(200));
  const OUT = path.join(os.tmpdir(), 'gp-deno-readme-' + Date.now() + '.html');

  // Patch the README block to:
  //   * use our SCAN/OUT instead of ~/Downloads + /tmp/disk_usage.html
  //   * point the npm: specifier at the local tools path so we test THIS
  //     working tree, not whatever happens to be on npm
  //   * drop the trailing `&& open "$OUT"` so the test doesn't launch a browser
  let cmd = block;
  cmd = cmd.replace(/^SCAN=.*$/m, `SCAN=${JSON.stringify(SCAN)}`);
  cmd = cmd.replace(/^OUT=.*$/m, `OUT=${JSON.stringify(OUT)}`);
  cmd = cmd.replace(/npm:@imbue-ai\/gp-treemap@[\w.-]+\/tools\/gpdu-scan\.js/,
                    JSON.stringify(path.join(ROOT, 'tools', 'gpdu-scan.js')));
  cmd = cmd.replace(/&&\s*open\s+"\$OUT"\s*$/m, '');

  // Run via bash so the SCAN=... OUT=... line-continuations evaluate correctly.
  const res = spawnSync('bash', ['-c', cmd], {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    expect(res.status, 'deno run exit status\nstdout:\n' + res.stdout + '\nstderr:\n' + res.stderr).toBe(0);
    expect(res.stderr).not.toMatch(/Requires .* access/);
    expect(res.stderr).not.toMatch(/NotCapable/);
    expect(fs.existsSync(OUT)).toBe(true);
    const html = fs.readFileSync(OUT, 'utf8');
    expect(html).toContain('<gp-treemap');
  } finally {
    fs.rmSync(SCAN, { recursive: true, force: true });
    if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
  }
});
