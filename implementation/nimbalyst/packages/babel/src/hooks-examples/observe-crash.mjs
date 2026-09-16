#!/usr/bin/env node
/** observe: crash after reading stdin. Delivery must fail; the command must stay committed. */
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
process.stderr.write("observe-crash: 演示进程崩溃\n");
process.exit(2);
