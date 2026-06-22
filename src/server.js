#!/usr/bin/env node
// server.js — local web UI + REST API for Roverb, backed by the same SQLite store
// the MCP server uses. Run:  npm run ui   (then open the printed URL)
//
// No extra dependencies — Node's built-in http only.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname, normalize, extname } from "node:path";
import * as store from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");
const PORT = process.env.ROVERB_PORT || 4319;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const send = (res, code, data, type = "application/json") => {
  const body = type.startsWith("application/json") ? JSON.stringify(data) : data;
  res.writeHead(code, { "content-type": type });
  res.end(body);
};

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try { resolve(b ? JSON.parse(b) : {}); }
      catch { resolve({}); }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const q = Object.fromEntries(url.searchParams);

  try {
    // ---- API ----
    if (path === "/api/stats" && req.method === "GET")
      return send(res, 200, store.stats());

    if (path === "/api/recall" && req.method === "GET")
      return send(res, 200, {
        memories: store.recall({ query: q.q || "", limit: q.limit, type: q.type, source: q.source, project: q.project }),
      });

    if (path === "/api/memories" && req.method === "GET")
      return send(res, 200, {
        memories: store.list({ type: q.type, source: q.source, project: q.project, tag: q.tag, limit: q.limit }),
      });

    if (path === "/api/memories" && req.method === "POST") {
      const body = await readBody(req);
      return send(res, 200, { saved: store.save({ ...body, source: body.source || "dashboard" }) });
    }

    const idMatch = path.match(/^\/api\/memories\/(\d+)$/);
    if (idMatch) {
      const id = Number(idMatch[1]);
      if (req.method === "DELETE") {
        const m = store.forget(id);
        return m ? send(res, 200, { forgotten: m }) : send(res, 404, { error: "not found" });
      }
      if (req.method === "PATCH") {
        const body = await readBody(req);
        const m = store.update(id, body);
        return m ? send(res, 200, { updated: m }) : send(res, 404, { error: "not found" });
      }
    }

    if (path.startsWith("/api/")) return send(res, 404, { error: "no such route" });

    // ---- static (the UI) ----
    let rel = path === "/" ? "/index.html" : path;
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return send(res, 403, "forbidden", "text/plain");
    const data = await readFile(file);
    return send(res, 200, data, MIME[extname(file)] || "application/octet-stream");
  } catch (e) {
    if (e.code === "ENOENT") return send(res, 404, "not found", "text/plain");
    return send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.error(`\n  Roverb dashboard → http://localhost:${PORT}`);
  console.error(`  store: ${store.storePath}\n`);
});
