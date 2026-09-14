# 巴别塔 · Babel

跨设备文件、聊天任务、多 Agent 开发、运维与 PDF 知识工作台。
当前仓库收录 Personal Workbench 开发规范，尚未实现应用。

这是一份实现规范，不是已部署软件。目标是保留 Nimbalyst/AFFiNE 前台，通过共同服务连接跨设备文件、Talk/Deck任务、Pi开发、运维和PDF双语笔记。

## 阅读入口

| 文件 | 用途 |
|---|---|
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

先执行WB-000建立真实环境/许可/版本基线，再执行WB-001。第一条可用链路为：Talk消息→Deck卡片→Nimbalyst共享任务→Pi Worker→GitLab MR/CI→人工验收→回传结果。R2完成此闭环；R3接AFFiNE、移动端与运维，R4完成PDF需求。

在仓库根目录执行上面的验证命令。规范里未确定的实际IP、凭据、目标目录、版本digest只在WB-000核实，不能自行把示例域名或旧会话端口当真实配置。Windows实施默认使用D盘新目录；本仓库目前只提交设计文档、契约和验证脚本，未安装服务或更改源程序。

新仓库的启动/构建命令由WB-001建立后写入项目README；这里不编造尚不存在的npm命令。

## 范围变化与冲突

核心API结构以openapi.json为准，事件以events.schema.json为准，业务行为以SPEC.md为准；它们必须同时兼容。若出现冲突，记录并修正spec后再实现，不靠任意优先级掩盖矛盾。PDF/OPS新增端点先扩展主契约再编码。

初版现有远端目录只读；新建受控目录才允许小文本写。第一阶段Task正文在Deck编辑，Nimbalyst做投影与运行操作。这些边界为避免文件竞争和Deck缺乏写入CAS，不得静默移除。
