# Nimbalyst 巴别塔开发提示词入口 · v2.3

## 当前开发方向（2026-09-16）

后续主开发与原生桌面验收平台为 **MacBook M3 / macOS**，执行 [macOS 开发交接](MACOS-DEVELOPMENT-HANDOFF.md)。Windows 历史路径/阶段顺序不覆盖此决定；保留 Windows/Ubuntu 的适配与回归要求。Wayland 指 getwayland.com 的 AI 工作台，对标以 [Wayland / Devin 指标](WAYLAND-DEVIN-BENCHMARK.md) 为准。已有实现继续收口，不重新制作另一套独立看板；历史测试通过不代表 macOS 已验收。

使用 [START-HERE-PROMPT.md](START-HERE-PROMPT.md) 中的完整提示词。这里保持单一入口，避免两个提示词各自漂移。

当前开发要求是 **共享非图形业务核心 + Nimbalyst GUI + 交互式 TUI + JSON CLI + 应用 Hooks**，M0 就交付三端同源演示与自动化测试，不能只做桌面看板。

必读：[AGENTS](AGENTS.md)、[主 SPEC](NIMBALYST-DEVELOPMENT-SPEC.md)、[Trackers 映射](NIMBALYST-TRACKER-MAPPING.md)、[TUI/Hooks 契约](NIMBALYST-TUI-HOOKS-SPEC.md)、[功能对照表](CAPABILITY-MATRIX.md)。

原 v2.2 提示词保存在 [历史快照](reference/v2.2/NIMBALYST-IMPLEMENTER-PROMPT.md)，不作为当前开发指令。
