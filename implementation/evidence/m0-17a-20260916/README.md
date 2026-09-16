# M0-17a：终端单键退出与分段输入

日期：2026-09-16。基线 `0d1ccef282143bb1358e47f2da5c610d8ca422da`，cwd `/Users/gengrf/Projects/babel`，分支 `ui/macos-glass`；起始工作树干净。MacBook M3 / macOS 27 / Node 24.15，Nimbalyst MIT；复用现有宿主 node-pty 依赖，无新增依赖。

## 本片行为

- 单独 Esc 在 100ms 消歧窗口后关闭弹层，不再要求额外空格；后续控制序列及时到达则取消该计时器。
- 方向键、F 键、SGR/X10 鼠标、粘贴起止符支持分段到达；粘贴正文里的 Escape 不触发退出，粘贴里的起始标记保留为正文。
- dispose 取消未触发的 Escape 计时器；保留现有退出恢复路径。Pi 原生测试去掉额外空格绕行。
- 不增加领域命令。真实 PTY 取消字段后核心 command 调用次数为零。

## 验证与复现

源码与日志 SHA-256、最终检查结果见 [validation.json](validation.json)。从 `implementation/nimbalyst/packages/babel` 使用 Node 24：

```sh
npm run typecheck
npm test
# 仅复现真实 POSIX PTY，需先安装 Nimbalyst 宿主依赖中的 node-pty：
npm test -- --run tests/tui-pty-input.test.ts
```

真实 PTY 测试创建临时 demo profile 和动态端口；中文搜索后等待实际选中详情，打开字段、输入分段中文粘贴、单独 Esc 取消、重新打开确认未保存；帮助弹层接收分段方向键后保持打开，再以单个 Esc 关闭。resize 后退出，与子进程启动前 `stty -g` 比较，并检查光标、鼠标、粘贴和备用屏幕恢复序列。临时服务及目录由测试清理；不启动 Electron、Pi、模型或个人账号。原有 GUI 演示实例未重启。

[最终 PTY 转义字节](pty.json)保存实际终端输出、退出与零写命令计数。[单项 PTY 日志](pty.log)及最终 [Babel 全包日志](babel-tests.log)分别保留，不能累加重叠用例。完整宿主检查见 [类型](host-typecheck.log)、[单测](host-tests.log)。

## 先失败与修正

- [before.log](before.log)：新 6 个输入用例先失败，覆盖裸 Escape 卡住及分段解析；随后补入 X10 鼠标分段用例。
- [targeted.log](targeted.log)：初版输入与 Pi TUI 定向 16 项通过；其后 X10 补测包含在最终全包中。
- [pty-first.log](pty-first.log)：测试误用了未被当前 app 使用的 renderFrame 清屏前缀；[首轮字节](pty-first.json)显示实际已连接。改用当前帧边界。
- [pty-second.log](pty-second.log)：搜索文字已显示但任务尚未选中就发出 F；改为等待单条结果和详情加载，不延长超时掩盖竞态。
- [babel-typecheck-first.log](babel-typecheck-first.log)：PTY fixture 缺必填 serviceToken；补显式测试值后类型和全包重跑。

日志文本仅清理行末空白与末尾空行；PTY 转义字节保持原样，第二次失败的原始日志另存 [JSON](pty-second-raw.json)。

## 未覆盖

独立验收会话仍未签收；完整断线/游标续读、草稿持久恢复、异常强杀的终端恢复、Windows ConPTY 和 Ubuntu 未验。100ms 为本机 Escape 消歧约定，不保证任意慢网络分包都合并。修改了 Pi 原生测试的单键输入步骤，但本片未重跑 Electron/Pi 三端协议测试；其历史证据不能算本轮新验收。GUI 外观未改，无新增截图或玻璃效果验收。本片不完成整个 M0-17，也不替代真实模型、worktree 和 Diff 交付。
