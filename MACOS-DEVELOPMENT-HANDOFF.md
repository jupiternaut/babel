# 后续开发主平台：macOS

决策日期：2026-09-16，依据用户再次确认。后续新增开发及桌面交互验收以 MacBook M3 / macOS 为主；不要求先完成所有 Windows 缺口才转移。保留多平台产品目标及真实验收门禁。

## 平台职责

| 环境 | 职责 |
|---|---|
| MacBook M3 / macOS | 主开发环境、Nimbalyst 原生宿主和交互验收；原生依赖与本地构建 |
| Windows | 保留既有工作树、历史证据；Windows 适配和受控设备回归 |
| Ubuntu | 后台服务、仓库与远程执行设备；独立验证 SSH、服务管理与运行状态 |
| iOS / iPadOS / Android | 后续客户端访问目标，不据此宣称完整桌面 Electron/TUI 已运行于移动端 |

提交 `6568dc0` 的交接轮次只更新文档，彼时尚未在 Mac 检出、安装依赖、编译或启动。后续 Mac 实测必须另附当轮证据，不能将这里的启动说明视为验收结果。Windows 的 D 盘路径是历史位置，不是 macOS 必须模拟的目录。

2026-09-16 已在 Mac 新检出并完成首轮原生开发验证：安装、共享模块/worker 构建、浅深主题、菜单、材质回退及 GUI/CLI/POSIX PTY 生命周期。见 [本轮实施证据](TASK_EVIDENCE.md)；全量单测仍有未通过项，不能据此宣布发布验收完成。

## 开发来源与准备

- 仓库：https://github.com/jupiternaut/babel
- 当前候选分支：`acceptance/m0-native-20260916`；代码基线提交：`877005dfecd61d6cbe45a772b86c520bccdf14af`。后续文档提交位于其后，开始工作时记录实际 HEAD。
- PR：https://github.com/jupiternaut/babel/pull/1 ，维持草稿，不因更换平台取消发布门禁。
- 建议新目录：`~/Projects/babel`。源码位于 `implementation/nimbalyst/`。已有同名目录先查 Git 状态，不覆盖、不 reset。
- 先读 AGENTS、当前验收、Wayland/Devin 指标与 Trackers 映射；使用已有实现继续推进，不从 M0 空目录重新开发。
- 记录 macOS 版本、`uname -m`、Node/npm 版本、Xcode 命令行工具与各 package 的 engines/锁文件。M3 默认采用原生 arm64 工具链；必须使用 Rosetta 时记录原因。
- 按源码构建说明安装依赖并重建 Electron/PTY/数据库等实际使用的原生模块。不要复制 Windows 的 node_modules、out、构建缓存或整个用户 profile；不能把 Windows 的成功日志作为 Mac 的证据。
- 宿主根 `implementation/nimbalyst/package.json` 要求 **Node >=24、npm >=11**；Babel 子包的 Node >=20 不能覆盖宿主要求。M3 使用原生 arm64 Node；仅对当前命令前置 PATH，无需改用户 shell 配置。

全新检出的依赖顺序如下。`runtime` 依赖工作区声明，不能直接沿用 Windows 文档中先构建 runtime 的旧顺序。本轮 Mac 新检出曾因此缺少 `@nimbalyst/extension-sdk/agents` 与 `types/editor`；先构建工作区依赖后再继续。

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
cd ~/Projects/babel/implementation/nimbalyst
node --version
npm --version
npm ci
npm ci --prefix packages/babel
npm run build:workspace-deps
npm run build --prefix packages/runtime
npm run build --prefix packages/extensions/nimbalyst-memory/engine
```

若 Node 安装在其他目录，替换 PATH 前缀。其他扩展的 dist 与原生模块仍按实际构建错误及各包说明补齐；这组命令不证明原生宿主或所有编辑器已通过验收。

## 配置与数据隔离

选择未占用的独立开发 profile。任务演示、系统控制台、Electron userData、缓存和日志各自明确绝对路径，在加载 electron-store 等组件前确定配置目录，并记录实际读写位置。路径通过配置与平台目录解析，不能硬编码 D 盘或复制旧 Roaming 数据。

凭据不入 Git，不整包同步个人账号或 SSH 密钥。真实服务保留既定状态，尤其不因测试启动 GitLab、DUFS、局域网代理。写操作使用隔离测试进程/服务，测试后按记录恢复。

## 可重复的 Mac 开发启动

依赖准备完成后，在仓库根使用 [scripts/dev-macos.mjs](scripts/dev-macos.mjs)。先选择一个新目录；脚本拒绝接管没有本仓库标记的非空目录，不覆盖个人 Nimbalyst 数据。

```sh
cd ~/Projects/babel
/opt/homebrew/opt/node@24/bin/node scripts/dev-macos.mjs start --profile "$HOME/Library/Application Support/Babel/mac-dev"
/opt/homebrew/opt/node@24/bin/node scripts/dev-macos.mjs status --profile "$HOME/Library/Application Support/Babel/mac-dev"
/opt/homebrew/opt/node@24/bin/node scripts/dev-macos.mjs stop --profile "$HOME/Library/Application Support/Babel/mac-dev"
```

`BABEL_NODE_BIN` 可以指定其他 Node >=24 的 bin 目录。脚本固定该 Node 的 PATH，检查 npm >=11，输出实际 Node/npm/Electron/electron-vite/macOS/架构、提交、工作树是否有改动，以及绝对路径、端口、命令、日志与进程身份。它不安装依赖、不签名、不发布。每次 start 先构建 extension-sdk 和 worker；已有数据与日志保留。

局部折射对照实验仅接受启动时显式传入 `VITE_BABEL_GLASS_REFRACTION=true`；默认不开启，`1`、`TRUE` 等值不会启用。它是 `VITE_BABEL_*` 继承变量的唯一实验白名单，其余仍由隔离配置覆盖或清除。`run.json` 的 `experiments.glassRefraction` 记录本次是否请求开启，用于 CSS 与 simple-liquid-glass 局部折射对照；该值不证明效果已呈现或性能已通过，产品界面不增加技术开关。

这里隔离的是 **Babel 演示业务 profile 和 Electron userData**。脚本清除继承的 Babel、Nimbalyst、Electron 和 Playwright 控制变量，再显式设置本轮路径；数据库可能优先读取的 `NIMBALYST_USER_DATA_PATH` 也固定为同一 Electron 目录。常规 HOME、PATH 等环境仍保留，上游宿主仍可能发现或读取现有 CLI 账号并执行用量检测。这不是整台机器的账号沙箱，不能宣称整个宿主完全不访问已有账号。首次引导无需设置测试环境：可按 Escape 跳过 welcome，工作区信任选择 Not now；实际窗口观察另记。

| 内容 | profile 下路径或默认地址 |
|---|---|
| 权威演示服务与令牌 | `demo/`，`http://127.0.0.1:7780` |
| 三端共同工作区 | `demo/workspaces/babel`，projectId 为 `fixture-project-babel` |
| Electron userData | `electron/`，在 bootstrap 加载 electron-store 前设定 |
| 系统控制台独立 profile | `system/`，不会由启动脚本主动运行 |
| npm 缓存 | `cache/` |
| 准备 / 服务 / 宿主日志 | `logs/prepare.log`、`logs/babel.log`、`logs/electron.log` |
| 进程及版本记录 | `run.json`，不含令牌内容 |
| Vite / CDP | `localhost:5273` / `127.0.0.1:9223`，启动后检查实际监听地址与进程所属 |

端口可在启动时用 `BABEL_PORT`、`VITE_PORT`、`NIMBALYST_CDP_PORT` 显式覆盖。占用时拒绝启动，不结束占用者。`status` 与 `stop` 以同一 profile 的 `run.json` 为准；stop 校验 PID、启动时间、命令及进程组，只结束本脚本记录的 Babel/Electron 开发进程，保留数据。启动失败清理本次新起进程；身份不匹配时拒绝发信号并报告。启动被强制 `SIGKILL` 时可能保留 `start.lock`；先核对锁中的进程身份，仅在确认已失效后移除这一锁文件，不能删除 profile。

宿主 GUI 关闭不等于演示服务停止。通过“设备与服务”界面另行启动的系统控制服务是独立后台，不在这两个受管进程组内；其启停和回归需另记，不把 `stop` 当成系统控制台停止证明。

窗口和进程恢复按以下边界执行：关闭项目窗口会显示 Workspace Manager；在 macOS 关闭该管理窗口后，Electron 仍可驻留，由 Dock 恢复。真正 Quit 后 electron-vite 随 Electron 退出，Babel 演示服务继续运行，`status` 显示部分存活；脚本不自动重启 GUI 或任务。存在受管存活进程时重复 start 会拒绝，需先处理完在运行任务，再 stop、start 同一 profile。demo 服务 executing/verifying 的真实进程 SIGKILL 恢复已补行为验收，见 [最新证据](TASK_EVIDENCE.md)；这不覆盖真实 Pi/Worker 或原生 GUI/TUI 断线后的草稿与焦点恢复。

正常保存状态应先使用宿主 Quit（Cmd+Q）并等待退出，再执行脚本 stop 清理剩余开发服务。宿主的数据库 checkpoint/关闭在 `before-quit` 路径，当前显式将 SIGTERM 转为 `app.quit()` 的代码仅覆盖 Windows；脚本 stop 是进程清理：先向身份确认的进程组发 SIGTERM，超过 5 秒仅对仍匹配的原进程升级 SIGKILL。它不证明 Mac 草稿或数据库已优雅保存。若组长已消失但组内仍有进程，脚本拒绝以过期身份清理并报告；必须重新核实具体剩余进程，不能靠端口或进程名批量结束。

脚本直接调用已安装的 electron-vite，显式传入 `--workspace` 和回环 CDP 参数。原有 `packages/electron/scripts/dev.sh` 不转发任意参数，不能把 `npm run dev -- --workspace ...` 当成等价入口。主进程/preload 使用按 profile 派生的 `out-macos-*` 输出；数据库 worker 的开发路径在源码中固定为 Electron 包下的 `out/`，故仍由 `build:worker` 生成在该位置。不要同时在同一检出启动多个 worker 构建。

CLI/TUI 连接同一演示服务时，从 `run.json` 读取实际 profile 和端口。例如默认端口：

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
export BABEL_PROFILE="$HOME/Library/Application Support/Babel/mac-dev/demo"
export BABEL_ENDPOINT="http://127.0.0.1:7780"
cd ~/Projects/babel/implementation/nimbalyst/packages/babel
node --import tsx src/cli/main.ts task list --project fixture-project-babel --json
node --import tsx src/tui/main.ts --project fixture-project-babel
```

`ready` 只表示受管服务/CDP已响应且相关端口属于本次回环进程。首次引导、实际工作区、原生 Trackers 交互、浅深主题和玻璃材质仍要真实窗口验收。脚本行为测试用 `node --test scripts/tests/dev-macos.test.mjs`，临时目录及空闲子进程不代替 Electron 启动验证。

## 构建入口与执行顺序

已在 `packages/electron/package.json` 核对存在 `dev`、`build:mac:local`、签名及发布相关脚本。这只是源码核对，尚未在 macOS 执行。

依赖和原生模块准备完毕后，本地打包入口为：

```sh
cd ~/Projects/babel/implementation/nimbalyst/packages/electron
npm run build:mac:local
```

该入口配置跳过公证和禁止发布；仍需读取实际构建脚本与资源要求。不要用 `build:mac:release` 代替本地验收；签名、公证和公开发布是另一个阶段。开发启动需先核对 `scripts/dev.sh` 的 profile/env 使用方式，不能只运行后假定隔离成功。

1. 固定实际源码、依赖和配置基线，启动未经本轮 UI 改动的宿主，保存原生布局截图和日志。
2. 先复验同记录在原生 Trackers 与 Babel 看板的创建、修改、运行、完成、归档和恢复；保留类型、Saved Views、Ready 和宿主菜单。
3. 按 WD-01～10 收口需要关注、执行可见性、接管和三端一致性；先登记缺口与文件归属，再并行独立模块。
4. macOS 系统适配分别验真实采样、进程身份、launchd 服务启停、自启动与权限错误。已有适配代码不等于实机通过。
5. 做 GUI/TUI/CLI/Hooks 交叉操作、关闭窗口后运行保留、断线重连、输入和焦点验收；额外回归 Windows/Ubuntu 适配。
6. 复跑全仓库检查，区分既有失败、新失败和平台差异。在 M3 上将 `npm run typecheck`、`npm run test:prepush` 与原生 E2E 顺序执行；首次并行运行曾出现 7 项 20 秒超时，具体复跑结果见 TASK_EVIDENCE，不能用提高超时或跳过测试掩盖。历史 206 项失败是 Windows 基线，不是 Mac 的预定结果，不能简单排除或标记已修复。

## 交付要求

每次交付记录实际提交、平台、依赖、profile、准确启动命令、CAP/WD/SYS 编号、原生窗口与 PTY 证据。更新当前验收表并提交通过验收的工作；未通过的发布门禁保持可见，不用假设备、独立网页或效果图替代真实功能。
