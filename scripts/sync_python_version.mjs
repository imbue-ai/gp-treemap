#!/usr/bin/env node
// Mirror the version from package.json into the Python wrapper's
// pyproject.toml and __init__.py. Invoked from npm's `version` lifecycle
// script, so every `npm version <bump>` produces a single commit that
// bumps both the npm and the PyPI versions in lockstep.
//
// Run manually after-the-fact via `node scripts/sync_python_version.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(?:[.-]\S+)?$/.test(version)) {
  console.error(`sync_python_version: unexpected version "${version}" in package.json`);
  process.exit(1);
}

function patchFile(relPath, pattern, replacement) {
  const filePath = path.join(repoRoot, relPath);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = before.replace(pattern, replacement);
  if (before === after) {
    console.error(`sync_python_version: no match for ${pattern} in ${relPath}`);
    process.exit(1);
  }
  if (before !== after) {
    fs.writeFileSync(filePath, after);
    console.log(`  ${relPath} → ${version}`);
  }
}

patchFile('python/pyproject.toml',
  /^version = "[^"]+"$/m,
  `version = "${version}"`);
patchFile('python/src/gp_treemap/__init__.py',
  /^__version__ = "[^"]+"$/m,
  `__version__ = "${version}"`);

// Stage the edits so npm's auto-commit picks them up alongside package.json.
try {
  execSync('git add python/pyproject.toml python/src/gp_treemap/__init__.py',
    { cwd: repoRoot, stdio: 'ignore' });
} catch (_) {
  // Outside a git context (e.g. inside an sdist build) — fine to ignore.
}
