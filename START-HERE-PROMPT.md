# 发给开发 Agent 的提示词 · v2.3

## 当前开发方向（2026-09-16）

后续主开发与原生桌面验收平台为 **MacBook M3 / macOS**，执行 [macOS 开发交接](MACOS-DEVELOPMENT-HANDOFF.md)。Windows 历史路径/阶段顺序不覆盖此决定；保留 Windows/Ubuntu 的适配与回归要求。Wayland 指 getwayland.com 的 AI 工作台，对标以 [Wayland / Devin 指标](WAYLAND-DEVIN-BENCHMARK.md) 为准。已有实现继续收口，不重新制作另一套独立看板；历史测试通过不代表 macOS 已验收。

本提示词与主 SPEC、Trackers 映射、TUI/Hooks 契约及功能矩阵同步。旧版在 reference/v2.2；本轮修改规格不代表已经开发应用。

```text
请在 macOS 的巴别塔仓库检出目录继续开发现有产品，建议 ~/Projects/babel。
先读 TASKS.md，选择尚未完成的任务 ID；开发后登记实现与自测，验收会话检查真实程序后再勾“验收通过”，附提交、平台和证据。两个标记分开，部分通过不勾整行。
先读 MACOS-DEVELOPMENT-HANDOFF.md 和 WAYLAND-DEVIN-BENCHMARK.md。资料留在根目录，源码在 implementation/nimbalyst/，依赖和独立 profile 使用本机配置路径。
以当前验收记录确定缺口，不把下面历史 M0 的实施顺序当成重写现有功能的要求；目标是成品，演示验收与真实能力分别登记。

当前开发由 UI/UX 主导场景和交付顺序。先读 design/visual-contract.md、design/UI-VISUAL-PLAN.md：设计与 Mac 运行基线并行，先精修 V01 首页和 V03 运行详情的正式组件，浅色磨砂为主稿、深色同步适配，再按 V02/V04/V05 扩展状态和相关业务。每个切片同时交付美观、交互与业务证据；不等全部后台完成才开始设计，也不另建独立展示产品。

先读 AGENTS.md、README.md、NIMBALYST-DEVELOPMENT-SPEC.md、NIMBALYST-TRACKER-MAPPING.md、NIMBALYST-TUI-HOOKS-SPEC.md、CAPABILITY-MATRIX.md，再按需读 design/ 和 skills/SKILLS-GUIDE.md。按当前 v2.3 开发，reference/v2.2 只是历史快照。

核心要求：每项新增业务能力都要有 GUI、交互式 TUI、非交互 CLI 和适当的 Hook 扩展/观察路径。先定义公共命令、查询、事件和业务服务，再开发各端适配；不要把业务写死在 GUI 按钮里。功能对等指相同输入、权限和业务结果，界面不必像素相同。

Nimbalyst 是桌面宿主。保留它的 Trackers、文档、会话、差异和主题；TUI 真正支持选择、编辑、菜单、运行控制、消息、差异和历史，不是仅打印日志或打开网页。CLI 供模型稳定调用，提供 JSON/JSONL、明确错误码和退出码、revision 与幂等键；不要让模型解析彩色终端文字才能自动化。

关闭桌面窗口后，TUI/CLI 仍能连接独立非图形服务完成业务，不依赖 Electron renderer、DOM 或显示服务器。关闭 TUI 或断开 SSH 不取消 run，重连恢复原执行。三个入口共享权威数据和命令守卫，不各存一份任务。

原生 Trackers 与执行看板保持同一 (projectId, trackerId)，重试有新 runId。同一 GUI 工作区两视图共用 provider；不同进程的 TUI/CLI 各有适配实例，连接同一服务。保留 Ready、自定义类型和保存视图；Releases 不是归档，approved 不是完成，创建 Session 不是开始执行。

Hooks 必须进入架构与测试合同：beforeCommand 是受控校验；提交后事件经持久 outbox 分发，支持 eventId 去重、游标续读、有限重试和因果关联。Hook 失败不重跑原业务，脚本退出码0或收到 run.finished 都不能直接判定 DONE。Hook 动作仍走同一权限和完成守卫，不能冒充人工接受。Codex/Pi 的专用 Hook 作为适配器，不绑死核心。

按 NB-00 核实源码、许可、构建、Electron 耦合和功能矩阵；NB-01 定义三端与 Hook 契约；NB-02～04 完成共享核心、CLI 首个闭环、GUI/TUI 及模拟 Hooks。保留已有安装、工作树和用户数据。当前没有运行命令时应实现它，不把规格里的 babel 命令示例声称为现成工具。

参考 MULTI-AGENT-PLAN.md 的合同与文件归属原则。当前 UI 切片按主控/设计负责人、前端、宿主/数据集成、独立验收分工；新增业务仍补齐 TUI/CLI/Hooks。先稳定场景和公共接口，再派发独占文件；Schema、lockfile、材质 API、迁移及最终集成由主控统一处理。需要独立运行环境的工作包使用独立worktree、端口和demo profile，最终三端接同一集成demo服务验收。不要把全部NB串行执行，也不要让多个Agent同时改同一文件。工具不支持并发子Agent时如实说明并沿同一依赖图顺序执行。

M0 不用 API Key、不读取真实凭据、不连接真实设备、不启动真实 Agent。三端共用独立 demo 服务和固定 fixtures；界面/输出明确标演示。完成新建、编辑、模拟启动、等待输入、取消、验证、验收、归档、恢复、差异与历史。未适配入口不得回退真实 IPC/MCP；禁用表示未完成，不算功能对等。

GUI 保持左侧丰富、中央简洁四列、右侧选中详情；TUI 按终端宽度使用看板/列表和详情，鼠标有键盘等价路径。测试中文、resize、窄终端、重连和退出恢复。每项新增能力更新 CAPABILITY-MATRIX，视觉限制明确登记，不宣称整个上游所有功能已经完全终端化。

GUI 复用 --nim-* 与现有组件，CSS 磨砂用于侧栏、顶栏、详情外框和浮层；正文、代码、日志及普通卡片稳定清晰。simple-liquid-glass 仅为小面积折射候选，先与 CSS 基线做原生可读性/输入/性能小样；默认关闭鼠标跟随、弹性位移、涟漪，不引入整窗 WebGL 或背景截图链路。材质不变形文字、焦点、点击区域，不接管业务命令或破坏 Portal。提供运行中减少动态效果、关闭透明度与无模糊回退。

Windows 的技能安装记录不能证明 Mac 已安装；核对实际资源再用。Open Design 只读参考，ui-ux-pro-max 的 catalog-only 入口不代表完整搜索可用。技能、React 依赖与视觉效果分开验证，缺少可选技能不阻塞现有组件设计。

自动化用“CLI/API命令 → correlationId关联事件 → 权威状态查询 → 断言”。验证 GUI创建、TUI修改、CLI查询、三端交叉运行控制始终同一记录；测试Hook重复/乱序/超时/崩溃、越权和伪造完成。另用真实GUI操作与PTY/ConPTY测试TUI输入；CLI或Hook通过不能替代交互验收。

以 MacBook M3 的真实 Electron 窗口验收 UI，浏览器预览只辅助调试；截图附提交、fixture、主题、视口/缩放、材质与回退状态。覆盖浅深主题、宽窄窗口、中文输入、焦点与异常恢复，保存 CSS/折射对照及资源测量。旧 babel-dashboard-v2.png 只作结构方向参考；新母版未经用户实际审阅不得标为 accepted-baseline，自动评分不能代替审美反馈。

交付源码、独立服务/GUI/TUI/CLI启动命令、Hook示例、功能矩阵、实际截图和逐项验收记录。明确区分结构检查、构建、demo、真实设备；不要只给方案或把效果图当实现。正常推进已授权的可逆开发步骤，不重复询问常规细节。M0完成后启动GUI和TUI供我体验；真实后台与多设备接入留下一阶段。
```
