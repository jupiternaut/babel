# M0 能力与验收状态 · CAP-01～20

核对日期：2026-09-16。源码基线：`6568dc00f4fb6a20d828542b4a6694be854aa3e0`，本表随 Mac UI 与 M0 收口增量一同提交；结果对应包含本文的提交版本。本表是实现与证据索引，不修改 [CAPABILITY-MATRIX](../CAPABILITY-MATRIX.md) 的交付要求。

**M0 仍在收口。** 已有原生 Mac GUI、真实 POSIX PTY、CLI 的 demo 交叉闭环，但未把全部 CAP 的必需输入路径、失败路径和三端等价条件验完。表中“demo 子路径通过”仅覆盖写明的操作，不表示整项 CAP 或整个 M0 通过。真实 Pi、生产 Gateway、SSH、Google OAuth 和第三方服务不属于这些 demo 证据。

后续工程增量 M1-02a 已提供 Pi RPC 传输与隔离 CLI 预检，实际连接本机 Pi 0.84.1 读取空会话并退出；未调用模型、未接通任务服务或 GUI/TUI。它不改变下表的模拟执行/差异状态。见 [Pi 接入边界](nimbalyst/packages/babel/PI-INTEGRATION.md)。

## 路由与证据口径

本文链接相对 `implementation/`；表内测试路径相对 `implementation/nimbalyst/packages/`。同名 `packages/babel/src/gui` 是独立辅助界面，不以它替代 Nimbalyst 原生验收。当前原生运行详情挂载的是 `BabelExecutionShell`，不能用未挂载的 `BabelWorkflowPanel` 文件推定入口可达。

| 简称 | 实际源码入口 |
|---|---|
| 原生 Trackers | [TrackerMainView](nimbalyst/packages/electron/src/renderer/components/TrackerMode/TrackerMainView.tsx)、[TrackerSidebar](nimbalyst/packages/electron/src/renderer/components/TrackerMode/TrackerSidebar.tsx)、[TrackerItemDetail](nimbalyst/packages/electron/src/renderer/components/TrackerMode/TrackerItemDetail.tsx) |
| 原生看板/详情 | [BabelExecutionBoard](nimbalyst/packages/electron/src/renderer/components/TrackerMode/BabelExecutionBoard.tsx)、[BabelExecutionShell](nimbalyst/packages/electron/src/renderer/components/TrackerMode/babelWorkbench/BabelExecutionShell.tsx)、[useBabelRunActions](nimbalyst/packages/electron/src/renderer/components/TrackerMode/babelWorkbench/useBabelRunActions.ts) |
| 共享宿主适配 | [BabelDemoTrackerDataSource](nimbalyst/packages/electron/src/renderer/services/BabelDemoTrackerDataSource.ts)、[createWorkspaceTrackerDataSource](nimbalyst/packages/electron/src/renderer/services/createWorkspaceTrackerDataSource.ts) |
| TUI | [app.ts](nimbalyst/packages/babel/src/tui/app.ts)、[input.ts](nimbalyst/packages/babel/src/tui/input.ts)、[tty.ts](nimbalyst/packages/babel/src/tui/tty.ts)、[http.ts](nimbalyst/packages/babel/src/tui/http.ts) |
| CLI | [help.ts](nimbalyst/packages/babel/src/cli/help.ts)、[run.ts](nimbalyst/packages/babel/src/cli/run.ts)、[http.ts](nimbalyst/packages/babel/src/cli/http.ts)；以下省略共同的 `babel` 前缀与项目/endpoint 参数 |
| 公共核心 | [domain.ts](nimbalyst/packages/babel/src/core/domain.ts)、[contracts.ts](nimbalyst/packages/babel/src/contracts.ts)、[HTTP server](nimbalyst/packages/babel/src/server/http.ts)、[hooks.ts](nimbalyst/packages/babel/src/core/hooks.ts) |

证据分四层，不能互相替代：

- **实现/定向测试**：源码可达性、领域/HTTP/适配器测试；headless `feedEvent`/`feedRaw` 不等于真实终端。
- **原生 demo 输入**：Electron 窗口及真实 PTY/ConPTY 操作；底层仍为模拟执行。
- **真实系统或进程**：本轮 demo 服务 SIGKILL/新进程恢复，或历史 Windows 系统控制；均不等于真实 Agent。
- **生产接入**：真实 Agent、第三方账号、远端设备、权限与发布，必须另有证据。

历史原生依据：[Windows ACCEPTANCE](ACCEPTANCE.md) 与 [Mac 首轮 TASK_EVIDENCE](../TASK_EVIDENCE.md)。Windows 的 ConPTY 结果不代替 Mac PTY；Mac 首轮结果也不自动覆盖之后的新代码。本轮日志列文件名和事实摘要；可移植的原生截图与结构化证据见 [Mac 证据目录](evidence/macos-20260916/README.md)，不记录令牌。

## CAP 逐项状态

| CAP / 当前状态 | 原生 GUI 路由 | TUI 路由 | CLI / 公共合同 | 已有证据及尚需完成的下一步 |
|---|---|---|---|---|
| **01 筛选、搜索** · demo 子路径通过 | 原生侧栏、宿主搜索、执行看板；本轮增加“需要关注”投影 | `/` 搜索、项目/类型/设备筛选；`!` 和菜单切换关注过滤 | `task list`、`project list`、`device list`、`--attention-only` | `babel/tests/domain-lifecycle.test.ts`、`wd-attention.test.ts`、`tui-lr03.test.ts`；本轮 `electron/e2e/babel/attention-native.spec.ts` 已在 Mac 通过。本轮执行看板已复用宿主状态、Saved View、字段/标签/来源过滤与搜索，计数取相同结果；`filters-native.spec.ts` 在 Mac 窗口验证 Open/Closed/All 和搜索与服务列表一致。**下一步**：真实 PTY 输入遍历项目/设备/类型/搜索的组合，和同一 GUI/CLI 结果逐项比较；远端设备仅为 demo 选项。 |
| **02 原生类型、Saved Views、Ready** · 部分实现 | 原生类型树与保存视图保留；适配器 `share-saved-view → view.save`；`unshare-saved-view` 明确未实现 | `y` Ready、`w` 视图列表、菜单保存当前筛选 | `schema types`、`view list/save`、`ready list` | `babel/tests/semantic-stage.test.ts`、`domain-lifecycle.test.ts`、`cli-lr03.test.ts`、`tui-lr03.test.ts`。**下一步**：原生窗口保存/切换视图→PTY 应用→CLI 查回同一定义；核对取消共享/视图编辑路径，不把禁用算完成。 |
| **03 创建条目** · demo 子路径通过 | `TrackerMainView` 快速新建，经共享数据源 `create-item → task.create` | `n`/新建菜单，标题、正文，按当前类型提交 | `task create --input` | `babel/tests/create-closed-loop.test.ts`、`cross-surface-identity.test.ts`；`electron/e2e/babel/three-surfaces.spec.ts` 有 Mac GUI 中文创建与 CLI 同 ID 证据。**下一步**：补当前类型、自定义字段、取消输入和重复提交的原生 GUI/PTY 交叉验收。 |
| **04 标题、正文、字段编辑** · 部分实现 | 原生 `TrackerItemDetail`，适配器 `update-item`/`update-items → task.update`；`update-item-content` 携带草稿起始版本，原生正文复用富文本编辑器显式保存与冲突选择 | `e` 标题/正文，`F` 优先级/负责人/标签；冻结原目标与 revision，Ctrl+S 显式保存 | `task update --expected-revision` | `babel/tests/edit-revision-closed-loop.test.ts` 验证适配/HTTP/headless 输入及过期版本；本轮 `title-native.spec.ts` 原生中文标题保存、跨端更新与冲突不覆盖已通过。标题使用显式保存及草稿起始 revision。**本片**：正文适配拒绝无版本/未知 JSON 结构，TUI 旧版本失败保留编辑浮层、冻结原目标并阻止重复保存；见 [TASKS M0-04a](../TASKS.md)。**下一步**：独立 Mac/真实 PTY 富文本与冲突验收，基础字段已有 M0-04b 三端开发自测，继续补自定义字段及完整选区/断线恢复；完整 CAP-04 仍未通过。 |
| **05 依赖、关联、优先级** · 部分实现 | 原生优先级已接共享字段显式保存；Babel dependsOn/blocks 已接专用 relation.set 显式保存及冲突选择；其他关系/类型控件仍只读 | `l` 依赖/blocks 表单→`relation.set`；`F` 支持优先级/负责人/标签，任意字段仍待补 | `relation set`、`task update` 字段 | `babel/tests/domain-lifecycle.test.ts`、`cli-lr03.test.ts`、`tui-lr03.test.ts` 覆盖关系正反向和命令。**下一步**：M0-05a 已补依赖/阻塞双向增删与核心循环/只读/版本守卫，原生 GUI/PTY/CLI 开发者实操见下节；独立复验及其他关系类型仍待补。 |
| **06 手工排序** · 部分实现 | 原生看板拖拽仍需确认完整落到共享排序合同；尚无原生排序验收证明 | `u`/`i` 或菜单前后移动→`task.reorder` | `task reorder --before/--after` | `babel/tests/domain-lifecycle.test.ts`、`tui-lr03.test.ts`、`cli-lr03.test.ts` 有核心与 headless 证据。**下一步**：接实 GUI 排序路由，真实鼠标拖动和键盘替代后由 TUI/CLI 比较 orderKey；确认不改正文业务字段。 |
| **07 启动摘要、执行** · demo 子路径通过 | 原生详情“开始模拟”→`useBabelRunActions.start`→共享 `run.start` | `s`/开始菜单→`run.start`，使用 revision 与幂等键 | `run start`、`--wait`；accepted 与 finished 分开 | `babel/tests/domain-lifecycle.test.ts`、`idempotency-auth.test.ts`；Mac `three-surfaces.spec.ts` 已交叉启动同一 run。**下一步**：补三端可检查的完整启动摘要与显式确认，真实输入验证连按/超时不双执行。Pi 仍为模拟器。 |
| **08 会话、工具活动、进度** · 部分实现 | `BabelExecutionShell` 运行页、共享事件订阅；工具列表当前从 messages 的 tool/system role 派生 | 选中详情显示 run/会话；轮询/事件后刷新 | `run show`、`events list/watch` | `babel/tests/domain-lifecycle.test.ts`、`tui-lr03.test.ts`；宿主 `babelRunActions.events.test.tsx` 有跨端刷新和过期响应测试。**下一步**：将独立 `tool.started/tool.finished` 事件接成一致的可浏览工具轨迹；真实窗口/PTY 检查滚动、长日志、事件顺序与同一 run 身份。 |
| **09 补充消息、待答请求** · 部分实现 | 运行页区分消息草稿与按 requestId 回答；旧 run 只读 | `m` 消息表单，在待答时使用 `run.respond` | `run message`、`run respond --request` | `babel/tests/domain-lifecycle.test.ts`；本轮 `domain-recovery.test.ts` 验待答不自进、回复后保留接受/执行/验证检查点。**下一步**：原生 GUI 与真实 PTY 双向发送/回答，保留草稿、拒绝重复回答，补切任务时在途请求不串目标的原生验收。 |
| **10 取消、终止核对** · 部分实现；M0-10a 开发完成、待独立验收 | 运行页/工具栏取消→`run.cancel`；已补 lost/cancel_requested 核对结果选择与二次确认 | `c` 取消确认；核对菜单补两种待核对状态，冻结目标与 revision，取消不提交 | `run cancel`、`run reconcile`；已补 CLI revision/幂等透传及核心只读/版本守卫 | 原有守卫及恢复测试保留；本轮范围、开发与验收分别见 [TASKS M0-10a](../TASKS.md)。**下一步**：固定本轮提交后真实 Mac GUI/PTY 复验取消确认、状态变化/只读/过期拒绝、未核对禁止重试/归档，确认后允许新 run。新增定向测试不能替代独立验收。 |
| **11 差异、产物、结果** · 部分实现 | 原生审查页展示模拟基线、patch/文件摘要与产物列表 | `d` 差异文本；未见独立完整产物浏览/下载/导出入口 | `diff get`；底层查询命令 `artifact.list`，尚非完整下载合同 | `babel/tests/domain-lifecycle.test.ts`；当前是模拟 diff/产物。**下一步**：补 TUI/CLI 产物导出及真实文件权限、稳定身份/版本校验；原生逐文件审查与终端结果等价验证，不把模拟基线叫真实 Git 差异。 |
| **12 验证、接受、要求修改** · demo 子路径通过 | 审查页验收项、接受与要求修改，公共 capability/revision 守卫 | `v` 验收确认；菜单“要求修改”目前使用固定说明 | `review accept`、`review request-changes` | `babel/tests/guards.test.ts`、`domain-lifecycle.test.ts`；Mac `three-surfaces.spec.ts` 覆盖 GUI/PTY/CLI 验收。**下一步**：TUI 可编辑修改说明；补缺证据、人工身份、豁免、verified_auto 等完整策略矩阵的三端实际输入，不能仅凭进程退出或 Hook 成功完成。 |
| **13 重试、新执行** · 部分实现 | 运行页失败/取消后“重试”→`run.retry` | `s` 可发起新 `run.start`；未见独立 retry 菜单或完整新执行摘要 | `run retry`、`run start` | `babel/tests/domain-lifecycle.test.ts` 验同 Tracker 新 run；`guards.test.ts` 验失联/取消待确认不可再开。**下一步**：补 TUI 可发现重试入口与摘要；GUI→PTY 重试后 CLI 比较 attempt/runId 和旧证据保留。 |
| **14 完成、归档、恢复** · demo 子路径通过 | 看板 Portal 菜单及原生 `archive-item`，恢复不重跑 | `a`/`r` 确认菜单 | `task archive/restore` | `babel/tests/archive-closed-loop.test.ts`、`fault-restore.test.ts`；Mac `archive-native.spec.ts`、三端闭环已证明相关路径。**下一步**：真实 PTY 归档/恢复、全部 native 右键/批量入口和未终止拒绝路径逐项交叉验证。 |
| **15 历史、旧 run、讨论** · 部分实现 | 历史页分类展示活动/评论/run，旧 run 切换只读；原生 add-comment→`comment.add` | `h` 历史文本；未见旧 run 详情选择和新增讨论表单 | `history get`、`run list/show`、`comment add` | `babel/tests/domain-lifecycle.test.ts` 验讨论不混入运行消息；宿主 `babelWorkbenchDrafts.test.ts` 验查看旧 run 的状态边界。**下一步**：补 TUI 旧 run/评论入口，原生 GUI 和 PTY 切历史后不能把写操作发给旧 run。 |
| **16 草稿、冲突、拒绝/只读** · 部分实现 | workbench 按 endpoint + projectId + trackerId 保存消息/回复/审查草稿；标题/正文/基础字段草稿按记录隔离；版本冲突保留草稿并提供采用远端/重定基线后显式保存 | 编辑冻结目标与 revision；正文/字段拒绝保留浮层输入；终端完整冲突解决交互未验完 | 结构化错误、revision、幂等、可重试标志 | `babel/tests/guards.test.ts`、`edit-revision-closed-loop.test.ts`、`fault-contract-replay.test.ts`；宿主 drafts/events 测试。**下一步**：真实双端制造过期保存，检查中文草稿、字段、选区不丢，提供重新加载/保留修改的可操作路径。 |
| **17 快照、断线、重连** · 部分实现；demo 崩溃恢复已补强 | 共享源 snapshot + EventSource；本轮关注投影保留最后快照并拒绝过期响应；显式 `reconnect` 适配命令仍未实现 | HTTP 查询/事件续读和 resize/reconnect 逻辑 | `events list/watch --after`、查询同一服务 | `babel/tests/events-auth.test.ts`、`hooks-delivery.test.ts`、`tui-lr03.test.ts`；本轮新增真实 SIGKILL/HTTP 恢复，见下节。**下一步**：真实 GUI/PTY 网络断连、事件重复/游标过期、后台重启后的选择/草稿/TTY 恢复；生产 Worker 崩溃恢复另验。 |
| **18 demo 初始化、注入、重置** · 部分实现 | 精确 demo workspace/profile 路由；未见原生开发场景注入/重置操作面板 | 明示 demo；未见完整场景注入/重置菜单 | `demo inject`、`demo reset`；服务首次初始化 fixture | `babel/tests/profile-init.test.ts`、`domain-lifecycle.test.ts`、`events-auth.test.ts`；宿主 `babelDemoWorkspace.test.ts`。**下一步**：补明确隔离的 GUI/TUI 开发入口，三端验证只重置指定 demo profile、不会读写真实用户数据。 |
| **19 权限、可用能力、禁用原因** · 部分实现 | 公共 capabilities 驱动运行操作；不支持宿主写入明确拒绝，不回退真实 IPC | `actionAllowed` 和错误提示；仍需遍历全部菜单与三端能力集合 | `capabilities`、公共鉴权/错误码/完成守卫 | `babel/tests/guards.test.ts`、`idempotency-auth.test.ts`、`events-auth.test.ts`、`fault-contract-auth.test.ts`；宿主适配测试。**下一步**：原生全部正文/字段/批量/拖拽/右键路径与同一拒绝合同对照；生产身份、MCP、真实多客户端是后续门槛。 |
| **20 Hook 配置、校验、投递** · 部分实现 | 未见挂载到原生宿主的 Hook 设置/投递管理界面 | `g`/菜单列 Hook、登记、重试；登记须服务权限 | `hook list/register/retry`；公共 beforeCommand、outbox、投递记录 | `babel/tests/hooks-outbox.test.ts`、`hooks-delivery.test.ts`、`regression-lr17-hooks-faults.test.ts`、`tui-lr03.test.ts`；均是隔离合成 Hook。**下一步**：补原生 Hook 界面和安全的隔离登记流程；真实 GUI/PTY 验拒绝/超时不提交、重试只投递、不重放业务。Pi/Codex 示例不算厂商接通。 |

表中列出的 Babel 测试文件在本轮 `babel-full.log` 有对应通过记录，或属于此前已登记的定向证据；该日志不能替代原生输入测试，也不用于本表宣告最终整仓门禁。宿主测试与 E2E 是否已覆盖最新工作树，以主控最终集成证据为准。

## 本轮可独立核对的增量

### WD02：需要关注投影

- 公共状态集合精确为 `waiting_input / failed / lost / review_required`；归档不进入关注计数，原有四阶段不变。
- `task.list` 支持 `attentionOnly:true`，与项目、类型、设备、搜索、保存视图相交；CLI `--attention-only` 和 TUI `!` 使用同一投影。
- 原生 [BabelAttention](nimbalyst/packages/electron/src/renderer/components/TrackerMode/babelWorkbench/BabelAttention.tsx) 定位原记录。`TaskCard.lastUpdatedAt` 取同项目/Tracker/run 最高 seq 的权威事件时间，缺事件回退 run 结束/开始时间，无 run 回退条目更新时间。它是最后观察到的业务更新，不是设备心跳。
- `babel/tests/wd-attention.test.ts`、`tui-lr03.test.ts` 及宿主 `babelAttention.test.tsx`、`BabelExecutionBoard.menu.test.tsx` 有定向通过日志；`attention-before.log`、`attention-pending-before.log` 保留失败证据，后续结果见 `attention-after.log`、`attention-pending-after.log`、`attention-location.log`。
- `electron/e2e/babel/attention-native.spec.ts` 本轮 Mac 原生 1 项通过，覆盖等待输入、待验收、验证失败场景与失联注入、同记录键盘定位、普通 TODO 排除、CLI 同源；30 次中文标题更新的请求发出至匹配 DOM 可见 p95 上界约 **228 ms**（此前两轮约 121/207 ms）。该测量包含传输与定位等待，来自 demo；不是 GPU 帧时延、生产延迟或 WD02 全条件的通过结论。证据为 `e2e-integrated-final.log`、`attention-evidence.json`、`attention-native.png`。
- 原生及真实 PTY 最终集成结果见 [TASK_EVIDENCE](../TASK_EVIDENCE.md)；服务断连后的完整原生输入路径尚需补齐。

### demo 服务崩溃恢复

- [domain-recovery.test.ts](nimbalyst/packages/babel/tests/domain-recovery.test.ts)：先观察重启停滞，再修复。9 个隔离用例覆盖 accepted/executing/verifying 检查点、答复后继续、幂等重试、原 run 身份、fixture 不自进、simulate=off、待答/取消待确认/失联保持。初始红例及答复检查点红例保存为 `domain-recovery-before.log`、`domain-recovery-answer-before.log`；绿例为 `domain-recovery-after.log`。
- [server-crash-recovery.test.ts](nimbalyst/packages/babel/tests/server-crash-recovery.test.ts) + [recovery-server.ts](nimbalyst/packages/babel/tests/fixtures/recovery-server.ts)：真实 Node 子进程、随机回环端口和临时 profile，经 HTTP 创建/启动任务，在 executing、verifying 两处 SIGKILL，再用同一 profile 的新 PID 恢复。**2 项通过**。
- 已断言同一 trackerId/runId/session/fence、已有事件前缀保持、接受/开始/消息/工具开始/工具结束/验证事件各一次、无第二个 run、固定展示 fixture 不推进。最终为 `review_required`，条目仍 RUNNING/outcome unresolved，不自动 DONE；子进程和监听已清理。日志：`server-crash-recovery.log`。
- 这补齐了旧 [ACCEPTANCE](ACCEPTANCE.md) 中“demo executing/verifying 服务重启”缺口的一条可重复证据。它不是真实 Pi/Worker 的进程接管、任务恢复、SSH 重连或生产数据库灾难恢复；也不能替代 GUI/TUI 断线后的草稿、选择与焦点验收。

## M0 接下来可派发的验收动作

1. **原生编辑与跨端冲突**：同一条目用 GUI 改正文/字段，PTY 改标题/依赖，CLI 读回；刻意提交旧 revision，验证拒绝与草稿保留。覆盖 CAP-04/05/16/19。
2. **运行控制与历史入口补齐**：GUI/TUI 的取消待确认核对、重试摘要、旧 run 只读查看、讨论、产物路径；每个新增操作同时有明确命令和真实输入。覆盖 CAP-07/09～13/15。
3. **排序、视图、Hooks、demo 工具入口**：优先补表中未发现的原生/终端入口，再跑“GUI 命令→PTY 操作→CLI 查询→关联事件断言”，不以三端共同禁用结项。覆盖 CAP-02/06/18/20。
4. **断线与终端恢复**：网络中断、服务强杀重启后，真实 GUI/PTY 重连，检查同 run、事件去重、最后更新时间、草稿/选择、鼠标捕获和光标恢复。覆盖 CAP-01/08/17。
5. **集成门禁与逐项签收**：主控在固定最终提交上记录本轮完整检查、未通过项和平台范围，再更新根能力矩阵。最终全量数字以 [TASK_EVIDENCE](../TASK_EVIDENCE.md) 为准，也不把 M0 局部通过外推为 M1/M2/M3、Windows/Ubuntu 新回归或可发布安装包。

真实本机服务控制另依 [SYSTEM-CONSOLE-ACCEPTANCE](SYSTEM-CONSOLE-ACCEPTANCE.md) 按 SYS-01～09 验收；历史 Windows 隔离服务/ConPTY 的通过不覆盖任务 demo，任务 demo 通过也不覆盖 Mac launchd、自启动、权限或真实 GitLab/DUFS 操作。

## M0-04b 基础字段增量（2026-09-16）

原生 GUI、真实 PTY 与 CLI 已完成优先级/中文负责人/标签同记录保存与读回的开发者实操。共享核心拒绝缺失/非法/旧版本和非法字段类型；适配器投影 owner/tags、拒绝未知字段，单条与批量基础字段命令均要求版本。批量预检只保证输入格式先检查，跨记录提交仍非原子操作。

原生复用宿主字段控件，先保留会话草稿再明确保存，GUI 冲突需明确选择；其他关系/类型/自定义字段入口暂只读。精确范围、独立验收操作与最终检查见 [TASKS M0-04b](../TASKS.md) 和 [证据](evidence/m0-04b-20260916/validation.json)。本增量不把完整 CAP-04/05/16 标为通过。

## M0-05a 双向依赖与阻塞增量（2026-09-16）

relation.set 现在校验正整数版本、ID 数组、自关联、同项目目标、循环及每个实际受影响的只读端点；所有拒绝在关系变更前发生。dependsOn/blocks 增删同步两个方向，变化端点各递增记录/binding revision、更新时间并发出关联 task.updated；无变化不更新版本或事件。创建时注入非空关系及普通字段更新关系明确拒绝，需先创建记录再走专用关系命令。

原生复用关系 pill/候选选择器，先保存会话草稿再明确提交，冲突显示远端标题与 ID。TUI l 固定原目标/版本，拒绝保留表单，重复保存受保护；CLI 明示版本参数。辅助独立 GUI 的原有依赖保存也补传草稿版本，但不拿它代替原生验收。适配器保存后主动刷新所有变化端点，不只依赖 SSE。

具体边界、独立验收步骤与最终证据见 [TASKS M0-05a](../TASKS.md)、[validation](evidence/m0-05a-20260916/validation.json)。只覆盖依赖/阻塞，完整 CAP-05/16/19 与 M0 仍未宣告完成。
