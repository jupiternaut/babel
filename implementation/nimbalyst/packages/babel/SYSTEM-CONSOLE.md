# 设备与服务控制台

这是一套真实本机控制能力，与 Babel 任务演示服务分开。原生 Nimbalyst、终端 TUI 和 JSON CLI 使用同一独立后台，后台以操作日志记录请求、执行结果和事件。关闭界面不会停止后台或受管服务。

## 打开和使用

原生 Nimbalyst 左侧导航选择 **设备与服务**。首次打开会连接或启动控制后台。Trackers、执行看板和 Agent 会话保持原入口。

在本目录运行：

```powershell
# 后台尚未运行时，在一个终端启动；默认端口 7782
node --import tsx src/system/main.ts

# 其他终端使用同一后台
node --import tsx src/cli/main.ts system resources
node --import tsx src/cli/main.ts system services
node --import tsx src/cli/main.ts system tui
```

默认 Windows profile：`D:\BabelData\system`。其他平台默认 `~/.local/state/babel-system`。可用 `BABEL_SYSTEM_PROFILE` 或客户端 `--profile` 指定独立目录。客户端地址可用 `--endpoint http://127.0.0.1:7782` 指定；它不是公网控制接口。

图形界面与 TUI 提供资源、服务、进程、日志和操作历史。运行状态与自启动是两个独立字段；关闭自启动不会结束当前进程，停止服务也不会自动改变下次启动设置。

TUI：`1/2/3/4` 切服务、进程、日志、历史；方向键选行；`/` 搜索；服务页 `s` 启动、`x` 停止、`r` 重启、`a` 切自启动；进程页 `x` 后核对 PID/启动时间，再 `y` 确认或 `n` 取消；`?` 帮助；`q` 或 Ctrl+C 退出。支持鼠标、中文和窗口调整。

## 服务清单与权限

`catalog.json` 的 version 为 1，services 是明确登记的服务。不要从网页/模型生成文本直接拼 shell 命令。

```json
{
  "version": 1,
  "services": [
    {"id":"dufs","label":"DUFS","kind":"scheduled-task","target":"LanShareDufs","taskPath":"\\"},
    {"id":"gitlab","label":"GitLab","kind":"wsl-systemd","target":"gitlab-runsvdir.service","distribution":"Ubuntu"}
  ]
}
```

这是格式示例，不会自动安装或创建对应服务。实际用户目录保留已有完整清单，不能用示例覆盖。修改清单后需在没有进行中操作时重启控制后台。支持的配置字段见 `src/system/types.ts`，包括固定 executable/args、依赖 dependsOn、日志路径、回环健康 URL 和 Startup 快捷方式原件/目标路径。

`managed-process` 用于控制明确登记的独立程序，保存 PID 与启动时间；它不提供自启动，会明确返回不支持。Windows SCM 关闭自启动改成 Manual，保留手动启动；计划任务区分任务整体 Enabled 与登录/开机触发器；WSL GitLab 区分 Windows 登录入口和 Linux unit，两层不一致显示 mixed/unknown。

Windows 用户无权限时操作失败并留下记录。原生面板的“以管理员权限运行控制服务”先等待后台无操作，再请求 Windows UAC；用户取消就不会宣称提权成功。界面进程本身无需长期管理员权限。控制目录 ACL 仅授予当前用户、SYSTEM、Administrators；令牌留在主进程/CLI，不进入 renderer。

## 可自动化的命令与恢复

```powershell
node --import tsx src/cli/main.ts system start SERVICE_ID --request-id deploy-001
node --import tsx src/cli/main.ts system history
node --import tsx src/cli/main.ts system events --after 0
node --import tsx src/cli/main.ts system logs SERVICE_ID --limit 100
node --import tsx src/cli/main.ts system autostart SERVICE_ID off
```

相同 requestId 与相同命令返回原操作；同 ID 用于不同命令返回 CONFLICT。客户端超时不意味着系统没有执行，先查历史或用原 requestId 重试。操作成功必须通过系统状态回读，HTTP 200 本身不是成功证据。

停止或重启依赖服务前，依赖方必须明确停止；unknown/失联不算停止。进程终止绑定 PID 与 startedAt，拒绝复用 PID 和关键进程。后台中断后，未完成操作标为 interrupted，保留副作用不确定提示，不会自动重放。

`system-state.json` 保存操作和事件，`.bak` 保存上次版本；损坏时失败退出，不清空。`server.lock` 只是诊断 PID，实际互斥由 OS 持有。Windows 使用命名管道，POSIX 使用 profile 哈希派生的回环端口；端点冲突时失败关闭。不要手动删除活跃 profile。它们不是长期异地备份。

## 应用 Hooks

在清单里可显式添加：

```json
{
  "hooks": {
    "before": [{"id":"policy","executable":"C:\\Program Files\\nodejs\\node.exe","args":["D:\\MyHooks\\validate.cjs"],"timeoutMs":3000}],
    "observers": [{"id":"audit","executable":"C:\\Program Files\\nodejs\\node.exe","args":["D:\\MyHooks\\observe.cjs"],"timeoutMs":3000}]
  }
}
```

可执行文件和脚本必须替换为实际受信路径。Hook 接收一行 JSON stdin；退出 0 表示通过/投递成功，非 0 为失败。校验事件为 `command.validate`，带 command；观察事件为 `event.observe`，带 event 和稳定 deliveryId。不传控制令牌，不继承 API Key 环境变量，无 shell 展开，限制输出与超时。

before 失败/超时阻止系统动作并记录 failed。观察 Hook 消费持久事件，每个 Hook 独立游标，成功后写 `hook-deliveries.json`；失败退避重试，不重跑原系统动作。进程在投递成功但落盘前崩溃可能重复投递，消费者须按 deliveryId 去重。观察脚本需要更多信息时，可由另一个具备授权的客户端查询操作日志。

## 验收边界

已进行真实 Windows 资源读取与隔离 Node 服务/ConPTY 验收。原生组件与主进程 IPC 有行为测试；构建成功不等于真实窗口验收。真实计划任务创建受当前权限限制，SCM/WSL/Startup 写操作、UAC、远程设备及 macOS/Linux 控制必须分别验收后才可宣称支持完成。

当前磁盘展示容量和剩余空间，不含文件删除、重复文件清理或磁盘 I/O 曲线。远程 SSH 管理不由这个本机接口冒充；后续设备适配仍使用相同命令/查询/事件语义。
