# Windows 原生 M0 启动与复验

> 后续主开发环境已确定为 macOS，先读 [macOS 交接](../MACOS-DEVELOPMENT-HANDOFF.md)。本文保留 Windows 历史启动与复验方法；本机 Mac 当前结果见 [TASK_EVIDENCE](../TASK_EVIDENCE.md)，不是要求先在 Windows 完成开发。

本分支包含候选源码，不是可发布安装包。先读 [验收边界](ACCEPTANCE.md)。本轮使用 Windows、Node 24.12、npm 11.6；macOS/Ubuntu 尚未复验。所有操作使用独立演示 profile，不登录真实账号，不启动真实 Pi。

## 准备源码

下面假设仓库放在 `D:\Projects\babel-github-delivery`；其他位置请调整 `$repo`。两个终端都需要各自设置环境变量。依赖、缓存及运行数据不在 Git 仓库中。

```powershell
$repo = 'D:\Projects\babel-github-delivery'
$src = Join-Path $repo 'implementation\nimbalyst'
$env:npm_config_cache = 'D:\Projects\babel-nimbalyst-cache\npm'
Set-Location $src
npm ci
npm ci --prefix packages/babel
npm run build --prefix packages/runtime
npm run build --prefix packages/extensions/nimbalyst-memory/engine
```

这是新检出的准备顺序，本轮验收复用了原开发检出已有依赖；没有把一次全新 `npm ci` 当作已测结果。其他原生扩展可能还需按其构建说明生成 dist；本轮没有回归宿主的全部扩展。

## 终端一：权威演示服务

选择未使用过的 profile 路径；不要删除或覆盖旧的用户数据。若端口已占用，先确认进程所属，或同时修改所有客户端端口。

```powershell
$repo = 'D:\Projects\babel-github-delivery'
$env:BABEL_PROFILE = 'D:\Projects\babel-nimbalyst-data\review-20260916'
$env:BABEL_PORT = '7780'
Set-Location (Join-Path $repo 'implementation\nimbalyst\packages\babel')
node --import tsx scripts/acceptance-server.ts
```

脚本创建缺失的目录及随机服务令牌；模拟每步间隔 3 秒，便于验证关闭 GUI 后继续执行。新脚本已在独立 7781 端口验证启动与 `/v2/health`。不要上传 `service.token` 或运行 profile。关闭服务进程会停止执行；持久化不等于已经实现全部崩溃恢复。

## 终端二：原生 Electron 宿主

```powershell
$repo = 'D:\Projects\babel-github-delivery'
$env:BABEL_PROFILE = 'D:\Projects\babel-nimbalyst-data\review-20260916'
$env:NIMBALYST_USER_DATA_DIR = 'D:\Projects\babel-nimbalyst-data\review-electron-20260916'
$env:BABEL_DEMO_WORKSPACE = Join-Path $env:BABEL_PROFILE 'workspaces\babel'
$env:BABEL_ENDPOINT = 'http://127.0.0.1:7780'
$env:BABEL_PROJECT_ID = 'fixture-project-babel'
$env:NIMBALYST_CDP_PORT = '9223'
Set-Location (Join-Path $repo 'implementation\nimbalyst\packages\electron')
npx electron-vite dev -- --workspace $env:BABEL_DEMO_WORKSPACE
```

在原生工作区窗口进入 **Trackers → 执行视图**。`Ctrl+T` 用于进入 Trackers；已经在 Trackers 时也可能切换侧栏显示。首次启动完成开发模式引导，跳过账号连接。不要把 Project Manager、已安装正式版或独立 Vite 网页当作该宿主窗口。CDP 仅供本机验收，不对外开放。

## 终端三：CLI / 交互 TUI

```powershell
$repo = 'D:\Projects\babel-github-delivery'
$env:BABEL_PROFILE = 'D:\Projects\babel-nimbalyst-data\review-20260916'
$env:BABEL_ENDPOINT = 'http://127.0.0.1:7780'
Set-Location (Join-Path $repo 'implementation\nimbalyst\packages\babel')
node --import tsx src/cli/main.ts task list --project fixture-project-babel --json
node --import tsx src/tui/main.ts --project fixture-project-babel
```

TUI 需要真实终端：`/` 搜索，输入标题后回车；详情更新后 `s` 启动模拟任务，待验收后 `v` 并回车验收。完整按键以界面帮助为准。CLI 可加 `--help`。所有端连接同一服务并使用相同 projectId、trackerId、runId。

## 检查命令

在源码根目录执行：

```powershell
npm run typecheck
npm run typecheck --prefix packages/babel
npm test --prefix packages/babel
npm run test:prepush
```

最后一项在本轮存在 206 项失败，不能跳过后宣称发布通过。Babel 不是根工作区测试的替代品，也需要单独运行。

原生 E2E 要求上述隔离服务与窗口已启动，进入 Trackers、关闭首次引导。测试会修改演示任务并关闭工作区窗口；只在指定隔离 profile 上运行，逐个 spec 执行：

```powershell
$env:BABEL_ACCEPTANCE_CDP = 'http://127.0.0.1:9223'
$env:BABEL_ENDPOINT = 'http://127.0.0.1:7780'
$env:BABEL_PROFILE = 'D:\Projects\babel-nimbalyst-data\review-20260916'
npx playwright test packages/electron/e2e/babel/three-surfaces.spec.ts --workers=1 --max-failures=1
# 从 Project Manager 重新打开同一个隔离工作区后，再运行：
npx playwright test packages/electron/e2e/babel/archive-native.spec.ts --workers=1 --max-failures=1
```

当前原生测试按开发 renderer 端口 5273 查找窗口，要求该端口没有被其他开发实例占用。真实 ConPTY 测试仅在 Windows 验证。截图、具体覆盖与未完成项目见 [ACCEPTANCE.md](ACCEPTANCE.md)。
# 真实设备与服务控制台

本轮新增模块的命令、清单和权限说明见 [SYSTEM-CONSOLE.md](nimbalyst/packages/babel/SYSTEM-CONSOLE.md)。原生窗口左导航选择“设备与服务”；它使用独立的真实控制后台 7782，下面任务演示服务 7780 不替代它。
