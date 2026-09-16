#!/usr/bin/env node
/**
 * observe: persist eventId and treat a second delivery of the same id as a no-op.
 * State file path is argv[2]. Must not trigger a new business command.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const statePath = process.argv[2];
if (!statePath) {
  process.stderr.write("observe-dedup: missing state file path\n");
  process.exit(2);
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
const eventId = typeof event.eventId === "string" ? event.eventId : "";
if (!eventId) {
  process.stderr.write("observe-dedup: eventId missing\n");
  process.exit(1);
}

const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { seen: [], applied: [], duplicates: [] };

if (state.seen.includes(eventId)) {
  state.duplicates.push(eventId);
  writeFileSync(statePath, `${JSON.stringify(state)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, duplicate: true, eventId })}\n`);
  process.exit(0);
}

state.seen.push(eventId);
state.applied.push({
  eventId,
  cursor: event.cursor ?? null,
  seq: event.seq ?? null,
  type: event.type ?? null,
});
writeFileSync(statePath, `${JSON.stringify(state)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, duplicate: false, eventId })}\n`);
