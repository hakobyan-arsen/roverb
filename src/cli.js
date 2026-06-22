#!/usr/bin/env node
// cli.js — inspect / edit your Roverb store directly from the terminal.
// Usage:
//   node src/cli.js stats
//   node src/cli.js list [--type decision] [--project "Billing"] [--tag api] [--limit 20]
//   node src/cli.js recall "how did we rate limit the api" [--limit 5]
//   node src/cli.js get 12
//   node src/cli.js save "Body text to remember" [--title "..."] [--type note] [--tags api,infra] [--project X]
//   node src/cli.js forget 12

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
    rows.forEach(line);
    console.log(`\n${rows.length} match(es) for "${pos.join(" ")}"`);
    break;
  }

  case "get":
    pretty(store.get(Number(pos[0])) || "(not found)");
    break;

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
    console.log(m ? `forgot #${pos[0]}` : "(not found)");
    break;
  }

  default:
    console.log(
      "commands: stats | list | recall <query> | get <id> | save <body> | forget <id>\n" +
        "store: " + store.storePath
    );
}
