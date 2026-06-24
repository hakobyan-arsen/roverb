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
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    type          TEXT NOT NULL DEFAULT 'note',   -- decision | code | note | link | fact | writing | image
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'unknown',-- claude | codex | chatgpt | cursor | manual ...
    project       TEXT,
    tags          TEXT NOT NULL DEFAULT '',       -- comma-separated
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    archived_at   TEXT,                            -- set when "forgotten" (soft delete / trash)
    last_accessed TEXT,                            -- last time fetched via get
    access_count  INTEGER NOT NULL DEFAULT 0
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

// --- migrations: add columns introduced after the first release -------------
// Existing stores (created before these columns) get them backfilled on open.
{
  const have = new Set(
    db.prepare("PRAGMA table_info(memories)").all().map((c) => c.name)
  );
  const add = (name, ddl) => {
    if (!have.has(name)) db.exec(`ALTER TABLE memories ADD COLUMN ${ddl}`);
  };
  add("archived_at", "archived_at TEXT");
  add("last_accessed", "last_accessed TEXT");
  add("access_count", "access_count INTEGER NOT NULL DEFAULT 0");
}

// Recency nudge for recall: a bounded bonus that gently favors newer memories
// without burying older strong matches. bm25() is "lower = better", so we
// subtract the bonus. A memory `halflife` days old gets half the max bonus.
const RECENCY_BOOST = 1.5;
const RECENCY_HALFLIFE_DAYS = 30;

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

// Build a safe FTS5 MATCH expression: prefix-match each term (so "rate" finds
// "rate-limiting"), OR them for breadth, and add the full phrase to reward
// exact multi-word hits in ranking. Quoting keeps user input from being parsed
// as FTS operators.
function ftsQuery(q) {
  const terms = String(q || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  if (!terms || !terms.length) return null;
  const parts = terms.map((t) => `"${t}"*`);
  if (terms.length > 1) parts.unshift(`"${terms.join(" ")}"`);
  return parts.join(" OR ");
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

// Record that a memory was actually used (fetched). Powers "most used" and
// future usage-aware ranking. Kept separate from get() so internal lookups
// don't inflate the count.
export function touch(id) {
  db.prepare(
    "UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?"
  ).run(now(), id);
  return get(id);
}

export function recall({
  query,
  limit = 8,
  type,
  source,
  project,
  includeArchived = false,
}) {
  const match = ftsQuery(query);
  const lim = Math.min(Math.max(parseInt(limit) || 8, 1), 50);
  let rows;

  if (match) {
    const filters = [];
    const params = { match, lim, boost: RECENCY_BOOST, hl: RECENCY_HALFLIFE_DAYS };
    if (!includeArchived) filters.push("m.archived_at IS NULL");
    if (type) { filters.push("m.type = @type"); params.type = type; }
    if (source) { filters.push("m.source = @source"); params.source = source; }
    if (project) { filters.push("m.project = @project"); params.project = project; }
    const where = filters.length ? " AND " + filters.join(" AND ") : "";
    rows = db
      .prepare(
        `SELECT m.*,
                bm25(memories_fts) AS score,
                snippet(memories_fts, 1, '[', ']', '…', 12) AS snippet
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.rowid
         WHERE memories_fts MATCH @match${where}
         ORDER BY bm25(memories_fts)
                  - (@boost / (1.0 + (julianday('now') - julianday(m.created_at)) / @hl))
         LIMIT @lim`
      )
      .all(params);
  } else {
    // empty/unsearchable query → most recent
    const where = includeArchived ? "" : " WHERE archived_at IS NULL";
    rows = db
      .prepare(`SELECT * FROM memories${where} ORDER BY created_at DESC LIMIT ?`)
      .all(lim);
  }
  return rows.map(shape);
}

export function list({ type, source, project, tag, limit = 50, archived = false } = {}) {
  const filters = [archived ? "archived_at IS NOT NULL" : "archived_at IS NULL"];
  const params = {};
  if (type) { filters.push("type = @type"); params.type = type; }
  if (source) { filters.push("source = @source"); params.source = source; }
  if (project) { filters.push("project = @project"); params.project = project; }
  if (tag) { filters.push("(',' || tags || ',') LIKE @tag"); params.tag = `%,${String(tag).replace(/^#/, "")},%`; }
  params.lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
  const where = " WHERE " + filters.join(" AND ");
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

// "Forget" is now a soft delete: the memory moves to the trash and can be
// restored. Use purge() for a permanent, unrecoverable delete.
export function forget(id) {
  const row = get(id);
  if (!row) return null;
  if (row.archived_at) return row; // already in the trash
  const t = now();
  db.prepare("UPDATE memories SET archived_at = @t, updated_at = @t WHERE id = @id")
    .run({ t, id });
  return get(id);
}

export function restore(id) {
  const row = get(id);
  if (!row) return null;
  db.prepare("UPDATE memories SET archived_at = NULL, updated_at = ? WHERE id = ?")
    .run(now(), id);
  return get(id);
}

// Permanent delete — bypasses the trash. There is no undo.
export function purge(id) {
  const row = get(id);
  if (!row) return null;
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  return row;
}

export function stats() {
  const total = db.prepare("SELECT COUNT(*) AS n FROM memories WHERE archived_at IS NULL").get().n;
  const archived = db.prepare("SELECT COUNT(*) AS n FROM memories WHERE archived_at IS NOT NULL").get().n;
  const byType = db
    .prepare("SELECT type, COUNT(*) AS n FROM memories WHERE archived_at IS NULL GROUP BY type ORDER BY n DESC")
    .all();
  return { total, archived, byType, store: STORE };
}

// --- backup / portability ---------------------------------------------------

export function exportAll({ includeArchived = true } = {}) {
  const where = includeArchived ? "" : " WHERE archived_at IS NULL";
  return db.prepare(`SELECT * FROM memories${where} ORDER BY id`).all().map(shape);
}

// Import records produced by exportAll(). New rows get fresh ids (we never
// clobber existing memories). dedupe skips rows whose title+body+created_at
// already exist, so re-importing the same backup is safe/idempotent.
export function importMemories(items = [], { dedupe = true } = {}) {
  const insert = db.prepare(
    `INSERT INTO memories (type, title, body, source, project, tags, created_at, updated_at, archived_at, last_accessed, access_count)
     VALUES (@type, @title, @body, @source, @project, @tags, @created_at, @updated_at, @archived_at, @last_accessed, @access_count)`
  );
  const exists = db.prepare(
    "SELECT 1 FROM memories WHERE title = ? AND body = ? AND created_at = ? LIMIT 1"
  );
  let imported = 0, skipped = 0;
  const run = db.transaction((rows) => {
    for (const r of rows) {
      if (!r || !r.body || !String(r.body).trim()) { skipped++; continue; }
      const t = now();
      const title =
        (r.title && String(r.title).trim()) ||
        String(r.body).trim().split("\n")[0].slice(0, 80);
      const created_at = r.created_at || t;
      if (dedupe && exists.get(title, String(r.body), created_at)) { skipped++; continue; }
      insert.run({
        type: r.type || "note",
        title,
        body: String(r.body),
        source: r.source || "import",
        project: r.project || null,
        tags: normTags(r.tags),
        created_at,
        updated_at: r.updated_at || t,
        archived_at: r.archived_at || null,
        last_accessed: r.last_accessed || null,
        access_count: Number(r.access_count) || 0,
      });
      imported++;
    }
  });
  run(items);
  return { imported, skipped };
}

export const storePath = STORE;
