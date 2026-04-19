// Tiny static server so samples/ and src/ can be served with MIME types.
// Used by Playwright (webServer) and for local browsing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function safeJoin(rel) {
  const target = path.normalize(path.join(ROOT, rel));
  if (!target.startsWith(ROOT)) return null;
  return target;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  let rel = decodeURIComponent(parsed.pathname || '/');
  if (rel === '/') rel = '/samples/index.html';
  const target = safeJoin(rel);
  if (!target) { res.writeHead(400); return res.end('bad path'); }
  fs.stat(target, (err, st) => {
    if (err) { res.writeHead(404); return res.end('not found: ' + rel); }
    if (st.isDirectory()) {
      const idx = path.join(target, 'index.html');
      return fs.readFile(idx, (err2, data) => {
        if (err2) { res.writeHead(404); return res.end('no index'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    }
    const type = MIME[path.extname(target)] || 'application/octet-stream';
    fs.readFile(target, (err2, data) => {
      if (err2) { res.writeHead(500); return res.end('read error'); }
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT}/`);
});
