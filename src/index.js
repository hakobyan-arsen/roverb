#!/usr/bin/env node
// index.js — Roverb MCP server (stdio).
// Exposes 5 tools any MCP client (Claude, Codex, Cursor, ...) can call:
//   roverb_save, roverb_recall, roverb_list, roverb_update, roverb_forget
//
// Run:  node src/index.js     (or `roverb` once installed/linked)
// Storage: ~/.roverb/roverb.db  (override with ROVERB_STORE)

import { readFileSync } from "node:fs";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import * as store from "./db.js";

const TYPES = ["decision", "code", "note", "link", "fact", "writing", "image"];

// keep serverInfo.version in sync with package.json (no manual edits on release)
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

const server = new Server(
  { name: "roverb", version },
  { capabilities: { tools: {} } }
);

const tools = [
  {
    name: "roverb_save",
    description:
      "Save something worth remembering to Roverb. Use when the user says 'remember this', 'save this to Roverb', or after a result they'll want later. Stores the content (or a summary you write) so any AI can recall it across sessions and tools.",
    inputSchema: {
      type: "object",
      properties: {
        body: { type: "string", description: "The content to remember (the answer, decision, snippet, fact). Required." },
        title: { type: "string", description: "Short title. If omitted, derived from the first line of body." },
        type: { type: "string", enum: TYPES, description: "What kind of memory this is. Default 'note'." },
        tags: { type: "array", items: { type: "string" }, description: "Topic tags, e.g. ['api','infra']." },
        project: { type: "string", description: "Optional project this belongs to." },
        source: { type: "string", description: "Where it came from: claude, codex, chatgpt, cursor, manual." },
      },
      required: ["body"],
    },
  },
  {
    name: "roverb_recall",
    description:
      "Recall memories from Roverb by meaning/keywords. Use when the user asks what they saved/decided earlier, or 'pull what I saved about X'. Returns ranked matches with full content so you can answer from them and cite them.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in natural language or keywords." },
        limit: { type: "number", description: "Max results (1–50). Default 8." },
        type: { type: "string", enum: TYPES, description: "Restrict to one memory type." },
        source: { type: "string", description: "Restrict to one source tool." },
        project: { type: "string", description: "Restrict to one project." },
      },
      required: ["query"],
    },
  },
  {
    name: "roverb_get",
    description:
      "Fetch one memory by its id, with full content. Use after roverb_recall/roverb_list to pull the complete item you want to act on or cite. Records the access (powers usage stats).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The memory id to fetch." },
      },
      required: ["id"],
    },
  },
  {
    name: "roverb_list",
    description:
      "List/browse saved memories with optional filters (type, source, project, tag). Use to show what's stored or scan a project. Newest first. Set archived=true to browse the trash.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: TYPES },
        source: { type: "string" },
        project: { type: "string" },
        tag: { type: "string" },
        archived: { type: "boolean", description: "true → list trashed (forgotten) memories instead of active ones." },
        limit: { type: "number", description: "Max results (1–200). Default 50." },
      },
    },
  },
  {
    name: "roverb_update",
    description:
      "Update an existing memory by id (edit body/title/tags/type/project). Use when the user says a saved item changed or needs correcting.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The memory id to update." },
        body: { type: "string" },
        title: { type: "string" },
        type: { type: "string", enum: TYPES },
        tags: { type: "array", items: { type: "string" } },
        project: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "roverb_forget",
    description:
      "Move a memory to the trash by id (a soft delete — it stops showing up in recall/list but can be restored). Use when the user says 'forget that' or 'remove what I saved about X' (recall first to find the id).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The memory id to forget (move to trash)." },
      },
      required: ["id"],
    },
  },
  {
    name: "roverb_restore",
    description:
      "Restore a previously forgotten (trashed) memory by id, bringing it back into recall/list. Use roverb_list with archived=true to find the id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The memory id to restore from the trash." },
      },
      required: ["id"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

const ok = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});
const fail = (msg) => ({
  content: [{ type: "text", text: `Error: ${msg}` }],
  isError: true,
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a = {} } = req.params;
  try {
    switch (name) {
      case "roverb_save": {
        const m = store.save(a);
        return ok({ saved: m, message: `Stored memory #${m.id} (${m.type}).` });
      }
      case "roverb_recall": {
        const results = store.recall(a);
        return ok({
          query: a.query,
          count: results.length,
          memories: results,
        });
      }
      case "roverb_get": {
        if (!store.get(a.id)) return fail(`No memory with id ${a.id}.`);
        return ok({ memory: store.touch(a.id) });
      }
      case "roverb_list":
        return ok({ memories: store.list(a) });
      case "roverb_update": {
        const m = store.update(a.id, a);
        return m ? ok({ updated: m }) : fail(`No memory with id ${a.id}.`);
      }
      case "roverb_forget": {
        const m = store.forget(a.id);
        return m
          ? ok({ forgotten: m, message: `Moved memory #${a.id} to trash. Restore with roverb_restore.` })
          : fail(`No memory with id ${a.id}.`);
      }
      case "roverb_restore": {
        const m = store.restore(a.id);
        return m ? ok({ restored: m, message: `Restored memory #${a.id}.` }) : fail(`No memory with id ${a.id}.`);
      }
      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return fail(e.message);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// stdio servers must not write to stdout; logs go to stderr.
console.error(`[roverb] MCP server ready · store: ${store.storePath}`);
