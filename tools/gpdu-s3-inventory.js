#!/usr/bin/env node
// Visualize an S3 bucket's daily Inventory report as a treemap. Way faster
// than `gpdu-s3` for large buckets — Inventory has already enumerated every
// object, so we just read the parquet report instead of paginating through
// LIST API calls.
//
// Usage:
//   node tools/gpdu-s3-inventory.js [--no-open] [--color=...]
//                                   [--region=REGION] [--no-sign-request]
//                                   [--block-size=N]
//                                   <s3://meta-bucket/.../manifest.json>
//                                   [output.html]
//
//   The argument is the path to an Inventory manifest.json — either an
//   s3:// URI (we'll fetch it and the parquet data files it lists) or a
//   local path (data files resolved relative to it).
//
// AWS S3 Inventory references:
//   https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-inventory.html
//   https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-inventory-location.html

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import { BUNDLE } from '../dist/gp-treemap.bundle.embed.js';
import { partitionBlocks, encodeBlock, humanBytes, escapeHtml, LOADER_JS } from './scan-core.js';

const COLOR_MODES = ['extension', 'storage-class', 'last-modified'];
const CATEGORICAL_MODES = ['extension', 'storage-class'];
const QUANTITATIVE_MODES = ['last-modified'];

function usage(exitCode) {
  console.error(
    'Usage: node tools/gpdu-s3-inventory.js [--no-open] [--color=' + COLOR_MODES.join('|') + ']\n' +
    '                                       [--region=REGION] [--no-sign-request]\n' +
    '                                       [--min-fraction=F] [--max-depth=D]\n' +
    '                                       [--block-size=N]\n' +
    '                                       <s3://meta-bucket/.../manifest.json | local-manifest.json>\n' +
    '                                       [output.html | s3://bucket/output.html]\n' +
    '\n' +
    '  --min-fraction=F   keep individual objects only if their size is at\n' +
    '                     least F * total. Default 0.00001 (0.001%). Pass 0\n' +
    '                     to keep every object. Smaller objects are rolled\n' +
    '                     up into a single "(N small)" leaf per parent\n' +
    '                     directory, so total bytes are preserved.\n' +
    '  --max-depth=D      cap path depth at which "(N small)" rollups land,\n' +
    '                     so very deep paths don\'t blow up the tree. Default\n' +
    '                     8. Big-leaf objects are emitted at their full path\n' +
    '                     regardless.'
  );
  process.exit(exitCode);
}

async function main() {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  let colorBy = 'extension';
  let blockSize = 500000;
  let region;
  let noSign = false;
  let minFraction = 0.00001;  // 0.001% of total; prune subtrees below this
  let maxDepth = 8;            // max '/' depth at which "(N small)" rollups land
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') continue;
    if (a === '-h' || a === '--help') usage(0);
    if (a === '--no-sign-request') { noSign = true; continue; }
    if (a.startsWith('--block-size=')) { blockSize = Number(a.split('=')[1]) || 500000; continue; }
    if (a.startsWith('--min-fraction=')) {
      const v = Number(a.split('=')[1]);
      minFraction = (Number.isFinite(v) && v >= 0) ? v : 0.00001;
      continue;
    }
    if (a.startsWith('--max-depth=')) {
      const v = Number(a.split('=')[1]);
      maxDepth = (Number.isInteger(v) && v >= 1) ? v : 8;
      continue;
    }
    if (a.startsWith('--region=')) { region = a.split('=')[1]; continue; }
    if (a === '--region') { region = argv[++i]; continue; }
    if (a === '--color' || a === '--color-by') { colorBy = argv[++i]; continue; }
    if (a.startsWith('--color=') || a.startsWith('--color-by=')) { colorBy = a.split('=')[1]; continue; }
    positionals.push(a);
  }
  if (!COLOR_MODES.includes(colorBy)) {
    console.error('Unknown --color mode: ' + colorBy + '\nValid modes: ' + COLOR_MODES.join(', '));
    process.exit(2);
  }
  if (positionals.length < 1) usage(2);

  const manifestArg = positionals[0];
  const outArg = positionals[1];

  const slug = manifestArg.replace(/^s3:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const outIsS3 = !!(outArg && outArg.startsWith('s3://'));
  const out = !outArg
    ? path.join(os.tmpdir(), 'gpdu-s3-inventory-' + slug + '-' + Date.now() + '.html')
    : (outIsS3 ? outArg : path.resolve(outArg));

  // Lazy-import the AWS SDK if either input or output is s3://.
  let s3 = null, GetObjectCommand = null, PutObjectCommand = null;
  if (manifestArg.startsWith('s3://') || outIsS3) {
    let S3Client;
    try {
      const sdk = await import('@aws-sdk/client-s3');
      S3Client = sdk.S3Client;
      GetObjectCommand = sdk.GetObjectCommand;
      PutObjectCommand = sdk.PutObjectCommand;
    } catch (_) {
      console.error('gpdu-s3-inventory: @aws-sdk/client-s3 not installed.\nInstall with: npm install @aws-sdk/client-s3');
      process.exit(1);
    }
    const opts = {};
    if (region) opts.region = region;
    if (noSign) {
      opts.credentials = async () => ({ accessKeyId: '', secretAccessKey: '' });
      opts.signer = { sign: async (req) => req };
    }
    s3 = new S3Client(opts);
  }

  // ----- Load the manifest -----
  process.stderr.write('  loading manifest...\n');
  let manifest, manifestBucket = null, manifestPrefix = '';
  if (manifestArg.startsWith('s3://')) {
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(manifestArg);
    if (!m) { console.error('bad s3:// URI: ' + manifestArg); process.exit(2); }
    manifestBucket = m[1];
    const manifestKey = m[2];
    manifestPrefix = manifestKey.replace(/[^/]+$/, ''); // dirname of key
    const buf = await fetchS3ToBuffer(s3, GetObjectCommand, manifestBucket, manifestKey);
    manifest = JSON.parse(buf.toString('utf8'));
  } else {
    const text = await fsp.readFile(manifestArg, 'utf8');
    manifest = JSON.parse(text);
    manifestPrefix = path.dirname(path.resolve(manifestArg));
  }

  if (manifest.fileFormat && manifest.fileFormat.toUpperCase() !== 'PARQUET') {
    console.error('gpdu-s3-inventory: manifest fileFormat is "' + manifest.fileFormat + '"; only Parquet is supported.');
    process.exit(1);
  }

  // The destination bucket where the parquet data files live (manifest's
  // `destinationBucket` is an ARN like "arn:aws:s3:::name"; if absent, fall
  // back to the bucket the manifest was loaded from).
  let destBucket = manifestBucket;
  if (manifest.destinationBucket) {
    const arnMatch = /^arn:aws:s3:::(.+)$/.exec(manifest.destinationBucket);
    destBucket = arnMatch ? arnMatch[1] : manifest.destinationBucket;
  }

  const fileEntries = (manifest.files || []);
  if (fileEntries.length === 0) {
    console.error('gpdu-s3-inventory: manifest has no files[]');
    process.exit(1);
  }
  process.stderr.write('  manifest references ' + fileEntries.length + ' parquet file(s)\n');

  // ----- Heavy lifting in DuckDB; streaming CSV consumed by Node ----------
  // Pure-JS parquet decode (hyparquet) was tractable at single-digit-millions
  // of rows but not at the tens-of-millions Inventory typically produces. We
  // shell out to DuckDB instead — its parquet reader is vectorized and
  // multithreaded, so 50M+ rows is seconds, not minutes. Tree-build (in
  // Node) and HTML emission are still on us.
  const { spawn, spawnSync } = await import('node:child_process');
  if (spawnSync('duckdb', ['--version']).status !== 0) {
    console.error(
      'gpdu-s3-inventory: `duckdb` not found on PATH.\n' +
      '  Install with:  brew install duckdb   (macOS)\n' +
      '          or:    https://duckdb.org/docs/installation/\n' +
      '  This tool uses DuckDB to decode parquet at scale.'
    );
    process.exit(1);
  }

  const sourceBucket = manifest.sourceBucket || destBucket || '(unknown)';
  const builder = newScanBuilder(sourceBucket);
  let bucketName = sourceBucket;

  // Build the parquet file list. For s3:// manifests, we let DuckDB's httpfs
  // extension fetch the parquet files directly — multithreaded, with row-group
  // pruning, no double-buffering. For local manifests, the data files are
  // resolved relative to the manifest's directory.
  let parquetPaths;
  if (manifestArg.startsWith('s3://')) {
    parquetPaths = fileEntries.map(e => 's3://' + destBucket + '/' + e.key);
  } else {
    parquetPaths = fileEntries.map(e => path.join(manifestPrefix, e.key));
  }
  let readElapsed = 0;

  // SQL prelude: for s3:// reads, install httpfs and bind AWS credentials
  // via the standard credential chain (env / ~/.aws/credentials / IAM role).
  const prelude = manifestArg.startsWith('s3://')
    ? "INSTALL httpfs; LOAD httpfs;\n" +
      (region ? "SET s3_region = '" + region.replace(/'/g, "''") + "';\n" : "") +
      "CREATE OR REPLACE PERSISTENT SECRET aws_chain (TYPE S3, PROVIDER credential_chain);\n"
    : "";
  const filesArg = parquetPaths.map(p => `'${p.replace(/'/g, "''")}'`).join(',');

  try {
    // ----- Pass 1: total bytes + object count -----
    process.stderr.write('  duckdb pass 1: totals...\n');
    const tTotal0 = Date.now();
    const totalSql = prelude +
      `SET variable FILES = [${filesArg}];\n` +
      "COPY (SELECT SUM(size), COUNT(*) FROM read_parquet(getvariable('FILES')))" +
      "  TO '/dev/stdout' (FORMAT 'CSV', HEADER FALSE);";
    const [totalBytesAtRoot, totalObjectCount] = await runDuckSqlRow(spawn, totalSql);
    process.stderr.write('  total bytes    ' + humanBytes(totalBytesAtRoot) +
      '  (' + totalBytesAtRoot.toLocaleString() + ' B)\n');
    process.stderr.write('  total objects  ' + totalObjectCount.toLocaleString() +
      '  (in ' + (Date.now() - tTotal0) + ' ms)\n');

    // Compute the threshold here so DuckDB can do the leaf/rollup split in
    // one pass; we still let pruneByThreshold run later as a safety net for
    // intermediate-prefix subtrees that fall under threshold.
    const threshold = minFraction > 0 ? totalBytesAtRoot * minFraction : 0;
    if (threshold > 0) {
      process.stderr.write('  keeping objects >= ' + humanBytes(threshold) +
        '  (' + (minFraction * 100).toFixed(4) + '% of total)\n');
    }

    // ----- Pass 2: big leaves UNION small-rollups -----
    // Big leaves: emit verbatim.
    // Small rollups: group by parent directory truncated to --max-depth.
    //   Result kind column distinguishes 'leaf' (full key) vs 'small'
    //   (directory prefix; Node synthesizes a "(N small)" leaf under it).
    process.stderr.write('  duckdb pass 2: big leaves + per-prefix small rollups (max depth ' + maxDepth + ')...\n');
    const t0 = Date.now();
    // Build a SQL expression for "the parent prefix of `key`, truncated to D
    // segments". Used for the GROUP BY of the small-rollup branch.
    const truncExpr =
      "array_to_string(string_split(key, '/')[1:LEAST(len(string_split(key, '/')) - 1, " + maxDepth + ")], '/')";
    const fullSql = prelude +
      `SET variable FILES = [${filesArg}];\n` +
      `SET variable T = ${threshold};\n` +
      "COPY (\n" +
      "  WITH inv AS (\n" +
      "    SELECT key, size, last_modified_date, storage_class\n" +
      "    FROM read_parquet(getvariable('FILES'))\n" +
      "  )\n" +
      "  SELECT 'leaf'   AS kind, key AS path, 1::BIGINT AS small_count,\n" +
      "         size, last_modified_date, storage_class\n" +
      "  FROM inv\n" +
      "  WHERE size >= getvariable('T')\n" +
      "  UNION ALL\n" +
      "  SELECT 'small'  AS kind, " + truncExpr + " AS path, COUNT(*)::BIGINT AS small_count,\n" +
      "         SUM(size) AS size, MAX(last_modified_date) AS last_modified_date,\n" +
      "         any_value(storage_class) AS storage_class\n" +
      "  FROM inv\n" +
      "  WHERE size < getvariable('T')\n" +
      "  GROUP BY " + truncExpr + "\n" +
      ") TO '/dev/stdout' (FORMAT 'CSV', HEADER FALSE);";

    await new Promise((resolve, reject) => {
      const proc = spawn('duckdb', ['-c', fullSql], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderrAll = '';
      proc.stderr.on('data', (d) => {
        stderrAll += d.toString();
        process.stderr.write(d);
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code !== 0) reject(new Error('duckdb exited with code ' + code + (stderrAll ? '\n' + stderrAll.slice(-2000) : '')));
      });

      // Stream CSV: kind, path, small_count, size, last_modified_date, storage_class
      let buf = '';
      let lastPrint = 0;
      let leafCount = 0, rollupCount = 0;
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.length === 0) continue;
          parseAndAdd(line);
        }
        const now = Date.now();
        if (now - lastPrint > 250) {
          lastPrint = now;
          process.stderr.write('\r  parsed ' + leafCount.toLocaleString() + ' leaves + ' +
            rollupCount.toLocaleString() + ' rollups          ');
        }
      });
      proc.stdout.on('end', () => {
        if (buf.length > 0) parseAndAdd(buf);
        process.stderr.write('\r  parsed ' + leafCount.toLocaleString() + ' leaves + ' +
          rollupCount.toLocaleString() + ' rollups in ' + (Date.now() - t0) + ' ms      \n');
        resolve();
      });

      function parseAndAdd(line) {
        const fields = parseCsvLine(line);
        if (fields.length < 6) return;
        const kind = fields[0];
        const path = fields[1] || '';   // empty path = root for 'small' rollups
        const smallCount = Number(fields[2]) || 0;
        const size = Number(fields[3]) || 0;
        const mtime = fields[4] ? Date.parse(fields[4]) || 0 : 0;
        const sc = fields[5] || 'STANDARD';
        if (kind === 'leaf') {
          if (!path) return;            // skip null/empty-key leaf rows
          builder.addObject(path, size, sc, mtime);
          leafCount++;
        } else {
          builder.addRollupSmall(path, smallCount, size, sc, mtime);
          rollupCount++;
        }
      }
    });
    readElapsed = Date.now() - t0;
    process.stderr.write('  built tree (' + builder.counts.object.toLocaleString() + ' objects, ' +
      builder.counts.prefix.toLocaleString() + ' prefixes) in ' + readElapsed + ' ms\n');
  } finally {}

  let scan = builder.finish();

  // Total is now known; report it before pruning so the threshold is visible.
  console.error('  total bytes  ' + humanBytes(scan.totalBytes) + '  (' + scan.totalBytes.toLocaleString() + ' B)');

  if (minFraction > 0 && scan.totalBytes > 0) {
    const threshold = scan.totalBytes * minFraction;
    process.stderr.write('  pruning subtrees < ' + humanBytes(threshold) +
      '  (' + (minFraction * 100).toFixed(4) + '% of total)\n');
    const t2 = Date.now();
    const beforeNodes = scan.labels.length;
    scan = pruneByThreshold(scan, threshold);
    process.stderr.write('  pruned ' + (beforeNodes - scan.labels.length).toLocaleString() +
      ' nodes; tree now ' + scan.labels.length.toLocaleString() +
      ' (' + (Date.now() - t2) + ' ms)\n');
  }
  // For S3 output, buffer in memory and upload after buildHtml. The
  // typical post-pruning HTML is < 50 MB, so memory is fine; for true
  // streaming we'd reach for @aws-sdk/lib-storage's Upload.
  const chunks = outIsS3 ? [] : null;
  const fd = outIsS3 ? null : fs.openSync(out, 'w');
  const sink = outIsS3
    ? (s) => chunks.push(s)
    : (s) => fs.writeSync(fd, s);
  buildHtml(sink, manifestArg, bucketName, scan, colorBy, blockSize);
  if (fd != null) fs.closeSync(fd);

  let outSize;
  if (outIsS3) {
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(out);
    if (!m) { console.error('bad s3:// output URI: ' + out); process.exit(2); }
    const buf = Buffer.from(chunks.join(''), 'utf8');
    outSize = buf.length;
    process.stderr.write('  uploading ' + humanBytes(outSize) + ' to ' + out + '\n');
    await s3.send(new PutObjectCommand({
      Bucket: m[1],
      Key: m[2],
      Body: buf,
      ContentType: 'text/html; charset=utf-8',
    }));
  } else {
    outSize = fs.statSync(out).size;
  }

  console.log('');
  console.log('inventory of bucket ' + (manifest.sourceBucket || bucketName));
  console.log('  manifest      ' + manifestArg);
  console.log('  parquet files ' + fileEntries.length.toLocaleString());
  console.log('  objects       ' + (scan.totalObjects || scan.counts.object).toLocaleString());
  console.log('  prefixes      ' + scan.counts.prefix.toLocaleString());
  console.log('  total bytes   ' + humanBytes(scan.totalBytes) + '  (' + scan.totalBytes.toLocaleString() + ' B)');
  console.log('  duckdb decode ' + readElapsed + ' ms');
  console.log('');
  console.log('wrote ' + out + '  (' + humanBytes(outSize) + ')');

  if (!noOpen && !outIsS3) {
    const { execSync } = await import('node:child_process');
    const openCmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { execSync(openCmd + ' ' + JSON.stringify(out)); } catch { console.log('open it with:  open "' + out + '"'); }
  }
}

function numCoerce(v) {
  if (v == null) return 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  return Number(v) || 0;
}

// Run a DuckDB SQL that emits a single scalar (single row × single column)
// to stdout in CSV form, return it as a Number.
async function runDuckSqlScalar(spawnFn, sql) {
  const row = await runDuckSqlRow(spawnFn, sql);
  return row[0] || 0;
}

// Run a DuckDB SQL that emits a single row of N scalars to stdout in CSV
// form, return it as an array of Numbers.
async function runDuckSqlRow(spawnFn, sql) {
  return await new Promise((resolve, reject) => {
    const proc = spawnFn('duckdb', ['-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', errAll = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { errAll += d.toString(); process.stderr.write(d); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error('duckdb exited with code ' + code + (errAll ? '\n' + errAll.slice(-2000) : '')));
      const line = out.trim().split('\n')[0] || '';
      const fields = parseCsvLine(line);
      resolve(fields.map((s) => { const n = Number(s); return Number.isFinite(n) ? n : 0; }));
    });
  });
}

// RFC4180 CSV row parser (single line, 6 columns). DuckDB's default writer
// quotes fields that contain commas / quotes / newlines, doubling internal
// quotes. We don't handle embedded newlines (no field in this schema can
// contain them).
function parseCsvLine(line) {
  const fields = [];
  let i = 0, n = line.length;
  while (i < n) {
    if (fields.length > 0) {
      if (line.charCodeAt(i) !== 44 /* , */) break;
      i++;
    }
    if (line.charCodeAt(i) === 34 /* " */) {
      i++;
      let s = '';
      while (i < n) {
        const c = line.charCodeAt(i);
        if (c === 34) {
          if (i + 1 < n && line.charCodeAt(i + 1) === 34) { s += '"'; i += 2; }
          else { i++; break; }
        } else { s += line.charAt(i); i++; }
      }
      fields.push(s);
    } else {
      const start = i;
      while (i < n && line.charCodeAt(i) !== 44) i++;
      fields.push(line.slice(start, i));
    }
  }
  return fields;
}

async function fetchS3ToBuffer(s3, GetObjectCommand, Bucket, Key) {
  const resp = await s3.send(new GetObjectCommand({ Bucket, Key }));
  // Body is a Readable stream; collect into a Buffer.
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Streaming tree builder. addObject() may be called millions of times; the
// builder must avoid per-call allocations beyond what's strictly needed for
// new prefixes / leaves.
// ---------------------------------------------------------------------------

function newScanBuilder(sourceBucket) {
  const labels = [];
  const parentIndices = [];
  const values = [];
  const exts = [];
  const storageClasses = [];
  const lastModified = [];
  const kinds = [];
  const objectCounts = [];   // 1 for normal object leaves, N for rollups, 0 elsewhere
  const counts = { object: 0, prefix: 0 };
  let totalObjects = 0;       // total real S3 objects (rollups count as small_count, not 1)
  let totalBytes = 0;

  function add(label, parentIdx, value, ext, sc, mtime, kind, objectCount) {
    const idx = labels.length;
    labels.push(label);
    parentIndices.push(parentIdx);
    values.push(value);
    exts.push(ext);
    storageClasses.push(sc);
    lastModified.push(mtime);
    kinds.push(kind);
    objectCounts.push(objectCount || 0);
    if (counts[kind] != null) counts[kind]++;
    return idx;
  }

  const ROOT = add('s3://' + sourceBucket, -1, 0, '', '', 0, 'root', 0);

  // Sharded prefix lookup: a single JS Map caps at 2^24 (~16.7M) entries,
  // which is too small for inventory-scale buckets. Split across SHARDS
  // maps via a tiny string hash.
  const SHARDS = 64;
  const SHARD_MASK = SHARDS - 1;
  const prefixShards = new Array(SHARDS);
  for (let i = 0; i < SHARDS; i++) prefixShards[i] = new Map();
  function shardOf(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
    return (h >>> 0) & SHARD_MASK;
  }
  function prefixGet(s) { return prefixShards[shardOf(s)].get(s); }
  function prefixSet(s, v) { prefixShards[shardOf(s)].set(s, v); }
  prefixSet('', ROOT);

  return {
    counts,
    addObject(key, size, sc, mtime) {
      if (!key) return;
      // S3 "directory marker" objects have keys ending in '/'. Strip the
      // trailing slash and label them so we account for their bytes (they
      // can be ~MB in some buckets) without producing an empty filename.
      let dirMarker = false;
      if (key.charCodeAt(key.length - 1) === 47 /* / */) {
        key = key.slice(0, -1);
        dirMarker = true;
      }
      // Find / build ancestor prefix nodes; iterate in-place to avoid an
      // intermediate split() allocation per key.
      let parent = ROOT;
      let segStart = 0;
      let acc = '';
      const lastSlash = key.lastIndexOf('/');
      for (let i = 0; i < lastSlash; i++) {
        if (key.charCodeAt(i) === 47 /* / */) {
          const seg = key.slice(segStart, i);
          acc += seg + '/';
          let id = prefixGet(acc);
          if (id == null) { id = add(seg, parent, 0, '', '', 0, 'prefix', 0); prefixSet(acc, id); }
          parent = id;
          segStart = i + 1;
        }
      }
      if (lastSlash > segStart - 1 && lastSlash >= 0) {
        // The last segment before the filename.
        const seg = key.slice(segStart, lastSlash);
        if (seg.length > 0) {
          acc += seg + '/';
          let id = prefixGet(acc);
          if (id == null) { id = add(seg, parent, 0, '', '', 0, 'prefix', 0); prefixSet(acc, id); }
          parent = id;
        }
      }
      const fileName = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
      const label = dirMarker ? fileName + '/ (dir marker)' : fileName;
      add(label, parent, size, dirMarker ? '(dir-marker)' : rawExt(fileName), sc, mtime, 'object', 1);
      totalBytes += size;
      totalObjects++;
    },
    // Add a "(N small)" rollup leaf under the given directory prefix
    // (without a trailing slash). The directory's ancestor prefix nodes
    // are created on demand, just like in addObject.
    addRollupSmall(dirPath, smallCount, size, sc, mtime) {
      let parent = ROOT;
      if (dirPath && dirPath.length > 0) {
        let segStart = 0;
        let acc = '';
        const n = dirPath.length;
        for (let i = 0; i <= n; i++) {
          if (i === n || dirPath.charCodeAt(i) === 47 /* / */) {
            if (i > segStart) {
              const seg = dirPath.slice(segStart, i);
              acc += seg + '/';
              let id = prefixGet(acc);
              if (id == null) { id = add(seg, parent, 0, '', '', 0, 'prefix', 0); prefixSet(acc, id); }
              parent = id;
            }
            segStart = i + 1;
          }
        }
      }
      const label = '(' + smallCount.toLocaleString() + ' small)';
      add(label, parent, size, '(small)', sc || '(rolled-up)', mtime, 'object', smallCount);
      totalBytes += size;
      totalObjects += smallCount;
    },
    get totalObjects() { return totalObjects; },
    finish() {
      return { labels, parentIndices, values, exts, storageClasses, lastModified, kinds, objectCounts, counts, totalBytes, totalObjects };
    },
  };
}

function rawExt(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '(none)';
}

// Walk the tree top-down. At each internal node, partition direct children
// into "kept" (subtree aggregate >= threshold) and "small" (everything
// else). Replace the small group with a single rollup leaf "(N small)"
// carrying the summed bytes. Total bytes are preserved.
function pruneByThreshold(scan, threshold) {
  const n = scan.labels.length;

  // childIds + aggValue (subtree-total bytes per node).
  const childIds = new Array(n);
  for (let i = 0; i < n; i++) childIds[i] = null;
  for (let i = 1; i < n; i++) {
    const p = scan.parentIndices[i];
    if (childIds[p] === null) childIds[p] = [];
    childIds[p].push(i);
  }
  const aggValue = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    aggValue[i] = scan.values[i];
    if (childIds[i]) for (const c of childIds[i]) aggValue[i] += aggValue[c];
  }

  // Aggregate underlying-S3-object count per subtree, using each leaf's
  // recorded objectCount (1 for normal leaves, smallCount for "(N small)"
  // rollups already produced by SQL).
  const aggObjects = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    aggObjects[i] = scan.objectCounts ? (scan.objectCounts[i] || 0) : (scan.kinds[i] === 'object' ? 1 : 0);
    if (childIds[i]) for (const c of childIds[i]) aggObjects[i] += aggObjects[c];
  }

  // Emit a new flat tree, copying only kept nodes (and their kept ancestors).
  const newLabels = [];
  const newParents = [];
  const newValues = [];
  const newExts = [];
  const newStorage = [];
  const newMtime = [];
  const newKinds = [];
  const newObjectCounts = [];
  function emit(label, parent, value, ext, sc, mt, kind, objectCount) {
    const idx = newLabels.length;
    newLabels.push(label);
    newParents.push(parent);
    newValues.push(value);
    newExts.push(ext);
    newStorage.push(sc);
    newMtime.push(mt);
    newKinds.push(kind);
    newObjectCounts.push(objectCount || 0);
    return idx;
  }

  // Emit the root.
  const newRoot = emit(scan.labels[0], -1, scan.values[0], scan.exts[0], scan.storageClasses[0], scan.lastModified[0], scan.kinds[0],
                       scan.objectCounts ? scan.objectCounts[0] : 0);

  // DFS over the original tree; each entry is [oldIdx, newIdx].
  const stack = [[0, newRoot]];
  while (stack.length) {
    const [oldIdx, newIdx] = stack.pop();
    const cs = childIds[oldIdx];
    if (!cs) continue;
    let smallSum = 0, smallCount = 0;
    for (const c of cs) {
      if (aggValue[c] >= threshold) {
        const ni = emit(scan.labels[c], newIdx, scan.values[c], scan.exts[c],
                        scan.storageClasses[c], scan.lastModified[c], scan.kinds[c],
                        scan.objectCounts ? scan.objectCounts[c] : 0);
        stack.push([c, ni]);
      } else {
        smallSum += aggValue[c];
        smallCount += aggObjects[c];
      }
    }
    if (smallSum > 0) {
      // Rollup leaf for this parent's pruned subtrees. objectCount is the
      // sum of every real S3 object that fell under this rollup.
      emit('(' + smallCount.toLocaleString() + ' small)', newIdx, smallSum, '(small)', '(rolled-up)', 0, 'object', smallCount);
    }
  }

  // Recompute counts (approximate).
  const newCounts = { object: 0, prefix: 0 };
  for (let i = 0; i < newKinds.length; i++) {
    if (newCounts[newKinds[i]] != null) newCounts[newKinds[i]]++;
  }

  return {
    labels: newLabels,
    parentIndices: newParents,
    values: newValues,
    exts: newExts,
    storageClasses: newStorage,
    lastModified: newMtime,
    kinds: newKinds,
    objectCounts: newObjectCounts,
    counts: newCounts,
    totalBytes: scan.totalBytes,
    totalObjects: scan.totalObjects,
  };
}

// ---------------------------------------------------------------------------
// HTML — same chrome as gpdu-s3.js, just a different title/help text.
// ---------------------------------------------------------------------------

const THEMES = {
  nord:          { label: 'Nord',             dark: true,  bg: '#2e3440', surface: '#3b4252', border: '#4c566a', fg: '#d8dee9', fgMuted: '#81a1c1', accent: '#88c0d0' },
  solarized:     { label: 'Solarized Dark',   dark: true,  bg: '#002b36', surface: '#073642', border: '#586e75', fg: '#839496', fgMuted: '#657b83', accent: '#268bd2' },
  dracula:       { label: 'Dracula',           dark: true,  bg: '#282a36', surface: '#44475a', border: '#6272a4', fg: '#f8f8f2', fgMuted: '#6272a4', accent: '#bd93f9' },
  catppuccin:    { label: 'Catppuccin Mocha',  dark: true,  bg: '#1e1e2e', surface: '#313244', border: '#45475a', fg: '#cdd6f4', fgMuted: '#a6adc8', accent: '#cba6f7' },
  gruvbox:       { label: 'Gruvbox Dark',      dark: true,  bg: '#282828', surface: '#3c3836', border: '#504945', fg: '#ebdbb2', fgMuted: '#a89984', accent: '#fabd2f' },
  'tokyo-night': { label: 'Tokyo Night',       dark: true,  bg: '#1a1b26', surface: '#16161e', border: '#0f0f14', fg: '#c0caf5', fgMuted: '#787c99', accent: '#7aa2f7' },
  'rose-pine':   { label: 'Rosé Pine',         dark: true,  bg: '#191724', surface: '#1f1d2e', border: '#26233a', fg: '#e0def4', fgMuted: '#908caa', accent: '#c4a7e7' },
  'one-dark':    { label: 'One Dark',           dark: true,  bg: '#282c34', surface: '#2c313a', border: '#3e4452', fg: '#abb2bf', fgMuted: '#828997', accent: '#61afef' },
};
const PALETTE_PICKS = {
  viridis: 'Viridis', plasma: 'Plasma', inferno: 'Inferno', magma: 'Magma',
  turbo: 'Turbo', heatmap: 'Heatmap', coolwarm: 'Cool\u2013Warm', rainbow: 'Rainbow',
  'gp-default': 'Default 8-hue',
};
const STORAGE_COLORMAP = {
  STANDARD:            'hsl(211, 70%, 52%)',
  STANDARD_IA:         'hsl(48,  85%, 55%)',
  ONEZONE_IA:          'hsl(26,  85%, 55%)',
  INTELLIGENT_TIERING: 'hsl(138, 55%, 45%)',
  GLACIER:             'hsl(188, 70%, 48%)',
  GLACIER_IR:          'hsl(264, 55%, 58%)',
  DEEP_ARCHIVE:        'hsl(220, 10%, 35%)',
  REDUCED_REDUNDANCY:  'hsl(0,    0%, 55%)',
  OUTPOSTS:            'hsl(348, 70%, 50%)',
};

const HELP_HTML = `
<h2>gp-treemap &mdash; S3 Inventory</h2>
<p>Cell area is the size in bytes of each S3 object, sourced from the
  bucket's daily Inventory parquet report. The tree mirrors the key
  hierarchy as if "/" were a path separator.</p>
<p>Inventory is the right tool for very large buckets: instead of
  paginating through millions of <code>ListObjectsV2</code> pages, we
  read a single pre-computed parquet manifest. Numbers reflect the day
  of the report — typically a day or two stale.</p>
<h3>Color modes</h3>
<ul>
  <li><b>extension</b>: lowercased file extension; categorically hashed.</li>
  <li><b>storage class</b>: STANDARD / IA / GLACIER / etc.</li>
  <li><b>last modified</b>: quantitative — older objects are darker.</li>
</ul>
`;

const PAGE_CSS = `
  html, body { margin: 0; padding: 0; height: 100%; font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--page-bg, #fafafa); color: var(--page-fg, #111); transition: background .15s, color .15s; }
  body { display: flex; flex-direction: column; }
  .title-row { padding: 8px 14px; border-bottom: 1px solid var(--page-border, #0002);
    display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap;
    background: var(--page-surface, #fff); transition: background .15s; }
  .title-row h1 { margin:0; font-size:14px; font-weight:600; font-family: ui-monospace, SF Mono, Menlo, monospace;
    color: var(--page-fg, #222); }
  .title-row .stat { color: var(--page-fg-muted, #555); font-size:13px; font-variant-numeric: tabular-nums; }
  .title-row .stat b { color: var(--page-fg, #000); font-weight:600; }
  .app-toolbar { padding: 4px 14px; border-bottom: 1px solid var(--page-border, #0002);
    display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
    background: var(--page-surface, #fff); font-size: 12px; color: var(--page-fg-muted, #666);
    transition: background .15s; }
  .app-toolbar .spacer { flex: 1; }
  .help-btn { font-size: 12px; width: 22px; height: 22px; line-height: 20px; text-align: center;
    border-radius: 50%; background: var(--page-bg, #fff); color: var(--page-fg, #333);
    border: 1px solid var(--page-border, #ccc); cursor: pointer; padding: 0;
    font-family: inherit; font-weight: 600; }
  .help-btn:hover { background: var(--page-border, #eee); }
  .help-modal-backdrop { position: fixed; inset: 0; background: #0007; z-index: 999; display: none;
    align-items: center; justify-content: center; }
  .help-modal-backdrop.open { display: flex; }
  .help-modal { background: var(--page-surface, #fff); color: var(--page-fg, #111);
    border: 1px solid var(--page-border, #333); border-radius: 8px; padding: 20px 24px;
    max-width: 560px; max-height: 80vh; overflow: auto; box-shadow: 0 8px 40px #000a;
    font-size: 13px; line-height: 1.5; }
  .help-modal h2 { margin: 0 0 10px; font-size: 16px; }
  .help-modal h3 { margin: 14px 0 4px; font-size: 13px; font-weight: 600; }
  .help-modal ul { margin: 4px 0 0 0; padding-left: 20px; }
  .help-modal .close { float: right; background: none; border: none; color: inherit;
    font-size: 18px; cursor: pointer; margin: -4px -8px 0 0; }
  .help-modal code, .help-modal kbd { background: var(--page-border, #eee); color: inherit;
    padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  gp-treemap { display:flex; flex: 1; min-height: 0; }
  #bottom-bar { display:flex; align-items:center; gap: 16px; padding: 3px 14px;
    font-size: 12px; font-variant-numeric: tabular-nums; min-height: 18px;
    color: var(--page-fg-muted, #888); background: var(--page-surface, #fff);
    border-top: 1px solid var(--page-border, #0002); transition: background .15s, color .15s; }
  #stats-bar { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #scanned-note { flex-shrink: 0; color: var(--page-fg-muted, #888); }
  #theme-sel, #palette-sel, #color-sel { font-size: 12px; padding: 2px 4px; border-radius: 4px;
    background: var(--page-bg, #fff); color: var(--page-fg, #333);
    border: 1px solid var(--page-border, #ccc); cursor: pointer; }
`;

function buildHtml(sink, manifestArg, bucketName, scan, colorBy, blockSize) {
  const w = sink;

  const isCategorical = CATEGORICAL_MODES.includes(colorBy);
  const tmColorMode = isCategorical ? 'categorical' : 'quantitative';
  const tmPalette = isCategorical ? 'tokyo-night' : 'viridis';

  const themeOptions = Object.entries(THEMES)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`)
    .join('');
  const paletteOptions = Object.entries(PALETTE_PICKS)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`)
    .join('');

  const when = (() => {
    const d = new Date();
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
    const mm = String(Math.abs(off) % 60).padStart(2, '0');
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
      'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') +
      sign + hh + ':' + mm;
  })();

  const titleStr = 'inventory · ' + bucketName + ' · ' + manifestArg;

  w(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>treemap \xb7 ${escapeHtml(bucketName)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="title-row">
  <h1>${escapeHtml(titleStr)}</h1>
  <span class="stat"><b>${(scan.totalObjects || scan.counts.object).toLocaleString()}</b> objects</span>
  <span class="stat"><b>${scan.counts.prefix.toLocaleString()}</b> "folders"</span>
  <span class="stat"><b>${humanBytes(scan.totalBytes)}</b> total</span>
  <span class="spacer" style="flex:1"></span>
  <button id="help-btn" class="help-btn" title="Help">?</button>
</div>
<div class="app-toolbar">
  <span>color
    <select id="color-sel">
      <option value="extension">extension</option>
      <option value="storage-class">storage class</option>
      <option value="last-modified">last modified</option>
    </select>
  </span>
  <span class="spacer"></span>
  <span>theme
    <select id="theme-sel">
      <option value="">Default (light)</option>
      ${themeOptions}
    </select>
  </span>
  <span>palette
    <select id="palette-sel">
      <option value="">(theme default)</option>
      ${paletteOptions}
    </select>
  </span>
</div>
<div id="help-modal" class="help-modal-backdrop">
  <div class="help-modal" role="dialog" aria-label="Help">
    <button class="close" aria-label="close">\xD7</button>
    ${HELP_HTML}
  </div>
</div>
<gp-treemap id="tm"
  color-mode="${tmColorMode}"
  palette="${tmPalette}"
  gradient-intensity="0.6"
  value-format="b"
  min-cell-area="30"></gp-treemap>
<div id="bottom-bar">
  <div id="stats-bar"></div>
  <span id="scanned-note">read ${escapeHtml(when)}</span>
</div>

<script type="application/json" id="tmdata">
`);

  const normScan = {
    labels: scan.labels,
    parentIndices: scan.parentIndices,
    values: scan.values,
    attributes: {
      extension:       { kind: 'categorical', values: scan.exts },
      'storage-class': { kind: 'categorical', values: scan.storageClasses },
      'last-modified': { kind: 'numeric',     values: scan.lastModified },
      kind:            { kind: 'categorical', values: scan.kinds },
      objectCount:     { kind: 'numeric',     values: scan.objectCounts || scan.kinds.map(k => k === 'object' ? 1 : 0) },
    },
  };

  const { blocks, aggValue } = partitionBlocks(normScan, blockSize);
  process.stderr.write('  partitioned into ' + blocks.length + ' blocks\n');

  w('{"v":3,"totalBytes":' + scan.totalBytes + ',"blocks":[');
  for (let bi = 0; bi < blocks.length; bi++) {
    const blockJson = JSON.stringify(encodeBlock(normScan, blocks[bi], { aggValue }));
    const compressed = zlib.deflateRawSync(blockJson, { level: 6 });
    if (bi > 0) w(',');
    w('"' + compressed.toString('base64') + '"');
  }
  w(']}');

  const cfg = {
    defaultColorMode: colorBy,
    categoricalModes: CATEGORICAL_MODES,
    quantitativeModes: QUANTITATIVE_MODES,
    catColorMaps: { 'storage-class': STORAGE_COLORMAP },
    defaultTheme: 'tokyo-night',
    themes: THEMES,
    palettePicks: PALETTE_PICKS,
    catPaletteDefault: 'tokyo-night',
    qPaletteDefault: 'viridis',
  };

  w(`
<\/script>
<script>
window._gpduConfig = ${JSON.stringify(cfg)};
window._gpduConfig.valueFormatter = function (v) {
  var units = ['B','KB','MB','GB','TB','PB']; var i = 0, n = v || 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
};
<\/script>
<script>
${BUNDLE}
<\/script>
<script>
${LOADER_JS}
<\/script>
<script>
window._bootReady.then(function () {
  var tm = document.getElementById('tm');
  var bar = document.getElementById('stats-bar');
  var store = window._store;
  function fmtBytes(v) {
    var units = ['B','KB','MB','GB','TB','PB']; var i = 0, n = v || 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
  }
  function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function subtreeStats(nodeId) {
    // c.object counts the underlying S3 objects: 1 per normal leaf, but
    // the rollup's stored objectCount (the "(N small)" count) for any
    // rollup leaf — so the displayed total reflects the real bucket, not
    // just the visible cells.
    var c = { object: 0, prefix: 0, bytes: 0 };
    var stack = [nodeId];
    while (stack.length) {
      var id = stack.pop();
      var n = store.get(id);
      if (!n) continue;
      var k = n.kind;
      if (k === 'object') { c.object += (n.objectCount || 1); c.bytes += n.value || 0; }
      else if (k === 'prefix') c.prefix++;
      if (n.childIds && n.childIds.length > 0) {
        for (var i = 0; i < n.childIds.length; i++) stack.push(n.childIds[i]);
      }
    }
    return c;
  }
  function update() {
    var id = tm._focusId != null ? tm._focusId : tm._targetId != null ? tm._targetId : tm._tree ? tm._tree.roots[0] : null;
    if (id == null) { bar.textContent = ''; return; }
    var nd = store.get(id);
    if (!nd) { bar.textContent = ''; return; }
    var s = subtreeStats(id);
    var parts = [];
    if (s.object > 0) parts.push(s.object.toLocaleString() + ' object' + (s.object !== 1 ? 's' : ''));
    if (s.prefix > 0) parts.push(s.prefix.toLocaleString() + ' "folder' + (s.prefix !== 1 ? 's"' : '"'));
    parts.push(fmtBytes(s.bytes || nd.value || 0));
    if (nd.kind === 'object') {
      parts.push('class: ' + (nd['storage-class'] || ''));
      if (nd['last-modified']) parts.push('modified: ' + fmtDate(nd['last-modified']));
    }
    bar.textContent = parts.join('  |  ');
  }
  tm.addEventListener('gp-focus', update);
  tm.addEventListener('gp-target', update);
  tm.addEventListener('gp-zoom-change', update);
  requestAnimationFrame(function () { setTimeout(update, 0); });
});
<\/script>
</body>
</html>
`);
}

if (import.meta.url === url.pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
