# 开发源码映射与改造边界

## 当前架构导航与证据边界（v2.3 设计增补）

当前开发要求同时见 [开发 SPEC](NIMBALYST-DEVELOPMENT-SPEC.md)、[Trackers 映射](NIMBALYST-TRACKER-MAPPING.md)、[系统规格](NIMBALYST-SYSTEM-SPEC.md) 与 [GUI / TUI / CLI 功能对等及 Hooks 契约](NIMBALYST-TUI-HOOKS-SPEC.md)。本节只登记新的设计要求和待核实接缝，没有新增上游源码阅读、构建或运行证据；下文固定提交、路径、行号和历史结论原样保留。

当前目标是 Nimbalyst GUI、交互式 TUI、非交互 CLI 共用领域服务、命令守卫与权威 Tracker，Hooks 使用同一持久事件并提供受控前置校验。M0 包含独立非图形 demo 服务与三端闭环，不依赖 Electron 图形服务、桌面窗口或显示服务器。同一 GUI 工作区内原生/执行面板共享 TrackerDataSource 实例；跨进程客户端分别持适配实例，共用服务和 `(projectId, trackerId)`，不能共享 renderer atoms 或另建可写任务副本。

| 设计导航（均待实施） | NB-00 必须核实的边界 | 后续归属 |
|---|---|---|
| 公共领域服务、独立 demo 服务、command/query 客户端 | 目标 HEAD 的 Electron/DOM 依赖、运行时与存储生命周期、纯终端启动/连接方式；不得假称上游已可无头运行 | NB-01 合同；NB-02 公共核心/demo/CLI 首个闭环，再接 GUI/TUI shell |
| DemoTrackerDataSource / BabelTrackerDataSource / TrackerCommandRouter / RunControlClient | 对齐既有 TrackerDataSource，核对直接 IPC、documentService、MCP 与文件回流；具体模块位置仍为拟新增 | NB-03/04 模拟三端；NB-05～08 真实服务、守卫与节点 |
| 交互式 TUI、非交互 CLI | TUI 库许可、Windows 终端/中文/键鼠支持、JSON/JSONL 输出与 PTY/ConPTY 验收；上游支持情况未核验 | NB-00 能力矩阵；NB-01 合同；NB-02～04 M0 |
| beforeCommand / Hook dispatcher / outbox 消费者 | 拟新增的应用级 Hook 合同，区分核心守卫、命令前校验和提交后事件；不能把厂商 Hook 名称当作已有 Babel API | NB-01 事件/错误/幂等合同；NB-03/04 故障注入；生产阶段再验收持久服务 |

GUI/TUI/CLI/MCP/Hook 的写入均进入同一权限、revision、幂等与完成/归档守卫。Hook 退出码、日志或 run.finished 不能自行证明 DONE；模型测试需保存命令结果、关联事件及权威查询断言，TUI 另有真实终端输入验证。新增业务逐项满足能力矩阵，不能将 M0 宣称为整个 Nimbalyst 全功能终端等价。

下文 §4.2 的 Deck 权威及 DeckTaskProjectionAdapter、AFFiNE/Nextcloud 必选依赖和旧单 GUI M0 建议属于历史方案，不是本轮实施要求；当前使用 canonical TrackerRecord、同一领域服务及上述三端/Hooks 合同。历史源码哈希和已读符号依然仅证明当时的源码定位，不证明这些拟新增模块存在。完整旧包另存于 [reference/v2.2](reference/v2.2/README.md)。

> 最新补充：[Trackers 一一映射与源码审计](NIMBALYST-TRACKER-MAPPING.md)，2026-09-14 实读 HEAD d6e1d008d9ee264a7447f3533fa9f48f158a70b0。旧表的 07779ab 基线和许可描述保留为历史记录，不能冒充新版本检查。新文档定位了 TrackerDataSource、tracker-core、原生看板、保存视图及直接 IPC 写路径。

> 2026-09-14：本机 Nimbalyst HEAD 已再次核对，仍为下述固定提交。源码导航保留；本文涉及 Deck 投影/Nextcloud 必选依赖的旧建议已过时。最新方案见 [ADR-003](decisions/ADR-003.md) 与 [Nimbalyst 系统规格](NIMBALYST-SYSTEM-SPEC.md)：共享任务由 Babel 后台持久化，Nimbalyst 是主底座。

状态：开发规格附件；源码阅读已完成，未执行应用构建或端到端验证。

核验日期：2026-09-13。本文仅定位可复用接口及需要新增的适配层，不宣称六平台协作、远程文件或 Pi 接入已经实现。

## 1. 核验基线

| 对象 | 核验方式 | 本轮基线 |
|---|---|---|
| Nimbalyst | 本机 Git 工作树、接口源码、仓库规范 | 本地Nimbalyst检出目录（绝对路径已移除）；HEAD `07779ab118c6659c0c1788e5666420aef988b144` |
| Nimbalyst 工作树状态 | 读取前后各运行 `git status --porcelain=v1` | 两次均为空；本轮未修改源码、依赖、数据库或运行中的应用 |
| AFFiNE | 官方 GitHub API 树及固定提交 raw 源码 | canary 提交 `868acf8505eb349223e367ef75070d24eb04f7ad`；不是已验证的部署版本 |
| Nimbalyst 服务器授权 | 本机 README / LICENSING，以及官方部署说明 | 客户端仓库 MIT；协作服务器是独立、受限许可项目 |
| AFFiNE 授权 | 官方固定提交 LICENSE / 后端 LICENSE | 前台与后端有不同授权边界；不可称为全仓 MIT |

已阅读 Nimbalyst 根 `AGENTS.md`、根 `CLAUDE.md`、`packages/runtime/CLAUDE.md`、`packages/electron/CLAUDE.md`。实施时还必须阅读涉及领域的 IPC、扩展、数据库、会话、worktree 和事件文档。本文不进入运行中的 Nimbalyst 数据库，也没有执行安装、重启或迁移。

本附件的新增类名和目录是设计提案；只有下表明确列出的现有文件和符号属于源码核验结果。执行前须重新检查目标提交及工作树，不能把本文行号当成未来版本的固定位置。

## 2. Nimbalyst：文件系统不是一个完整的远程接口

### 2.1 已核验入口

以下路径均相对于Nimbalyst仓库根目录；执行前定位自己的检出目录。

| 现有文件与行号 | 已核验内容 | 实施边界 |
|---|---|---|
| `packages/runtime/src/core/FileSystemService.ts:38` | `FileSystemService`，含 workspace、搜索、列表、文本读取 | 可以扩展资源读取适配；没有写入、重命名、条件保存、watch、断线恢复等完整远程语义 |
| 同文件 `:47 / :57 / :66` | `searchFiles`、`listFiles`、`readFile` | 返回结果带 success/error，读取可能 truncated；截断内容不能被用户直接覆盖保存 |
| 同文件 `:103 / :107` | 按 workspace 路径注册服务的 `setFileSystemServiceFor` / `getFileSystemServiceFor` | 远程资源必须显式项目隔离；不得回落到“当前前台项目”的全局服务 |
| `packages/electron/src/main/services/ElectronFileSystemService.ts:28` | `ElectronFileSystemService` | 现有实现使用本机 `fs/promises`；保留本地路径处理 |
| 同文件 `:43 / :138 / :232` | 搜索、列表、读取的实现 | 不把 SFTP URI 传给本地 fs 或 path.resolve 冒充支持远程文件 |
| `packages/extension-sdk/src/types/editor.ts:253` | `EditorHost` 契约 | 复用编辑器；必须区分本地路径和远程资源引用 |
| 同文件 `:331 / :352 / :370` | `loadContent`、`onFileChanged`、`saveContent` | 是接入远程编辑体验的另一条必要边界，不能只替换 FileSystemService |
| `packages/electron/src/renderer/components/TabEditor/createEditorHost.ts:113` | 工厂把编辑器接到现有加载、保存、watch 回调 | 为远程标签页注入 RemoteEditorHost；本地编辑保持旧路径 |
| 同文件 `:151` | `virtual://` 标签页保存被忽略 | 不能用 virtual:// 实现“已保存远程文件”；必须等待真实后端确认 |
| `packages/runtime/src/extensions/ExtensionPlatformService.ts:44 / :51` | 扩展平台有 readFile/writeFile | 这是另一条本地文件访问通道；首期禁止让扩展绕过 Gateway 访问远程设备 |

### 2.2 拟新增而非现成能力

建议在我们自己的适配包中定义 `RemoteResourceClient`、`RemoteEditorHost`、`RemoteResourcePanel`。请求走 Gateway HTTPS，Gateway 再调用 Nextcloud Files/WebDAV 或已登记的设备 SFTP 连接。SSH 私钥不进入 renderer、浏览器存储或 AFFiNE 文档。

文件访问入口应持有结构化引用，而不是解析任意用户拼接地址：

```ts
type RemoteResourceRef = {
  resourceId: string;
  projectId: string;
  deviceId: string;
  rootId: string;
  relativePath: string;
};

type LoadedResource = {
  content: string;
  revision: string;
  editable: boolean;
  truncated: boolean;
};
```

这里的 `revision` 是 Gateway 的条件更新令牌；它不等于“SFTP 原生支持 HTTP ETag”。对于经 WebDAV 获取的资源可保存服务器版本信息，并验证目标服务的条件写入语义。SFTP 单独的“比较后覆盖”有外部写入竞争窗口，Gateway 自己的锁也不能阻止其他本地进程修改。首期 SFTP 默认只读；不能保证条件更新时只允许保存为新副本，不覆盖原件。原位编辑须另行通过远端文件代理及竞争写入验收后开放。

最小 UI 改造：设备分组、离线标记、远程文件位置、只读/可编辑标记、保存中/保存成功/冲突状态。原编辑工具栏与差异审阅尽量复用。

首期只支持小型 UTF-8 文本文件读取；经验证支持条件写入的后端才开放明确授权后的原位保存。SFTP 默认只读或另存副本。二进制预览、大文件下载、目录重命名和递归操作按各自能力标志开放；不能因菜单原来存在就对远程目录启用删除。

### 2.3 必须通过的适配验证

- 两个项目、同名文件和两个设备同时打开，不交叉读取或保存。
- 设备离线、请求中断、SSH 主机密钥变化分别给出可区分错误。
- 外部进程在读取后修改文件，保存返回冲突；原件不被覆盖。
- 被截断内容不可编辑保存；中文路径与 Windows 大小写规则单独验证。
- 项目根外路径、`..`、符号链接/联接逃逸被后端拒绝。
- 编辑器仅在服务器确认写入后清除 dirty；断网后仍保留用户未保存内容。
- 文件访问与命令执行分别授权；拥有 SFTP 读写不自动获得终端权限。

## 3. Nimbalyst：Pi 与会话事件

### 3.1 已核验入口

| 文件与行号 | 现有内容 | 拟接法 |
|---|---|---|
| `packages/extension-sdk/src/agents/AgentProtocol.ts:213` | Agent 协议入口 | 作为会话生命周期与事件映射的参考契约 |
| 同文件 `:225 / :234 / :246` | create、resume、fork | Pi/Worker 无法提供的能力明确禁用；不把“新建空会话”伪装成恢复原会话 |
| 同文件 `:165 / :255` | `ProtocolEvent`、流式 sendMessage | Gateway 事件投影到现有文本/工具/错误/usage UI |
| `packages/runtime/src/ai/server/providers/BaseAgentProvider.ts:30` | 内置 Agent 公共基类 | 复用思路：会话映射、取消、权限请求；不复制整个内置提供商 |
| `packages/runtime/src/ai/server/ProviderFactory.ts:18` | 内置提供商工厂 | 不是首选直接修改的开关表 |
| 同文件 `:116` | `createExtensionAgentProvider` | 优先走已有扩展提供商通路，减少长期 fork 差异 |
| `packages/runtime/src/ai/server/providers/ExtensionAgentProvider.ts:43 / :117 / :140` | bridge 契约、bridge 安装、provider 包装 | 新扩展通过 Gateway 驱动远端 Pi Worker；首次启动/权限符合现有扩展宿主机制 |
| `packages/runtime/src/ai/server/providers/agentProtocol/AgentProtocolTranscriptAdapter.ts:44` | 协议事件到 transcript 的转换适配 | 对齐现有语义；是否直接复用需由 M0 的事件夹具试验决定 |
| `packages/runtime/src/storage/repositories/AgentMessagesRepository.ts:3 / :25` | 可注入的 raw message store | 在正式适配层记录外部执行的本地投影，不直接操作数据库文件 |
| `packages/runtime/src/ai/server/transcript/TranscriptTransformer.ts:83 / :128 / :226` | 单一路径转换器、事件回调、增量转换 | 保留“raw → canonical”唯一写入路径，不让新适配器同时写两套 transcript |

M0 必须检查扩展 backend manifest 和宿主生命周期的完整约束，做一个 fake Gateway 事件回放扩展，验证注册、会话列表、取消和错误显示。确认这条通路可行后，再绑定真实 Pi SDK/RPC。不能仅凭 AgentProtocol 的 TypeScript 类型存在，就宣布第三方 Agent 无改动即插即用。

### 3.2 拟新增模块

| 拟新增模块 | 所在层 | 责任 |
|---|---|---|
| `pi-gateway-agent` 扩展 | Nimbalyst 扩展包 | 用户选择项目/任务；连接 Gateway；显示当前 run |
| `GatewayAgentProtocol` | 我们的客户端适配包 | 将运行事件映射成 Nimbalyst 支持的事件，并处理重连游标 |
| `RunSessionMap` | Gateway + 客户端投影 | 关联 `runId`、`attemptId`、Nimbalyst session 和 Pi session，不按标题关联 |
| `PiWorkerAdapter` | 独立 Worker 服务 | 在被分配的设备与隔离工作目录执行 Pi SDK/RPC，产生真实工具/验证事件 |

Nimbalyst 只提交一个 run 请求，不同时启动本地 Pi 子进程和远端 Pi Worker。Worker 的运行记录由 Gateway 持久化，本地 transcript 只是可重建投影。

连接断开不等于执行停止。取消动作必须经过 Gateway 到拥有该 run 的 Worker，得到终止确认后才显示取消完成。恢复 UI 时通过游标补齐遗漏事件，不重新派发任务。

不读取任意环境变量作为模型密钥兜底，不把现有订阅或个人 API key 默认为 Worker 授权。使用用户明确配置的提供商凭据引用；部署时由凭据管理层注入 Worker，禁止写入任务标题、日志或仓库。

## 4. Nimbalyst：Tracker 可以复用展示，但不能成为第二份任务权威

### 4.1 已核验数据入口

| 文件与行号 | 核验结果 | 设计含义 |
|---|---|---|
| `packages/runtime/src/core/TrackerRecord.ts:43` | 通用 `TrackerRecord` | 可用作列表/卡片投影模型 |
| 同文件 `:49` | source 只有 native、inline、frontmatter、import | 远程 Deck 不是现成 source；需独立 adapter 或明确新增来源 |
| `packages/runtime/src/plugins/TrackerPlugin/trackerDataAtoms.ts:25 / :124 / :144` | 记录 map、upsert、全量替换 | 可参考更新展示的方式；不能拿全量 Deck 覆盖用户已有本地 Tracker |
| `packages/runtime/src/plugins/TrackerPlugin/components/useTrackerRows.ts:87 / :152` | 共享行交互及字段更新 | 字段更新实际调用 electronAPI.documentService；必须为远程卡片分流 |
| `packages/runtime/src/sync/trackerPersistence.ts:63` | 本地投影、事务队列的持久化契约 | 不等于 Deck API；原同步引擎不能直接改 base URL 冒充兼容 |
| `packages/electron/src/main/services/tracker/TrackerPGLiteStore.ts:114` | 本地 TrackerPersistence 实现 | 保留现有 Tracker；新共享任务投影与本地同步分开 |
| `packages/electron/src/renderer/components/AgentMode/TrackerPanel.tsx:41` | Tracker 面板 | 复用布局、筛选、详情；增加共享项目来源与 run 摘要 |

### 4.2 本项目应有的数据写入规则

1. 共享任务标题、正文、标签、看板位置由 Nextcloud Deck 保存。客户端通过 Gateway 请求 Deck 更新。
2. Gateway 保存稳定的 `taskId ↔ Deck board/stack/card ID` 映射、运行快照、权限及幂等记录。
3. Nimbalyst 原生本地任务保持原来数据来源。与 Deck 任务并列显示时有明确来源；不能默认批量导入或双向全量同步。
4. 拖动卡片和编辑字段只有远端确认后才持久确认。乐观 UI 被拒绝时回滚并提示。
5. Agent 阶段在独立 run 字段显示，不把心跳、token 或工具调用不断写入任务标题。
6. 不新增第二个定时器去扫描 Nimbalyst 的数据库文件；使用应用的正式服务/仓储/事件边界。

建议先实现 `DeckTaskProjectionAdapter`，把最少字段映射到现有看板；M0 明确哪些纯展示组件能直接复用。其余保留 `RemoteTaskPanel` 薄层，避免为了表面复用将两个同步引擎强行耦合。

## 5. AFFiNE：保留文档与 CRDT，只增加引用和操作入口

### 5.1 固定提交中已核验的官方源码

下面链接均指向本轮读取的官方固定提交，不是本机已安装 AFFiNE 的版本。

| 已核验官方源码 | 可复用内容 | 本项目边界 |
|---|---|---|
| [bookmark-block.ts](https://github.com/toeverything/AFFiNE/blob/868acf8505eb349223e367ef75070d24eb04f7ad/blocksuite/affine/blocks/bookmark/src/bookmark-block.ts#L29) | `BookmarkBlockComponent`，链接预览、标题、图片及只读状态 | 最小首版使用 Gateway HTTPS 任务/资源链接，验证现有链接卡片行为 |
| [bookmark/index.ts](https://github.com/toeverything/AFFiNE/blob/868acf8505eb349223e367ef75070d24eb04f7ad/blocksuite/affine/blocks/bookmark/src/index.ts#L1) | 书签块模块出口 | 定位模块组织；不假定公开可安装第三方插件 |
| [embed-linked-doc-spec.ts](https://github.com/toeverything/AFFiNE/blob/868acf8505eb349223e367ef75070d24eb04f7ad/blocksuite/affine/blocks/embed-doc/src/embed-linked-doc-block/embed-linked-doc-spec.ts#L12) | `BlockViewExtension` 及文档/白板两种视图注册 | 二期开 `workbench-task` / `workbench-resource` 自定义块时参考；它本身是内部文档链接，不是远程任务实现 |
| [merge-updates.ts](https://github.com/toeverything/AFFiNE/blob/868acf8505eb349223e367ef75070d24eb04f7ad/packages/backend/server/src/core/doc/merge-updates.ts#L3) | 使用 Yjs 更新合并及 native 合并路径 | 证明文档后端具有 CRDT 同步职责；不是可替换成普通文件覆盖的存储层 |

拟新增 `WorkbenchReferenceClient`，只向 Gateway 查询 task/run/resource 的显示摘要及操作权限；文档中保存稳定引用与可选快照。动态状态不持续写回 CRDT 文档，以免每次 Worker 心跳都形成文档修改。

先保留 HTTPS 链接回退，再做卡片增强。任何无法解析的自定义块在导出或旧客户端中至少保留标题和可打开链接。任务详情来自 Gateway，授权失败时显示“无权限”，不可继续展示过期敏感摘要。

### 5.2 尚未核验，必须在 M0 定位

- 与实际部署 CE 版本相符的前端工作台注册入口、slash-menu 注册入口与构建命令。
- 当前版本是否提供面向用户的稳定第三方扩展分发入口。官方 README 的插件规划不能当作插件商城已经可用。
- 自定义块 schema 的迁移、Markdown/HTML 导出、移动端视图兼容和未知块降级。
- 工作区账号与我们统一身份之间的绑定方式、令牌刷新及注销联动。
- Nextcloud 文件资源和 AFFiNE blob 的引用/复制策略；不得擅自搬迁现有附件。
- 所选 AFFiNE CE 镜像中的组件清单、协作端点、许可证和客户端版本匹配。

未满足以上门禁前，首期只交付稳定 HTTPS 资源链接与普通文档卡片；不重写 AFFiNE 文档同步后端，也不宣称一个 Gateway 已接管所有软件数据。

## 6. 许可证与版本门禁

这部分是工程分发清单，不是法律意见；最终采用的版本必须附原始许可证文本与依赖清单。

### Nimbalyst

- 已核验提交的 [LICENSE](https://github.com/nimbalyst/nimbalyst/blob/07779ab118c6659c0c1788e5666420aef988b144/LICENSE#L1) 为 MIT。
- 同一提交的 [README](https://github.com/nimbalyst/nimbalyst/blob/07779ab118c6659c0c1788e5666420aef988b144/README.md#L157) 与 [LICENSING.md](https://github.com/nimbalyst/nimbalyst/blob/07779ab118c6659c0c1788e5666420aef988b144/LICENSING.md#L5) 明确协作服务器属于独立项目。
- [官方部署说明](https://nimbalyst.com/quant/) 将该服务器描述为可审阅源码但受限许可的商业产品。我们不复制或部署该服务器作为开源底座。
- 新 Gateway 独立实现本项目的数据和任务协议；不以改地址方式承诺兼容其官方共享数据库、文档加密与同步。

### AFFiNE

- [根 LICENSE](https://github.com/toeverything/AFFiNE/blob/868acf8505eb349223e367ef75070d24eb04f7ad/LICENSE#L3) 将 `packages/backend` 和 `packages/common/native` 指向另一份后端许可证，其他未受限制部分使用 MIT。
- [后端 LICENSE](https://github.com/toeverything/AFFiNE/blob/868acf8505eb349223e367ef75070d24eb04f7ad/packages/backend/server/LICENSE#L1) 含 EE 生产使用条款，并对 CE 分发部分及客户端代码说明 MPL 2.0 适用范围。
- 因而必须锁定实际 CE release/image 与它包含的组件，记录哪些模块属于 CE，不能只引用 README 的 MIT 描述就把整个 canary 后端当 MIT。
- 首期保留经版本核验的 CE 文档后端；在已明确授权的前台区域增加任务/资源引用。M0 无法确认的 EE 模块不进入生产依赖。

## 7. 交付给实现 Agent 的最小定位任务

| ID | 实施前必须交付的证据 | 通过条件 |
|---|---|---|
| SRC-01 | Nimbalyst 提交、工作树状态、实际运行版本 | 三者分别记录；不把已安装二进制和源码 HEAD 混同 |
| SRC-02 | fake Gateway Agent 扩展 | 在隔离测试环境注册成功、事件显示正确、取消/失联有区分；无需真实模型调用 |
| SRC-03 | RemoteEditorHost 夹具 | 中文路径、截断只读、外部变更冲突、离线未保存内容均通过 |
| SRC-04 | 共享任务投影夹具 | 本地 Tracker 不变；远端拒绝会回滚；重复事件不复制任务 |
| SRC-05 | 事件回放 | 重复、乱序、断线补齐不产生重复工具调用或重复派发 |
| SRC-06 | AFFiNE CE 版本清单 | 明确镜像版本、固定源码、客户端匹配和许可证组成 |
| SRC-07 | AFFiNE 链接卡片试验 | 文档/白板可打开同一任务；失去权限后不显示敏感摘要；旧客户端保留可读链接 |

完成这些才进入真实 Ubuntu 服务连接及 Pi 运行验收。本轮只产出此源码映射，没有执行上述夹具或测试。
