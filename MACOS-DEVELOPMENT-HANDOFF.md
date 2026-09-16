# 后续开发主平台：macOS

决策日期：2026-09-16，依据用户再次确认。后续新增开发及桌面交互验收以 MacBook M3 / macOS 为主；不要求先完成所有 Windows 缺口才转移。保留多平台产品目标及真实验收门禁。

## 平台职责

| 环境 | 职责 |
|---|---|
| MacBook M3 / macOS | 主开发环境、Nimbalyst 原生宿主和交互验收；原生依赖与本地构建 |
| Windows | 保留既有工作树、历史证据；Windows 适配和受控设备回归 |
| Ubuntu | 后台服务、仓库与远程执行设备；独立验证 SSH、服务管理与运行状态 |
| iOS / iPadOS / Android | 后续客户端访问目标，不据此宣称完整桌面 Electron/TUI 已运行于移动端 |

本轮只更新文档，尚未在 Mac 检出、安装依赖、编译或启动。Windows 的 D 盘路径是历史位置，不是 macOS 必须模拟的目录。

## 开发来源与准备

- 仓库：https://github.com/jupiternaut/babel
- 当前候选分支：`acceptance/m0-native-20260916`；代码基线提交：`877005dfecd61d6cbe45a772b86c520bccdf14af`。后续文档提交位于其后，开始工作时记录实际 HEAD。
- PR：https://github.com/jupiternaut/babel/pull/1 ，维持草稿，不因更换平台取消发布门禁。
- 建议新目录：`~/Projects/babel`。源码位于 `implementation/nimbalyst/`。已有同名目录先查 Git 状态，不覆盖、不 reset。
- 先读 AGENTS、当前验收、Wayland/Devin 指标与 Trackers 映射；使用已有实现继续推进，不从 M0 空目录重新开发。
- 记录 macOS 版本、`uname -m`、Node/npm 版本、Xcode 命令行工具与各 package 的 engines/锁文件。M3 默认采用原生 arm64 工具链；必须使用 Rosetta 时记录原因。
- 按源码构建说明安装依赖并重建 Electron/PTY/数据库等实际使用的原生模块。不要复制 Windows 的 node_modules、out、构建缓存或整个用户 profile；不能把 Windows 的成功日志作为 Mac 的证据。

## 配置与数据隔离

选择未占用的独立开发 profile。任务演示、系统控制台、Electron userData、缓存和日志各自明确绝对路径，在加载 electron-store 等组件前确定配置目录，并记录实际读写位置。路径通过配置与平台目录解析，不能硬编码 D 盘或复制旧 Roaming 数据。

凭据不入 Git，不整包同步个人账号或 SSH 密钥。真实服务保留既定状态，尤其不因测试启动 GitLab、DUFS、局域网代理。写操作使用隔离测试进程/服务，测试后按记录恢复。

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
6. 复跑全仓库检查，区分既有失败、新失败和平台差异。历史 206 项失败是 Windows 基线，不是 Mac 的预定结果，不能简单排除或标记已修复。

## 交付要求

每次交付记录实际提交、平台、依赖、profile、准确启动命令、CAP/WD/SYS 编号、原生窗口与 PTY 证据。更新当前验收表并提交通过验收的工作；未通过的发布门禁保持可见，不用假设备、独立网页或效果图替代真实功能。
