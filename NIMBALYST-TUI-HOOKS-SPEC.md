# 巴别塔：GUI / TUI / CLI 功能对等与 Hooks 契约

版本：补充规格 v2.3，2026-09-14。状态：待实施。

这是用户对开发方式的新要求，已经同步进入 [主开发 SPEC v2.3](NIMBALYST-DEVELOPMENT-SPEC.md) 和 [Trackers 映射](NIMBALYST-TRACKER-MAPPING.md)：第一阶段从单 GUI 原型扩展为共用核心的 GUI、TUI、CLI 与 Hooks 原型。旧包原样存于 [v2.2 存档](reference/v2.2/README.md)；当前 M0 范围按本补充更新，既有身份、权限、完成/归档守卫继续有效。

## 1. 功能对等的定义

每项新增业务能力必须先有不依赖图形界面的命令、查询和事件，再提供 Nimbalyst GUI、交互式 TUI 与非交互 CLI 入口。三个入口共用领域模型、业务服务、授权、校验和持久化，执行相同操作得到相同业务结果。

**TUI 是可操作的终端应用**：支持列表/看板、详情、编辑、筛选、菜单、对话、差异和历史，不只是打印日志或用命令唤起桌面窗口。CLI 提供适合模型与脚本调用的结构化命令。Hooks 提供扩展、观察及受控校验点。

功能对等不要求像素一致：GUI 拖拽对应 TUI 的选择后移动菜单；GUI 标签页对应 TUI 页签；富文本操作可用语义文本编辑或结构化命令表达。图片、PDF 页面等图形对象的定位、检索、批注、译文与导出需要终端操作路径，但不能把文字摘要宣称为原图显示，也不能把“打开外部 GUI”算作纯终端完成。

NB-00 核实并补齐 [CAPABILITY-MATRIX.md](CAPABILITY-MATRIX.md)：列出本次新增及涉及的继承能力，逐项记录 command/query、GUI、TUI、CLI、Hook、测试与差异。既有 Nimbalyst 全部编辑器功能的终端覆盖也要登记缺口；不把单阶段 M0 宣称为整个上游软件已经完全等价。新增功能缺任一应有入口时，不标记该功能完成，也不能把三端统一禁用说成功能已经等价实现。

## 2. 共用核心，无图形环境可运行

```text
Nimbalyst GUI ─┐
交互式 TUI ───┼─ 公共 command/query 客户端 ─ 领域服务 / 统一命令路由
非交互 CLI ───┘                                  │
                           权威 Tracker + ExecutionBinding + Run 数据
                                                 │
                                 持久事件 / outbox / hook dispatcher
                                                 │
                                    GUI / TUI / CLI watch / 测试消费者
```

- 领域服务与协议不导入 Electron renderer、DOM 或图形窗口对象。GUI 作为宿主适配器接入；现有 Electron 耦合在 NB-00 定位后逐步抽取，不能先假定上游已经支持无头运行。
- 允许独立本地服务进程提供 demo/profile 后端；它不能要求 Nimbalyst 桌面窗口、Electron 图形服务或显示服务器先启动。生产接既定 Gateway，不能在每个入口另造任务库。
- 同一 GUI 工作区的原 Trackers 和执行面板仍共用一个 provider / TrackerDataSource 实例。不同进程的 TUI/CLI 不可能共用同一个内存对象，必须共用权威服务、协议与项目身份，通过快照、revision、事件游标保持一致。
- 每个调用携带项目作用域，业务身份是 `(projectId, trackerId)`。执行新 runId；写入使用 revision 与幂等键。GUI、TUI、CLI、MCP、Hook 发起的命令走相同守卫。
- UI/TUI 关闭或 SSH 会话退出只断开视图，不隐式取消已接收的执行。重新连接可恢复快照、run 和事件游标；显式取消另走命令。
- Windows、Ubuntu、macOS 分别验收；TUI 库与实现语言由 NB-00 根据现有栈、许可、键盘/鼠标与 Windows 终端支持选定，不为“用了 TUI”重写所有核心逻辑。

## 3. 命令与查询合同

下列 `babel` 是**拟实现命令名**，当前包不提供这些可执行文件。NB-01 要生成真实帮助、Schema、协议版本、正反例及错误码；不照抄命令示例冒充已完成。

```text
babel tui --profile demo
babel capabilities --json
babel task list --project <projectId> --json
babel task get --project <projectId> --id <trackerId> --json
babel task create --project <projectId> --input request.json --json
babel task update --project <projectId> --id <trackerId> --input patch.json --expected-revision 3 --json
babel run start --project <projectId> --task <trackerId> --idempotency-key <key> --json
babel run show --project <projectId> --id <runId> --json
babel run respond --project <projectId> --id <runId> --request <requestId> --input answer.json --json
babel run cancel --project <projectId> --id <runId> --json
babel review accept --project <projectId> --run <runId> --expected-revision 4 --json
babel task archive --project <projectId> --id <trackerId> --json
babel task restore --project <projectId> --id <trackerId> --json
babel events watch --project <projectId> --after <cursor> --format jsonl
```

上述列表是起点，非功能上限。正文、依赖、类型、保存视图、排序、结果/差异、历史、重试、要求修改、设备与集成配置等新增能力都进入矩阵，补相应命令。普通字段更新不得接受任意 stage/outcome/run.status。

- `--json` 标准输出只含结构化结果，诊断写 stderr；事件流用 JSONL，无 ANSI 控制码。交互式 TUI 仅在 TTY 中运行，非 TTY 给明确错误并指向 CLI。
- 非交互模式不能弹出等待输入的隐藏提示；缺少必需参数、版本冲突、拒绝命令返回机器可读 code、相关 ID、可重试标志和非零退出码。
- “启动请求已接收”不等于 run 成功。命令结果区分 command status、业务 revision 与 run status；若提供 `--wait`，明确等待目标、超时与终止条件。
- 事件 watch 断开/Ctrl-C 不等于取消 run；等待超时不自动重派。`capabilities` 反映服务端权限与能力，禁用原因在三端一致。
- Shell/Hook 调用使用可执行文件与参数数组、JSON 文件/stdin，不能把任务标题或模型输出拼成 shell 命令。

## 4. TUI 的首期交互

终端初始页包含项目/类型/设备选择、任务列表或四列看板、选中详情；宽度不足时切阶段列表。鼠标可选择、滚动、打开菜单，但所有业务操作都有键盘路径，不能仅靠鼠标坐标。

M0 覆盖：新建和编辑正文/字段/依赖、筛选与保存视图、查看类型、启动摘要、模拟执行、补充消息、回答待答请求、取消、差异、验收、归档、恢复、历史与旧 run。模拟切换方式清楚标记，不成为生产任意成功接口。

要求保留中文宽字符、输入法体验、终端 resize、滚动、搜索、焦点、草稿及重连后的选择。终端颜色不足时仍有状态文字；TTY 恢复正常，退出不留下鼠标捕获或隐藏光标。终端复用器/SSH 环境的鼠标支持不足时保留键盘等价路径。

M0 的 GUI 和 TUI 必须能连接同一隔离 demo 服务，互相看到同一记录的修改。fixture 初始化一次，不由三种入口分别拷贝三份“看起来相同”的数据。

## 5. Hooks：扩展点和可观察事件

这里的 Hooks 是 **Babel 应用级扩展协议**。Codex、Pi 或其他 Agent 的厂商 Hook 只是适配消费者，不把平台专用配置硬写进业务核心，也不假定已有厂商 Hook 具有同名事件。

### 命令前校验与命令后事件分开

| 阶段 | 职责 | 规则 |
|---|---|---|
| `beforeCommand` | 已配置的同步校验插件可返回 allow/deny 与原因 | 在公共命令服务执行；有超时、版本与确定的失败策略；必需校验失败或超时拒绝命令。不能绕过核心权限/完成守卫或直接写库 |
| committed/rejected/failed | 报告真实命令结果 | 提交后事件与数据变更有一致 revision；日志中的 started 不能冒充提交 |
| 业务事件 | Tracker 更新、run 子状态、验收、归档、设备快照等 | 三端及模型消费相同事件，使用既定 v2 事件名称并扩充 Schema，避免另一套平行命名 |
| `hook.delivery.failed` | 报告扩展脚本失败 | 属于投递状态，不改变已提交的任务结果；可人工重试投递，不重跑原业务命令 |

既定事件如 `task.updated`、`run.accepted`、`run.started`、`tool.finished`、`input.requested`、`verification.updated`、`run.finished`、`task.archived`、`device.snapshot` 保留语义。特别是 `run.finished` 必须携带结果类型，不一律当成功。

事件 envelope 至少含 schemaVersion、eventId、projectId、trackerId/taskId（非条目事件可空，存在时相等）、runId（非运行事件可空）、type、streamId、seq、cursor、revision、occurredAt、correlationId、causationId、mode、payload。seq 在 streamId 内单调；任务/设备流不伪造 runId。eventId 去重，授权日志 cursor 用于续读，墙钟时间不能用于因果排序。跨项目串流/越权订阅必须有负例测试。

投递使用持久 outbox、游标、有限重试和失败记录，按至少一次投递设计；消费者以 eventId 幂等去重，不能声称脚本天然恰好执行一次。重放事件不得重新执行原业务动作。防止 Hook 自己生成同类事件而无限递归，限制因果链/重试次数。

异步或耗时前置校验后，提交事务仍需重新核对 revision、权限和核心不变量；Hook 的 allow 结果不能放行已经过期的条件。相同幂等键/负载重试返回原结果，同键不同负载冲突；覆盖提交已完成但响应丢失、Worker已接受但客户端崩溃、Hook已执行但确认丢失三类窗口。

本地 Hook 采用明确登记的 executable + argv、工作目录、环境白名单、timeout、JSON stdin 和结构化结果；不自动执行克隆仓库内发现的脚本。M0 可登记隔离目录下的合成测试 Hook；生产 Hook 配置纳入项目权限。日志与 payload 避免携带密钥和无关个人数据。

### Hooks 如何帮助模型测试

模型调用 CLI/API → 公共命令执行 → 消费 correlationId 对应事件 → 查询真实快照/结果 → 使用断言检查不变量 → 保存测试报告。Hooks 负责稳定扩展点与观测，**不能替代状态查询、结果断言或 GUI/TUI 输入测试**。

执行测试的脚本可以通过同一命令接口提交验证证据，但不能凭 Hook 退出码 0 直接写 DONE。证据由权威服务按 completionPolicy 接受；人工审查与豁免沿用原规则。

## 6. 里程碑与验收增补

| 原任务 | 新增工作 |
|---|---|
| NB-00 | 盘点 Electron 耦合、终端运行条件和功能矩阵；固定 TUI 库与无头服务边界 |
| NB-01 | 三端公共 command/query/event、CLI 输入输出与错误码、Hook 契约与正反例 |
| NB-02 | 公共核心/隔离 demo 服务和 CLI 首个纵向闭环，随后 GUI shell 与 TUI shell |
| NB-03 | 同一 demo 数据源的三端业务操作、Hook dispatcher 与故障注入 |
| NB-04 | 三端会话/差异/历史、交叉操作及终端交互验收；交付扩展后的 M0 |
| NB-05～12 | 真实 Gateway/Worker/外部集成仍按原阶段接入；每项新增功能继续满足三端矩阵 |

以下是 M0 新增门槛，原 UI/FLOW/MAP/REG 验收继续有效：

| 编号 | 需要实际证明 |
|---|---|
| PAR-01 | 同一 fixture 在 GUI/TUI/CLI 执行等价命令，规范化快照、revision 与拒绝原因一致；瞬时时间等差异须明确排除依据 |
| PAR-02 | GUI 创建 → TUI 修改 → CLI 查询 → 任一端模拟启动/验收/归档/恢复，始终同一项目/Tracker/run 关联，无重复条目 |
| HEADLESS-01 | 不启动桌面应用/显示服务器，只启动非图形 demo 服务和终端，完成业务闭环；没有 Electron/浏览器隐式回退 |
| CLI-01 | JSON/JSONL、退出码、缺参、拒绝、revision 冲突、请求超时与幂等重试均正确，无不可控交互提示 |
| TUI-01 | 通过 PTY/ConPTY 或等价终端测试键盘、选择、编辑、resize、重连与退出恢复；有实测鼠标路径；不能只测 CLI 就算 TUI 通过 |
| HOOK-01 | 拒绝/超时的必需 beforeCommand 不提交；post Hook 失败不回滚已提交业务，不误触发新执行 |
| HOOK-02 | 注入重复、断连、崩溃和乱序交付，验证游标恢复、eventId 去重、有限重试与因果链；过期游标按合同重拉快照 |
| EVIDENCE-01 | 报告包含命令结果、关联事件与查询断言；缺少完成策略要求的证据，或 verified_and_reviewed 缺授权人工验收时，三端及 Hook 都不能转 DONE。另验证 verified_auto 在配置规则与证据满足时由服务完成 |
| LIFE-01 | 关闭 GUI/TUI 或断开 SSH 不取消 run；重新接入恢复同一 run；显式取消待确认时仍禁止重试 |

M0 仅证明合成场景；真实设备、模型、第三方账号与生产权限另行验收。功能矩阵未覆盖或需图形预览的部分明确列出，不用“与某产品完全一样”替代验证。
