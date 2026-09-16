# GUI / TUI / CLI / Hooks 功能对照表

版本：v2.3。当前所有条目为**待实现、待验证**，下表是交付要求，不是已支持能力清单。依据：[主 SPEC](NIMBALYST-DEVELOPMENT-SPEC.md)、[TUI/Hooks 契约](NIMBALYST-TUI-HOOKS-SPEC.md)。

表中命令/事件是语义角色，NB-01 固定精确名称、Schema、错误码与权限。读取动作不必伪造业务变更事件：使用查询结果及 correlationId/可选 trace 进行断言。变更动作在权威事务提交后产生真实事件。界面选择/滚动属于客户端状态，不复制成任务业务字段。

## M0 必须对等的能力

| ID | 能力 | GUI | TUI | 非交互 CLI/API | Hooks / 观察 |
|---|---|---|---|---|---|
| CAP-01 | 项目/类型/设备/状态筛选及搜索 | 侧栏和搜索 | 导航选择和搜索 | list/query + filters + cursor | 查询结果、请求 trace |
| CAP-02 | 原生类型、Saved Views、Ready | 原生分组/显示菜单 | 类型/视图选择与编辑 | schema/view/ready query 与保存 | 视图变更事件；Ready 按原依赖规则查询 |
| CAP-03 | 创建条目 | 当前类型表单 | 当前类型表单 | create + JSON input | beforeCommand、条目提交事件 |
| CAP-04 | 标题/正文/字段编辑 | 原生详情 | 多行/字段编辑器 | update + expectedRevision | 同一校验、拒绝/提交事件 |
| CAP-05 | 依赖/关联/优先级 | 关系和字段操作 | 关系列表/选择 | relation/field commands | 双向关系与 revision 更新 |
| CAP-06 | 手工排序 | 列内拖拽/菜单 | 移动前后菜单 | reorder + view scope | 排序提交；不写原文档字段 |
| CAP-07 | 启动摘要与执行 | 表单和启动按钮 | 摘要与显式确认 | run.start + key/revision | accepted/started，与仅创建 session 区分 |
| CAP-08 | 进度/工具活动/当前会话 | 会话面板 | 可滚动对话和工具详情 | run query、events watch | 既有 run/tool/message 事件 |
| CAP-09 | 补充消息/等待回答 | 两种明确输入入口 | 消息框/待答表单 | message/respond + requestId | 消息确认与 input.requested 对应 |
| CAP-10 | 取消与终止核对 | 取消/核对操作 | 取消/核对菜单 | cancel/reconcile | cancel_requested ≠ cancelled；lost 保留 |
| CAP-11 | 结果、文件差异、产物 | 宿主差异和结果页 | 文本差异/产物列表/导出 | diff/artifact query/download | 查询证据和产物关联，不能伪造基线 |
| CAP-12 | 验证、接受、要求修改 | 验收面板 | 验收项/选择操作 | review + policy + revision | 必需证据和人工身份守卫；Hook不能自批 |
| CAP-13 | 重试、新执行 | 运行菜单 | 新执行摘要 | retry/new run + key | 同一Tracker、新run，未终止不重复执行 |
| CAP-14 | 完成、归档、恢复 | 四列和菜单 | 阶段列表和菜单 | archive/restore | archived/restored事实，恢复不执行 |
| CAP-15 | 历史、旧run、人工讨论 | 分类历史/讨论 | 分类时间线与只读旧run | activity/run/comments query/command | 评论和执行消息不混用 |
| CAP-16 | 草稿、冲突、拒绝/只读 | 草稿保留和原因提示 | 草稿/冲突选择 | 明确冲突code、revision、可重试标志 | 拒绝无业务提交，查询校验未丢原修改 |
| CAP-17 | 快照、断线、重连 | 缓存与最后更新时间 | 相同缓存/状态 | snapshot + cursor/watch | 去重、续读、游标过期重拉 |
| CAP-18 | demo初始化、注入、重置 | 开发菜单 | demo菜单 | demo-only commands | mode=demo，隔离profile，不触达真实数据 |
| CAP-19 | 权限/可用能力/禁用原因 | 操作可达和说明 | 相同操作集合和说明 | capabilities + structured error | 所有端共用拒绝守卫；同样禁用不代表已实现 |
| CAP-20 | Hook配置/校验/投递观察 | Hook设置与状态 | Hook设置/投递列表 | register/list/test/retry-delivery | beforeCommand与观察Hook分开；受控配置 |

M0 中设备、Google 来源与真实执行数据使用演示场景；只读继承来源的写限制必须三端一致，不能为了展示全功能而绕过权限。CAP-20 仅登记合成测试 Hook，生产身份/策略后续验证。

## 后续阶段同样要求对等

| ID | 阶段与能力 | GUI / TUI 等价路径 | CLI/API 与 Hook 重点 |
|---|---|---|---|
| CAP-21 | NB-05～08 真实服务/Pi与认证 | 三端接同一服务/同一run | 服务发现、认证、原始执行证据、持久幂等/事件/守卫 |
| CAP-22 | NB-09 设备登记/健康/刷新 | 列表、详情、配置、显式刷新 | 命令/快照、freshness、设备事件；未知不等于离线 |
| CAP-23 | NB-10 Google列表/同步/冲突 | 连接状态、选表、冲突解决 | OAuth流程/选表/API、同步事件；外部完成不等于Agent成功 |
| CAP-24 | NB-11 文件/目录/任务引用 | 文件树或列表、阅读、选择引用 | 资源ID/revision、受控读写、来源权限与事件 |
| CAP-25 | NB-11 项目讨论生成待办 | 选消息、预填、保存 | 来源binding、create/去重，不自动启动 |
| CAP-26 | NB-11 运维查询/修复待办 | 健康详情、创建任务 | 只读探测、异常事件、修复仍正常启动 |
| CAP-27 | NB-12 PDF对译/定位/批注/导出 | GUI原页；TUI段落/页码定位、译文/批注结构操作 | 文档版本、页/段锚点、批注/导出命令和持久事件；原图呈现差异单独记录 |
| CAP-28 | 涉及的继承编辑器/自定义字段 | NB-00逐项盘点并保留业务语义 | 没有终端等效实现的列为缺口，不丢富文本/关系或宣称整套上游已对等 |

## 每项如何更新为完成

实现时为每条 CAP 补充准确命令、GUI/TUI组件/路由、事件Schema、权限、错误码与测试路径；状态分“待实现 / 部分实现 / demo通过 / 真实验证通过”。只提供界面或命令占位不能标 demo 通过。

PAR-01/02 对同一 fixture 比较三端结果及交叉操作；HEADLESS-01 证明无窗口可运行；CLI-01 与 TUI-01 分别验证非交互合同和真实终端输入；HOOK-01/02 验证校验和可恢复投递；EVIDENCE-01 结合查询断言；LIFE-01 验证视图退出不杀 run。具体通过条件见契约第 6 节。

每项证据记录：提交/版本、平台/终端、mode、projectId/trackerId/runId、输入、命令结果、关联eventId/cursor、前后revision、查询断言与日志/截图。图像生成与Hook日志本身都不能把未执行条目标为通过。
## 2026-09-16 真实系统模块

SYS-01～09 的实现与验收独立记录在 [系统控制 SPEC](SYSTEM-CONSOLE-SPEC.md)。服务启停、自启动、进程终止在 GUI/TUI/CLI 共用同一命令核心，资源/日志/历史共用查询，Hook 消费持久事件。真实 ConPTY 验收与原生窗口验收分别计数；系统权限不足和未验证平台不算通过。历史任务域的当前验收以 implementation/ACCEPTANCE.md 为准。
