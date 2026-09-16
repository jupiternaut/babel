# 如何审查这次源码提交

此前 GitHub 仓库只有规格。本次首次放入完整上游源码快照，所以 diff 很大；这不表示重写了整个 Nimbalyst。基线为公开 MIT 仓库 `nimbalyst/nimbalyst` 的 `d6e1d008d9ee264a7447f3533fa9f48f158a70b0`，见 [SOURCE-BASELINE.json](SOURCE-BASELINE.json)。未复制依赖、构建目录、嵌套 Git 仓库或运行 profile。

优先审查：

- `nimbalyst/packages/babel/`：共用核心、HTTP 服务、CLI、TUI、应用 Hooks 及合成集成。该包不在根 npm workspaces 中，要单独安装依赖、类型检查和测试。
- `nimbalyst/packages/electron/src/renderer/components/TrackerMode/`：原生执行视图、右侧详情和折叠诊断；保留原有 Tracker 类型与视图。
- `nimbalyst/packages/electron/src/renderer/services/` 下 Babel 数据源、错误处理、演示工作区识别及其测试。
- Electron bootstrap / store 路径隔离，以及 `electron.vite.config.ts` 的非敏感演示环境变量传递。
- `nimbalyst/packages/electron/e2e/babel/`：本轮真实原生窗口与 Windows ConPTY 验收。

本次接手后进一步修复了精确工作区隔离、Hook 迟到写入、TUI 搜索与启动竞态、详情对外部事件刷新和类型检查错误。其余 Babel 内容包含此前开发成果，不能因进入仓库就视为全部通过真实验收；逐层证据与缺口以 [ACCEPTANCE.md](ACCEPTANCE.md) 为准。

源码快照保留了上游部分空白格式，首次导入的整树 `git diff --check` 会报告这些空白问题；没有为消除报告而批量重排上游文件。完整测试门禁仍为失败状态，本次应保留为草稿 PR，不合并为正式版本。
