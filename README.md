# Roverb

A personal AI memory you write to from Claude / Codex and recall anywhere — over MCP.

You're working in an AI tool, you hit something worth keeping, you say **"remember this in Roverb."** Weeks later, in any tool, you say **"pull what I saved about X"** and it comes back. One shared store behind all your assistants. No more scrolling old sessions.

- **Local-first** — one SQLite file at `~/.roverb/roverb.db`. No cloud, no API keys, no telemetry.
- **MCP-native** — works with any Model Context Protocol client (Claude Code, Claude Desktop, Codex, Cursor, …).
- **5 tools** — `roverb_save`, `roverb_recall`, `roverb_list`, `roverb_update`, `roverb_forget`.
- **Full-text search** — SQLite FTS5 with BM25 ranking. (Semantic/vector recall is a later add-on; FTS gets you most of the way.)

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

Requires **Node 18+**. Nothing to clone once it's published to npm:

```bash
# 1. point your AI tools at Roverb (auto-configures Codex, Claude, Cursor)
npx -y roverb init

# 2. open the dashboard in your browser (optional, but nice)
npx -y roverb ui      # → http://localhost:4319
```

Then **restart your AI tool** and say *"remember this in Roverb."* That's it — `init` already configured the MCP server, and your tool launches it on demand.

`roverb init` writes the MCP config for whatever it finds installed:
- **Codex** → `~/.codex/config.toml`
- **Claude Code** → via `claude mcp add`
- **Claude Desktop** → `claude_desktop_config.json`
- **Cursor** → `~/.cursor/mcp.json`

All of them get registered as `npx -y roverb mcp`, so there's no path to manage and updates are automatic.

### Run straight from source (no npm)

Want the latest `main`, or prefer not to use the npm release? Run it directly from GitHub — still no clone or build:

```bash
npx -y github:hakobyan-arsen/roverb init
npx -y github:hakobyan-arsen/roverb ui
```

---

## Run from a local checkout (dev)

```bash
cd roverb-server
npm install            # better-sqlite3 builds a native module — expected
npm run seed           # optional: load sample memories
node bin/roverb.js init --local   # registers THIS checkout's path instead of npx
```

Commands from a checkout: `node bin/roverb.js mcp | ui | init | seed | <inspect>`.

---

## See it in a browser (local dashboard)

```bash
npx -y roverb ui       # or, from a checkout: npm run ui
# Roverb dashboard → http://localhost:4319
```

Four screens: **Ask** (search/recall), **Library** (browse + filter + forget), **Capture** (save), **Connection** (stats + MCP config). Small REST API in `src/server.js`, no extra deps. Override the port with `ROVERB_PORT`. The dashboard and the MCP server share the one database, so run both at once.

---

## Manual config (if you skip `init`)

The command to register is `npx -y roverb mcp` (or, from a checkout, `node /ABSOLUTE/PATH/roverb-server/bin/roverb.js mcp`).

**Codex** — `~/.codex/config.toml`:
```toml
[mcp_servers.roverb]
command = "npx"
args = ["-y", "roverb", "mcp"]
enabled = true
```

**Claude Desktop / Cursor** — `mcpServers` block:
```json
{ "mcpServers": { "roverb": { "command": "npx", "args": ["-y", "roverb", "mcp"] } } }
```

Restart the tool; you should see 5 `roverb_*` tools.

---

## Use it

Just talk to your assistant — it calls the tools for you:

- *"Remember this decision in Roverb, tag it api and infra."* → `roverb_save`
- *"What did I save about rate limiting?"* → `roverb_recall`
- *"List everything from the Billing project."* → `roverb_list`
- *"Forget that staging note."* → `roverb_recall` to find it, then `roverb_forget`

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
  "updated_at": "2026-06-22T10:00:00.000Z"
}
```

Storage path override: set `ROVERB_STORE=/some/path/roverb.db`.

---

## Roadmap (in the prototype, not yet here)

1. **Semantic recall** — add embeddings (e.g. local model) alongside FTS5; fuse with reciprocal-rank fusion.
2. **Web dashboard** — the `Roverb.dc.html` design, pointed at this store via a small local HTTP API.
3. **Cloud sync + OAuth** — so the Claude/ChatGPT *apps* (not just CLIs) can connect remotely.
4. **Auto-summarize on save** — have the calling model write a tight summary into `body`.

MIT.
