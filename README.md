# Roverb

A personal AI memory you write to from Claude / Codex and recall anywhere — over MCP.

You're working in an AI tool, you hit something worth keeping, you say **"remember this in Roverb."** Weeks later, in any tool, you say **"pull what I saved about X"** and it comes back. One shared store behind all your assistants. No more scrolling old sessions.

- **Local-first** — one SQLite file at `~/.roverb/roverb.db`. No cloud, no API keys, no telemetry.
- **MCP-native** — works with any Model Context Protocol client (Claude Code, Claude Desktop, Codex, Cursor, …).
- **7 tools** — `roverb_save`, `roverb_recall`, `roverb_get`, `roverb_list`, `roverb_update`, `roverb_forget`, `roverb_restore`.
- **Smart full-text search** — SQLite FTS5 with BM25 ranking, prefix matching (so "rate" finds "rate-limiting"), a recency nudge, and highlighted snippets that show *why* each result matched. (Semantic/vector recall is a later add-on.)
- **Safe by default** — `forget` moves a memory to the trash (recoverable); nothing is permanently deleted unless you `purge`.
- **Backup & portable** — `roverb export` dumps everything to JSON, `roverb import` loads it back (idempotent, so re-imports won't duplicate).

---

## What you actually run

Roverb has **two pieces**, both on the same local database:

| Piece | What it's for | How it runs |
|---|---|---|
| **MCP server** | the agent side — Claude/Codex call it to save & recall | started **automatically** by your AI tool after `roverb init` (you don't launch it by hand) |
| **Dashboard** | the browser UI — see, search, save, forget | you run it yourself: **`roverb ui`** → http://localhost:4319 |

So after setup there's really one command to remember: **`roverb ui`** to open the dashboard. The MCP server takes care of itself.

---

## Quick start (the easy way)

Requires **Node 18+** — nothing to install or clone:

```bash
# 1. point your AI tools at Roverb (auto-configures Codex, Claude, Cursor)
npx -y roverb init

# 2. open the dashboard in your browser (optional, but nice)
npx -y roverb ui      # → http://localhost:4319
```

Then **restart your AI tool** and say *"remember this in Roverb."* That's it — `init` already configured the MCP server, and your tool launches it on demand.

`roverb init` writes the MCP config for whatever it finds installed:
- **Codex** → `~/.codex/config.toml`
- **Claude Code** → via `claude mcp add -s user` (user scope → available in every project, not just the folder you ran it in)
- **Claude Desktop** → `claude_desktop_config.json`
- **Cursor** → `~/.cursor/mcp.json`

All of them are registered as `npx -y roverb@latest mcp`. Your tool launches the server via `npx` on every start, which contacts the npm registry — so `@latest` simply guarantees you get the newest published version each launch, and updates land automatically with no re-config.

> **Offline or locked-down networks:** `npx` contacts the npm registry when the server starts. If you're offline or behind a proxy that blocks npm, the `roverb_*` tools won't load for that session — your AI tool still runs normally, it just won't see Roverb until the next online start. For an offline-resilient setup, install globally instead — `npm i -g roverb` — and register `command: "roverb", args: ["mcp"]`; updates are then manual via `npm update -g roverb`.

Each person who runs `roverb init` gets their **own** local store at `~/.roverb/roverb.db` — memories stay on your machine and aren't shared between people.

### Prefer not to use the npm release?

Run it straight from GitHub instead — still no clone or build:

```bash
npx -y github:hakobyan-arsen/roverb init
npx -y github:hakobyan-arsen/roverb ui
```

---

## See it in a browser (local dashboard)

```bash
npx -y roverb ui       # → http://localhost:4319
```

Five screens: **Ask** (search/recall), **Library** (browse + filter + forget), **Capture** (save), **Trash** (restore or permanently delete forgotten memories), and **Connection** (stats, backup export/import, MCP config). Small REST API in `src/server.js`, no extra deps. Override the port with `ROVERB_PORT`. The dashboard and the MCP server share the one database, so run both at once.

---

## Manual config (if you skip `init`)

The command to register is `npx -y roverb@latest mcp`.

**Codex** — `~/.codex/config.toml`:
```toml
[mcp_servers.roverb]
command = "npx"
args = ["-y", "roverb@latest", "mcp"]
enabled = true
startup_timeout_sec = 120
```

**Claude Code (CLI)** — user scope, so it's available in every project:
```bash
claude mcp add -s user roverb -- npx -y roverb@latest mcp
```

**Claude Desktop / Cursor** — `mcpServers` block:
```json
{ "mcpServers": { "roverb": { "command": "npx", "args": ["-y", "roverb@latest", "mcp"] } } }
```

Restart the tool; you should see 5 `roverb_*` tools.

---

## Use it

Just talk to your assistant — it calls the tools for you:

- *"Remember this decision in Roverb, tag it api and infra."* → `roverb_save`
- *"What did I save about rate limiting?"* → `roverb_recall`
- *"List everything from the Billing project."* → `roverb_list`
- *"Forget that staging note."* → `roverb_recall` to find it, then `roverb_forget` (it goes to the trash)
- *"Actually, bring that note back."* → `roverb_restore`

### Make it proactive (optional)

Drop this in your project's `CLAUDE.md` / `AGENTS.md` so the agent reaches for Roverb without being told:

```
You have a `roverb_*` memory tool set (an MCP server called "roverb").
- Before answering questions about past decisions, preferences, or project
  history, call roverb_recall first.
- When the user makes a decision, states a preference, or produces something
  reusable, offer to roverb_save it.
```

---

## A memory record

```jsonc
{
  "id": 12,
  "type": "decision",          // decision | code | note | link | fact | writing | image
  "title": "Postgres over Mongo for billing",
  "body": "Billing needs ACID guarantees ...",
  "source": "claude",          // which tool it came from
  "project": "Billing",
  "tags": ["db", "billing"],
  "created_at": "2026-06-22T10:00:00.000Z",
  "updated_at": "2026-06-22T10:00:00.000Z",
  "archived_at": null,         // set when forgotten (in the trash); null = active
  "last_accessed": null,       // last time fetched via roverb_get
  "access_count": 0            // how many times it's been fetched
}
```

Storage path override: set `ROVERB_STORE=/some/path/roverb.db`.

### Back up & restore

```bash
roverb export --out roverb-backup.json   # dump everything (including trash) to JSON
roverb import roverb-backup.json          # load it back — safe to re-run, duplicates are skipped
```

---

## License

MIT.
