# 真实设备与服务控制台：实施与验收

日期：2026-09-16。源码位于 `implementation/nimbalyst`，沿用 Nimbalyst 原生宿主。此次实现真实系统控制，不使用 M0 假设备。**这是可运行的开发成果，完整成品发布验收尚未通过。**

## 已实现

- 原生左导航新增“设备与服务”，保持 Trackers 与执行看板入口。
- CPU、内存、磁盘容量、进程列表和身份；服务运行、自启动独立控制；详情日志与操作记录。
- 独立回环控制服务、GUI 主进程 IPC 代理、交互 TUI、JSON CLI。
- 命令串行化、持久 requestId 幂等、冲突拒绝、进程身份保护、反向依赖停止/重启守卫、实际状态回读。
- 后台中断将未完成操作标记 interrupted，不自动重放；GUI/终端关闭不停止后台。
- 可配置前置校验 Hook、持久事件与观察投递游标、失败退避重试、至少一次投递。
- Windows SCM/计划任务/Startup/WSL 适配代码；托管独立进程适配；其他平台能力未在本次机器验收。

## 证据

| 层级 | 结果 | 不能由此推出 |
|---|---|---|
| Babel 全包测试 | 58 个文件，255 通过，1 跳过 | 不能代表 Windows 特权控制已实测 |
| 原生 GUI/IPC 定向测试 | 14 通过；包括伪装来源拒绝、请求隔离、隐藏暂停、过期显示 | 不是实际窗口鼠标/视觉验收 |
| TypeScript | 原 26 工作区检查中 25 通过；修正测试类型后 Electron 单独通过；Babel 单独通过 | 不是行为证明 |
| Electron 构建 | 完成；独立 systemServer.js 和 PS 资源打包输出已生成 | 尚未验证安装包签名/安装/升级 |
| 真实 Windows 采样 | CPU/内存/C、D 盘/进程实际返回 | 不含磁盘 I/O 曲线或文件清理 |
| 真实 Windows ConPTY | 12 项通过；鼠标、键盘、中文、resize、精确 PID 终止、启停重启、重复请求、退出保留后台 | 使用隔离 Node 服务，不等于 GitLab 写操作验收 |
| 全仓库门禁 | 13,856 通过，206 失败，26 跳过；另有 1 个未处理错误 | 红色门禁，不可正式发布或合并 main |

本轮 206 个失败名称与上一轮逐项比较差异为 0，不能据此断言每个失败根因都相同。最后 IPC 加固另外完成两项失败→通过负例和最终构建；未重复跑全仓库以覆盖同一批已知失败。

原生新构建普通窗口已经启动，标题 `babel - Nimbalyst`；仅这一事实不能标记界面完成。带测试调试连接的重启命令被自动审批拒绝（工具只返回 blocked by policy，无具体原因），因此该模块真实原生窗口点击、截图、窄屏和 UAC 验收仍未完成。没有用独立网页或组件截图替代。

## 实际系统保持状态

2026-09-16 06:38 UTC 回读：GitLab WSL、DUFS、GitLab 局域网代理全部 stopped，autostart=false。本轮未启动这些真实业务服务，OpenClaw/Mihomo 未改动。真实控制 profile 是 `D:\BabelData\system`，令牌和实际清单不入 Git。

计划任务真实测试因 Register-ScheduledTask 权限不足跳过，未请求提权、未遗留测试任务。Disabled 任务临时启用、执行及恢复的脚本测试用了窄命令替身，应与实机调度器测试区别。SCM/Startup/WSL 写操作、UAC 取消/成功、Linux/macOS 和远程 SSH 均仍需专项验收。

## 本地证据位置

- `D:\Projects\babel-nimbalyst-data\system-babel-final.log`
- `D:\Projects\babel-nimbalyst-data\system-gui-final-tests.log`
- `D:\Projects\babel-nimbalyst-data\system-gui-final-typecheck.log`
- `D:\Projects\babel-nimbalyst-data\system-electron-build-security.log`
- `D:\Projects\babel-nimbalyst-data\system-prepush.log`
- `D:\Projects\babel-nimbalyst-data\acceptance\system-console-20260916\terminal\2026-09-16T06-31-04-127Z\report.json`

ConPTY 证据含真实原始 ANSI、解析后的文本和 SVG；SVG 是终端屏幕重建，明确不冒充原生窗口截图。清理报告确认测试服务/进程已退出，7783 无监听，证据中没有令牌。

操作和协议见 [使用手册](nimbalyst/packages/babel/SYSTEM-CONSOLE.md)。后续收口优先级：真实原生窗口 → 特权动作隔离实测 → 安装包/升级 → 已知全仓库失败。远程设备与磁盘 I/O 不应写成当前已完成。
