// Local static server; no production API proxy or Git-dependent fixtures.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const stat = await fs.stat(target);
    const file = stat.isDirectory() ? path.join(target, 'index.html') : target;
    const body = await fs.readFile(file);
    if (pathname === '/tests/e2e/legacy-free-sw.js') res.setHeader('Service-Worker-Allowed', '/free/');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(8138, '127.0.0.1');
