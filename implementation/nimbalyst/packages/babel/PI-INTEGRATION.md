# Pi 接入：传输与隔离预检

2026-09-16，工程切片 M1-02a。Pi 负责模型、推理、工具及代码修改；Babel 负责记录与会话绑定、交互、状态观测、结果审查和人工验收。本片只交付 RPC 传输与 CLI 预检，不是已接通的任务执行功能。

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

## 下一片与验收边界

下一片将同一 projectId/trackerId/runId 绑定工作目录与 Pi sessionId，接入原生 GUI、TUI、CLI 的实时事件和输入，记录可恢复日志及未确认停止状态。真实模型验收需明确 provider/model/账号范围，再用隔离代码仓库核验修改、测试与人工验收。

尚未交付：任务服务接线、进程持久托管、崩溃接管、真实 prompt/工具调用、真实 diff、三端 Pi 会话界面和独立验收。现有 `ManagedWorker` 的真实 Pi 拒绝保护不变，M0 仍是模拟运行。协议替身测试不算模型执行证据，CLI 预检不算 GUI/TUI 对等。
