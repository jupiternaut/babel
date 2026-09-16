#!/usr/bin/env node
/** beforeCommand: always allow. Reads stdin JSON, writes stdout JSON. */
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
process.stdout.write(`${JSON.stringify({ allow: true })}\n`);
