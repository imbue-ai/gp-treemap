// gpdu-sqlite.js — SQLite database → treemap.
//
// Tests cover the serial-type byte estimator, the basic tree shape produced
// from a fixture DB, the per-column sample-vs-full-scan paths, and the
// rendered HTML.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import Database from 'better-sqlite3';

import { serialBytes } from '../tools/gpdu-sqlite.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'gpdu-sqlite.js');

// ---- Unit: serial-type byte estimator ----

test('serialBytes: NULL is 0', () => {
  expect(serialBytes(null)).toBe(0);
  expect(serialBytes(undefined)).toBe(0);
});

test('serialBytes: integers follow SQLite serial-type ranges', () => {
  expect(serialBytes(0)).toBe(0);   // serial type 8
  expect(serialBytes(1)).toBe(0);   // serial type 9
  expect(serialBytes(2)).toBe(1);   // type 1
  expect(serialBytes(127)).toBe(1);
  expect(serialBytes(128)).toBe(2);
  expect(serialBytes(32767)).toBe(2);
  expect(serialBytes(32768)).toBe(3);
  expect(serialBytes(8388607)).toBe(3);
  expect(serialBytes(8388608)).toBe(4);
  expect(serialBytes(2147483647)).toBe(4);
  expect(serialBytes(2147483648)).toBe(6);   // 48-bit
  expect(serialBytes(140737488355327)).toBe(6);
  expect(serialBytes(140737488355328)).toBe(8);
});

test('serialBytes: negative ints follow magnitude rules', () => {
  expect(serialBytes(-1)).toBe(1);    // not serial-type 9 (those are exactly 0/1)
  expect(serialBytes(-128)).toBe(2);  // |-128| = 128 → 2 bytes
  expect(serialBytes(-32768)).toBe(3); // |-32768| = 32768 → 3 bytes
});

test('serialBytes: floats are 8 bytes', () => {
  expect(serialBytes(3.14)).toBe(8);
  expect(serialBytes(-0.5)).toBe(8);
});

test('serialBytes: text uses utf-8 byte length', () => {
  expect(serialBytes('')).toBe(0);
  expect(serialBytes('hi')).toBe(2);
  expect(serialBytes('héllo')).toBe(6);
  expect(serialBytes('🦄')).toBe(4);  // 4 bytes in utf-8
});

test('serialBytes: blobs use raw byte length', () => {
  expect(serialBytes(Buffer.from([1, 2, 3]))).toBe(3);
  expect(serialBytes(new Uint8Array([1, 2, 3, 4]))).toBe(4);
});

// ---- Integration tests against a fixture DB ----

let fixtureDir;
let fixturePath;

test.beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpdu-sqlite-fixture-'));
  fixturePath = path.join(fixtureDir, 'fixture.sqlite');
  const db = new Database(fixturePath);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      age INTEGER
    );
    CREATE INDEX idx_users_name ON users(name);
    CREATE INDEX idx_users_email ON users(email);
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      title TEXT,
      body TEXT
    );
    CREATE VIEW v_user_post_counts AS
      SELECT u.name, COUNT(p.id) AS posts FROM users u LEFT JOIN posts p ON u.id = p.user_id GROUP BY u.id;
    CREATE TRIGGER trg_no_delete BEFORE DELETE ON users BEGIN
      SELECT RAISE(ABORT, 'no deletes');
    END;
  `);
  const insU = db.prepare('INSERT INTO users (name, email, age) VALUES (?, ?, ?)');
  for (let i = 0; i < 100; i++) {
    insU.run('user-' + i, 'u' + i + '@example.com', 20 + (i % 40));
  }
  const insP = db.prepare('INSERT INTO posts (user_id, title, body) VALUES (?, ?, ?)');
  for (let i = 0; i < 50; i++) {
    insP.run(1 + (i % 10), 'title ' + i, 'body of post ' + i + ' '.repeat(10 + (i % 30)));
  }
  db.close();
});

test.afterAll(() => {
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

function runSqlite(extra = []) {
  const outPath = path.join(fixtureDir, 'out-' + Date.now() + Math.random() + '.html');
  const res = spawnSync(process.execPath, [TOOL, '--no-open', ...extra, fixturePath, outPath], {
    encoding: 'utf8', timeout: 30000,
  });
  return { res, outPath };
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
    parentTables: decodeCat(raw.attributes['parent-table']),
    valueTypes: decodeCat(raw.attributes['value-type']),
    totalBytes: envelope.totalBytes,
  };
}

test('default scan produces tables, indices, columns; views/triggers visible', () => {
  const { res, outPath } = runSqlite();
  expect(res.status, res.stderr).toBe(0);
  const scan = parseScanHtml(outPath);

  // Find named entities by their kind.
  const tableLabels = scan.labels.filter((l, i) => scan.kinds[i] === 'table');
  expect(tableLabels).toContain('users');
  expect(tableLabels).toContain('posts');

  const indexLabels = scan.labels.filter((l, i) => scan.kinds[i] === 'index');
  expect(indexLabels).toContain('idx_users_name');
  expect(indexLabels).toContain('idx_users_email');

  const viewLabels = scan.labels.filter((l, i) => scan.kinds[i] === 'view');
  expect(viewLabels).toContain('v_user_post_counts');

  const triggerLabels = scan.labels.filter((l, i) => scan.kinds[i] === 'trigger');
  expect(triggerLabels).toContain('trg_no_delete');
});

test('users table has columns nested under it, plus its indices', () => {
  const { res, outPath } = runSqlite();
  expect(res.status, res.stderr).toBe(0);
  const scan = parseScanHtml(outPath);

  // Find users table index
  const usersIdx = scan.labels.findIndex((l, i) => scan.kinds[i] === 'table' && l === 'users');
  expect(usersIdx).toBeGreaterThan(0);

  // Children: columns + indices
  const childIds = [];
  for (let i = 0; i < scan.labels.length; i++) {
    if (scan.parentIndices[i] === usersIdx) childIds.push(i);
  }
  const childKinds = childIds.map(i => scan.kinds[i]);
  expect(childKinds.filter(k => k === 'column').length).toBe(4);    // id, name, email, age
  expect(childKinds.filter(k => k === 'index').length).toBe(2);     // idx_users_name, idx_users_email

  // Column 'name' should have value-type 'text'.
  const nameColIdx = scan.labels.findIndex((l, i) => i === childIds.find(c => scan.labels[c] === 'name'));
  expect(scan.valueTypes[nameColIdx]).toBe('text');
});

test('--include-row-elements-for-all-columns emits row leaves under each column', () => {
  const { res, outPath } = runSqlite(['--include-row-elements-for-all-columns']);
  expect(res.status, res.stderr).toBe(0);
  const scan = parseScanHtml(outPath);

  const rowKinds = scan.kinds.filter(k => k === 'row');
  // 100 users × 4 cols + 50 posts × 4 cols = 400 + 200 = 600
  expect(rowKinds.length).toBe(600);
});

test('without --include-row-elements, columns are leaves', () => {
  const { res, outPath } = runSqlite(['--sample-rows=20']);
  expect(res.status, res.stderr).toBe(0);
  const scan = parseScanHtml(outPath);

  // Find a 'name' column under 'users' — should have no children.
  const usersIdx = scan.labels.findIndex((l, i) => scan.kinds[i] === 'table' && l === 'users');
  const childIds = [];
  for (let i = 0; i < scan.labels.length; i++) {
    if (scan.parentIndices[i] === usersIdx && scan.labels[i] === 'name') childIds.push(i);
  }
  expect(childIds.length).toBe(1);
  const nameColIdx = childIds[0];
  // No grandchildren under this column.
  const hasGrandkids = scan.parentIndices.some(p => p === nameColIdx);
  expect(hasGrandkids).toBe(false);
});

test('non-sqlite file is rejected with friendly error', () => {
  const bogus = path.join(fixtureDir, 'not-a-db.txt');
  fs.writeFileSync(bogus, 'this is not a sqlite database');
  const outPath = path.join(fixtureDir, 'bogus-out.html');
  const res = spawnSync(process.execPath, [TOOL, '--no-open', bogus, outPath], { encoding: 'utf8' });
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/not a sqlite database|cannot open/);
});

test('generated HTML loads under file:// and renders cells', async ({ page }) => {
  const { res, outPath } = runSqlite();
  expect(res.status, res.stderr).toBe(0);

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto('file://' + outPath);
  await page.waitForTimeout(400);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  expect(errs, 'no errors').toEqual([]);
  const cells = await page.locator('gp-treemap').evaluate((el) => el._leaves.length);
  expect(cells).toBeGreaterThan(0);
});
