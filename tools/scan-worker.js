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
      let st;
      try { st = fs.statSync(path.join(dirPath, ent.name)); }
      catch { unreadable++; continue; }
      const r = { name: ent.name, isDir: false, size: st.size,
                  ts: { ctime: st.ctimeMs, mtime: st.mtimeMs, atime: st.atimeMs } };
      results.push(r);
    } else {
      unreadable++;
    }
  }

  parentPort.postMessage({ dirRow, dirPath, results, unreadable });
});
