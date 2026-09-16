# Pi 接入：隔离预检与本地任务会话

2026-09-16，工程切片 M1-02a。Pi 负责模型、推理、工具及代码修改；Babel 负责记录与会话绑定、交互、状态观测、结果审查和人工验收。M1-02a 已交付 RPC 传输与 CLI 预检；后续 M1-02b 增加独立本地服务、任务绑定和三端会话入口。预检成功、协议替身测试通过和真实模型执行分别记录，不能相互替代。

## 可运行入口

在本包使用 Node 24：

```sh
node --import tsx src/cli/main.ts pi probe --executable /opt/homebrew/bin/pi --json
```

必须指定已安装的 Pi 可执行文件绝对路径，可加 `--timeout 15000`（1～60000 毫秒）。命令不会安装 Pi。Windows 的可执行文件启动、Ubuntu 及其他 Pi 版本待验；本次实际验证 macOS arm64 / Pi 0.84.1。

预检创建临时空工作目录、HOME 和 Pi 配置目录，使用明确的环境变量白名单；不继承账号、API Key、NODE_OPTIONS 或已有会话。禁用工具、扩展、技能、模板、主题、上下文文件发现、会话保存、遥测和版本检查，使用 Pi offline 模式。仅发送 `get_state` 与 `get_messages`，从不发送 prompt、bash、模型切换或其他执行命令。

输出只有 JSON，诊断进入 stderr。成功要求得到非空 sessionId、空消息及空闲状态，并在返回前确认预检子进程关闭；临时目录随之清理。正常 EOF 未退出时依次使用 SIGTERM / SIGKILL，仅作用于本次新建的预检进程。无法确认退出则报错并保留临时目录。

`protocolConnected: true` 表示指定程序的 RPC 握手通过。固定输出 `modelExecutionVerified: false` 和 `taskIntegrationVerified: false`，不把响应成功、空闲或进程退出写成任务完成。不存在的程序、超时、非法响应均非零退出，未进入 demo 服务。

## 传输合同

`src/pi/rpc-client.ts` 只管理调用方提供的 stdin/stdout，不启动进程、不读取凭据、不创建 Agent 引擎。命令子集为 `get_state`、`get_messages`、`prompt`（可指定 steer/followUp）、`steer`、`follow_up`、`abort`。只有前两个被预检 CLI 暴露。

- 严格 LF 分帧，支持 CRLF、UTF-8 分块和字符串内 U+2028/U+2029；单条记录默认上限 8 MiB。
- 每次请求独立 ID，校验响应的 command；事件原样交给上层，响应不混作进度事件。
- prompt/abort 响应只表示命令确认。完成、取消确认、人工验收与 DONE 仍由后续绑定层根据真实证据决定。
- 超时返回 `TIMEOUT`，结果可能未知，不自动重发。迟到/重复响应不变成事件。
- 非法 JSON/响应返回 `PROTOCOL`；请求被 Pi 拒绝返回 `REJECTED`；断连返回 `DISCONNECTED` 并通知调用方。断连不宣称 Pi 已停止，不杀进程、不重新派发。
- 参数、原始消息和模型输出都属于不可信数据；未来不能直接据此自动验收或运行额外 shell 命令。

协议依据为本机安装包附带的 `docs/rpc.md`，版本 0.84.1；上游入口：[Pi RPC 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)。使用薄传输层的原因：现有 Worker 是独立进程架构，而安装包的 RpcClient 启动代码会合并 `process.env`；本片需要明确的空凭据环境，不增加全量 Pi SDK 运行时依赖。

## 本地任务服务与 Mac 启动

本地模式必须显式设置 `BABEL_MODE=local` 和 `BABEL_LOCAL_PI_CONFIG`；后者是**私有 JSON 文件的绝对路径**，不是 JSON 字符串。不要把配置、凭据、服务令牌或运行会话提交到仓库。配置示例（将示例路径、provider、model 全部改成已确认的实际值）：

```json
{
  "projectId": "my-local-project",
  "name": "本地开发项目",
  "workdir": "/Users/you/Projects/pi-acceptance",
  "executable": "/opt/homebrew/bin/pi",
  "agentDir": "/Users/you/Library/Application Support/Babel/mac-local-dev/local/pi-agent",
  "provider": "your-provider",
  "model": "your-model"
}
```

`workdir` 必须是现存绝对目录。服务会校验实际路径、Pi 可执行程序和独立配置目录。通过 Mac 启动器时，`agentDir` 固定为 `<启动器 profile>/local/pi-agent`，不能指向日常 `~/.pi/agent`。账号只在用户明确授权后配置到这个专用目录；不会发现、读取或复制其他配置目录的登录信息，也不会从调用进程继承模型 API Key。启动服务和桌面本身不派发任务；实际模型调用由每次显式启动确认触发。

在仓库根目录运行（配置文件需先由用户按已授权的账号与模型准备）：

```sh
export BABEL_MODE=local
export BABEL_LOCAL_PI_CONFIG="$HOME/babel-local-pi.json"
node scripts/dev-macos.mjs start --profile "$HOME/Library/Application Support/Babel/mac-local-dev"
```

本地默认端口为服务 `7783`、Vite `5274`、CDP `9224`；demo 保持 `7780/5273/9223`，默认 profile 也不同。可用 `BABEL_PORT`、`VITE_PORT`、`NIMBALYST_CDP_PORT` 显式覆盖，端口占用不会停止已有进程。启动器传入同一 `BABEL_PROFILE`、`BABEL_PROJECT_ID`、`BABEL_ENDPOINT` 与实际工作目录；本地使用 `src/server/main.ts`，demo 保持慢速验收模拟服务。

`status`、`stop` 仍按已记录的 PID/进程组身份工作，不删除数据；带上同一个 `--profile` 即可，不依赖配置文件仍在原位。已有 demo profile 不能复用为 local，避免混用桌面数据。启动器不会生成或导入 Pi 的账号信息。

## CLI 与 TUI 接入同一个本地服务

在本包目录、另一个终端设置服务地址与**该服务自己生成**的令牌，不输出令牌：

```sh
export BABEL_ENDPOINT=http://127.0.0.1:7783
export BABEL_PROFILE="$HOME/Library/Application Support/Babel/mac-local-dev/local"
export BABEL_SERVICE_TOKEN="$(cat "$BABEL_PROFILE/service.token")"
node --import tsx src/cli/main.ts task list --project my-local-project --json
node --import tsx src/tui/main.ts --project my-local-project
```

令牌仅用于 Babel 本地服务身份验证，不是模型凭据。不要启用 shell 命令追踪，不把令牌复制到截图或问题报告。原生桌面主进程从该 profile 获取令牌，经受限桥接访问服务，不把令牌放进 Vite 环境或渲染器源码。

CLI 是非交互入口。先读取任务，检查 `record.revision` 和 `executionTarget`：

```sh
node --import tsx src/cli/main.ts task get --project my-local-project --id YOUR_TRACKER_ID --json
```

确认任务、目录、provider/model 后，自己准备 `start.json`：

```json
{
  "executionTarget": {
    "workdir": "/Users/you/Projects/pi-acceptance",
    "provider": "your-provider",
    "model": "your-model"
  }
}
```

使用读回的 revision 和本次意图的唯一幂等键提交：

```sh
node --import tsx src/cli/main.ts run start --project my-local-project --task YOUR_TRACKER_ID \
  --expected-revision 1 --idempotency-key YOUR_UNIQUE_START_KEY --input start.json --json
```

缺任何确认字段时，本地 CLI 拒绝启动；不会自动复制服务目标代替用户确认。revision、目录或模型改变时必须重新检查。响应丢失后重试原意图时，保持相同输入、revision 和幂等键。accepted/settled=false 不代表执行完成。

会话查询、输入、停止和事件沿用现有合同：

```sh
node --import tsx src/cli/main.ts run show --project my-local-project --id YOUR_RUN_ID --json
node --import tsx src/cli/main.ts events watch --project my-local-project --format jsonl
node --import tsx src/cli/main.ts run message --project my-local-project --id YOUR_RUN_ID \
  --text '请继续检查测试结果' --idempotency-key YOUR_UNIQUE_MESSAGE_KEY --json
node --import tsx src/cli/main.ts run cancel --project my-local-project --id YOUR_RUN_ID --json
```

TUI 顶栏明确显示“本地 Pi”。`s` 打开含任务、工作目录、provider/model 和 revision 的确认框，Enter 才提交；Esc/n 取消不会启动。`S` 查看同一 run 的会话 ID、目录、模型及用户/Agent/工具消息；↑/↓ 阅读历史时新输出不抢滚动，End 恢复跟随。`m` 输入消息，发送失败保留输入、目标和原幂等键，提交期间阻止连按。取消请求和连接丢失都不宣称 Pi 已停止；本地隐藏 demo 的人工终止核对入口。

## 当前验收边界

本片功能测试使用隔离服务和可控 RPC/HTTP 替身；未因此声明真实 provider/model、账号或文件修改通过。真实 Pi 无凭据预检保持独立，不发送 prompt。实际模型验收仍需明确 provider/model/账号范围，再在隔离代码目录检查真实输入、输出、工具调用、取消状态以及重启后可读的同一记录。

本地任务身份、会话内容持久化不等于服务崩溃后能接管活进程。真实 Diff、测试证据、PR 交付、可恢复进程托管及完整人工验收闭环仍待后续切片；本地 `review.accept`、`run.respond` 和手工 `run.reconcile` 不用模拟结果替代真实事实。完整功能与独立验收标记以仓库根目录 `TASKS.md` 为准。

### 第一片的运行边界

- 一个 local profile 使用独占单写者锁；同一服务内工作目录只允许一个未终止 run，包含待审/失联。独立 worktree 和跨 profile 工作区租约尚未实现。
- 启动握手后仍要等初始 prompt 回执，才开放补充消息。回执不代表任务完成；确认 `agent_settled` 且状态无活动/队列后仅进入待审。
- Pi 会在指定专用 `pi-agent` 下保存关闭自动重试的设置。普通个人 Pi 配置不复用，项目显式开启重试也会拒绝启动。
- 停止需要 RPC abort 确认以及所拥有的 Pi 进程组退出；断线时无法核实 Pi 独立启动的工具进程，保留待核对状态，不允许假确认。
- 正常关闭服务会尝试停止其拥有的 Pi，并持久化确认；强杀后 `state/local-writer.lock` 不自动抢占。确认原服务和工具进程全部停止后才能人工处理锁，历史 run 仍标失联；接管和恢复功能尚未交付。
- 当前流式消息逐事件持久化 JSON，尚未做长日志/高频输出性能验收；SQLite 和日志分页属于后续生产化。
