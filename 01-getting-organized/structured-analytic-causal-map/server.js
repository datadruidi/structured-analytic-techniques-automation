/**
 * Local server for causal-map. Serves the app, persists the map tree to
 * data/evidence.json (the live database), and appends hypothesis-keyword
 * JSONL records to data/hypothesis_keywords.jsonl.
 * Run from this folder: node server.js
 * Then open http://localhost:8765 in the browser.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const EVIDENCE_PATH = path.join(DATA_DIR, 'evidence.json');
const JSONL_PATH = path.join(DATA_DIR, 'hypothesis_keywords.jsonl');

function toArray(val) {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (val == null) return [];
  return [String(val).trim()].filter(Boolean);
}

function normalizeRecord(body) {
  const createdAt =
    body && body.createdAt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(String(body.createdAt))
      ? String(body.createdAt)
      : new Date().toISOString();
  const record = {
    createdAt,
    what: toArray(body && body.what),
    who: toArray(body && body.who),
    when: toArray(body && body.when),
    where: toArray(body && body.where),
    why: toArray(body && body.why),
    how: toArray(body && body.how)
  };
  if (body && body.id != null && String(body.id).trim() !== '') record.id = String(body.id).trim();
  if (body && body.evidence != null && String(body.evidence).trim() !== '') record.evidence = String(body.evidence).trim();
  if (body && body.sessionId != null && String(body.sessionId).trim() !== '') record.sessionId = String(body.sessionId).trim();
  if (body && body.appVersion != null && String(body.appVersion).trim() !== '') record.appVersion = String(body.appVersion).trim();
  return record;
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
  res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '').split('?')[0].replace(/\/$/, '') || '/';

  /* ── GET /data/evidence.json ── */
  if (req.method === 'GET' && urlPath === '/data/evidence.json') {
    fs.readFile(EVIDENCE_PATH, 'utf8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); }
        else { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  /* ── POST /api/save-evidence ── */
  if (req.method === 'POST' && urlPath === '/api/save-evidence') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try { JSON.parse(body); } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        return;
      }
      try {
        ensureDataDir();
        fs.writeFileSync(EVIDENCE_PATH, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Error writing evidence.json:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err.message) }));
      }
    });
    return;
  }

  /* ── POST /api/save-indicators (hypothesis keywords JSONL) ── */
  if (req.method === 'POST' && urlPath === '/api/save-indicators') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        return;
      }
      const record = normalizeRecord(body);
      const line = JSON.stringify(record) + '\n';
      try {
        ensureDataDir();
        fs.appendFileSync(JSONL_PATH, line, 'utf8');
        console.log('Appended hypothesis keywords to:', JSONL_PATH);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Error writing hypothesis keywords:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err.message) }));
      }
    });
    return;
  }

  const staticPath = urlPath === '/' ? '/index.html' : urlPath;
  const safePath = path.normalize(staticPath).replace(/^(\.\.(\/|\\))+/, '').replace(/^[\\/]+/, '');
  const filePath = path.join(__dirname, safePath);
  if (!filePath.startsWith(__dirname)) {
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
    serveFile(filePath, res);
  });
});

server.listen(PORT, () => {
  console.log('Causal map server: http://localhost:' + PORT);
  console.log('Evidence (live database): ' + EVIDENCE_PATH);
  console.log('Hypothesis keywords (JSONL): ' + JSONL_PATH);
});
