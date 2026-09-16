export const HELP_TEXT = `babel — 巴别塔 M0 非交互 CLI（演示数据，经 HTTP 连接同一 demo 服务）

用法:
  babel <资源> <动作> [选项]

全局选项:
  --json                 标准输出 JSON（默认即 JSON）
  --project <id>         项目 ID
  --id <id>              记录或 run ID
  --input <file|->       JSON 请求体，- 表示标准输入
  --expected-revision N  乐观锁
  --idempotency-key <k>  幂等键
  --endpoint <url>       默认 $BABEL_ENDPOINT 或 http://127.0.0.1:7780
  --profile <name>       仅写入提示，实际仍走 HTTP，不读本地密钥
  --wait                 等待 run 到待验收或终态；超时 WAIT_TIMEOUT（退出 21），不自动重派
  --timeout <ms>         --wait 超时，默认 30000
  --help                 本说明（纯文本，写到 stderr；加 --json 则输出 JSON 帮助）

命令:
  babel capabilities --json
  babel pi probe --executable <Pi 可执行文件绝对路径> [--timeout 15000] --json
  babel project list --json
  babel device list --project <id> --json
  babel schema types --json
  babel view list --project <id> --json
  babel view save --project <id> --name <name> [--view-id <id>] [--input definition.json] --json
  babel ready list --project <id> --json
  babel relation set --project <id> --id <trackerId> [--depends-on <id[,id]>] [--blocks <id[,id]>] [--input relations.json] --expected-revision <n> --json
  babel hook list --project <id> --json
  babel hook register --project <id> --input hook.json --json
  babel hook retry --project <id> --delivery <deliveryId> --json
  babel task list --project <id> [--attention-only] --json
  babel task get --project <id> --id <trackerId> --json
  babel task create --project <id> --input request.json --json
  babel task update --project <id> --id <trackerId> --input patch.json --expected-revision N --json
  babel task archive --project <id> --id <trackerId> --json
  babel task restore --project <id> --id <trackerId> --json
  babel task reorder --project <id> --id <trackerId> --before <trackerId> --json
  babel comment add --project <id> --id <trackerId> --input comment.json --json
  babel run start --project <id> --task <trackerId> --idempotency-key <key> --json
  babel run show --project <id> --id <runId> --json
  babel run list --project <id> --json
  babel run message --project <id> --id <runId> --input message.json --json
  babel run respond --project <id> --id <runId> --request <requestId> --input answer.json --json
  babel run cancel --project <id> --id <runId> --json
  babel run retry --project <id> --task <trackerId> --json
  babel run reconcile --project <id> --id <runId> --input resolve.json --expected-revision N --idempotency-key <key> --json
  babel review accept --project <id> --run <runId> --expected-revision N --json
  babel review request-changes --project <id> --run <runId> --input note.json --json
  babel history get --project <id> --id <trackerId> --json
  babel diff get --project <id> --id <runId> --json
  babel events list --project <id> --after <cursor> --json
  babel events watch --project <id> --after <cursor> --format jsonl
  babel demo reset --json
  babel demo inject --scenario waiting_input --json
  babel google-tasks status --json
  babel google-tasks pull --tasklist <id> --json
  babel node list --json
  babel ops health [--service <id>] --json
  babel pdf locate --quote <text> --json

说明:
  标准输出只含 JSON 或 JSONL，不含 ANSI。诊断写 stderr。
  pi probe 仅用空配置检查真实 Pi RPC，不调用模型、不接任务；输出 mode=pi-rpc-probe，不是 demo 执行。
  启动成功只表示 command accepted；settled=false 时 run 尚未完成。
  events watch 的 Ctrl-C 只断开订阅，不会取消 run。
  task list --attention-only 只看等待输入、失败、失联、待验收，保留四阶段并排除归档。
  交互界面请运行: npx tsx src/tui/main.ts
  后续入口 google-tasks / node / ops / pdf 走同一合成查询。没有真账号时标明未接入或演示，不打开外部图形窗口，也不把试拉写成同步成功。
`;

export const HELP_JSON = {
  ok: true,
  mode: "demo",
  kind: "help",
  settled: true,
  commands: [
    "capabilities",
    "pi probe",
    "project list",
    "device list",
    "schema types",
    "view list",
    "view save",
    "ready list",
    "relation set",
    "hook list",
    "hook register",
    "hook retry",
    "task list",
    "task get",
    "task create",
    "task update",
    "task archive",
    "task restore",
    "task reorder",
    "comment add",
    "run start",
    "run show",
    "run list",
    "run message",
    "run respond",
    "run cancel",
    "run retry",
    "run reconcile",
    "review accept",
    "review request-changes",
    "history get",
    "diff get",
    "events list",
    "events watch",
    "demo reset",
    "demo inject",
    "google-tasks status",
    "google-tasks pull",
    "node list",
    "ops health",
    "pdf locate",
  ],
};
