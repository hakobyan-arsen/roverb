// seed.js — optional: load a few sample memories so you can test recall immediately.
// Run:  npm run seed
import * as store from "./db.js";

const samples = [
  { type: "decision", title: "Rate limiting: token bucket over sliding window", body: "Public API uses a token-bucket limiter: 100 req/min per key, bursts to 150, via Redis INCR + TTL. Internal service tokens are exempt. 429s return a Retry-After header.", source: "claude", tags: ["api", "infra"], project: "Public API" },
  { type: "code", title: "Redis rate-limit middleware", body: "Express middleware: INCR a per-key counter in Redis, set 60s TTL on first hit, return 429 with Retry-After once over the limit.", source: "codex", tags: ["api"], project: "Public API" },
  { type: "decision", title: "Postgres over Mongo for billing", body: "Billing needs ACID guarantees for invoices and refunds, so Postgres over Mongo. Stripe webhooks verified against signing secret before any write.", source: "claude", tags: ["db", "billing"], project: "Billing" },
  { type: "fact", title: "Coding preferences", body: "TypeScript strict mode, never use any. Prefer explicit types or generics, small pure functions, early returns.", source: "claude", tags: ["prefs"] },
];

for (const s of samples) {
  const m = store.save(s);
  console.log(`saved #${m.id}  ${m.title}`);
}
console.log("\nstats:", store.stats());
console.log("\nTry: recall 'how did we rate limit the api'");
console.log(JSON.stringify(store.recall({ query: "how did we rate limit the api" }), null, 2));
