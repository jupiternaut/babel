# macOS UI/UX 首轮实施证据

最新接续：本文件按轮次追加；当前任务的开发/验收双标记见 [TASKS](TASKS.md)，最新结果在文末。历史通过不覆盖后续未验收的新代码。

日期：2026-09-16。下文“首轮”保留历史测试失败；最新修复与门禁结果见文末“持续迭代”。首轮交付为可运行的 Mac 开发入口与原生工作台视觉候选，不代表 M0 全部能力或发布验收完成。

## 环境与边界

- 工作目录：`/Users/gengrf/Projects/babel`；分支：`ui/macos-glass`。
- 基线：`6568dc00f4fb6a20d828542b4a6694be854aa3e0`；新检出时工作树干净。此段记录首轮提交前快照，后续交付状态见文末。
- 宿主：`implementation/nimbalyst`，沿用 Electron / React / TypeScript / Vite 和原生 TrackerRecord。
- 本机：Apple M3 / arm64 / macOS 27.0 (26A428)，Xcode 已选中。
- 工具链：`/opt/homebrew/opt/node@24/bin`，Node 24.15.0 / npm 11.12.1；Electron 43.2.0 / electron-vite 4.0.1。未修改全局 shell 配置。
- 日志根：`/Users/gengrf/Library/Logs/Babel-Dev/macos-ui-20260916/`，下文证据文件名均相对此目录。
- 最终改动文件与截图的 SHA-256 清单：日志根下 `source-manifest.json`，用于识别这次未提交工作树快照。
- 手工基线 profile：`~/Library/Application Support/Babel-Dev/macos-ui`；脚本实测 profile：`~/Library/Application Support/Babel/mac-glass-script-20260916`。
- 两个 profile 均独立保存 demo / Electron / system 数据；宿主仍会检测本机已有 CLI 账号，不等于整个宿主与账户环境完全隔离。
- 未执行真实 Agent 任务、OAuth 授权、SSH 或生产服务写入；业务验收使用演示数据。未修改 Open Design 或全局技能配置。

## 首轮变化

1. 新增 `scripts/dev-macos.mjs start|status|stop` 与行为测试：固定 Node 24，验证进程身份及回环监听，隔离数据，保留 profile。纠正首次构建顺序：workspace-deps → runtime → memory engine → workers。
2. 视觉合同更新为候选 v3：浅色磨砂优先、深色继承宿主主题、正文清晰，侧栏/详情/菜单具有玻璃层次。旧 v2 仍只是历史参考。
3. 改造现有 Babel 导航、看板和详情。Floating UI Portal 菜单修复裁切、Escape 焦点恢复与菜单内 N 误触发，不改变共享业务模型。
4. 精确锁定 `simple-liquid-glass@5.3.0`，仅在当前导航项提供可选 SVG 装饰层；默认 CSS 磨砂。实验开关 `VITE_BABEL_GLASS_REFRACTION=true`。正文与交互位于独立稳定层，偏好变化实时回退。
5. 原生 E2E 修正 Windows 快捷键/ConPTY 假设，新增材质与输入保持检查，只附着显式指定的隔离实例。

## 首轮已验证结果

| 检查 | 实测结果 | 日志/证据 |
|---|---|---|
| 全新依赖安装 | 根与 Babel 包 npm ci 成功 | `npm-ci.log`、`babel-npm-ci.log` |
| 共享模块与 worker 构建 | workspace-deps / runtime / memory engine / workers 均成功；第一次 runtime 构建顺序错误已纠正 | `workspace-deps-build.log`、`runtime-build-retry.log`、`memory-engine-build.log`、`worker-build.log` |
| 原生 UI 改前基线 | 真实 Electron 窗口已观察、留图 | `screenshots/baseline-light.png` |
| Mac 启动器 | start、status、正常退出后 stop 成功，状态回报 not-running；4 项行为测试通过 | `launcher-start.log`、`launcher-status.json`、`launcher-stop.json`、`launcher-tests.log` |
| 窄/宽与浅/深主题 | 原生窗口 zoom、窄窗口及实际宿主主题菜单检查完成 | `screenshots/light-detail.png`、`screenshots/dark-detail.png`、`e2e-archive-v3/` |
| 菜单交互 | 新增 4 项针对性测试通过，保留改前失败 | `menu-tests-before.log`、`menu-tests-after.log` |
| 玻璃组件 | 新增 5 项通过：偏好变化、输入/选区/焦点、监听清理、iOS 回退 | 全量单测包含这些用例，无新增用例失败 |
| CSS 材质原生检查 | 20 次菜单开关、中文输入、运行中 reduced-motion / reduced-transparency / forced-colors 回退通过；菜单无残留 | `e2e-glass-css.log`、`e2e-glass-css/**/materials.json` |
| SVG 小样及最终整合 | 最终同轮归档/恢复、材质回退、三端生命周期 3/3 通过；同样完成 20 次菜单开关 | `e2e-final-svg.log`、`e2e-final-svg/**/materials.json` |
| 恢复默认材质 | 默认 CSS 重启后材质用例再次通过，20 次菜单开关无残留；原生浅色窗口保持开启 | `e2e-final-css.log`、`launcher-final-status.json`、`screenshots/final-light.png` |
| 归档/恢复 | 保持 record 与 run 绑定，原生菜单和响应式检查通过 | `e2e-archive-v3.log` |
| GUI / CLI / TUI | 同一中文任务与 trackerId/runId，真实 Mac POSIX PTY；关闭 GUI 后服务继续，可由 TUI 验收 | `e2e-three-surfaces.log`、该输出目录下 `identity.json` / `pty.txt` |
| 类型检查 | 26 个工作区全部通过，Babel 单独 typecheck 通过 | `typecheck-all.log`、`babel-typecheck.log` |
| 整仓单测 | 14055 通过 / 19 失败 / 26 跳过，1674 文件；仅运行一次全套 | `test-prepush.log`、`test-prepush-failures.log` |
| Babel 单测 | 243 通过 / 9 失败 / 4 跳过 | `babel-tests.log` |

CSS 测量的实际主题为 light、viewport 1710×1010；导航 backdrop 为 `blur(12px) saturate(1.1)`，没有 SVG filter 或 canvas。20 次菜单开/关往返中位数约 102ms、p95 约 145ms，含自动化等待且当时并行运行全量单测，不能用作 GPU 帧时延或性能达标结论。

SVG 小样实测 `svg / native-svg`，186×32 CSS px，位移图已生成，浏览器 computed backdrop-filter 包含实际 SVG filter URL；没有 canvas，20 次菜单开/关后仍只有 1 个 filter、0 个菜单。相同导航项的两张 `surface.png` 已目视对照：主要差异是高光与边缘，纯色背景上的折射收益不明显，因此保持默认 CSS。SVG 轮菜单往返中位数约 50ms、p95 约 63ms，但其时全量单测已结束，且 viewport 为 1400×900，不能据此声称比 CSS 更快。未做 GPU/功耗/持续帧率定量验收。

最终实例保持运行，`experiments.glassRefraction=false`。监听核验：Babel `127.0.0.1:7780`、Vite `[::1]:5273`、CDP `127.0.0.1:9223`。最终画面为 7 条演示记录：5 条固定 fixture 加上三端验收创建并完成的 2 条，保留证据，不假装仍是初始五条快照。

## 首轮未通过项与后续门槛

- Babel 的 9 失败：8 项依赖基线未包含的 Windows `implementation/verification/lr-20260914-1107/install-restore/dry-run-check.mjs`；1 项在 Mac 模拟 Windows 时使用宿主 `path.isAbsolute`。相关源码与固定基线一致，未跳过测试掩盖问题。
- 整仓 19 失败分类：宿主路径假设 1、tutorial CRLF 1、marketplace 脚本可执行位 3、marketplace 导入 4、RevoGrid 配置解析 CRLF 2、animation 样本 CRLF 3、canvas 文档 CRLF 2、大文档 Diff 格式规范化 3。9 个失败测试和 26 项关键源码/fixture 均逐字节等于 HEAD；既有依赖版本未变。marketplace 导入 4 项的 CRLF shebang/SSR 原因尚属高可信推断，未定向重跑证实。文件未改不等于复跑干净基线，不宣称全仓无回归。全量完成后仅 E2E 测试与文档继续更新，此结果是当次快照。
- SVG 候选路径已验证，可见折射收益尚不足以进入默认界面；功耗与帧率需进一步测量。
- 中途 macOS 锁屏及首次引导遮罩造成一次 SVG 测试超时；用户手动解锁后补全引导前置步骤，最终整合 3/3 通过。没有接受服务条款或调整工作区信任。
- 没有签名、打包、公证、发布、Windows/Ubuntu 回归或真实远端 Agent 验收。减少透明度现有证据为 Chromium media emulation 和组件事件测试，未人工切换真实 macOS 系统设置。
- 当前为视觉候选，用户尚未对真实界面给出最终美术批准。

## 复现

```sh
cd /Users/gengrf/Projects/babel
/opt/homebrew/opt/node@24/bin/node scripts/dev-macos.mjs start --profile "$HOME/Library/Application Support/Babel/mac-glass-script-20260916"
/opt/homebrew/opt/node@24/bin/node scripts/dev-macos.mjs status --profile "$HOME/Library/Application Support/Babel/mac-glass-script-20260916"
```

正常结束先在开发宿主 Cmd+Q，再运行同入口 `stop`。脚本 stop 是受管进程清理，不等同于正常保存/checkpoint。详见 [Mac 交接](MACOS-DEVELOPMENT-HANDOFF.md)。

原生测试从 `implementation/nimbalyst` 执行，显式设置 `BABEL_ACCEPTANCE_CDP=http://127.0.0.1:9223`、`BABEL_ENDPOINT=http://127.0.0.1:7780` 及对应 demo 的 `BABEL_PROFILE`，每次单 worker。`three-surfaces.spec.ts` 会关闭工作窗口，应最后运行。


## 持续迭代：M0 关注、编辑与恢复

本节记录同一基线上的后续增量。开发分支仍为 `ui/macos-glass`，提交目标为 GitHub `acceptance/m0-native-20260916` / Draft PR #1；不合并 main 或发布安装包。最新分项状态见 [CAP-01～20](implementation/M0-CAP-STATUS.md)。

日志根：`/Users/gengrf/Library/Logs/Babel-Dev/m0-iteration-20260916/`。可移植性修复及运行草稿 red/green 日志保存在上一节日志根；原生标题定向 red/green 为本机 `/tmp/babel-title-*.log`，已复制至本节日志根。

### 行为变化与证据范围

- GUI、TUI 和 CLI 共用需要关注的判定：waiting_input、failed、lost、review_required，排除归档且保留四阶段。GUI 由原 ID 定位任务，在窄布局同步切到所在阶段；卡片采用权威事件最后更新时间。设备/项目查询切换期间不泄漏上个范围，断线保留最后快照并说明过期。
- demo 服务恢复依照已持久化的接受事件和检查点，恢复 accepted/executing/verifying；fixture、等待回答、失联和取消待确认不擅自推进。真实 Node 子进程在执行/验证时被 SIGKILL 后由新 PID 读取原 profile，run/session/fence 和事件保持，最终停在待人工验收而非自动完成。此处不是 Pi 真实任务恢复。
- 原生 Babel 标题显式保存，固定草稿开始时 revision；干净标题随跨端更新，冲突保留中文草稿并显示远端值。允许采用远端或显式选择新基线后继续编辑。非 Babel 原有自动保存行为保留。标题、消息和旧 run 选择缓存按 endpoint/project/tracker 隔离，草稿跨条目切换与详情重挂保留。
- 修复 Mac 上旧测试的宿主安装路径假设、CRLF 文本/可执行脚本和样本、Windows 路径模拟；补回缺失的只读安装路径检查器。保留 Windows 专项跳过，不放宽业务断言或跳过失败测试。
- 执行看板复用宿主 Open/Closed、Saved View、字段/标签/来源及搜索过滤，工具栏与看板使用同一计数；原生状态/搜索交叉查询已经通过。补同任务在途请求跨切换防重与项目全量设备统计，22 项定向红绿验证通过。

### 当前阶段边界

本轮均使用明确指定的隔离 demo profile 和原生开发窗口。未读取其他项目 API Key，未消费 Pi 模型额度、连接 OAuth/SSH 或改变 GitLab、DUFS、代理状态。Pi 0.84.1 已在本机找到并核对版本；命令存在不等于 Babel 真实执行接入完成。

完整 M0 仍有正文/字段及关联编辑、TUI 缺失操作、Hook 原生管理、产物导出和断线真实输入验收等缺口。M1 真实 Pi、M2 远端设备/Google、M3 PDF 与移动端尚未交付；Windows/Ubuntu 新回归、Mac launchd 自启动、签名/公证/安装包及最终美术签收也未完成。

### 最终集成验证

- 类型检查：最终源文件下 26 个工作区通过，`typecheck-integrated.log`；Babel 独立 typecheck 通过（`babel-typecheck.log`）。
- Babel 全量：61 文件，271 通过 / 4 跳过 / 0 失败（`babel-full.log`）。包含真实子进程 SIGKILL 恢复 2 项。
- 新增及修改路径的行为测试：标题 12 项、在途请求/导航 22 项、执行筛选及既有投影 25 项均通过；各失败 red 记录与修复 green 记录保留。启动器 4 项通过。
- 原生 6 类验收已通过：归档恢复、关注视图、筛选及计数、玻璃/无障碍回退、标题/冲突/切任务保草稿、GUI/CLI/真实 POSIX PTY 同源生命周期。最终结果分别见 `e2e-integrated-final.log`（前 4 类）、`e2e-title-integrated.log`（1 项）及 `e2e-three-surfaces-final.log`（1 项）。结构化 JSON 与截图在 [Mac 证据目录](implementation/evidence/macos-20260916/README.md)。
- 原生标题整合时曾发生测试检查按钮 enabled 后按钮被正确禁用的竞态；改为等待冲突提示并断言按钮禁用后通过，未绕过禁用或放松数据不覆盖断言。archive/three-surfaces 的窗口匹配排除了 menu-bar-island 等辅助页。HMR 重新显示引导造成的超时保留，测试明确暂缓信任设置后完成，没有确认服务条款。
- 30 次关注标题更新最终 p95 请求至 DOM 观测上界约 228ms，含并发类型检查/单测负载；此前约 121/207ms。不能由不同负载样本推导材质更快、GPU 帧率达标或生产延迟结论。
- 第一轮整仓集成：1676 文件，14111 通过 / 7 失败 / 26 跳过（`test-prepush.log`），7 项都是 20 秒超时，位于 4 文件。类型检查和 E2E 同时运行。结束并行负载后，原规则下这 4 文件 248/248 通过（`timeout-targeted.log`），未改测试超时或跳过规则；随后独立全量通过：**1669 文件通过 / 7 文件跳过；14118 项通过 / 26 项跳过 / 0 失败**，耗时 348.73 秒（`test-prepush-final.log`）。没有为此修改代码、提高超时或新增跳过。
- 三端测试关闭了原生项目窗口，独立 Babel 演示服务继续运行；测试确认原 run 继续到待验收，并由 PTY 显式验收。未声称最后仍显示某个固定界面或初始五条记录。

### 下一次接续

1. 按 CAP 表补可达的 `run.reconcile` GUI/TUI、TUI 重试/修改说明/历史讨论和 Hook 管理，再验正文/字段/关系编辑、断线后的草稿与选择。
2. 完整 M0 收口后再接真实 Pi。只读核对显示现有 Worker 拒绝真实 Pi 协议且路径固定 Windows；厂商合成信封也不是 Pi 原生 RPC。首片应为明确 provider/model、隔离 profile 与单个文本任务，将唯一 runId、Pi session、原始事件及产物 SHA-256 接回共享核心；接受请求、执行结束、验证和人工验收分别保留。真实账号和额度授权仍待用户回答，不读取其他项目凭据。
3. 延续 Mac 主开发、UI/UX 与可读性优先、Windows/Ubuntu 回归职责，保持 Draft PR，未验条件不标完成。

最终文档完整性检查通过；本批候选提交仍保留完整产品未验项。PR：[jupiternaut/babel #1](https://github.com/jupiternaut/babel/pull/1)。提交内容含可移植的原生截图与验证 JSON；本机原始日志不入库。


## TASK 双标记与 M0-10a：核对执行

日期：2026-09-16；基线 `44683aa04c43d4a26eaefcf19c6554a0f9ed9640`；cwd `/Users/gengrf/Projects/babel`，分支 `ui/macos-glass`；开始时工作树干净。上游 MIT 许可及现有 Electron/React/TUI/CLI 结构保持不变。

用户要求已落到根目录 TASKS：49 个稳定任务 ID，分别记录开发完成、验收通过、具体功能及操作条件；AGENTS、README、启动提示词均指向该入口。基线实测子路径单列，部分实现与完整 CAP 不混算；本轮新增功能的独立验收保持未通过标记。同步纠正 Mac 交接、WD 对标和视觉合同中落后于已提交证据的总括状态。

本轮 M0-10a 行为：

- GUI：当前 lost/cancel_requested 执行可选择“已取消/失败”，经明确二次确认再提交；返回/Escape 不写入，初始焦点与返回触发按钮有组件测试。冻结目标与版本，旧 run/切任务/切数据源/过期确认不能误写；服务拒绝不假造已停止。核对弹窗独立限制窄视口宽高及长 ID 换行，保留宿主主题。
- TUI：两种待核对状态均有菜单入口，冻结 project/tracker/run/revision；可切换结果，Enter 明确确认，n/Escape 取消；后台目标变化时拒绝旧确认。
- 公共核心：run.reconcile 在任何变更前校验只读与 expectedRevision；能力查询按记录或 run 提供一致的核对可用性及原因。
- CLI：run reconcile 透传 expectedRevision 与 idempotencyKey；过期提交拒绝，同键重试返回 replay，不产生第二次终态事件。
- 核对仅记录 demo 的人工选择，结果保持 unresolved，不自动 DONE，不新建 run；不是观察或终止真实 Pi/Worker 的实现，也不等于 WD06 人工接管完成。

### 自测证据与验收边界

日志根：`/Users/gengrf/Library/Logs/Babel-Dev/task-reconcile-20260916/`。相关测试源码随本轮提交，可重新运行；红绿日志保留。

| 检查 | 当前结果 | 日志 |
|---|---|---|
| 核心守卫定向 | 18 通过；新增 6 项覆盖两种状态的只读、旧 revision、核对幂等与未完成语义 | core-before.log、core-after.log、core-final.log |
| TUI 定向 | 15 通过；新增 7 项，输入事件→临时真实 HTTP→公共核心；不是实际 PTY | babel-tui-reconcile-before.log、babel-tui-reconcile-core-pending.log、babel-tui-reconcile-final.log |
| CLI 定向 | 10 通过；新增 4 项；真实临时 HTTP 的旧版本拒绝/幂等重放 | babel-cap10-cli-before.log、babel-cap10-cli-after.log |
| GUI 定向与已有动作回归 | 34 通过（19 个新增 + 15 个已有）；jsdom 组件/hook 测试 | reconcile-renderer-before.log、reconcile-renderer-after.log |
| 宿主类型检查 | 26 工作区通过 | typecheck.log |
| Babel 类型检查 / 全包 | 通过；288 通过 / 4 跳过 / 0 失败，61 文件 | babel-typecheck.log、babel-full.log |
| 宿主整仓门禁 | 14137 通过 / 26 跳过 / 0 失败；1670 文件通过 / 7 跳过；259.22 秒 | test-prepush.log |

核心测试首轮除守卫红例外，还修正了测试快照引用与计数假设：query 返回的 live 对象需要复制，demo 注入的 stopped:false 事件不能计成新增核对终态；最终检查核对事件与业务状态。CLI 的旧版本错误成功及重复提交错误拒绝均通过临时 HTTP 复现后修复。

本轮未运行新的原生 Mac 窗口/真实 PTY 操作验收、VoiceOver、系统偏好切换或 200% 缩放；也未接真实 Agent、OAuth、SSH 或生产服务。TASKS 的 M0-10a 验收列保留空，验收会话按其中 7 步操作后再打标。GUI 测试/全量单测不代替这一独立验收。

本轮开发自测摘要及对应源文件 SHA-256 见 [M0-10a validation](implementation/evidence/m0-10a-20260916/validation.json)。所有代码测试在冻结的实现文件上执行；后续仅整理 TASK/证据与提交信息，未把验收列自动改为通过。


## M0-04a：正文显式保存与版本保护

日期：2026-09-16；基线 `25c61e3d14057b102e8d36922ac4309226b7dc75`；cwd `/Users/gengrf/Projects/babel`，分支 `ui/macos-glass`，开始时工作树干净。沿用 MIT 许可及现有构建命令。本片是 M0-04 的正文子项，字段编辑与完整 M0-16 仍未完成；TASKS 现有 50 个稳定任务行，开发与独立验收分开标记。

### 本片行为

- 原生详情复用 NimbalystEditor，直接读取共享记录正文，输入后明确“保存正文”；保存携带草稿起始 revision，不自动保存、不启动执行。
- 按 endpoint/project/tracker 隔离的会话草稿跨任务/详情重挂保留。远端变更保留中文草稿并禁用保存，展示远端正文，用户可采用远端或明确重定版本后再次保存。只读、无版本与在途重复提交受保护；任务切换后的异步结果不污染新任务。
- Babel 正文不走宿主内容读写 IPC、不启动团队正文协作/发布初始化；普通宿主路径不变。只读状态随服务投影，不能由字段写入修改元数据。
- 正文命令只接受 Markdown 字符串或包含 Markdown 字符串的对象，拒绝无效版本和任意编辑器 JSON，不把 JSON 文本当成正文保存。
- TUI 保存固定原项目/Tracker 与 revision，不随后台筛选选中项改变而串写；重复 Ctrl+S 不再发第二次请求，失败保留编辑浮层和正文。Escape 明确取消并丢弃终端本次草稿；终端冲突选择、跨关闭/断线恢复仍待 M0-16。

### 自测与实际窗口

日志：`/Users/gengrf/Library/Logs/Babel-Dev/task-body-20260916/`。

| 检查 | 结果 | 日志 |
|---|---|---|
| 原生正文适配 | 21 项通过；真实临时 HTTP、事件、CLI 读回，中文富 Markdown/清空/旧版本/只读；无版本及未知结构拒绝 | adapter-before.log、adapter-after.log、adapter-readonly-final.log |
| GUI 行为及原详情回归 | 18 项通过；5 个正文行为 + 13 个详情测试，含实际编辑器挂载与无宿主正文 IPC | gui-final.log |
| TUI 定向与已有入口回归 | 22 项通过；新增 3 项先复现再修复：拒绝丢稿、选中变化串写、重复保存冲突 | tui-before-behavior.log、tui-final.log |
| Mac 原生开发者自测 | 1 项通过；中文正文显式保存、冲突/草稿、切任务、展开返回、两种冲突选择；同权威服务回读 | native-evidence-final.log |
| 全仓类型与测试 | 26 工作区类型检查通过；1671 文件通过/7 跳过；14162 项通过/26 跳过/0 失败，209.24 秒 | typecheck.log、test-prepush.log |

Mac 使用现有明确隔离的 `mac-glass-script-20260916` 开发 profile，Node24.15 / Apple M3 / macOS27；主进程启动记录仍为早期基线，renderer 经当前源码 HMR，本片未修改服务核心；精确本片源码以 validation 的 SHA-256 为准。没有重启或连接真实 Pi/SSH/OAuth，也未改变 GitLab/DUFS/代理配置。

原生首次测试错误选中了仍打开的 Tutorial 窗口，尚未进入正文写入就因缺少 Babel 控件失败；重新打开指定隔离 workspace，并在测试中校验完整路径后通过。展开正文实际进入宿主全文页面，返回动作是“Back to tracker”，测试误用原切换按钮导致超时，修正操作后通过。组件测试曾用 default mock 掩盖 NimbalystEditor 的 named export，实际挂载测试发现并修复。新增真实 Lexical jsdom focus 测试超时且诊断格式化失败，删除该本轮实验用例，保留日志；对应路径由原生窗口实际操作覆盖，未删除既有测试。

原生图与结构化结果：[冲突窗口](implementation/evidence/m0-04a-20260916/body-conflict-native.png)、[原生结果](implementation/evidence/m0-04a-20260916/body-evidence.json)。本轮是开发者自测；独立验收会话尚未签收，因此不勾验收列。未覆盖真实 PTY 本片操作、所有富文本格式、VoiceOver/中文组合输入、系统偏好/多主题/窄窗完整矩阵、字段编辑与退出应用后的持久草稿，也不代表完整 CAP-04/16 或 M0 完成。


最终独立 Babel 类型检查发现新增保存中提示的文本替换误触原有 relation 帮助分支（TS2367/TS2339），已把该行恢复原文；未改关系业务行为。之后重新执行 Babel 类型检查与全包测试。宿主整仓门禁在此单行恢复前通过；该恢复只影响 Babel TUI，其最终版本由独立 Babel 门禁覆盖，不重复运行不受影响的宿主全仓测试。

最终 Babel 独立门禁：类型检查通过，61 文件、291 项通过 / 4 跳过 / 0 失败（`babel-typecheck-corrected.log`、`babel-full-final.log`）；最终原生操作与截图日志 `native-evidence-final.log`。本片源码哈希及结果见 [M0-04a validation](implementation/evidence/m0-04a-20260916/validation.json)。


## M0-04b：优先级、负责人、标签三端显式保存

日期：2026-09-16；基线 `e8af8c8cd19bafbea8e1b0bb16b866410c2dbdb0`；cwd `/Users/gengrf/Projects/babel`，分支 `ui/macos-glass`，开始时工作树干净。沿用 MIT 许可、npm 工作区与现有 Electron/React/TUI/CLI，不新增依赖。本片仅覆盖三个基础字段；TASKS 新增稳定子项，开发与独立验收分开。

### 行为与边界

- GUI 复用原生优先级、负责人和标签控件，先存 endpoint/project/tracker 作用域的会话草稿，再明确保存。切任务/详情重挂保留草稿，远端冲突展示远端字段，可采用远端或重定版本后再次保存；只提交修改字段，不覆盖未编辑的远端值。
- Babel 字段写入经共享适配与 task.update，不走宿主文件/数据库/reindex。未适配的关系、类型和自定义字段只读；普通宿主编辑保留。适配器补齐 owner/tags 投影，拒绝未知写字段，单条与批量基础字段必须携带有效版本；批量先检查格式，远端仍逐条提交，不宣称原子事务。
- 公共核心在任何字段变更前校验只读、版本及 priority/owner 文本和 tags 文本数组；null/非法输入拒绝，空负责人和空标签可明确清除。保留已有自定义优先级文本，不把旧 normal 值擅自改成枚举。
- TUI 大写 F / 菜单打开字段表单，Tab 切换，Ctrl+S 保存；冻结原项目/记录/版本，防重复提交，冲突/拒绝保留输入，Escape 明确取消。标签使用英文/中文逗号分隔；完整终端冲突选择及持久草稿仍待 M0-16。
- CLI 复用 task update --input 的 JSON 输入、expectedRevision 和幂等合同。中文字段、清空、旧版本、非法类型、事件和查询的测试均通过真实临时 HTTP；不启动真实 Agent。

### 检查与运行证据

日志根：`/Users/gengrf/Library/Logs/Babel-Dev/task-fields-20260916/`。

| 检查 | 结果 | 日志 |
|---|---|---|
| 核心与 CLI 定向 | 40 通过（核心 29、CLI 11）；先复现 tags 未保存、非法字段/缺失版本未拒绝 | core-before.log、core-revision-before.log、core-cli-final.log |
| 共享宿主适配 | 26 通过；HTTP→事件→查询→宿主投影→CLI、清空、只读/旧版本 | adapter-before.log、adapter-final.log |
| GUI 草稿及原详情 | 25 通过；包含真实宿主控件、目标切换、旧回调/权限变化与冲突 | gui-final.log |
| TUI 定向及已有入口 | 33 通过；5 个新增字段保存/拒绝/只读/选中变化/取消行为 | tui-fields-before.log、tui-fields-after.log |
| Babel 类型与全包 | 类型通过；61 文件，308 通过 / 4 跳过 / 0 失败 | babel-typecheck-final.log、babel-full.log |
| Mac 原生 + 实际 POSIX PTY + CLI | 1 条跨端闭环通过；中文字段读写、双 Ctrl+S 单次 revision、GUI 冲突保稿/明确重定版本、仅改字段保存、退出恢复备用屏幕 | native-frozen.log |
| 宿主全仓类型与测试 | 26 工作区类型通过；1672 文件通过 / 7 跳过，14179 项通过 / 26 跳过 / 0 失败，178.92 秒 | typecheck.log、test-prepush.log |

Mac 使用现有隔离 profile `mac-glass-script-20260916`，Apple M3 / macOS 27.0 / Node 24.15.0；因公共核心新增 tags 与版本守卫，明确重启该隔离开发实例，启动记录基于 e8af8c8 的本片工作树。未接账号、Pi、OAuth、SSH，未更改 GitLab/DUFS/代理。原生截图使用浅色默认 CSS 磨砂，折射关闭；这是实际 Electron 页面，非浏览器设计稿。

首轮原生测试对 High 选项使用完全匹配，未计入图标的无障碍文本而超时；读取实际 DOM 后改用选项内可见 High 标签，通过闭环。CLI 新测试首轮错误假设 replayed 字段，按既有 commandStatus=replayed 合同修正。类型检查发现 Object.hasOwn 与宿主 TS target 不兼容、测试额外属性写法及 TUI 动态 tags 类型缺少数组判断，均修复后重验；不把这些初次失败隐藏为全程通过。

结构化结果、截图及真实终端录制：[三端结果](implementation/evidence/m0-04b-20260916/fields-evidence.json)、[冲突窗口](implementation/evidence/m0-04b-20260916/fields-conflict-native.png)、[PTY 记录](implementation/evidence/m0-04b-20260916/fields-pty.txt)。主控实际查看了截图，确认冲突说明和远端负责人可见；未据此宣称完整 UI/UX 通过。具体源码哈希与门禁见 [validation](implementation/evidence/m0-04b-20260916/validation.json)。

本轮是开发者自测，独立验收保持空。未覆盖完整 CAP-04/05/16、自定义字段/关系/类型、退出应用后的草稿持久化、全部主题/窄窗/200% 字体/系统中文输入法/VoiceOver、Windows/Ubuntu 或真实执行。下一切片为关系与依赖的统一写路由。

本片最终代码冻结后再次运行原生三端闭环通过（native-frozen.log）；最终 Babel 全包测试包含 tags 数组收窄修正。TASKS 共 51 个唯一任务 ID，M0-04b 开发完成，独立验收未勾选。
