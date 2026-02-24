/**
 * Local server for the Analysis of Competing Hypothesis (ACH) evidence list.
 * Serves static files so evidence-list.html can fetch evidence_example.json.
 * Port: 8084 (see HUB-PAGE-INSTRUCTIONS.md).
 *
 * Run: node server.js
 * Then open http://localhost:8084 (serves evidence-list.html by default)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8084;
const ROOT = __dirname;

/**
 * Remove unescaped control characters from inside JSON string literals
 * so that JSON.parse() succeeds. Leaves other content unchanged.
 */
function sanitizeJsonForParse(raw) {
  const s = typeof raw === "string" ? raw : String(raw);
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = c.charCodeAt(0);
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString && code < 32) {
      if (c === "\n") out += "\\n";
      else if (c === "\r") out += "\\r";
      else if (c === "\t") out += "\\t";
      else out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function send(res, statusCode, body, contentType, extraHeaders) {
  const headers = { "Content-Type": contentType || "text/plain; charset=utf-8" };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  res.writeHead(statusCode, headers);
  res.end(body);
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || "application/octet-stream";
  const noCache = ext === ".json";
  const isJson = ext === ".json";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        send(res, 404, "Not found", "text/plain");
        return;
      }
      send(res, 500, "Server error", "text/plain");
      return;
    }
    let body = data;
    if (isJson) {
      const text = data.toString("utf8");
      try {
        JSON.parse(text);
      } catch (e) {
        body = Buffer.from(sanitizeJsonForParse(text), "utf8");
      }
    }
    const headers = { "Content-Type": contentType };
    if (noCache) {
      headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
      headers["Pragma"] = "no-cache";
    }
    res.writeHead(200, headers);
    res.end(body);
  });
}

const EVIDENCE_JSON_PATH = path.join(ROOT, "..", "..", "data", "evidence.json");
const EVIDENCE_JSONL_PATH = path.join(ROOT, "evidence_list.jsonl");
const HYPOTHESIS_JSON_PATH = path.join(ROOT, "hypothesis_example.json");
const INPUT_HYPOTHESIS_JSON_PATH = path.join(ROOT, "input", "hypothesis.json");
const DATA_HYPOTHESIS_JSON_PATH = path.join(ROOT, "..", "..", "data", "hypothesis.json");

function collectEvidenceNodes(node, out) {
  if (!node) return;
  const evidence = (node.evidence || "").toString().trim();
  if (evidence.toLowerCase() === "yes") {
    out.push({
      id: node.id,
      name: node.name || "",
      description: node.description || "",
      source: node.source || "",
      date: node.date || "",
      time: node.time || "",
      evidence: "Yes"
    });
  }
  const children = node.children;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      collectEvidenceNodes(children[i], out);
    }
  }
}

function writeEvidenceJsonl(tree, cb) {
  const items = [];
  collectEvidenceNodes(tree, items);
  const lines = items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : "");
  fs.writeFile(EVIDENCE_JSONL_PATH, lines, "utf8", cb);
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || "").split("?")[0].replace(/\/$/, "") || "/";

  if (req.method === "POST" && urlPath === "/api/save-evidence") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (e) {
        send(res, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json");
        return;
      }
      const json = JSON.stringify(body, null, 2);
      fs.writeFile(EVIDENCE_JSON_PATH, json, "utf8", (err) => {
        if (err) {
          send(res, 500, JSON.stringify({ ok: false, error: err.message }), "application/json");
          return;
        }
        writeEvidenceJsonl(body, (errJsonl) => {
          if (errJsonl) {
            send(res, 500, JSON.stringify({ ok: false, error: errJsonl.message }), "application/json");
            return;
          }
          send(res, 200, JSON.stringify({ ok: true }), "application/json");
        });
      });
    });
    return;
  }

  if (req.method === "POST" && urlPath === "/api/remove-from-evidence-jsonl") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (e) {
        send(res, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json");
        return;
      }
      const id = body && body.id ? String(body.id).trim() : "";
      if (!id) {
        send(res, 400, JSON.stringify({ ok: false, error: "Missing id" }), "application/json");
        return;
      }
      fs.readFile(EVIDENCE_JSONL_PATH, "utf8", (err, data) => {
        if (err && err.code !== "ENOENT") {
          send(res, 500, JSON.stringify({ ok: false, error: err.message }), "application/json");
          return;
        }
        const lines = (err ? "" : data).split("\n").filter((line) => {
          const trimmed = line.trim();
          if (!trimmed) return false;
          try {
            const obj = JSON.parse(trimmed);
            return obj.id !== id;
          } catch (e) {
            return true;
          }
        });
        const out = lines.join("\n") + (lines.length ? "\n" : "");
        fs.writeFile(EVIDENCE_JSONL_PATH, out, "utf8", (writeErr) => {
          if (writeErr) {
            send(res, 500, JSON.stringify({ ok: false, error: writeErr.message }), "application/json");
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
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (e) {
        send(res, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json");
        return;
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        send(res, 400, JSON.stringify({ ok: false, error: "Expected JSON object" }), "application/json");
        return;
      }
      const json = JSON.stringify(body, null, 2);
      fs.writeFile(HYPOTHESIS_JSON_PATH, json, "utf8", (err) => {
        if (err) {
          send(res, 500, JSON.stringify({ ok: false, error: err.message }), "application/json");
          return;
        }
        send(res, 200, JSON.stringify({ ok: true }), "application/json");
      });
    });
    return;
  }

  if (req.method === "POST" && urlPath === "/api/save-input-hypothesis") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (e) {
        send(res, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json");
        return;
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        send(res, 400, JSON.stringify({ ok: false, error: "Expected JSON object" }), "application/json");
        return;
      }
      const json = JSON.stringify(body, null, 2);
      fs.writeFile(INPUT_HYPOTHESIS_JSON_PATH, json, "utf8", (err) => {
        if (err) {
          send(res, 500, JSON.stringify({ ok: false, error: err.message }), "application/json");
          return;
        }
        send(res, 200, JSON.stringify({ ok: true }), "application/json");
      });
    });
    return;
  }

  if (req.method === "GET" && urlPath === "/api/evidence") {
    serveFile(EVIDENCE_JSON_PATH, res);
    return;
  }

  if (req.method === "GET" && urlPath === "/api/hypothesis") {
    serveFile(DATA_HYPOTHESIS_JSON_PATH, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/save-data-hypothesis") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (e) {
        send(res, 400, JSON.stringify({ ok: false, error: "Invalid JSON" }), "application/json");
        return;
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        send(res, 400, JSON.stringify({ ok: false, error: "Expected JSON object" }), "application/json");
        return;
      }
      const json = JSON.stringify(body, null, 2);
      fs.writeFile(DATA_HYPOTHESIS_JSON_PATH, json, "utf8", (err) => {
        if (err) {
          send(res, 500, JSON.stringify({ ok: false, error: err.message }), "application/json");
          return;
        }
        send(res, 200, JSON.stringify({ ok: true }), "application/json");
      });
    });
    return;
  }

  if (req.method !== "GET") {
    send(res, 405, "Method not allowed", "text/plain");
    return;
  }

  const filePathFromUrl = urlPath === "/" ? "/evidence-list.html" : urlPath;
  const safePath = filePathFromUrl.replace(/^\/+/, "").replace(/\.\./g, "");
  const filePath = path.resolve(ROOT, safePath || "evidence-list.html");

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, "Forbidden", "text/plain");
    return;
  }
  serveFile(filePath, res);
});

server.listen(PORT, () => {
  console.log("Competing Hypothesis (evidence list) at http://localhost:" + PORT);
});
