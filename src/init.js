// init.js — auto-configure AI tools to use Roverb over MCP.
// Run:  roverb init        (registers `npx -y roverb mcp` — the shareable form)
//       roverb init --local (registers this checkout's absolute path, for dev)

import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const local = process.argv.includes("--local");
const entry = fileURLToPath(new URL("./index.js", import.meta.url));
const COMMAND = local ? "node" : "npx";
const ARGS = local ? [entry] : ["-y", "roverb", "mcp"];
const argsToml = ARGS.map((a) => `"${a}"`).join(", ");

const home = homedir();
const done = [];
const skip = [];

function ensureDir(p) { mkdirSync(dirname(p), { recursive: true }); }

// ---- Codex (~/.codex/config.toml) ----
function codex() {
  const f = process.env.CODEX_HOME
    ? join(process.env.CODEX_HOME, "config.toml")
    : join(home, ".codex", "config.toml");
  let txt = existsSync(f) ? readFileSync(f, "utf8") : "";
  if (/\[mcp_servers\.roverb\]/.test(txt)) return skip.push("Codex (already configured)");
  const block = `\n[mcp_servers.roverb]\ncommand = "${COMMAND}"\nargs = [${argsToml}]\nenabled = true\n`;
  ensureDir(f);
  writeFileSync(f, txt + block);
  done.push(`Codex → ${f}`);
}

// ---- a JSON-config client (Claude Desktop, Cursor) ----
function jsonClient(name, file) {
  if (!existsSync(file) && !existsSync(dirname(file))) return skip.push(`${name} (not installed)`);
  let cfg = {};
  if (existsSync(file)) { try { cfg = JSON.parse(readFileSync(file, "utf8")); } catch { cfg = {}; } }
  cfg.mcpServers = cfg.mcpServers || {};
  if (cfg.mcpServers.roverb) return skip.push(`${name} (already configured)`);
  cfg.mcpServers.roverb = { command: COMMAND, args: ARGS };
  ensureDir(file);
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  done.push(`${name} → ${file}`);
}

// ---- Claude Code (CLI) ----
function claudeCode() {
  try {
    execSync("claude --version", { stdio: "ignore" });
  } catch { return skip.push("Claude Code (CLI not found)"); }
  try {
    execSync("claude mcp list", { stdio: "ignore" });
    const probe = execSync("claude mcp list", { encoding: "utf8" });
    if (/roverb/.test(probe)) return skip.push("Claude Code (already configured)");
    execSync(`claude mcp add roverb -- ${COMMAND} ${ARGS.join(" ")}`, { stdio: "ignore" });
    done.push("Claude Code (via `claude mcp add`)");
  } catch (e) {
    skip.push("Claude Code (couldn't auto-add — see README)");
  }
}

const plat = platform();
const claudeDesktop =
  plat === "darwin"
    ? join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
    : plat === "win32"
    ? join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
    : join(home, ".config", "Claude", "claude_desktop_config.json");
const cursor = join(home, ".cursor", "mcp.json");

console.log(`\n  Roverb init — registering: ${COMMAND} ${ARGS.join(" ")}\n`);
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
                   Restart Claude / Codex, then say "remember this in Roverb".

  2) Dashboard   — see & manage everything in your browser. Run:

                       ${local ? "node bin/roverb.js ui" : "npx -y roverb ui"}

                   then open  http://localhost:4319
  ─────────────────────────────────────────────
`);
