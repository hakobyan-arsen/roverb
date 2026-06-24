#!/usr/bin/env node
// cli.js — inspect / edit your Roverb store directly from the terminal.
// Usage:
//   node src/cli.js stats
//   node src/cli.js list [--type decision] [--project "Billing"] [--tag api] [--limit 20]
//   node src/cli.js recall "how did we rate limit the api" [--limit 5]
//   node src/cli.js get 12
//   node src/cli.js save "Body text to remember" [--title "..."] [--type note] [--tags api,infra] [--project X]
//   node src/cli.js forget 12             move #12 to the trash (recoverable)
//   node src/cli.js restore 12            bring #12 back from the trash
//   node src/cli.js purge 12              permanently delete #12 (no undo)
//   node src/cli.js trash                 list trashed memories
//   node src/cli.js export [--out file]   dump all memories to JSON (stdout or file)
//   node src/cli.js import <file>         load memories from a JSON export

import { readFileSync, writeFileSync } from "node:fs";
import * as store from "./db.js";

const argv = process.argv.slice(2);
const cmd = argv[0];

// pull --flags out, leave positionals
const flags = {};
const pos = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) flags[a.slice(2)] = argv[++i];
  else pos.push(a);
}

const pretty = (x) => console.log(JSON.stringify(x, null, 2));

function line(m) {
  const tags = m.tags.length ? "  #" + m.tags.join(" #") : "";
  console.log(
    `#${String(m.id).padEnd(4)} [${m.type}] ${m.title}\n      ${m.source}` +
      `${m.project ? " · " + m.project : ""} · ${m.created_at.slice(0, 10)}${tags}`
  );
}

switch (cmd) {
  case "stats":
    pretty(store.stats());
    break;

  case "list": {
    const rows = store.list({
      type: flags.type,
      source: flags.source,
      project: flags.project,
      tag: flags.tag,
      limit: flags.limit,
    });
    if (!rows.length) console.log("(no memories)");
    rows.forEach(line);
    console.log(`\n${rows.length} shown`);
    break;
  }

  case "recall": {
    const rows = store.recall({ query: pos.join(" "), limit: flags.limit });
    if (!rows.length) console.log("(no matches)");
    rows.forEach((m) => {
      line(m);
      if (m.snippet) console.log(`      ↪ ${m.snippet.replace(/\s+/g, " ").trim()}`);
    });
    console.log(`\n${rows.length} match(es) for "${pos.join(" ")}"`);
    break;
  }

  case "get": {
    const id = Number(pos[0]);
    const m = store.get(id) ? store.touch(id) : null;
    pretty(m || "(not found)");
    break;
  }

  case "save": {
    const m = store.save({
      body: pos.join(" "),
      title: flags.title,
      type: flags.type,
      project: flags.project,
      source: flags.source || "cli",
      tags: flags.tags ? flags.tags.split(",") : [],
    });
    console.log("saved:");
    line(m);
    break;
  }

  case "forget": {
    const m = store.forget(Number(pos[0]));
    console.log(m ? `moved #${pos[0]} to trash (restore with: roverb restore ${pos[0]})` : "(not found)");
    break;
  }

  case "restore": {
    const m = store.restore(Number(pos[0]));
    console.log(m ? `restored #${pos[0]}` : "(not found)");
    break;
  }

  case "purge": {
    const m = store.purge(Number(pos[0]));
    console.log(m ? `permanently deleted #${pos[0]}` : "(not found)");
    break;
  }

  case "trash": {
    const rows = store.list({ archived: true, limit: flags.limit });
    if (!rows.length) console.log("(trash is empty)");
    rows.forEach(line);
    console.log(`\n${rows.length} in trash`);
    break;
  }

  case "export": {
    const data = {
      roverb: "export",
      version: 1,
      exported_at: new Date().toISOString(),
      memories: store.exportAll(),
    };
    data.count = data.memories.length;
    const json = JSON.stringify(data, null, 2);
    if (flags.out) {
      writeFileSync(flags.out, json);
      console.error(`exported ${data.count} memories → ${flags.out}`);
    } else {
      console.log(json);
    }
    break;
  }

  case "import": {
    const file = pos[0];
    if (!file) { console.error("usage: roverb import <file.json>"); break; }
    let parsed;
    try { parsed = JSON.parse(readFileSync(file, "utf8")); }
    catch (e) { console.error(`could not read JSON from ${file}: ${e.message}`); break; }
    const items = Array.isArray(parsed) ? parsed : parsed.memories || [];
    const { imported, skipped } = store.importMemories(items);
    console.error(`imported ${imported}, skipped ${skipped} (duplicates/empty)`);
    break;
  }

  default:
    console.log(
      "commands: stats | list | recall <query> | get <id> | save <body>\n" +
        "          forget <id> | restore <id> | purge <id> | trash\n" +
        "          export [--out file] | import <file>\n" +
        "store: " + store.storePath
    );
}
