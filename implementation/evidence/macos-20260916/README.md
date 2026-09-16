# Mac M3 原生 demo 验收证据 · 2026-09-16

此目录记录本次 Mac UI 与 M0 收口增量，测试源码与本文在同一提交。完整范围、失败及修复历史见 [TASK_EVIDENCE](../../../TASK_EVIDENCE.md)，逐项未完需求见 [M0-CAP-STATUS](../../M0-CAP-STATUS.md)。

- `glass-workbench.png`、`board-wide.png`、`board-narrow.png`：真实 Electron 开发窗口，浅色 CSS 磨砂默认，宽窄布局。演示服务保留多轮验收记录，数量不是初始 fixture 数量。
- `filtered-board.png`、`filters-evidence.json`：宿主状态/搜索筛选的同源 ID 与计数。
- `title-conflict-native.png`、`title-evidence.json`：跨端标题冲突不覆盖、切任务保草稿、采用远端；没有启动 run。
- `three-surfaces-identity.json`：GUI 创建 → CLI 读回 → POSIX PTY 启动/关注切换 → GUI 验收；关闭 GUI 后同一服务继续，PTY 再完成验收。
- `attention-evidence.json`：30 次请求至匹配原生 DOM 的观测上界，最终整合 p95 约 228ms；含 HTTP、定位等待和并发检查负载，不能当作 GPU 帧率或生产性能结论。

截图与 JSON 仅来自本任务的隔离 demo；不证明真实 Pi、OAuth、SSH、设备在线、完整 M0 或发布包。系统减少透明度本轮使用 Chromium media emulation，未人工更改系统偏好。

最终代码门禁：26 工作区 typecheck 通过；整仓 14118 通过 / 26 跳过 / 0 失败；Babel 271 通过 / 4 跳过。平台与初次超时复跑事实见 [validation.json](validation.json)。
