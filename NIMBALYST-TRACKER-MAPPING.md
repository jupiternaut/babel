# Nimbalyst 源码审计：巴别塔与 Trackers 一一映射

日期：2026-09-14。方法：本机静态源码与现有测试源码阅读，未修改 Nimbalyst、未读取用户任务数据库、未执行应用测试。代码基线 `d6e1d008d9ee264a7447f3533fa9f48f158a70b0`；截图中的运行程序版本尚未核对，不能认定与源码完全相同。

本文件是 [开发 SPEC](NIMBALYST-DEVELOPMENT-SPEC.md) 的必要补充。新的要求是：**巴别塔应成为原生 Trackers 的执行视图，同一个 Tracker 条目在两种布局下显示；不是在旁边新增一套任务库再定时同步。**

设计更新：v2.3 与 [GUI / TUI / CLI 功能对等与 Hooks 契约](NIMBALYST-TUI-HOOKS-SPEC.md) 配套实施。M0 已扩展为共用领域服务的 GUI、交互式 TUI、非交互 CLI 与 Hooks 闭环，要求无显示环境独立运行。下面的固定提交、源码路径与符号仍是历史静态阅读证据；本次新增的终端、无头服务与 Hook 接缝是待实施设计，必须由 NB-00 在目标源码中核实，不能据此声称上游已经支持。

可追溯证据见 [33 份源码的固定提交、SHA256 与符号行号](design/nimbalyst-source-evidence.json)。该清单记录本轮针对关键分支的阅读与定位，不表示逐行审计了整个仓库，也不表示测试通过。

## 1. 原生 Trackers 已经具备什么

用户截图当前选中 `Releases`。左边的 Plans、Decisions、Bugs、Tasks、Ideas、Milestones、Releases 是 Tracker **类型**；Ready 位于 Saved Views，是**保存视图**；上方 Open/All/Closed 是**生命周期筛选**。它们属于三个独立维度。

原生看板也并非只有列表：`TrackerMainView` 根据显示模式渲染 `KanbanBoard` 等组件，详情通过 `TrackerItemDetail` 打开。截图中没有卡片不能证明软件没有看板。

需要保留这些类型、模式和信息，而非简单把原菜单改名成待办/运行/完成/归档。

### 真实调用链

```text
TrackerMode.tsx
  ├─ TrackerSidebar.tsx
  │    ├─ 类型：registry / navigationEntries
  │    └─ 保存视图：allTrackerSavedViewsAtom + builtin:ready
  └─ TrackerMainView.tsx
       ├─ trackerItemsByTypeAtom / archivedTrackerItemsAtom
       ├─ filterTrackerItems + readiness + statusScope
       ├─ KanbanBoard.tsx / 其他显示模式
       │    ├─ TrackerBoardCard（共享 trackers-ui）
       │    └─ saveTrackerFields / saveTrackerFieldsBatch
       ├─ TrackerItemDetail.tsx
       └─ buildTrackerLaunchContext → sessions:create → tracker:link-session
```

数据进入 renderer 的实际链路：

```text
ElectronTrackerDataSource（IPC） / BrowserTrackerDataSource（官方同步协议）
  → snapshot / subscribe / command
  → trackerSyncListeners
  → trackerItemToRecord
  → replaceAllTrackerItemsAtom / upsertTrackerItemAtom
  → 同一份 trackerItemsMapAtom
  → 原生 Tracker 视图 与 拟增加的 Babel 执行视图
```

主要源码定位：

| 位置 | 源码证据与意义 |
|---|---|
| `packages/electron/src/renderer/components/TrackerMode/TrackerMode.tsx:292` | 构造 Sidebar；类型、筛选、保存视图作为同一组状态传入 |
| 同文件 `:325` | 同样的筛选和视图配置传入 TrackerMainView |
| `packages/electron/src/renderer/components/TrackerMode/TrackerMainView.tsx:544` | 同时存在 active 与 archived 数据集合；原默认集合不会自动同时含归档 |
| 同文件 `:1527` | 实际渲染原生 KanbanBoard 的入口 |
| `packages/collab-client/src/trackers/dataSource.ts:166` | 已有 TrackerDataSource，而非需要从零设计的概念 |
| `packages/electron/src/renderer/store/listeners/trackerSyncListeners.ts:237` | 当前绑定代码直接构造 ElectronTrackerDataSource；是后台切换的宿主接缝 |
| `packages/tracker-core/src/trackerRecord.ts:97` | TrackerRecord 的真正类型定义；runtime/core 同名文件是兼容导出 |

## 2. 一一映射的精确定义

一一映射针对**业务条目身份**，不是要求每个屏幕组件都对应一种 Tracker 类型。

```text
一条 TrackerRecord ── 同一个 ID ── 一张 Babel 卡片
        │                              │
        ├─ 同一正文/字段/类型/归档       └─ 执行状态的简化展示
        └─ 0..N 条 Run ── 各自绑定 Session / Worktree / Evidence
```

必须满足：

1. Babel 卡片 ID = 原条目 `TrackerRecord.id`。数据库唯一身份是 `(projectId, trackerId)`；不使用标题、issueKey 或本机路径连接记录。
2. 同一项目只有一个条目权威数据源；两个界面共享记录和命令入口。允许本地缓存，不允许独立维护第二份可写标题/正文。
3. 同一条目可以有多次 run、多个讨论会话；不把 task→run→session 强制为永久一对一。每次受管 run 的执行会话身份必须明确。
4. 从原生 Tasks 改标题，Babel 立即看到同一版本；Babel 归档，原生 Archived 筛选看到同一个 ID。无需导出、导入或定时对账后才能一致。
5. 类型字段与未知自定义字段无损保留。API 面向执行的 Task DTO 是 TrackerRecord 的视图，不是另外一张业务任务表。
6. 运行统计、设备快照和服务探测不是 Tracker 条目，不为了“映射”把设备创建为 Task。
7. 同一 GUI 工作区绑定生命周期内，原 Trackers 和 Babel 面板共享同一个 provider / TrackerDataSource 实例。独立进程的 GUI、TUI、CLI 各自持客户端适配实例，共用同一权威服务和 `(projectId, trackerId)`，通过快照、revision、事件游标保持一致；不要求跨进程共享内存对象或 renderer atoms。
8. GUI、交互式 TUI 和非交互 CLI 对同一受支持业务操作得到相同结果、版本与拒绝原因。每项新增能力进入功能矩阵，Hooks 消费同一权威事件；不能在终端另存一份可写任务库，也不能以三端都禁用某功能来宣称该功能已完成。

## 3. 左侧导航与原生面板逐项映射

| 原生入口 | Babel 对应入口 | 对应对象/代码 | 行为要求 |
|---|---|---|---|
| TRACKERS 模式 | 工作区 → 任务看板 | `TrackerMode` + 新执行展示模式 | 进入同一项目记录，保留原生显示模式切换 |
| Saved Views | 任务看板下的“视图”分组 | `SavedView.id/definition` | 复用同一视图定义，不能存两套同名视图 |
| Ready | 视图 → Ready / 可开始 | `builtin:ready` | 保留依赖就绪含义；不替代全部 TODO |
| All | 类型 → 全部 | `selectedType='all'` | 全部类型仍可查看；执行总览默认筛可执行类型，不删除其他类型 |
| Plans | 类型 → 计划 | `primaryType='plan'` | 计划正文、状态、依赖、关联会话保留；可按权限显式启用执行 |
| Decisions | 类型 → 决策 | `primaryType='decision'` | 决策记录；审阅或实施另关联 Task，默认不自动执行 |
| Bugs | 类型 → 缺陷 | `primaryType='bug'` | 同一 Bug 可直接进入受管执行，不复制成 Task |
| Tasks | 类型 → 任务 | `primaryType='task'` | 默认执行入口；Google 导入创建这里的一条 Task |
| Ideas | 类型 → 想法 | `primaryType='idea'` | 想法保留；转为开发事项通过明确转换/关联操作，不暗中执行 |
| Milestones | 类型 → 里程碑 | `primaryType='milestone'`、collection 关系 | 聚合成员、截止日期、进度；不是项目或一条 Agent 进程 |
| Releases | 类型 → 发布 | `primaryType='release'` | 发布版本、tag、channel、时间；**不是归档列** |
| 自定义类型/类型文件夹 | 类型分组原样保留 | schema registry / navigationEntries | 动态读取，不写死为截图中的七个类型 |
| Open / All / Closed | 生命周期筛选菜单 | `statusScope` | open/closed 与 archived 独立；进入四列全览使用 all |
| Save view | 保存当前视图 | `buildCurrentViewDefinition` / `applySavedViewToLayout` | 包含类型、筛选、分组、排序、显示模式；新增设备条件需共同扩展序列化 |
| Filter | 单个筛选菜单 | `TrackerFilterSet` / filter helpers | 同一查询语义，不另写一个只查标题的假筛选 |
| Display | 显示模式菜单 | 原有 viewMode + 新 Babel execution 模式 | 切换只换布局，不创建/复制条目 |
| Import | 导入菜单 → Google Tasks 等 | source mapping + create-item | 去重；导入后原生 Tasks 与 Babel 同时可见 |
| New / New Release | 新建当前类型 / 新任务 | registry + 原 create payload builders | 在 Releases 创建 Release，在 Tasks 创建 Task，不能统一都生成 Task |
| 原 Agent 模式 | 工作区 → Agent 会话 | session registry / workstream | 同一已关联会话；不再复制一套 Agent session 卡片库 |

v2 左栏需补一个可折叠的“Trackers”分组，内部保留“视图 / 类型”。截图 v2 省略了这些原生入口，实施时必须补齐，放在左侧，不往中央增加面板。设备、项目、集成、运维是与 Trackers 并列的导航域。

## 4. 数据字段逐项映射

| Babel 概念 | 原生字段/机制 | 设计约束 |
|---|---|---|
| taskId / cardId | `TrackerRecord.id` | 字符串保持原值，不能强制改成 UUID；上游类型可用 ULID 等 ID 格式 |
| 显示编号 | issueKey / issueNumber；localKey 仅本机 | `localKey` 明确不跨设备同步，不作全局引用 |
| 类型 | primaryType / typeTags | 卡片属于哪个类型与处在哪一执行列是不同维度 |
| 标题/状态/优先级/负责人 | `fields` + role/accessor/schema | 通过 `getRecordTitle/getRecordStatus/resolveRoleFieldName` 等读取，支持自定义字段名 |
| 任务说明 | description 字段与 `content` | 富文本正文不能压成一句 prompt 后丢弃；执行快照记录版本、正文及引用 |
| 文件来源 | source / sourceRef / system.documentPath | native/inline/frontmatter/import 具有不同写入路径 |
| Google/聊天出处 | `system.origin` + 后台 SourceBinding | 不把 `source` 直接扩成未经 schema 支持的 google/ssh 字符串 |
| 完成列 | schema status category + 受管验收结果 | approved 不自动是 done；托管执行完成需后台审核状态机 |
| 归档列 | `archived: boolean` | 归档时间在扩展元数据保存；不覆盖原 status |
| 依赖 | `dependsOn/blocks` 关系及反向传播 | 复用 Ready/依赖计算；不维护第二套只存在于看板的关系 |
| 里程碑/发布归属 | `collection` / 成员关系 | 保留逆关系；单个 Task 完成不自动发布整个 Release |
| 会话 | `system.linkedSessions` + session.linkedTrackerItemIds | 必须合并正向/反向关系，复用 resolveLinkedSessions |
| 修改/讨论历史 | `system.activity/comments` | 与执行事件分区显示；人工讨论不当作 Agent 消息 |
| worktree / 结果 / 验证 | Run 关联的独立执行数据 | 不塞入任务标题、看板排序字段或任意 Markdown 路径 |
| 设备、Agent、最近执行 | 拟新增 ExecutionBinding/RunSummary | 按 trackerId 外键引用，属于执行扩展，不另存业务正文 |

`TrackerRecord.source` 当前只有 native/inline/frontmatter/import。Babel 是 workspace 的数据后端选择，不能通过杜撰 `source='babel'` 触发路由。保持源格式和同步后端两个概念分离。

### 推荐扩展模型（拟新增）

```ts
type TrackerRef = { projectId: string; trackerId: string };
type ExecutionBinding = TrackerRef & {
  targetDeviceId: string | null;
  providerId: string | null;
  latestRunId: string | null;
  completionPolicy: "verified_auto" | "verified_and_reviewed";
  revision: number;
  archivedAt: string | null;
};
type RunBinding = TrackerRef & {
  runId: string;
  sessionId: string | null; // Nimbalyst 的会话表示
  remoteSessionId: string | null; // 节点侧原始会话身份
  deviceId: string;
  inputSnapshotId: string;
};
```

共享后台保存 canonical Tracker 条目和执行扩展，`GET /tasks` 只是执行视图 DTO；同一 GUI 工作区中的原生面板与 Babel 通过同一个 TrackerDataSource 消费它，独立 TUI/CLI 通过公共客户端接入同一服务。`/tracker-items` 承担完整类型/字段/正文合同，不能靠 `/tasks` 的几个字段有损重建原条目。

## 5. 状态语义：不能简单替换字符串

本机 YAML 与 tracker-core 声明以下生命周期分类：backlog、unstarted、started、done、cancelled。closed = done 或 cancelled，closed 不等于成功；archived 为独立布尔值。

| 类型 | 待开始类别示例 | 开始/审查类别示例 | done 类别 | cancelled 类别 |
|---|---|---|---|---|
| task / bug | to-do | in-progress、in-review、changes-requested、approved | done | wont-do、duplicate |
| plan | draft、ready-for-development | in-development、in-review、changes-requested、approved、blocked | completed | rejected |
| decision | to-do | in-progress | decided、implemented | 当前此内置 schema 未列出 |
| idea | new | considering、accepted | 当前此内置 schema 未列出 | rejected |
| milestone | planned | active | done | cancelled |
| release | planned | in-progress | released | cancelled |

四列是投影，保留原始 status：archived 优先进入归档；backlog/unstarted 进入待办；started 进入运行；done 进入完成；未归档 cancelled 留在运行列“已终止/需处理”组并标明原因。未知 category 显示需核对，不能猜测成功。

受管 Task/Bug/显式启用的 Plan 再叠加 run 子状态：starting、waiting_input、verifying、lost 等。不把每个子状态都创建成全局 Tracker status。运行开始/验证/验收通过由服务端原子更新 run 与条目状态，两个面板看到同一版本。

原生面板中非受管记录保持原生命周期编辑行为；绑定受管执行之后，原生状态菜单、TUI、CLI、MCP 与 Hook 发起的命令也必须遵守同一完成守卫。不能只保护 Babel 拖拽，却允许其他入口或 Agent 的 tracker_update 直接跳 done。模型测试脚本可提交验证证据，但 Hook 退出码 0、进程退出或 run.finished 事件都不能替代完成策略要求的验证及人工验收。

Ready 的源码定义是“依赖项均已关闭的 open 工作”，按解锁其他事项的数量、优先级、标题排序。设备在线/目录可用是**执行就绪**的额外判断，不改写 Ready 的原始含义；点击启动仍需执行环境核验。

## 6. 右侧面板一一对应

| Babel 右栏 | 原生来源 | 需要补的能力 |
|---|---|---|
| TODO 任务说明 | TrackerItemDetail 的字段、内容、依赖编辑 | 复用同一记录，启动摘要增加执行目标与验收 |
| 会话 | resolveLinkedSessions + AgentTranscript | 根据 RunBinding 选中受管执行会话，而非随便选择最近一个聊天 |
| 差异 | 原 Agent 审查/文件差异组件 | 明确 runId、baseCommit 和远端产物，不把本地 Git 路径冒充远端 |
| 历史 | 原 activity/comments + 新 run journal | 任务变更、人工讨论、执行历史区分展示，可按 run 切换 |
| 任务讨论 | TrackerCommentsSection / document panel 的 discussion | 不与 AI 补充指令混用；单独折叠入口 |
| 关闭/调宽度 | TrackerDetailPanelResizable / 稳定宿主布局 | 保存偏好，不卸载仍在工作的编辑器或结束会话 |

`TrackerItemChatPanel` 的源码明确是原 ChatSidebar 加“当前条目作为上下文”。**打开它并不自动创建绑定执行，也不能证明右栏就是当前 Pi。** 因此需要独立的 RunBinding 选择策略，但继续使用原有消息显示组件。

`resolveLinkedSessions` 同时读取条目 linkedSessions 与会话 linkedTrackerItemIds，文件来源还支持 `file:<documentPath>`。同步条目可能不保留正向 linkedSessions，只读一边会造成卡片显示“无会话”。跨设备身份以 trackerId 为准，文件路径仅是原本地兼容引用。

## 7. 最需要修正的代码接缝

### 7.1 不再另造 TaskDataSource

上游已有 `TrackerDataSource.snapshot/subscribe/command/status/dispose`、条目/保存视图/状态/拒绝事件，以及 Electron/Browser 两个实现。应拟新增 `BabelTrackerDataSource` 和 `DemoTrackerDataSource` 实现该接口；执行控制另外增加 `RunControlClient`。

`trackerSyncListeners.bindTrackerDataSource` 改为宿主工厂：原工作区继续 ElectronTrackerDataSource；明确登记的 Babel 工作区使用 BabelTrackerDataSource；独立 demo profile 使用 DemoTrackerDataSource。两个面板由同一 GUI 工作区的同一个 factory 结果供数，不能各自创建一个连接并替换全局 atoms。

拟新增的公共 command/query 客户端供独立 TUI/CLI 使用，连接与 GUI 相同的领域服务。DemoTrackerDataSource 适配同一独立非图形 demo 服务；fixtures 只初始化一次，不能由 GUI/TUI/CLI 分别持久化副本。领域服务、统一守卫、事件与 Hook 分发不依赖 Electron renderer、DOM、桌面窗口或显示服务器；关闭 GUI/TUI 只断开视图，已接收的 run 由服务/Worker 持续管理。具体抽取边界、启动方式及 TUI 库由 NB-00 核实和记录，不能把现有接口的存在当作 headless 已实现。

不将官方 BrowserTrackerDataSource 的 serverUrl 指向我们的 HTTP API：它使用特定 TrackerSyncEngine、JWT、room 和 envelope 协议，换 URL 并不兼容。

### 7.2 读链路已有抽象，写链路还没完全统一

当前 `trackerFieldSave.ts` 会按来源写文件或直接调用 documentService，`TrackerMainView` 的归档、删除、新建、会话启动也有直接 IPC。`trackerDataSourceAtom` 当前虽存在，不能据此认定所有修改已通过它。

共享条目需要集中 `TrackerCommandRouter`（拟新增），覆盖：

- 单字段、多字段、批量、正文保存、卡片拖动和排序。
- 原生 New/Import、归档/恢复/删除、类型变更和关系反向索引。
- 评论、会话链接、MCP tracker_create/tracker_update 等宿主写入口。
- 文档内 inline/frontmatter 修改与索引回流。
- TUI、CLI、已登记 Hook 和自动化测试发起的业务命令；调用同一命令服务，不直接写数据库、JSON fixture 或 renderer atoms。

文件来源的正文仍回原文件；`kanbanSortOrder` 在上游明确是看板存储字段，不应写进 Markdown。跨设备文件条目首期只读，不静默改成 native 以绕过权限。

当前 `saveTrackerFields` catch 后只记日志而不抛出，远端拒绝不能复用这种成功外观。新命令返回结构化 accepted/rejected/conflict，UI 以服务端确认更新并回滚受拒绝的乐观修改。

TUI 显示同一拒绝原因，CLI 返回结构化 code 与非零退出码。拟新增 beforeCommand Hook 只能追加受控校验，不能覆盖核心鉴权、版本或完成守卫；提交后 Hook 消费持久事件，失败记录为投递失败，不回滚已提交结果，也不重跑原业务命令。投递按至少一次设计，按 eventId 去重并支持游标恢复；模型自动化必须结合命令结果、关联事件和权威快照断言，而不是仅凭 Hook 日志判定通过。完整事件、幂等与崩溃合同见 [Hooks 契约](NIMBALYST-TUI-HOOKS-SPEC.md)。

### 7.3 原 Launch Session 不等于已运行

`TrackerMainView.handleLaunchSession` 的已读路径：创建 session → tracker:link-session → ai:saveDraftInput → 跳转 Agent 模式；它准备草稿，没有在该路径证明真实开始执行。Babel 必须以 Worker accepted/started 事件判定运行。

`buildTrackerLaunchContext` 还会要求 Agent 完成后调用 tracker_update 更新状态。这对新受管任务需要调整：提交结果/验证请求给 RunControlClient；最后状态由统一守卫处理，不能仅在提示词里写“不要自己完成”。上游已有禁止 Agent 写 approved 的测试，可作为守卫扩展入口，不能据此声称所有 done 路径已受保护。

### 7.4 两个会被旧默认值隐藏的状态

原 Trackers 默认 `statusScope='open'`，且 active/archived 分离。若直接复用默认过滤器，Babel 的完成列和归档列会空掉。

新增执行视图必须有显式 all 生命周期和 includeArchived 语义，但不改变用户其他保存视图的筛选。设备筛选、执行阶段、归档显示的新增 SavedView 字段需通过 normalize/serialize/parse/build/apply/matches 的完整往返测试；不能只改 UI。

### 7.5 正文、数据库与 transcript 不能照旧文档猜测

包级文档明确当前同时支持 PGLite 和 better-sqlite3。原生缓存/设置沿宿主 AppDatabase 与工作区设置接口，不能硬编码 SQL 方言，也不用 renderer localStorage 保存正式数据。

当前 `docs/TRANSCRIPT_ARCHITECTURE.md` 描述 raw ai_agent_messages 持久化、canonical events 内存派生；根文档仍有旧的双持久表描述。远端事件适配须以具体 TranscriptRuntime/解析器版本核验，不另写一个持续改 ai_transcript_events 的脚本。本文只完成静态定位，未测试新的 Pi 消息适配。

## 8. 最小改造后的组件与存储关系

下图为待实现设计；GUI 内部共享实例与跨进程共用服务分开表达。

```text
WorkspaceProviderFactory（每个 GUI 工作区绑定生命周期一个 provider）
   ├─ 原生：ElectronTrackerDataSource
   ├─ 演示：DemoTrackerDataSource → 独立非图形 demo 领域服务
   └─ 共享：BabelTrackerDataSource → Ubuntu Gateway 领域服务
                     │
        trackerSyncListeners / shared tracker atoms
                     │
          ┌──────────┴──────────┐
          │                     │
    原生 Trackers         Babel execution view
    类型/列表/表格         左栏/四列/右栏
          │                     │
          └── 公共 command/query 客户端 ──┘
                         │
独立 TUI / CLI ──────────┤
已登记 Hook 的业务命令 ──┤
                         ▼
          同一领域服务 / TrackerCommandRouter / RunControlClient
                         │
             权威 TrackerRecord + ExecutionBinding + Run
                         └─ 持久事件 / outbox → Hooks / 三端订阅者
```

工作区 provider 显式选择，首期不在同一原记录上同时启用官方同步和 Babel 同步。旧工作区保持原 provider；迁移必须有清单和稳定 ID 保持校验，不自动复制所有原任务到服务器。

新 Babel 工作区内所有受支持 Tracker 类型使用同一个后台条目合同；不只托管 Tasks 却把 Plans/关系端点悄悄留在另一台电脑。如果某类型/富文本/文件来源暂不支持写入，GUI 两种布局、TUI 和 CLI 都返回同一只读原因，不能通过换入口或 Hook 绕过。功能对等覆盖本次新增及涉及的继承能力；上游编辑器的终端覆盖缺口仍须登记，M0 不能宣称整个 Nimbalyst 全功能等价。

## 9. 实施补充任务

以下并入原 NB 任务，并按 [TUI/Hooks 补充的里程碑](NIMBALYST-TUI-HOOKS-SPEC.md) 扩展 M0，不另开一套冲突的开发顺序：

| 编号 | 所属任务 | 必做内容 |
|---|---|---|
| MAP-01 | NB-00 | 核对运行安装版本与固定源码，记录原七类及自定义 schema；定位 Electron 耦合、TUI/无头接缝和功能矩阵 |
| MAP-02 | NB-01 | canonical TrackerRecord、ExecutionBinding、SourceBinding、RunBinding、保存视图及三端 command/query/event、CLI 与 Hook 合同 |
| MAP-03 | NB-02/03 | 先建立公共核心、独立 demo 服务和 CLI 首个闭环；GUI 两布局共享实例，TUI/CLI 连接同一服务和同一 ID，提供模拟 Hook 分发 |
| MAP-04 | NB-06 | bindTrackerDataSource 工厂及所有直接 documentService/MCP 写路径集中路由 |
| MAP-05 | NB-06/07 | Launch Session 与受管启动分流；GUI/TUI/CLI/MCP/Hook 的生产权限和完成守卫 |
| MAP-06 | NB-04 | 三端详情/正文/评论、执行会话/差异/历史对应；双向关联会话解析与终端交互验收 |
| MAP-07 | NB-06 | SavedView/归档/statusScope/计数一致性及不同 provider 生命周期清理 |
| MAP-08 | NB-03/04 | M0 三端交叉操作、无头运行、Hook 拒绝/超时/重复/崩溃及模型自动化断言；真实服务与节点按 NB-05～08 另行验收 |

## 10. 必须新增的双面板与终端验收

1. 原生 Tasks 创建条目 A，Babel 仅出现 A；两边 ID 一致，无第二条同名记录。
2. Babel 改 A 标题/正文，原详情立即得到同 revision；反向编辑同样成立。
3. 同一条 Bug 在两面板保持 bug 类型；启动不会创建新的 task 类型副本。
4. 原生 Task 的 approved 仍在 Babel 运行/审查列；wont-do 不进入成功完成列。
5. 原生归档 A，Babel 显示归档；恢复 A 保留原 status、run、讨论与附件。
6. 原生 Releases 新建发布记录，不进 Babel 的归档列；Milestone 的成员关系不变。
7. Ready 与 TODO 的差异可解释：带阻塞依赖的 TODO 不出现在 Ready；未配置设备不伪造 Ready 失败。
8. 两面板选择同一条目，关联会话列表一致；旧讨论会话不被误作当前执行。
9. GUI 任一布局、TUI、CLI、MCP 或 Hook 对执行中的受管 A 直接写 done 都被统一守卫拒绝；验证/人工验收后各端获得同一完成版本。
10. 文件来源修改遵循文件权威、排序不污染正文；远端只读限制不能通过原生详情绕过。
11. 保存视图在两面板应用后筛选、排序、设备范围、归档范围一致，退出执行视图不破坏其他视图。
12. 两客户端断线重连、乱序事件、同 ID 不同项目与切工作区均不串记录；旧 provider 已 dispose，无重复订阅。
13. GUI 创建、TUI 修改、CLI 查询和模拟运行/验收/归档/恢复始终关联同一项目、Tracker 与 run；新功能按矩阵验证三端等价业务结果。
14. 不启动 Nimbalyst 窗口或显示服务器，仅启动非图形 demo 服务、TUI/CLI 完成 M0 闭环；关闭视图、断开 SSH 不取消 run，重新连接可恢复同一执行。
15. 模型测试通过 CLI/API、关联 Hook 事件与权威状态查询保存证据；Hook 拒绝、超时、重复投递、游标过期和崩溃不绕过守卫、不重复执行。CLI 合同通过不代替 PTY/ConPTY 的 TUI 输入与恢复验收。

本轮只阅读已有测试与实现作为设计依据，没有运行这些新增场景。最终报告必须附原生 Trackers、Babel 与 TUI/CLI 同一条目的操作录像或事件/ID 对照，并区分 M0 模拟、合成后端、真实节点与第三方 API 证据；截图、CLI 输出或 Hook 成功日志均不能单独替代交互及业务结果验收。
