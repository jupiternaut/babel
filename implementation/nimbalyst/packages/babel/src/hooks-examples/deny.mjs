#!/usr/bin/env node
/** beforeCommand: deny. Opt-in via hook.register or *.hook.json.example. */
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
process.stdout.write(`${JSON.stringify({ allow: false, reason: "演示拒绝：校验 Hook 不允许提交" })}\n`);
