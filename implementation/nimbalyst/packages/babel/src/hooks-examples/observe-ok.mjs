#!/usr/bin/env node
/** observe: accept the event payload and exit 0. */
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
