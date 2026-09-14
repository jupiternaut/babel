# 发给开发 Agent 的提示词

以下用于用户决定启动实施时。当前文件夹的打包与校验不代表已经实施这些步骤。

```text
请基于这个开发包，实施 Nimbalyst 内的巴别塔 M0 原型。

先读 AGENTS.md 和 README.md，再读 NIMBALYST-TRACKER-MAPPING.md、NIMBALYST-DEVELOPMENT-SPEC.md、design/visual-contract.md、design/UI-VISUAL-PLAN.md。按 skills/SKILLS-GUIDE.md 选择相关技能，不加载或安装整套设计技能。

以现有 Nimbalyst 源码为底座，先做 NB-00/01，再做 NB-02/03/04。使用 D 盘独立检出和独立开发 profile，保留已安装应用和现有项目数据。核实源码 HEAD、许可、目标目录的 AGENTS.md/CLAUDE.md 与实际构建命令。不要把此资料包误当已实现的应用仓库。

原生 Trackers 和新执行面板必须共用同一 TrackerRecord.id、同一 TrackerDataSource 和统一读写命令。保留 Ready、全部原生/自定义类型与保存视图；Releases 不是归档。执行信息以 (projectId, trackerId) 唯一关联，缓存/路由/事件均携带项目作用域；重试产生新 runId，不复制新任务。M0 所有可达 demo 写入口同样隔离并模拟守卫，未适配入口禁用，不能回退真实 IPC/MCP。生产完整命令路由和 MCP 守卫的真实验收仍属于 NB-06/07。

默认执行视图保持左侧信息丰富、中央简洁四列、右侧选中详情；切换原生 Trackers 显示模式保留原布局和类型语义。补齐 Trackers 类型树和视图入口；移除旧图运行/完成/归档列的＋；复用宿主搜索、主题、会话和差异组件。原图是方向稿，不是没有矛盾的最终稿。先按 visual-contract 完成一个可核对的母版，再复用同一套组件扩展场景。

M0 不要 API Key，不读真实凭据，不连接局域网设备或启动真实 Agent。固定演示数据，完成新建/编辑/启动/等待/验证/验收/归档/恢复的交互；界面明确显示“演示数据”。design/demo-fixtures.json 只是场景描述，需适配为原生数据与执行关联，不能当成已经验证的生产合同。

先实现可以操作的原型；不要把多张生成图或独立 Cursor 网页当成交付。通过同一任务在两个面板之间切换、编辑与状态流转，证明一一映射。保存实际截图和 UI/FLOW/MAP/REG 验收记录，说明源码阅读、构建、模拟测试和真实执行各自覆盖了什么。

交付启动方式、改动说明、实际结果与未覆盖项。完成 M0 后结束这一阶段；后续真实 Gateway/Pi/Google/设备/PDF 按用户后续指令继续。
```
