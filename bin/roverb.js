#!/usr/bin/env node
// roverb — single entry point. Subcommands:
//   roverb mcp     start the MCP server (what Claude/Codex talk to, stdio)
//   roverb ui      start the local web dashboard
//   roverb init    auto-configure your AI tools to use Roverb
//   roverb seed    load a few sample memories
//   roverb <cli>   inspect the store: stats | list | recall <q> | get <id> | save <body> | forget <id>

const cmd = process.argv[2];

const HELP = `
  roverb — a personal AI memory, shared across your AI tools (MCP)

  roverb init            configure Claude / Codex / Cursor to use Roverb
  roverb mcp             run the MCP server (agents connect to this)
  roverb ui              open the local dashboard (http://localhost:4319)
  roverb seed            load sample memories
  roverb stats           show what's stored
  roverb list            browse memories
  roverb recall "<q>"    search memories
  roverb save "<text>"   save a memory
  roverb forget <id>     delete a memory

  store: ~/.roverb/roverb.db   (override: ROVERB_STORE)
`;

const run = (p) => import(new URL(p, import.meta.url).href);

switch (cmd) {
  case "mcp":
    run("../src/index.js");
    break;
  case "ui":
    run("../src/server.js");
    break;
  case "init":
    run("../src/init.js");
    break;
  case "seed":
    run("../src/seed.js");
    break;
  case undefined:
  case "help":
  case "-h":
  case "--help":
    console.log(HELP);
    break;
  default:
    // stats | list | recall | get | save | forget  → handled by the CLI
    run("../src/cli.js");
}
