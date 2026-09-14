# 巴别塔 · Babel

跨设备文件、聊天任务、多 Agent 开发、运维与 PDF 知识工作台。
当前仓库收录 Personal Workbench 开发规范，尚未实现应用。

确定方向：以 Nimbalyst 为底座，融合 TODO / RUNNING / DONE / ARCHIVED 看板；Ubuntu 常驻后台接入 Google Tasks、每分钟 SSH 设备采集与 Pi 执行，保留项目讨论、文件、运维和 PDF。

**最新实施入口：先读 [Nimbalyst 开发 SPEC](NIMBALYST-DEVELOPMENT-SPEC.md)、[Trackers 一一映射与源码审计](NIMBALYST-TRACKER-MAPPING.md) 和 [开发提示词](NIMBALYST-IMPLEMENTER-PROMPT.md)。以原生 TrackerRecord 作为共同条目身份，两个面板共享数据源，先交付无 Key 的 Nimbalyst 内 UI 原型。**

**系统背景：先读 [Nimbalyst 系统规格](NIMBALYST-SYSTEM-SPEC.md) 和 [ADR-003](decisions/ADR-003.md)。初版 SPEC、OpenAPI 与 27 项任务仍含 Talk/Deck 模型，尚未完成一致迁移，不能直接作为新架构的实施清单。当前不是已部署软件。**

## 阅读入口

| 文件 | 用途 |
|---|---|
| [NIMBALYST-DEVELOPMENT-SPEC.md](NIMBALYST-DEVELOPMENT-SPEC.md) | UI v2、交互、运行状态、接口草案、NB 开发任务与验收 |
| [NIMBALYST-TRACKER-MAPPING.md](NIMBALYST-TRACKER-MAPPING.md) | 原 Trackers 与新面板逐项对应、共享身份、源码调用链及改造接缝 |
| [NIMBALYST-IMPLEMENTER-PROMPT.md](NIMBALYST-IMPLEMENTER-PROMPT.md) | 当前 Nimbalyst 实施提示词 |
| [SPEC.md](SPEC.md) | 决策、权限、模型、状态机、文件读写、UI、阶段和验收 |
| [contracts/openapi.json](contracts/openapi.json) | 核心API的机器可读契约；PDF/OPS后续端点不在本版 |
| [contracts/events.schema.json](contracts/events.schema.json) | 持久运行事件的JSON Schema |
| [SOURCE-MAP.md](SOURCE-MAP.md) | 本机Nimbalyst/官方AFFiNE代码入口、固定提交和待验证项 |
| [PDF-AND-OPS.md](PDF-AND-OPS.md) | PDF行间阅读/批注、Ubuntu服务探测的详细子规格 |
| [TASKS.md](TASKS.md) / [tasks.json](tasks.json) | 27项任务、依赖、范围、验收；均未开始 |
| [decisions/ADR-001.md](decisions/ADR-001.md) | 数据源、后端和文件访问的关键取舍 |
| [IMPLEMENTER-PROMPT.md](IMPLEMENTER-PROMPT.md) | 可交给Cursor/Pi/Codex的执行提示词 |
| [validate-spec.py](validate-spec.py) | 只验证本spec包的JSON、引用、任务依赖和示例，不测试软件 |
| [validation-report.json](validation-report.json) | 实际校验结果、检查项与输入文件SHA256 |

## 本包验证

```powershell
python validate-spec.py
```

验证使用Python标准库；若本地已有jsonschema，则额外校验Schema和正反事件样例。不下载/安装依赖。结果见 `validation-report.json`。OpenAPI引用与结构检查不等于完整第三方OpenAPI一致性认证，更不代表API已实现。

## 从哪里开始开发

先按开发 SPEC 的 NB-00/01 核实环境并修订契约和机器任务，再按 NB-02/03/04 做 Nimbalyst 内可交互原型。Trackers 映射中的 MAP-01 至 MAP-07 是这些任务的必需子项。第一条链路为：Nimbalyst TODO → 目标设备 Pi 执行 → 实时状态/详情 → 满足完成条件后 DONE → 归档；之后接 Google Tasks 导入和每分钟 SSH 快照。原 27 项任务仅供迁移参考。

在仓库根目录执行上面的验证命令。规范里未确定的实际IP、凭据、目标目录、版本digest只在WB-000核实，不能自行把示例域名或旧会话端口当真实配置。Windows实施默认使用D盘新目录；本仓库目前只提交设计文档、契约和验证脚本，未安装服务或更改源程序。

新仓库的启动/构建命令由WB-001建立后写入项目README；这里不编造尚不存在的npm命令。

## 范围变化与冲突

核心API结构以openapi.json为准，事件以events.schema.json为准，业务行为以SPEC.md为准；它们必须同时兼容。若出现冲突，记录并修正spec后再实现，不靠任意优先级掩盖矛盾。PDF/OPS新增端点先扩展主契约再编码。

初版现有远端目录只读；新建受控目录才允许小文本写。共享任务由 Babel 后台持久化，通过 Nimbalyst 适配层展示；原本地任务保持原存储。旧契约尚未迁移，文档结构校验不判断架构迁移完成与否。
