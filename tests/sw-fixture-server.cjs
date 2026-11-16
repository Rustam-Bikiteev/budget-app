// Local-only fixture for service worker upgrade and slow-network checks.
// node tests/sw-fixture-server.cjs
// POST /__test/upgrade switches HEAD's worker to the working copy.
// POST /__test/slow enables 1.5 s latency for static responses.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const previousWorker = execFileSync('git', ['show', 'HEAD:free/sw.js'], { cwd: root });
let upgraded = false;
let slow = false;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (req.method === 'POST' && pathname === '/__test/upgrade') {
      upgraded = true;
      res.end('upgraded');
      return;
    }
    if (req.method === 'POST' && pathname === '/__test/slow') {
      slow = true;
      res.end('slow');
      return;
    }
    const target = path.resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const stat = await fs.stat(target);
    const file = stat.isDirectory() ? path.join(target, 'index.html') : target;
    const body = file === path.join(root, 'free', 'sw.js') && !upgraded
      ? previousWorker : await fs.readFile(file);
    if (slow) await new Promise(resolve => setTimeout(resolve, 1500));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch (_) {
    res.writeHead(404).end();
  }
}).listen(8137, '127.0.0.1', () => console.log('SW fixture http://127.0.0.1:8137'));
