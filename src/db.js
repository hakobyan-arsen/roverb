// db.js — Roverb storage layer: SQLite + FTS5 full-text search.
// One local file (~/.roverb/roverb.db by default). No cloud, no API keys.

import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

const STORE =
  process.env.ROVERB_STORE || join(homedir(), ".roverb", "roverb.db");
mkdirSync(dirname(STORE), { recursive: true });

const db = new Database(STORE);
db.pragma("journal_mode = WAL");

// --- schema -----------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL DEFAULT 'note',   -- decision | code | note | link | fact | writing | image
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'unknown',-- claude | codex | chatgpt | cursor | manual ...
    project    TEXT,
    tags       TEXT NOT NULL DEFAULT '',       -- comma-separated
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
    USING fts5(title, body, tags, content='memories', content_rowid='id');

  CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, title, body, tags)
    VALUES (new.id, new.title, new.body, new.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, title, body, tags)
    VALUES ('delete', old.id, old.title, old.body, old.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, title, body, tags)
    VALUES ('delete', old.id, old.title, old.body, old.tags);
    INSERT INTO memories_fts(rowid, title, body, tags)
    VALUES (new.id, new.title, new.body, new.tags);
  END;
`);

const now = () => new Date().toISOString();
const normTags = (tags) =>
  (Array.isArray(tags) ? tags : String(tags || "").split(","))
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean)
    .join(",");

const shape = (row) =>
  row && {
    ...row,
    tags: row.tags ? row.tags.split(",") : [],
  };

// Build a safe FTS5 MATCH expression: quote each term, OR them for breadth.
function ftsQuery(q) {
  const terms = String(q || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  if (!terms || !terms.length) return null;
  return terms.map((t) => `"${t}"`).join(" OR ");
}

// --- operations -------------------------------------------------------------

export function save({ type, title, body, source, project, tags }) {
  if (!body || !String(body).trim())
    throw new Error("`body` (the content to remember) is required.");
  const t = now();
  const finalTitle =
    (title && String(title).trim()) ||
    String(body).trim().split("\n")[0].slice(0, 80);
  const info = db
    .prepare(
      `INSERT INTO memories (type, title, body, source, project, tags, created_at, updated_at)
       VALUES (@type, @title, @body, @source, @project, @tags, @created_at, @updated_at)`
    )
    .run({
      type: type || "note",
      title: finalTitle,
      body: String(body),
      source: source || "unknown",
      project: project || null,
      tags: normTags(tags),
      created_at: t,
      updated_at: t,
    });
  return get(info.lastInsertRowid);
}

export function get(id) {
  return shape(db.prepare("SELECT * FROM memories WHERE id = ?").get(id));
}

export function recall({ query, limit = 8, type, source, project }) {
  const match = ftsQuery(query);
  const lim = Math.min(Math.max(parseInt(limit) || 8, 1), 50);
  let rows;

  if (match) {
    const filters = [];
    const params = { match, lim };
    if (type) { filters.push("m.type = @type"); params.type = type; }
    if (source) { filters.push("m.source = @source"); params.source = source; }
    if (project) { filters.push("m.project = @project"); params.project = project; }
    const where = filters.length ? " AND " + filters.join(" AND ") : "";
    rows = db
      .prepare(
        `SELECT m.*, bm25(memories_fts) AS score
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.rowid
         WHERE memories_fts MATCH @match${where}
         ORDER BY score
         LIMIT @lim`
      )
      .all(params);
  } else {
    // empty/unsearchable query → most recent
    rows = db
      .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ?")
      .all(lim);
  }
  return rows.map(shape);
}

export function list({ type, source, project, tag, limit = 50 } = {}) {
  const filters = [];
  const params = {};
  if (type) { filters.push("type = @type"); params.type = type; }
  if (source) { filters.push("source = @source"); params.source = source; }
  if (project) { filters.push("project = @project"); params.project = project; }
  if (tag) { filters.push("(',' || tags || ',') LIKE @tag"); params.tag = `%,${String(tag).replace(/^#/, "")},%`; }
  params.lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
  const where = filters.length ? " WHERE " + filters.join(" AND ") : "";
  return db
    .prepare(`SELECT * FROM memories${where} ORDER BY created_at DESC LIMIT @lim`)
    .all(params)
    .map(shape);
}

export function update(id, fields = {}) {
  const current = get(id);
  if (!current) return null;
  const next = {
    type: fields.type ?? current.type,
    title: fields.title ?? current.title,
    body: fields.body ?? current.body,
    source: fields.source ?? current.source,
    project: fields.project ?? current.project,
    tags: fields.tags !== undefined ? normTags(fields.tags) : current.tags.join(","),
    updated_at: now(),
    id,
  };
  db.prepare(
    `UPDATE memories SET type=@type, title=@title, body=@body, source=@source,
       project=@project, tags=@tags, updated_at=@updated_at WHERE id=@id`
  ).run(next);
  return get(id);
}

export function forget(id) {
  const row = get(id);
  if (!row) return null;
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  return row;
}

export function stats() {
  const total = db.prepare("SELECT COUNT(*) AS n FROM memories").get().n;
  const byType = db
    .prepare("SELECT type, COUNT(*) AS n FROM memories GROUP BY type ORDER BY n DESC")
    .all();
  return { total, byType, store: STORE };
}

export const storePath = STORE;
