import { parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';

parentPort.on('message', ({ dirPath, dirRow }) => {
  let entries;
  const results = [];
  let unreadable = 0;

  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    parentPort.postMessage({ dirRow, dirPath, results, unreadable: 1 });
    return;
  }

  for (const ent of entries) {
    if (ent.isSymbolicLink()) { unreadable++; continue; }
    if (ent.isDirectory()) {
      results.push({ name: ent.name, isDir: true });
    } else if (ent.isFile()) {
      let size = 0;
      try { size = fs.statSync(path.join(dirPath, ent.name)).size; }
      catch { unreadable++; continue; }
      results.push({ name: ent.name, isDir: false, size });
    } else {
      unreadable++;
    }
  }

  parentPort.postMessage({ dirRow, dirPath, results, unreadable });
});
