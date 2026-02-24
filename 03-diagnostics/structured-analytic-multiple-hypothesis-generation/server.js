/**
 * Local server for the Multiple Hypothesis Generation app.
 * Serves static files from this folder. Per HUB-PAGE-INSTRUCTIONS.md, uses port 8083.
 *
 * Run: node server.js
 * Then open http://localhost:8083
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8083;
const ROOT = __dirname;
const SOURCE_FILE = path.join(ROOT, "input", "Multiple_Hypothesis_Generation.txt");
const HYPOTHESES_FILE = path.join(ROOT, "Hypotheses.txt");
const JSONL_PATH = path.resolve(ROOT, "..", "..", "data", "hypothesis_keywords.jsonl");

function toArray(val) {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (val == null) return [];
  return [String(val).trim()].filter(Boolean);
}

function normalizeIndicatorsRecord(body) {
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
  if (body && body.id != null && String(body.id).trim() !== "") record.id = String(body.id).trim();
  if (body && body.evidence != null && String(body.evidence).trim() !== "") record.evidence = String(body.evidence).trim();
  if (body && body.sessionId != null && String(body.sessionId).trim() !== "") record.sessionId = String(body.sessionId).trim();
  if (body && body.appVersion != null && String(body.appVersion).trim() !== "") record.appVersion = String(body.appVersion).trim();
  return record;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, statusCode, body, contentType) {
  res.writeHead(statusCode, { "Content-Type": contentType || "text/plain; charset=utf-8" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0].replace(/\/$/, "") || "/";

  if (req.method === "POST" && urlPath === "/api/add-source") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let label = Buffer.concat(chunks).toString("utf8").trim();
      if (req.headers["content-type"] && req.headers["content-type"].includes("application/json")) {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          label = (json.label || json.text || "").trim();
        } catch (_) {}
      }
      if (!label) {
        send(res, 400, JSON.stringify({ ok: false, error: "Empty label" }), "application/json");
        return;
      }
      const line = "\n- " + label;
      const inputDir = path.dirname(SOURCE_FILE);
      if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir, { recursive: true });
      fs.readFile(SOURCE_FILE, "utf8", (err, content) => {
        const toWrite = err && err.code === "ENOENT" ? "So What?" + line : (content || "") + line;
        fs.writeFile(SOURCE_FILE, toWrite, "utf8", (writeErr) => {
          if (writeErr) {
            send(res, 500, JSON.stringify({ ok: false, error: String(writeErr.message) }), "application/json");
            return;
          }
          send(res, 200, JSON.stringify({ ok: true }), "application/json");
        });
      });
    });
    return;
  }

  if (req.method === "POST" && urlPath === "/api/source") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (_) {
        send(res, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json");
        return;
      }
      const items = Array.isArray(body.items) ? body.items.map((l) => (l == null ? "" : String(l).trim())).filter(Boolean) : [];
      const content = "So What?\n" + items.map((i) => "- " + i).join("\n") + (items.length ? "\n" : "");
      const inputDir = path.dirname(SOURCE_FILE);
      if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFile(SOURCE_FILE, content, "utf8", (writeErr) => {
        if (writeErr) {
          send(res, 500, JSON.stringify({ ok: false, error: String(writeErr.message) }), "application/json");
          return;
        }
        send(res, 200, JSON.stringify({ ok: true }), "application/json");
      });
    });
    return;
  }

  if (req.method === "POST" && urlPath === "/api/update-hypothesis-line") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (_) {
        send(res, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json");
        return;
      }
      const index = typeof body.index === "number" ? body.index : -1;
      const text = typeof body.text === "string" ? body.text : "";
      if (index < 0) {
        send(res, 400, JSON.stringify({ ok: false, error: "Invalid index" }), "application/json");
        return;
      }
      fs.readFile(HYPOTHESES_FILE, "utf8", (err, content) => {
        if (err && err.code !== "ENOENT") {
          send(res, 500, JSON.stringify({ ok: false, error: String(err.message) }), "application/json");
          return;
        }
        const lines = (err || !content ? "" : content).split(/\r?\n/);
        if (index >= lines.length) {
          send(res, 400, JSON.stringify({ ok: false, error: "Index out of range" }), "application/json");
          return;
        }
        lines[index] = text;
        fs.writeFile(HYPOTHESES_FILE, lines.join("\n"), "utf8", (writeErr) => {
          if (writeErr) {
            send(res, 500, JSON.stringify({ ok: false, error: String(writeErr.message) }), "application/json");
            return;
          }
          send(res, 200, JSON.stringify({ ok: true }), "application/json");
        });
      });
    });
    return;
  }

  if (req.method === "POST" && urlPath === "/api/save-hypothesis") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let title = raw.trim();
      if (req.headers["content-type"] && req.headers["content-type"].includes("application/json")) {
        try {
          const json = JSON.parse(raw);
          title = typeof json.title === "string" ? json.title.trim() : (typeof json.permutation === "string" ? json.permutation.trim() : (typeof json.text === "string" ? json.text.trim() : title));
        } catch (_) {}
      }
      const dataDir = path.resolve(ROOT, "..", "..", "data");
      const outPath = path.join(dataDir, "hypothesis.json");
      try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        let payload = {};
        if (fs.existsSync(outPath)) {
          try { payload = JSON.parse(fs.readFileSync(outPath, "utf8")); } catch (_) {}
        }
        if (typeof payload !== "object" || payload === null) payload = {};
        if (!Array.isArray(payload.hypotheses)) payload.hypotheses = [];
        const exists = payload.hypotheses.some((h) => h && h.title === title);
        if (!exists) {
          const hypId = "hyp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
          payload.hypotheses.push({ id: hypId, title: title });
        }
        fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
        send(res, 200, JSON.stringify({ ok: true }), "application/json");
      } catch (err) {
        send(res, 500, JSON.stringify({ ok: false, error: String(err.message) }), "application/json");
      }
    });
    return;
  }

  if (req.method === "GET" && urlPath === "/api/hypothesis-ach") {
    const achDir = path.resolve(ROOT, "..", "..", "data");
    const outPath = path.join(achDir, "hypothesis.json");
    try {
      let payload = {};
      if (fs.existsSync(outPath)) {
        try {
          payload = JSON.parse(fs.readFileSync(outPath, "utf8"));
        } catch (_) {}
      }
      if (typeof payload !== "object" || payload === null) payload = {};
      send(res, 200, JSON.stringify(payload), "application/json");
    } catch (err) {
      send(res, 500, JSON.stringify({ ok: false, error: String(err.message) }), "application/json");
    }
    return;
  }

  if (req.method === "POST" && urlPath === "/api/save-hypothesis-ach") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (_) {
        send(res, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json");
        return;
      }
      const id = typeof body.id === "string" && /^H\d+$/.test(body.id) ? body.id : null;
      const title = typeof body.title === "string" ? body.title : "";
      const description = typeof body.description === "string" ? body.description : "";
      const hypothesisId = typeof body.hypothesisId === "string" ? body.hypothesisId.trim() : null;
      const intelligenceRequirement = body.intelligence_requirement !== undefined ? String(body.intelligence_requirement).trim() : undefined;
      const titles = Array.isArray(body.titles) ? body.titles.map((t) => (t != null ? String(t).trim() : "")) : null;
      const achDir = path.resolve(ROOT, "..", "..", "data");
      const outPath = path.join(achDir, "hypothesis.json");
      try {
        if (!fs.existsSync(achDir)) {
          fs.mkdirSync(achDir, { recursive: true });
        }
        let payload = {};
        if (fs.existsSync(outPath)) {
          try {
            payload = JSON.parse(fs.readFileSync(outPath, "utf8"));
          } catch (_) {}
        }
        if (typeof payload !== "object" || payload === null) payload = {};
        if (!Array.isArray(payload.hypotheses)) payload.hypotheses = [];
        if (intelligenceRequirement !== undefined) payload.intelligence_requirement = intelligenceRequirement;
        if (titles && titles.length > 0) {
          for (let i = 0; i < Math.min(5, titles.length); i++) {
            const key = "H" + (i + 1);
            const newTitle = titles[i] !== undefined ? titles[i] : "";
            const existing = payload[key] && typeof payload[key] === "object" ? payload[key] : null;
            const existingDesc = existing && typeof existing.description === "string" ? existing.description : "";
            payload[key] = { id: key, title: newTitle, description: existingDesc };
          }
        } else if (id) {
          payload[id] = { id, title, description };
          if (hypothesisId) {
            payload[id].hypothesisId = hypothesisId;
            const match = payload.hypotheses.find((h) => h && h.id === hypothesisId);
            if (match) {
              match.slot = id;
              match.description = description;
            }
          }
        }
        fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
      } catch (err) {
        send(res, 500, JSON.stringify({ ok: false, error: String(err.message) }), "application/json");
        return;
      }
      send(res, 200, JSON.stringify({ ok: true }), "application/json");
    });
    return;
  }

  if (req.method === "POST" && urlPath === "/api/hypotheses") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (_) {
        send(res, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json");
        return;
      }
      const lines = Array.isArray(body.lines) ? body.lines.map((l) => (l == null ? "" : String(l))) : [];
      fs.writeFile(HYPOTHESES_FILE, lines.join("\n"), "utf8", (writeErr) => {
        if (writeErr) {
          send(res, 500, JSON.stringify({ ok: false, error: String(writeErr.message) }), "application/json");
          return;
        }
        send(res, 200, JSON.stringify({ ok: true }), "application/json");
      });
    });
    return;
  }

  if (req.method === "POST" && urlPath === "/api/clear-hypotheses") {
    const dataDir = path.resolve(ROOT, "..", "..", "data");
    const outPath = path.join(dataDir, "hypothesis.json");
    try {
      let payload = {};
      if (fs.existsSync(outPath)) {
        try { payload = JSON.parse(fs.readFileSync(outPath, "utf8")); } catch (_) {}
      }
      if (typeof payload !== "object" || payload === null) payload = {};
      payload.hypotheses = [];
      ["H1", "H2", "H3", "H4", "H5"].forEach((k) => { delete payload[k]; });
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
      send(res, 200, JSON.stringify({ ok: true }), "application/json");
    } catch (err) {
      send(res, 500, JSON.stringify({ ok: false, error: String(err.message) }), "application/json");
    }
    return;
  }

  if (req.method !== "GET") {
    send(res, 405, "Method not allowed", "text/plain");
    return;
  }

  const staticPath = urlPath === "/" ? "/index.html" : urlPath;
  const safePath = staticPath.replace(/^\/+/, "").replace(/\.\./g, "");
  const filePath = path.resolve(ROOT, safePath || "index.html");

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, "Forbidden", "text/plain");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") send(res, 404, "Not found", "text/plain");
      else send(res, 500, "Server error", "text/plain");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log("Multiple Hypothesis Generation: http://localhost:" + PORT);
  console.log("Hypothesis keywords (JSONL) will be written to:", JSONL_PATH);
});
