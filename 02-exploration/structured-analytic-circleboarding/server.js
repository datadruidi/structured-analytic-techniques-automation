/**
 * Optional local server for the Circleboarding app.
 * Serves static files so the app can load hypothesis_keywords.txt via fetch.
 *
 * Run: node server.js
 * Then open http://localhost:8082
 *
 * Port 8082 is reserved for this tool (see repo root HUB-PAGE-INSTRUCTIONS.md).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8082;
const ROOT = __dirname;
const REPO_ROOT = path.resolve(ROOT, "..", "..");
const CIRCLEBOARD_DATA_FILE = path.join(ROOT, "CircleboardData.txt");
const DATA_DIR = path.join(REPO_ROOT, "data");
const HYPOTHESIS_DIR = path.resolve(REPO_ROOT, "03-diagnostics", "structured-analytic-multiple-hypothesis-generation", "input");
const HYPOTHESIS_FILE = path.resolve(HYPOTHESIS_DIR, "Multiple_Hypothesis_Generation.txt");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function send(res, statusCode, body, contentType) {
  res.writeHead(statusCode, { "Content-Type": contentType || "text/plain; charset=utf-8" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  if (req.method === "POST" && urlPath === "/api/save-circleboard") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      fs.writeFile(CIRCLEBOARD_DATA_FILE, body, "utf8", (err) => {
        if (err) {
          send(res, 500, JSON.stringify({ ok: false, error: String(err.message) }), "application/json");
          return;
        }
        send(res, 200, JSON.stringify({ ok: true }), "application/json");
      });
    });
    return;
  }

  if (req.method === "POST" && urlPath === "/api/save-hypothesis") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      fs.mkdir(HYPOTHESIS_DIR, { recursive: true }, (mkdirErr) => {
        if (mkdirErr) {
          send(res, 500, JSON.stringify({ ok: false, error: String(mkdirErr.message) }), "application/json");
          return;
        }
        // Always overwrite: full content each time, never append
        fs.writeFile(HYPOTHESIS_FILE, body, { encoding: "utf8", flag: "w" }, (err) => {
          if (err) {
            console.error("Hypothesis save error:", err.message);
            send(res, 500, JSON.stringify({ ok: false, error: String(err.message) }), "application/json");
            return;
          }
          console.log("Hypothesis saved to:", HYPOTHESIS_FILE);
          send(res, 200, JSON.stringify({ ok: true }), "application/json");
        });
      });
    });
    return;
  }

  if (req.method !== "GET") {
    send(res, 405, "Method not allowed", "text/plain");
    return;
  }

  // Serve files from repo-root /data/ folder (e.g. /data/hypothesis_keywords.jsonl)
  if (urlPath.startsWith("/data/")) {
    const dataFile = urlPath.slice("/data/".length).replace(/\.\./g, "");
    const dataFilePath = path.resolve(DATA_DIR, dataFile);
    if (!dataFilePath.startsWith(DATA_DIR)) {
      send(res, 403, "Forbidden", "text/plain");
      return;
    }
    const ext = path.extname(dataFilePath);
    const contentType = MIME[ext] || MIME[".jsonl"] || "application/x-ndjson; charset=utf-8";
    fs.readFile(dataFilePath, (err, data) => {
      if (err) {
        if (err.code === "ENOENT") send(res, 404, "Not found", "text/plain");
        else send(res, 500, "Server error", "text/plain");
        return;
      }
      send(res, 200, data, contentType);
    });
    return;
  }

  const pathToServe = urlPath === "/" ? "/index.html" : urlPath;
  const safePath = pathToServe.replace(/^\/+/, "").replace(/\.\./g, "");
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
    send(res, 200, data, contentType);
  });
});

server.listen(PORT, () => {
  console.log("Circleboarding server at http://localhost:" + PORT);
  console.log("Circleboard data file: " + CIRCLEBOARD_DATA_FILE);
  console.log("Hypothesis file (absolute): " + HYPOTHESIS_FILE);
  console.log("  -> Use the app at http://localhost:" + PORT + " and click 'Save for Hypothesis Generation' to create the file.");
});
