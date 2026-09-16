#!/usr/bin/env node
/**
 * Reference consumer: resume from cursor, ignore duplicates by eventId,
 * and order by stream seq / cursor rather than wall-clock or payload label.
 * Reads a JSON array of events from stdin. Optional last cursor is argv[2].
 */
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "[]");
const events = Array.isArray(parsed) ? parsed : parsed.events ?? [];
const after = Number(process.argv[2] ?? 0);

const seen = new Set();
const applied = [];
const ordered = [...events].sort((left, right) => {
  const cursorDelta = Number(left.cursor ?? 0) - Number(right.cursor ?? 0);
  if (cursorDelta !== 0) return cursorDelta;
  return Number(left.seq ?? 0) - Number(right.seq ?? 0);
});

for (const event of ordered) {
  const cursor = Number(event.cursor ?? 0);
  if (cursor <= after) continue;
  if (!event.eventId || seen.has(event.eventId)) continue;
  seen.add(event.eventId);
  applied.push(event);
}

const lastCursor = applied.length
  ? Number(applied[applied.length - 1].cursor)
  : after;

process.stdout.write(`${JSON.stringify({
  ok: true,
  after,
  applied: applied.map((event) => ({
    eventId: event.eventId,
    type: event.type,
    cursor: event.cursor,
    seq: event.seq,
    streamId: event.streamId,
  })),
  lastCursor,
  unique: applied.length,
})}\n`);
