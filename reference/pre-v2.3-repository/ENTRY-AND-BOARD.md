# 巴别塔入口与统一 Agent 看板

> 后续用户已确定 Nimbalyst 为底座，完成与归档为独立阶段，并增加 Google Tasks 和 60 秒 SSH 采集。以 [ADR-003](decisions/ADR-003.md) 和 [最新系统规格](NIMBALYST-SYSTEM-SPEC.md) 为当前方向；本文保留视觉与上游源码调查，“Cline 作为主底座候选”的建议已被取代。

日期：2026-09-14。状态：设计增补；未构建、未部署、未做运行测试。

用户确定的方向：参考提供的 Ubuntu 桌面图片作为入口，参考 Hermes 和 Cline 的开源看板实现。本文记录交互要求与源码调查；候选项目的取舍是工程建议，不代表已决定 fork 或安装。

## 1. 入口：桌面式 Web 工作台

第一张参考图呈现雾林背景、细顶栏、紧凑浮动菜单；图片只有 330×330，不能据此确认具体桌面环境、主题或菜单软件。第二张图用深色背景、分栏和卡片集中呈现任务。采用它们的视觉结构，不复制低分辨率图片作为生产背景，不复制其中看不清的文字和品牌。

Ubuntu 承载服务；Windows、Ubuntu、macOS、iOS、iPadOS、Android 通过同一个响应式 Web 入口访问。这里的“桌面式”指应用界面，不是远程桌面、Ubuntu Shell 扩展，也不需要替换现有桌面环境。

默认打开后即可看到任务摘要和看板入口，不能只有壁纸和一个隐藏菜单。顶栏显示当前项目、执行设备、连接状态与用户；桌面菜单提供任务、文件、项目讨论、运维、知识/PDF、设置。

桌面浏览器可右键打开菜单，同时必须提供可见菜单按钮及键盘入口；触屏不能依赖右键、悬停或双击。工作面板用不透明或足够遮罩的底色，正常文字对比度至少 4.5:1；壁纸不能影响日志和卡片可读性。

```text
巴别塔     项目 ▾     执行设备 ▾     连接状态     菜单
┌────────────────────────────────────────────────────────┐
│ TODO           RUNNING           ACHIEVE               │
│ 尚未启动       正在执行/待输入    满足完成条件的记录     │
│                                                        │
│ 任务卡：标题 · 执行器 · 设备 · 最近活动 · 状态更新时间  │
├────────────────────────────────────────────────────────┤
│ 选中卡片 → 任务正文 / 实时会话 / 差异 / 产物 / 执行历史 │
└────────────────────────────────────────────────────────┘
项目讨论     文件     Ubuntu 运维     知识与 PDF
```

大屏：三列看板与详情抽屉可并列；手机：按状态切换列表、点卡片进入全屏详情。主界面不同时堆叠多个独立看板或嵌入完整 Ubuntu 桌面。运维告警与任务事件分开显示，但可关联同一任务。

## 2. 一个任务，多次执行记录

同一张卡片始终使用同一个 task_id。启动时新建 run_id，并记录 executor、device_id、工作目录/工作区、任务正文快照与开始时间；重试创建新 run_id，不复制任务卡。

- TODO：还未启动。点击启动后先显示“启动中”；只有执行节点确认接受，才进入 RUNNING。重复点击不得重复启动。
- RUNNING：包含执行中、等待输入、验证中。失败、取消、失联显示明确异常标记和可执行操作；不能作为成功记录混入 ACHIEVE。
- ACHIEVE：达到任务约定的完成条件，有结果和执行证据。是否要求人工验收由任务规则明确，不能把模型一轮回答结束直接等同于任务完成。
- 归档：是另一个可见性属性，不等于成功，也不等于删除。失败记录允许归档，但保留失败结果。

执行器报告事件，Babel 服务校验并决定状态变更；浏览器拖拽或聊天消息都不能绕过这个规则。UI、CLI、聊天入口调用同一任务服务；不让 Hermes、Cline、Babel 三个数据库分别拥有一份可独立修改的任务正文。

任务可暂存为“待办 → 运行 → 完成”三列，但底层必须保存 waiting_input、failed、cancelled、lost 等详细状态。断线显示最后收到事件的时间，不显示虚假的在线状态；未知进度显示阶段和耗时，不编造百分比。重连按事件游标补取，重复或迟到事件不得将成功卡片倒退为运行。

聊天只提供上下文、创建任务入口、待输入回复及通知；Babel 保存任务。GitLab 保留代码、MR/CI，不要求每张任务卡先建 GitLab Issue。

## 3. 开源实现分别参考什么

### Cline Kanban：第一轮原型的候选 UI / 执行工作台

这是独立仓库 cline/kanban，不是把 Cline VS Code 插件整体搬进网页。README 描述任务卡独立终端/worktree、Hooks 活动显示、差异审查、任务依赖和提交操作。检视版本为 0.1.70，主仓库 Apache-2.0；第三方依赖、图标和品牌仍需按各自声明处理。

固定提交：`abd4912c27ce6b7f18b5a8106c145fd838e90cc4`。

源码导航（已核实路径；除特别说明外尚未完整审计模块行为）：

| 目标 | 上游入口 |
|---|---|
| 看板与任务卡 | [kanban-board.tsx](https://github.com/cline/kanban/blob/abd4912c27ce6b7f18b5a8106c145fd838e90cc4/web-ui/src/components/kanban-board.tsx)、[board-card.tsx](https://github.com/cline/kanban/blob/abd4912c27ce6b7f18b5a8106c145fd838e90cc4/web-ui/src/components/board-card.tsx) |
| 任务详情终端 | [agent-terminal-panel.tsx](https://github.com/cline/kanban/blob/abd4912c27ce6b7f18b5a8106c145fd838e90cc4/web-ui/src/components/detail-panels/agent-terminal-panel.tsx) |
| 启动支持列表（已读取） | [agent-catalog.ts](https://github.com/cline/kanban/blob/abd4912c27ce6b7f18b5a8106c145fd838e90cc4/src/core/agent-catalog.ts) |
| 任务变更 | [task-board-mutations.ts](https://github.com/cline/kanban/blob/abd4912c27ce6b7f18b5a8106c145fd838e90cc4/src/core/task-board-mutations.ts) |
| Hooks | [hooks.ts](https://github.com/cline/kanban/blob/abd4912c27ce6b7f18b5a8106c145fd838e90cc4/src/commands/hooks.ts) |

该提交实际允许启动的列表为 Cline、Claude、Codex、Droid、Kiro；目录中的 OpenCode/Gemini 条目不等于已启用支持。列表中没有 Pi，因此需要新增 Pi 适配器和真实验收。

不能照搬上游的所有行为：README 仍称 Research Preview；agent-catalog 的自动模式包含跳过审批/沙箱的参数，Babel 不把这些参数作为默认启动策略。上游“完成并移入 trash 才触发关联任务”的工作流要改成独立的成功事件、依赖满足和归档操作。共享 node_modules 等 symlink 优化也不能被宣传为完整写隔离，需先验证依赖目录修改的影响。

### Hermes：任务持久化、调度与恢复模型

主仓库 MIT。固定提交：`5eb99eb2844b22ebb723711b8e6a0bbb80bb5f04`。

官方文档及 API 模块描述：看板、CLI、Agent 工具共同访问 kanban_db；task_events 持久化，WebSocket 向界面传递变化。任务与运行记录分开，调度有独立 Worker 概念。这些设计适合学习“界面刷新/进程重启后，任务仍可追溯”。它的默认执行对象是 Hermes profile，不应假定可直接替换成 Pi。

| 目标 | 上游入口 |
|---|---|
| 功能与状态说明 | [kanban.md](https://github.com/NousResearch/hermes-agent/blob/5eb99eb2844b22ebb723711b8e6a0bbb80bb5f04/website/docs/user-guide/features/kanban.md) |
| API 与事件通知（已读取模块说明及部分代码） | [plugin_api.py](https://github.com/NousResearch/hermes-agent/blob/5eb99eb2844b22ebb723711b8e6a0bbb80bb5f04/plugins/kanban/dashboard/plugin_api.py) |
| 数据入口 | [kanban_db.py](https://github.com/NousResearch/hermes-agent/blob/5eb99eb2844b22ebb723711b8e6a0bbb80bb5f04/hermes_cli/kanban_db.py) |
| 调度入口 | [kanban_db_dispatch.py](https://github.com/NousResearch/hermes-agent/blob/5eb99eb2844b22ebb723711b8e6a0bbb80bb5f04/hermes_cli/kanban_db_dispatch.py) |

这里复用的是任务、运行与事件的分层思路；不直接把 Hermes 的 SQLite 文件挂载给多台设备写。跨设备客户端只访问 Babel 服务。Hooks 是事件入口，数据库中的运行记录和执行节点核对结果才是恢复依据，避免漏 Hook 后任务永久卡住。

### 其他候选保留的价值

- Cursor agent-kanban：参考分组筛选、产物预览和创建流程；现有示例对接 Cursor Cloud Agents，不当成本地 Pi 后端。
- Vibe Kanban：保留为工作区与审查的比较对象；已有停运/社区维护背景，不再把它当作唯一基础。
- Nimbalyst：保留文档、会话、差异编辑和任务关联的复用候选；不再强制用它承载整个入口。
- AFFiNE：知识/PDF 关联前台候选，原文档与协作能力不因入口改变而丢弃。

**当前工程建议：先评估 Cline Kanban 能否承载小型原型，参考 Hermes 的任务/运行/事件设计，外层使用用户参考图的桌面式入口。不是把两套完整系统一起启动后互相同步。**最终 fork、模块移植或独立实现的选择，由下节原型证据决定。

## 4. 最小验证链路

1. 在合成仓库中创建一张 TODO；点击启动一次 Pi；第二次点击返回相同启动结果而不是新进程。
2. 卡片自动进入 RUNNING，详情展示真实事件；执行失败保持失败标记，成功且满足验收后才进入 ACHIEVE。
3. 关闭再打开浏览器，卡片、run_id 和日志仍在；中断事件连接后可补齐，不重复启动。
4. 等待输入时能在详情回复；取消需要执行节点确认停止，失联不盲目重派。
5. 从第二台设备看到同一任务状态；只通过带身份校验的服务访问，未经授权的请求不能创建/启动任务。
6. 在手机宽度可创建、启动、查看、回复，桌面右键与触屏菜单提供相同入口；同一任务保持单份数据。
7. 挂接一个已核实的 Ubuntu 服务探测，显示探测时间和正常/异常/未知；任务结束不代表系统服务健康。

先用假执行器覆盖重复事件、失联和失败，再用真实 Pi 做上述执行验收；不能把假执行器的成功当作 Pi 可用证明。安装、远程部署、真实项目修改在后续实施阶段进行。

## 5. 与初版契约的关系

旧 SPEC、OpenAPI、tasks.json 仍包含 Talk/Deck、Nextcloud 登录和任务投影模型，尚未迁移。本增补确定的是入口与统一看板方向，不是新 API 已可实施的声明。

下一轮规范修订必须共同更新：任务正文归属 Babel、独立身份入口、聊天来源引用、task/run/event 状态、Pi 适配器、设备节点与订阅恢复接口，以及对应任务验收。完成前旧机器可读任务不能直接派发实施。原有文件权限、幂等、取消确认、备份、PDF/Ops 和真实验收要求保留。

本次只有文档、源码导航与结构校验；没有安装 Hermes/Cline，没有启动 Agent，也没有修改 Ubuntu 服务。
