#!/usr/bin/env node
/** beforeCommand: sleep longer than typical timeoutMs so required hooks time out. */
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
await new Promise((resolve) => setTimeout(resolve, 8000));
process.stdout.write(`${JSON.stringify({ allow: true })}\n`);
