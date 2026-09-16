import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const stripped = item.replace(/^--/, "");
    const eq = stripped.indexOf("=");
    return eq === -1 ? [stripped, "true"] : [stripped.slice(0, eq), stripped.slice(eq + 1)];
  }),
);

const worktree = String(args.worktree ?? "");
const runId = String(args.runId ?? "");

if (!worktree || !runId) {
  process.stderr.write("synthetic-child requires --worktree and --runId\n");
  process.exit(2);
}

function emit(kind, payload) {
  process.stdout.write(`${JSON.stringify({ kind, runId, at: new Date().toISOString(), payload })}\n`);
}

function writeDiff() {
  const file = path.join(worktree, "src", "hello.txt");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `hello from pi-sim child at ${new Date().toISOString()}\n`, "utf8");
}

function writeArtifact() {
  const file = path.join(worktree, "artifacts", "result.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ok: true, executor: "pi-sim", realPi: false }, null, 2)}\n`, "utf8");
}

emit("log", { message: "pi-sim child started; not a real Pi" });
emit("message", { role: "agent", text: "本机合成执行器已开始" });
emit("tool", { name: "read_worktree", phase: "started" });
emit("tool", { name: "read_worktree", phase: "finished" });
writeDiff();
emit("diff", { files: [{ path: "src/hello.txt", status: "modified" }] });
writeArtifact();
emit("artifact", { path: "artifacts/result.json", name: "result.json", realPi: false });

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }
  if (cmd.op === "message") {
    emit("message", { role: "user", text: String(cmd.text ?? "") });
    emit("message", { role: "agent", text: "合成执行器已收到消息" });
  } else if (cmd.op === "record") {
    if (cmd.kind === "tool") {
      const name = String(cmd.name ?? "synthetic_tool");
      emit("tool", { name, phase: "started" });
      emit("tool", { name, phase: "finished" });
    } else if (cmd.kind === "diff") {
      writeDiff();
      emit("diff", { files: [{ path: "src/hello.txt", status: "modified" }] });
    } else if (cmd.kind === "artifact") {
      writeArtifact();
      emit("artifact", { path: "artifacts/result.json", name: "result.json", realPi: false });
    }
  } else if (cmd.op === "cancel") {
    emit("cancel_ack", { confirmed: true });
    process.exit(0);
  }
});
