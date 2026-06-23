// init.js — auto-configure AI tools to use Roverb over MCP.
//
//   roverb init             register `npx -y roverb mcp`  (after you `npm publish`)
//   roverb init --github    register `npx -y github:<owner>/<repo> mcp`  (no npm needed)
//   roverb init --local     register this checkout's absolute path (best for dev)
//   add --force             overwrite an existing roverb entry

import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const flags = process.argv.slice(2);
const local = flags.includes("--local");
const github = flags.includes("--github");
const force = flags.includes("--force");

// figure out "owner/repo" from package.json for --github
function repoSlug() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const m = String(pkg.repository?.url || "").match(/github\.com[:/]([^/]+\/[^/.]+)/i);
    return m ? m[1] : null;
  } catch { return null; }
}

const entry = fileURLToPath(new URL("./index.js", import.meta.url)); // starts the MCP server
let COMMAND, ARGS, NOTE = "";

if (local) {
  COMMAND = "node";
  ARGS = [entry];
} else if (github) {
  const slug = repoSlug();
  if (!slug) { console.error("Could not read repository from package.json — use --local instead."); process.exit(1); }
  COMMAND = "npx";
  ARGS = ["-y", `github:${slug}`, "mcp"];
  NOTE = "github mode: first launch clones the repo (can be slow) — timeout set to 120s.";
} else {
  COMMAND = "npx";
  // @latest so each launch pulls the newest published version (npx otherwise
  // reuses whatever it cached first, and never updates). Costs one quick
  // registry check per launch; needs network on start.
  ARGS = ["-y", "roverb@latest", "mcp"];
  NOTE = "npm mode: registers roverb@latest (auto-updates). Not published yet? re-run with --github.";
}

// Codex wants a generous startup timeout when the command fetches over the network.
const NEEDS_TIMEOUT = !local;
const argsToml = ARGS.map((a) => `"${a}"`).join(", ");

const home = homedir();
const done = [];
const skip = [];
const ensureDir = (p) => mkdirSync(dirname(p), { recursive: true });

// ---- Codex (~/.codex/config.toml) ----
function codex() {
  const f = process.env.CODEX_HOME
    ? join(process.env.CODEX_HOME, "config.toml")
    : join(home, ".codex", "config.toml");
  let txt = existsSync(f) ? readFileSync(f, "utf8") : "";
  const has = /\[mcp_servers\.roverb\]/.test(txt);
  if (has && !force) return skip.push(`Codex — already has [mcp_servers.roverb] → ${f}  (use --force to replace)`);
  if (has) {
    // strip the existing roverb block (from its header to the next [section] or EOF)
    txt = txt.replace(/\n*\[mcp_servers\.roverb\][\s\S]*?(?=\n\[|\s*$)/, "").replace(/\s*$/, "\n");
  }
  let block = `\n[mcp_servers.roverb]\ncommand = "${COMMAND}"\nargs = [${argsToml}]\nenabled = true\n`;
  if (NEEDS_TIMEOUT) block += `startup_timeout_sec = 120\n`;
  ensureDir(f);
  writeFileSync(f, txt + block);
  done.push(`Codex → ${f}`);
}

// ---- JSON clients (Claude Desktop, Cursor) ----
function jsonClient(name, file) {
  if (!existsSync(file) && !existsSync(dirname(file))) return skip.push(`${name} (not installed)`);
  let cfg = {};
  if (existsSync(file)) { try { cfg = JSON.parse(readFileSync(file, "utf8")); } catch { cfg = {}; } }
  cfg.mcpServers = cfg.mcpServers || {};
  if (cfg.mcpServers.roverb && !force) return skip.push(`${name} — already configured → ${file}  (use --force)`);
  cfg.mcpServers.roverb = { command: COMMAND, args: ARGS };
  ensureDir(file);
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  done.push(`${name} → ${file}`);
}

// ---- Claude Code (CLI) ----
function claudeCode() {
  try { execSync("claude --version", { stdio: "ignore" }); }
  catch { return skip.push("Claude Code (CLI not found)"); }
  try {
    const probe = execSync("claude mcp list", { encoding: "utf8" });
    if (/roverb/.test(probe)) {
      if (!force) return skip.push("Claude Code — already configured (use --force)");
      try { execSync("claude mcp remove roverb -s user", { stdio: "ignore" }); } catch {}
    }
    // -s user → available in every project/session, not just the cwd where init ran.
    execSync(`claude mcp add -s user roverb -- ${COMMAND} ${ARGS.join(" ")}`, { stdio: "ignore" });
    done.push("Claude Code (via `claude mcp add -s user`)");
  } catch { skip.push("Claude Code (couldn't auto-add — see README)"); }
}

const plat = platform();
const claudeDesktop =
  plat === "darwin"
    ? join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
    : plat === "win32"
    ? join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
    : join(home, ".config", "Claude", "claude_desktop_config.json");
const cursor = join(home, ".cursor", "mcp.json");

console.log(`\n  Roverb init — registering:  ${COMMAND} ${ARGS.join(" ")}`);
if (NOTE) console.log(`  ${NOTE}\n`); else console.log("");
codex();
claudeCode();
jsonClient("Claude Desktop", claudeDesktop);
jsonClient("Cursor", cursor);

if (done.length) { console.log("  configured:"); done.forEach((d) => console.log("   ✓ " + d)); }
if (skip.length) { console.log("\n  skipped:"); skip.forEach((s) => console.log("   – " + s)); }
console.log(`
  ─────────────────────────────────────────────
  Done. Two parts to Roverb:

  1) MCP server  — your AI tools start this automatically now.
                   Fully quit & reopen Claude / Codex, then say "remember this in Roverb".

  2) Dashboard   — see & manage everything in your browser. Run:

                       ${local ? "node bin/roverb.js ui" : github ? `npx -y github:${repoSlug()} ui` : "npx -y roverb ui"}

                   then open  http://localhost:4319
  ─────────────────────────────────────────────
`);
