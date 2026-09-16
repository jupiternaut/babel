#!/usr/bin/env node
/** observe: fail delivery. Must not roll back the committed command. */
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
process.stderr.write("observe-fail: 演示投递失败\n");
process.exit(1);
