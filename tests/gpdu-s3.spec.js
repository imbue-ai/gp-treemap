// gpdu-s3.js — S3 bucket / prefix → treemap.
//
// Tests run entirely against an SDK mock (aws-sdk-client-mock) — no live
// S3 calls. We invoke the tool's main flow as a child process whose AWS
// SDK module is intercepted by a small launcher script that mocks
// ListObjectsV2 / ListObjectVersions before importing the tool.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'gpdu-s3.js');

// A tiny launcher script we write per-test that mocks the S3 client with
// `aws-sdk-client-mock` then dynamically imports gpdu-s3.js. We use a real
// child-process invocation (not in-process) so the mock survives and the
// tool's process.argv is what we pass.
// Place the launcher inside the project so node_modules resolution finds
// `aws-sdk-client-mock` and `@aws-sdk/client-s3`.
const LAUNCHER_DIR = path.join(ROOT, 'tests', '_tmp_s3_launchers');
function makeLauncher(mockSetupSrc) {
  fs.mkdirSync(LAUNCHER_DIR, { recursive: true });
  const launcher = path.join(LAUNCHER_DIR, 'launcher-' + Date.now() + '-' + Math.floor(Math.random() * 1e9) + '.mjs');
  fs.writeFileSync(launcher, `
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListObjectsV2Command, ListObjectVersionsCommand } from '@aws-sdk/client-s3';
const s3Mock = mockClient(S3Client);
${mockSetupSrc}
const url = await import('node:url');
const tool = ${JSON.stringify(TOOL)};
process.argv = [process.argv[0], tool, ...process.argv.slice(2)];
await import(url.pathToFileURL(tool).href);
`);
  return launcher;
}

function runWithMock(mockSetupSrc, args = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gpdu-s3-test-'));
  const outPath = path.join(tmp, 'out.html');
  const launcher = makeLauncher(mockSetupSrc);
  const res = spawnSync(process.execPath, [launcher, ...args, outPath], {
    encoding: 'utf8', cwd: ROOT, timeout: 30000,
  });
  fs.unlinkSync(launcher);
  return { res, outPath, tmp };
}

function parseScanHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script type="application\/json" id="tmdata">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('tmdata script tag not found');
  const envelope = JSON.parse(m[1]);
  const compressed = Buffer.from(envelope.blocks[0], 'base64');
  const raw = JSON.parse(zlib.inflateRawSync(compressed).toString());
  const piBuf = Buffer.from(raw.piB64, 'base64');
  const parentIndices = Array.from(new Int32Array(piBuf.buffer, piBuf.byteOffset, piBuf.byteLength / 4));
  function decodeCat(attr) {
    const buf = Buffer.from(attr.b64, 'base64');
    const idx = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
    return Array.from(idx).map(i => attr.names[i]);
  }
  return {
    labels: raw.labels,
    values: raw.values,
    parentIndices,
    kinds: decodeCat(raw.attributes.kind),
    exts:  decodeCat(raw.attributes.extension),
    storageClasses: decodeCat(raw.attributes['storage-class']),
    totalBytes: envelope.totalBytes,
  };
}

function cleanup(tmp) { fs.rmSync(tmp, { recursive: true, force: true }); }

// ---- Hierarchy synthesis ----

test('synthesizes folder hierarchy from /-separated keys', () => {
  // photos/2024/foo.jpg     → photos → 2024 → foo.jpg
  // photos/2024/bar.png     → photos → 2024 → bar.png
  // photos/2023/baz.gif     → photos → 2023 → baz.gif
  // README.md               → README.md (top-level)
  const mockSrc = `
s3Mock.on(ListObjectsV2Command).callsFake(async (input) => {
  const { Prefix = '' } = input;
  // Paged listings keyed by prefix.
  const PAGES = {
    '': {
      CommonPrefixes: [{ Prefix: 'photos/' }],
      Contents: [{ Key: 'README.md', Size: 100, StorageClass: 'STANDARD', LastModified: new Date('2024-01-01') }],
      IsTruncated: false,
    },
    'photos/': {
      CommonPrefixes: [{ Prefix: 'photos/2023/' }, { Prefix: 'photos/2024/' }],
      Contents: [],
      IsTruncated: false,
    },
    'photos/2023/': {
      Contents: [{ Key: 'photos/2023/baz.gif', Size: 300, StorageClass: 'GLACIER', LastModified: new Date('2023-06-01') }],
      IsTruncated: false,
    },
    'photos/2024/': {
      Contents: [
        { Key: 'photos/2024/foo.jpg', Size: 1000, StorageClass: 'STANDARD', LastModified: new Date('2024-06-01') },
        { Key: 'photos/2024/bar.png', Size:  500, StorageClass: 'STANDARD_IA', LastModified: new Date('2024-09-01') },
      ],
      IsTruncated: false,
    },
  };
  return PAGES[Prefix] || { Contents: [], IsTruncated: false };
});
`;
  const { res, outPath, tmp } = runWithMock(mockSrc, ['--no-open', 's3://my-bucket/']);
  try {
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(outPath);

    expect(scan.labels).toContain('photos');
    expect(scan.labels).toContain('2023');
    expect(scan.labels).toContain('2024');
    expect(scan.labels).toContain('foo.jpg');
    expect(scan.labels).toContain('bar.png');
    expect(scan.labels).toContain('baz.gif');
    expect(scan.labels).toContain('README.md');

    // Object kinds and storage classes
    const fooIdx = scan.labels.indexOf('foo.jpg');
    expect(scan.kinds[fooIdx]).toBe('object');
    expect(scan.exts[fooIdx]).toBe('jpg');
    expect(scan.storageClasses[fooIdx]).toBe('STANDARD');
    expect(scan.values[fooIdx]).toBe(1000);

    const bazIdx = scan.labels.indexOf('baz.gif');
    expect(scan.storageClasses[bazIdx]).toBe('GLACIER');

    // Tree shape: photos > 2024 > foo.jpg
    const photosIdx = scan.labels.indexOf('photos');
    expect(scan.kinds[photosIdx]).toBe('prefix');
    const photos2024Idx = scan.labels.findIndex((l, i) => l === '2024' && scan.parentIndices[i] === photosIdx);
    expect(photos2024Idx).toBeGreaterThan(0);
    expect(scan.parentIndices[fooIdx]).toBe(photos2024Idx);

    // Totals: 100 + 1000 + 500 + 300 = 1900
    expect(scan.totalBytes).toBe(1900);
  } finally {
    cleanup(tmp);
  }
});

// ---- Pagination via NextContinuationToken ----

test('pagination is followed across multiple ListObjectsV2 pages', () => {
  const mockSrc = `
s3Mock.on(ListObjectsV2Command).callsFake(async (input) => {
  const { ContinuationToken } = input;
  if (!ContinuationToken) {
    return {
      Contents: [{ Key: 'a.txt', Size: 10, StorageClass: 'STANDARD', LastModified: new Date('2024-01-01') }],
      IsTruncated: true,
      NextContinuationToken: 'page2',
    };
  }
  if (ContinuationToken === 'page2') {
    return {
      Contents: [{ Key: 'b.txt', Size: 20, StorageClass: 'STANDARD', LastModified: new Date('2024-01-02') }],
      IsTruncated: false,
    };
  }
  return { Contents: [], IsTruncated: false };
});
`;
  const { res, outPath, tmp } = runWithMock(mockSrc, ['--no-open', 's3://my-bucket/']);
  try {
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(outPath);
    expect(scan.labels).toContain('a.txt');
    expect(scan.labels).toContain('b.txt');
    expect(scan.totalBytes).toBe(30);
  } finally {
    cleanup(tmp);
  }
});

// ---- --include-versions uses ListObjectVersions ----

test('--include-versions switches to ListObjectVersions and emits per-version leaves', () => {
  const mockSrc = `
s3Mock.on(ListObjectVersionsCommand).callsFake(async (input) => ({
  Versions: [
    { Key: 'foo.txt', Size: 100, StorageClass: 'STANDARD', LastModified: new Date('2024-01-01'), VersionId: 'v1abcdef', IsLatest: true },
    { Key: 'foo.txt', Size:  90, StorageClass: 'STANDARD', LastModified: new Date('2023-12-01'), VersionId: 'v0xyz123', IsLatest: false },
  ],
  IsTruncated: false,
}));
`;
  const { res, outPath, tmp } = runWithMock(mockSrc, ['--no-open', '--include-versions', 's3://my-bucket/']);
  try {
    expect(res.status, res.stderr).toBe(0);
    const scan = parseScanHtml(outPath);
    // Each version is its own leaf.
    const objects = scan.labels.filter((l, i) => scan.kinds[i] === 'object');
    expect(objects.length).toBe(2);
    expect(objects.every(l => l.startsWith('foo.txt'))).toBe(true);
    // Labels include version-id suffix.
    expect(objects.some(l => /@v1abcd/.test(l))).toBe(true);
    expect(objects.some(l => /@v0xyz1/.test(l))).toBe(true);
    expect(scan.totalBytes).toBe(190);
  } finally {
    cleanup(tmp);
  }
});

// ---- --workers=4 produces same tree as --workers=1 ----

test('concurrency: --workers=4 produces same total bytes as --workers=1', () => {
  // Same mock for both runs.
  const mockSrc = `
s3Mock.on(ListObjectsV2Command).callsFake(async (input) => {
  const { Prefix = '' } = input;
  const PAGES = {
    '': { CommonPrefixes: [{ Prefix: 'a/' }, { Prefix: 'b/' }, { Prefix: 'c/' }], Contents: [], IsTruncated: false },
    'a/': { Contents: [
      { Key: 'a/1.txt', Size: 10, StorageClass: 'STANDARD', LastModified: new Date() },
      { Key: 'a/2.txt', Size: 20, StorageClass: 'STANDARD', LastModified: new Date() },
    ], IsTruncated: false },
    'b/': { Contents: [{ Key: 'b/1.txt', Size: 30, StorageClass: 'STANDARD', LastModified: new Date() }], IsTruncated: false },
    'c/': { Contents: [{ Key: 'c/1.txt', Size: 40, StorageClass: 'STANDARD', LastModified: new Date() }], IsTruncated: false },
  };
  return PAGES[Prefix] || { Contents: [], IsTruncated: false };
});
`;
  for (const w of ['--workers=1', '--workers=4']) {
    const { res, outPath, tmp } = runWithMock(mockSrc, ['--no-open', w, 's3://b/']);
    try {
      expect(res.status, res.stderr).toBe(0);
      const scan = parseScanHtml(outPath);
      expect(scan.totalBytes).toBe(100);
      const leaves = scan.labels.filter((l, i) => scan.kinds[i] === 'object').sort();
      expect(leaves).toEqual(['1.txt', '1.txt', '1.txt', '2.txt']);
    } finally {
      cleanup(tmp);
    }
  }
});

// ---- Friendly error on NoSuchBucket ----

test('NoSuchBucket exits 1 with friendly message', () => {
  const mockSrc = `
s3Mock.on(ListObjectsV2Command).rejects({ name: 'NoSuchBucket', message: 'The specified bucket does not exist' });
`;
  const { res, tmp } = runWithMock(mockSrc, ['--no-open', 's3://does-not-exist/']);
  try {
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/NoSuchBucket/);
  } finally {
    cleanup(tmp);
  }
});

// ---- Render smoke test ----

test('generated HTML loads under file:// and renders cells', async ({ page }) => {
  const mockSrc = `
s3Mock.on(ListObjectsV2Command).callsFake(async (input) => {
  const { Prefix = '' } = input;
  if (Prefix === '') {
    const Contents = [];
    for (let i = 0; i < 30; i++) {
      Contents.push({ Key: 'item-' + i + '.json', Size: 100 + i * 10, StorageClass: 'STANDARD', LastModified: new Date() });
    }
    return { Contents, IsTruncated: false };
  }
  return { Contents: [], IsTruncated: false };
});
`;
  const { res, outPath, tmp } = runWithMock(mockSrc, ['--no-open', 's3://b/']);
  try {
    expect(res.status, res.stderr).toBe(0);

    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

    await page.goto('file://' + outPath);
    await page.waitForTimeout(400);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    expect(errs, 'no errors').toEqual([]);
    const cells = await page.locator('gp-treemap').evaluate((el) => el._leaves.length);
    expect(cells).toBeGreaterThan(10);
  } finally {
    cleanup(tmp);
  }
});
