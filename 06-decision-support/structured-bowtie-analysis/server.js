/**
 * Local static server for Bowtie Analysis.
 * Run from this folder: node server.js
 * Then open http://localhost:8085
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8085;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }

  const urlPath = (req.url || '/').split('?')[0];
  const staticPath = urlPath === '/' ? '/index.html' : urlPath;
  const safePath = path
    .normalize(staticPath)
    .replace(/^(\.\.(\/|\\))+/, '')
    .replace(/^[\\/]+/, '');
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('Bowtie Analysis server: http://localhost:' + PORT);
});
