# 巴别塔：Nimbalyst 底座、Google Tasks 与局域网执行节点

> 后续开发入口：[开发 SPEC v2.2](NIMBALYST-DEVELOPMENT-SPEC.md) 与 [Trackers 一一映射](NIMBALYST-TRACKER-MAPPING.md)。本文件的旧源码基线是历史核验；新审计 HEAD 为 d6e1d008d9ee264a7447f3533fa9f48f158a70b0。共享任务采用原 TrackerRecord 身份和已有 TrackerDataSource 接口，两个面板共用条目。

日期：2026-09-14。状态：确定产品底座及设计要求；尚未实现、部署或连接账号。

本文件与 [ADR-003](decisions/ADR-003.md) 记录用户最新选择：直接使用 Nimbalyst 当底座，融合 Vibe Kanban 的待办/运行/完成/归档，参考 Cline、Hermes 的实现，接入 Google Tasks 和每分钟设备状态采集。

## 1. 产品与部署边界

主客户端确定为 Nimbalyst，复用现有编辑器、会话、任务展示与差异审查。扩展优先，现有接口无法承担时做小范围宿主修改；不另造一套与 Nimbalyst 并行的主工作台。前轮桌面背景与菜单仍可作为 Nimbalyst 起始页风格。

最新 UI 约束：侧栏可以信息丰富，中央必须简洁。Ubuntu/macOS/Windows 设备选择、状态、刷新控制、Google Tasks 同步及运维入口集中在左侧分组；中央只保留任务列与精简卡片，设备指标和同步横幅不占用中央空间。点选卡片才打开右侧详情，会话/差异/历史用标签页按需显示。视觉示例见 [UI v2](design/babel-dashboard-v2.png)，其浅色外观是参考图的设计演示，核心约束是信息布局。

部署分三部分，用户从一个应用操作：

```text
Google Tasks ── Tasks API / OAuth，60 秒拉取 ──┐
                                            ▼
Nimbalyst 客户端 ⇄ Babel 后台（Ubuntu 常驻）
  四阶段任务板       任务/执行/事件/设备快照
  会话与差异         Google 同步、SSH 调度采集
  设备与运维                 │
                            ├─ SSH → Ubuntu 执行节点 → Pi 等 Agent
                            ├─ SSH → Windows 执行节点 → Pi 等 Agent
                            └─ SSH → macOS 执行节点 → Pi 等 Agent
```

Nimbalyst 有本地运行服务和 Agent 集成，但本轮没有证据表明它现成提供跨设备 SSH 巡检与任务调度。新增 Babel 后台承担这些常驻功能，避免关闭 Windows 上的 Nimbalyst 后同步、采集和任务一起停止。它是我们为 Nimbalyst 增加的后台，不是调用一个已经存在的官方通用任务服务器。

本机 Nimbalyst HEAD 已重新核对为 `07779ab118c6659c0c1788e5666420aef988b144`。客户端仓库 MIT；其协作同步服务器是独立项目，官方当前说明为受限许可商业产品。本方案独立实现任务/设备后台，不以客户端 MIT 推定服务器许可，也不改写原文档协作协议。[许可说明](https://github.com/nimbalyst/nimbalyst/blob/07779ab118c6659c0c1788e5666420aef988b144/LICENSING.md)、[官方部署边界](https://www.nimbalyst.com/quant/)。

跨设备共享由后台协议实现，不把各客户端 PGLite 文件放在共享文件夹中读写。手机、平板端沿用可复用的 Nimbalyst 移动能力并做实际适配，必要时提供同一后台的响应式页面；不能据 Electron 桌面构建成功宣称六平台已通过。

## 2. 四个可见阶段，一份任务

| 展示阶段 | 进入条件 | 操作与数据 |
|---|---|---|
| TODO / 待办 | 手工创建或外部导入 | 编辑标题、说明、项目、目标设备与验收要求 |
| RUNNING / 运行 | 执行节点接受启动请求 | 实时会话、工具活动、差异、等待输入、取消与异常处理 |
| DONE / 完成 | 满足约定完成条件 | 结果、验证证据、完整 run 历史；是否人工验收由任务规则决定 |
| ARCHIVED / 归档 | 用户归档已结束任务 | 从活跃视图移出，保留内容、结果与历史，可恢复查看 |

完成统一使用 DONE；前轮 ACHIEVE 是同一完成概念。ARCHIVED 是独立的可见性属性：底层 `archived_at` 与执行结果分开保存。失败任务也可归档，但在归档中仍标明失败；归档不能删除 worktree、日志或文件。运行中的任务先取消且确认停止后再归档，避免藏起仍在执行的工作。

`task_id` 不变；每次启动/重试新增 `run_id`，绑定设备、Agent 会话、正文快照、工作目录与证据。Babel 是这些共享任务的权威源，Nimbalyst 通过正式适配层读写投影；既有纯本地 Tracker 不自动搬迁或覆盖。

启动请求幂等，双击不创建两个 Agent；“启动中”不假装正在执行。RUNNING 保留 waiting_input、verifying 等子状态；failed、cancelled、lost 必须明确展示且不能进入 DONE。异常可在运行区的“需处理”组中显示，恢复/重试不复制任务。

服务端核实状态转移，拖卡不直接修改数据库以绕过启动或验收。Hook 表示观察事件，不是成功证据。进程退出、模型回合结束、Google 勾选完成、GitLab MR 合并均不能单独证明所有类型的任务完成。

## 3. 融合方式与现有入口

| 对象 | 在 Nimbalyst 中借鉴/复用 | 不直接照搬 |
|---|---|---|
| Vibe Kanban | 任务进入执行、工作区、结果审查与历史 | 默认列名与合并即完成规则 |
| Cline Kanban | 卡片活动、终端详情、差异反馈、Hooks 适配 | 自动跳过权限、trash 触发依赖、共享依赖目录等默认行为 |
| Hermes Kanban | 持久任务、run 历史、事件游标、调度恢复 | 整个 Hermes profile 运行时及另一份任务数据库 |
| Cursor 示例 | 卡片筛选、仓库元信息、产物预览 | Cursor Cloud 专属创建与密钥接入流程 |

源码基线与导航保留在 [SOURCE-MAP.md](SOURCE-MAP.md) 和 [前轮参考调查](ENTRY-AND-BOARD.md)。Nimbalyst 重点是 TrackerPanel/TrackerRecord、ExtensionAgentProvider、AgentProtocol 与 transcript 适配，不在 renderer 中扫描本地数据库或持有 SSH 私钥。

拟新增 `BabelTaskAdapter`（共享任务）、`GatewayAgentProtocol`（远端会话）、`DevicePanel`（设备快照）、`GoogleTasksConnector`（后台同步）、`SshCollector`（后台查询）和 `PiWorkerAdapter`（执行节点）。这些是设计名称，不是已存在或已验证模块。

## 4. Google Tasks → Nimbalyst

结论：可用 Tasks API 自动导入。核对的 REST v1 方法集合没有 watch、channel 或任务变更 Webhook；采用后台轮询，不宣称 Google 会主动回调内网服务器。[官方方法列表](https://developers.google.com/workspace/tasks/reference/rest)。

### 同步规则

1. 用户通过 OAuth 绑定自己的 Google 账号，首版读取用户选择的任务列表。可建议专门列表“巴别塔”，不得擅自创建列表或导入全部账号任务。
2. Ubuntu 常驻后台每 60 秒检查一次；这是计划间隔，不承诺任务一定在 60 秒内可见。初次分页导入，后续使用 `updatedMin` 重叠窗口读取变化；必须遍历所有 `nextPageToken`。
3. 读取包含已完成、隐藏、删除记录；需要 Docs/Chat 指派任务时显式处理 `showAssigned`。`showHidden` 影响是否能收到 Google 客户端完成的任务，不能忽略。[tasks.list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list)。
4. 唯一键为 `(Google account identity, tasklist_id, task_id)`；保存 Google 版本与最后同步时间。批次全部页面成功持久化后才推进游标；失败重试、重叠记录去重，定期全量核对补漏，不将这一时间过滤器当作有强一致保证的变更日志。
5. 导入为 TODO，不自动运行 Agent。首次绑定前已完成的 Google 任务默认不作为新待办导入。启动需要确定项目、设备和权限；自动启动属于以后单独配置的规则。
6. Google 标题/备注更新先记录来源版本；对用户已在 Nimbalyst 改过的任务提示冲突，不静默覆盖。已启动的 run 继续使用不可变快照。Google 勾选完成记录为外部状态变化，不能把正在运行的 Agent 直接标为 DONE；外部删除也不删除本地日志、不取消运行。
7. 首版只做 Google → Babel 导入。若启用完成回写，另行增加写权限、回写队列、重试和冲突规则；Babel 成功完成后才可回写 Google `completed`。Google 的完成状态不能表达本地 RUNNING/ARCHIVED，需保留各自模型。
8. 401/授权撤销显示“需重新登录”，429/5xx 退避，不丢任务。刷新令牌只保存在后台凭据存储中，不进入卡片、客户端日志或 Git。

轮询由 Ubuntu 主动访问 Google，不需要为了 Google 回调把局域网入口公开。自己可以提供供聊天/其他系统调用的 Webhook，但它不能变成 Google Tasks 原生 Webhook。

## 5. 每分钟 SSH 设备采集

用户指定设备状态每分钟刷新。采用 Ubuntu 上单一采集调度器，每台已登记设备每 60 秒取一次结构化快照；所有 Nimbalyst 客户端看同一结果，不各自向设备发起一轮扫描。

SSH 可远程执行采集命令或通过隧道访问节点服务。[OpenSSH 手册](https://man.openbsd.org/ssh.1)。主机、用户名、端口及主机密钥需在实施时核实，不从旧会话硬编码；只访问登记设备，不扫整个网段。

### 设备快照与 Agent 事件分开

- 设备快照：CPU/内存/磁盘、启动时间、节点版本、采集错误、重要服务健康。默认 60 秒采集，采集有截止时间，同一设备不重叠执行；睡眠或断网标记状态过期。
- 运行快照：读取节点保存的 `task_id/run_id/session_id`、PID 与进程开始时间、最新事件序号、退出结果、最近活动。PID 只是辅助，不能仅凭进程名识别任务，也不能将 PID 重用当作原进程仍活跃。
- 实时事件：正在查看或执行的任务，通过节点持久事件流和后台 WebSocket/SSE 尽快更新日志、等待输入与完成；SSH 轮询承担每分钟核对。第一版如仅采用轮询，必须接受一轮采集延迟并标注最后观察时间。
- 未由本系统登记的 Agent 进程可以显示为“发现的进程／任务未知”，不能伪造它的任务、进度或完成状态；接入相应 Agent adapter 后才获得语义状态。

状态必须区分 `device reachable`、`node healthy`、`agent running`、`task succeeded`。设备 SSH 可达不代表 Pi 可用；SSH 不通不代表任务失败。建议超过 150 秒没有新快照显示“状态过期/连接未知”（可配置）；保留最后成功采集时间，失联期间不自动重复启动任务。

### 采集与执行的边界

首期每台电脑安装一个小型节点包装器，把受管运行的状态与事件持久化；SSH 调用固定只读状态命令返回有上限的 JSON。进程由节点的独立生命周期管理，不依附一次查询的 SSH 会话，不能每分钟重启 Agent。

采集权限与启动/终止权限分开；主机密钥校验开启，凭据在后台，远程命令采用固定动作和验证后的参数。Windows 使用 PowerShell/Windows 服务或计划任务，Linux 使用 systemd，macOS 使用 launchd，各自实现等价采集与进程生命周期；不把 Linux 命令直接套给所有系统。

SSH 隧道、长连接或短命令查询由原型验证后选择；不假定 ControlMaster 在所有 Windows 客户端均可用。网络响应过大、命令超时、鉴权失败分别记录，不展示为设备正常。

Ubuntu 上的后台、Google 同步和 SSH 调度保持常驻；关闭客户端、退出一个查看页面或电脑锁屏不应停止远端运行。手机和平板主要作为查看/控制客户端，不要求变成常驻 SSH Worker。

## 6. 验收与后续契约迁移

1. Nimbalyst 中能创建、启动、查看、完成、归档同一任务；恢复归档保留原执行结果和所有 run。
2. 双击启动、浏览器/客户端重开、服务重启和重试不重复执行；已失联任务必须核对后才重派。
3. Google 测试列表新增任务经真实 OAuth/API 导入，重复拉取无重复卡片；分页中断、隐藏完成、删除、撤销权限有明确证据。
4. Ubuntu/Windows/macOS 真实设备每分钟快照；分别模拟节点停止、设备休眠、SSH 失败、Agent 失败，状态不混淆。
5. 未登记 Agent 只显示可证实信息；受管 Pi 的等待输入和完成来自实际事件，不从 CPU 占用或日志关键字猜测。
6. 原有 Nimbalyst 本地文档、Tracker 与会话不被新投影覆盖；六平台支持按各平台实机分别记录。

旧 OpenAPI/events/tasks.json 仍是待迁移的 v1 基线。本文件并非宣称已完成机器契约迁移；实施前必须一致更新：Babel 原生 task、归档字段、Google source mapping/sync cursor、device snapshot、run ownership、Agent 事件、身份/权限与对应验收任务。保留原先的文件安全、幂等、取消确认、PDF/Ops 需求。本轮未创建 OAuth 客户端、未获取令牌、未连接设备执行命令、未修改 Nimbalyst 源码或部署服务。
