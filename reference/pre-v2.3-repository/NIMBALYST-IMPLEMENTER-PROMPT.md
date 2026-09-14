# Nimbalyst 巴别塔开发提示词

这是供用户明确启动实施时使用的提示词，不代表本轮已修改 Nimbalyst。

```text
请按 babel 仓库的 NIMBALYST-DEVELOPMENT-SPEC.md 开发 Nimbalyst 内的巴别塔工作台。

先读 README、NIMBALYST-TRACKER-MAPPING、NIMBALYST-DEVELOPMENT-SPEC、NIMBALYST-SYSTEM-SPEC、ADR-003/004 和设计图 design/babel-dashboard-v2.png。新开发入口以 NB 任务清单为准，旧 WB tasks.json/OpenAPI 尚待迁移，不要执行旧 Nextcloud Talk/Deck 方案。

先完成 NB-00 和 NB-01，再完成 NB-02/03/04，交付可运行的 Nimbalyst 内 M0 UI。保留现有工作树和应用数据，代码与依赖放 D 盘独立检出，使用独立开发 profile。核实当前 HEAD、包许可、AGENTS.md/CLAUDE.md 和实际构建脚本，不升级或覆盖现有安装来解决开发问题。

原生 Trackers 与 Babel 面板必须一一对应：同一 TrackerRecord.id、同一条目权威源、同一读写和权限入口。Ready/类型/保存视图与 Open/Closed/归档各自语义保留，Releases 不是归档。复用已有 TrackerDataSource，引入 DemoTrackerDataSource/BabelTrackerDataSource 与执行控制 RunControlClient；不要新建平行的 TaskDataSource 或第二套标题正文存储。按映射文档落实 MAP-01 至 MAP-07。

界面严格采用左侧管理、中央简洁四列、右侧选中任务会话。设备和同步/运维在左侧；卡片最多两行标题、一行辅助信息、轻量菜单。右侧会话/差异/历史渐进显示，切面板不能重启 Agent。对照 v2，而不是复制 Cursor 示例的深色卡片和满屏描述。

优先适配现有 TrackerMode/KanbanBoard、AgentWorkstreamLayout、AgentTranscript 与 AgentProtocol。KanbanBoard 的 overrideItems 不解决保存问题：所有共享任务写操作、右键、拖拽、批量动作和快捷键必须经统一 TrackerCommandRouter 与 TrackerDataSource 分流，不能落入原本地 Tracker 保存路径。不要用 iframe 把 Cursor 示例充当最终集成。

M0 不用 API Key，不读取现有真实凭据，不连接设备或 Agent。五张模拟任务、模拟消息/差异/历史、新建/编辑/启动/等待输入/验证/完成/归档/恢复可交互；模拟数据持久化在独立 demo 命名空间。按钮、键盘和拖拽遵守状态机。不要在生产代码留下任意设为成功的端点。

M0 完成后交付启动方式、截图、源码改动和逐项 UI 验收记录，再根据用户后续指令实施真实 Gateway/Pi/Google/设备链路。真实执行时 task ID 始终不变，每次 run 有独立 ID 和不可变输入；失联先核对，取消先确认，完成必须有证据，归档不删结果。

每项任务交付说明具体改了什么、为什么、测试命令和实际结果。区分结构检查、demo、合成测试、真实设备及真实第三方账号验收。未覆盖项明确列出，不将下载或编译成功写成产品完成。
```
