# 巴别塔 × Nimbalyst 开发包

这是从空目录建立的独立开发交接包，汇集已写好的开发 SPEC、Trackers 源码映射、设计参考和 Agent 工作规则。原文件保留在 `D:\Projects\babel`，本包没有移动原资料，也没有覆盖 Nimbalyst 安装或源码。

打包日期：2026-09-14。当前状态：**规格与设计准备，应用改造尚未实施**。第一阶段是 Nimbalyst 内无需 API Key 的交互原型 M0。

## 从这里开始

| 顺序 | 文件 | 用途 |
|---|---|---|
| 1 | [AGENTS.md](AGENTS.md) | 给开发 Agent 的入口、约束、技能选择和验收要求 |
| 2 | [Trackers 一一映射](NIMBALYST-TRACKER-MAPPING.md) | 确定每个面板、记录、写入口对应哪段宿主代码 |
| 3 | [开发 SPEC v2.2](NIMBALYST-DEVELOPMENT-SPEC.md) | 页面、状态机、协议、NB 任务与验收矩阵 |
| 4 | [视觉约束](design/visual-contract.md) | 将已选布局与原生 Trackers 对齐，纠正旧效果图中的遗漏 |
| 5 | [效果图补齐计划](design/UI-VISUAL-PLAN.md) | 五张主视图与三类交互/适配证据的制作顺序 |
| 6 | [启动开发提示词](START-HERE-PROMPT.md) | 可直接发给 Cursor、Codex 或 Pi 的实施指令 |

### 这次补了什么

- `AGENTS.md`：只写跨任务不变的规则，细节通过链接读取，避免每次加载整套资料。
- `skills/vendor/`：携带三个经过选择的设计技能、必要参考文件与 MIT 许可证；[使用指南](skills/SKILLS-GUIDE.md)规定何时读取。
- `design/`：保留原图及原生 Trackers 截图，新增视觉约束、场景计划和逐张生图提示词。
- `design/demo-fixtures.json`：统一任务名称、演示身份和场景。这是设计数据，不是生产 API 合同。
- `PACKAGE-MANIFEST.json`：记录文件来源与 SHA-256；[校验脚本](scripts/verify-package.py)可在别的电脑复核内容完整性。

## 哪些资料是当前规则

当前业务规则以 **开发 SPEC v2.2 + Trackers 映射 + ADR-004** 为准；本包的视觉约束将其落实到参考图。图片用于布局方向，不能覆盖状态守卫、类型语义或源码证据。

[系统规格](NIMBALYST-SYSTEM-SPEC.md)保留整体背景；[SOURCE-MAP](SOURCE-MAP.md)和[源码证据 JSON](design/nimbalyst-source-evidence.json)记录既有源码研究。源码基线是 `d6e1d008d9ee264a7447f3533fa9f48f158a70b0`，实施前必须重新核对检出的 HEAD。源码本身未复制到开发包。

下列内容为历史或需求参考，不能重新启用其中已被替代的底座：

- [ADR-001](decisions/ADR-001.md)、[ADR-002](decisions/ADR-002.md)：保留决策过程，已由 [ADR-003](decisions/ADR-003.md)及 [ADR-004](decisions/ADR-004.md)调整。
- [ENTRY-AND-BOARD](ENTRY-AND-BOARD.md)：Hermes、Cline 等参考调查，不意味着重新选择主应用。
- [PDF 与运维早期子规格](reference/v1/PDF-AND-OPS.md)：可借鉴双语定位、批注、旧版引用和健康检查需求；其 Nextcloud/AFFiNE/PostgreSQL 假设必须在 NB-12 实施前逐项重审。
- [原开发提示词](NIMBALYST-IMPLEMENTER-PROMPT.md)保持原样存档；启动本包时使用上面的 `START-HERE-PROMPT.md`，以包含本轮新增约束。

原仓库的旧 `tasks.json`、`TASKS.md` 和 `contracts/` 没有混入此包。新版机器可读合同仍是 **NB-01 的待办**；不能因为已有 Markdown 就假定后端接口已经同步。

## 是否还要继续画图

**需要补关键状态，但当前第二版不能直接称为最终图。** 它少了 Trackers 视图与类型树，并在运行、完成、归档列画了不应存在的新建按钮。

建议围绕同一套组件完成五张主视图：看板首页、待办详情、运行会话、验收差异、历史归档。失败、等待输入、失联、窄屏和深色用同一套原型的状态与截图覆盖。Trackers 与新面板是否一一对应，必须用同一条记录的实际交互证明。

本轮已写制作计划与提示词，**没有批量生成新图片，也没有把任何设计稿标记为最终验收通过**。先修正一张母版，再扩展其余状态；有可运行组件后优先从实际 UI 截图。

## 交给开发 Agent

把这个文件夹作为资料根目录，发送 [START-HERE-PROMPT.md](START-HERE-PROMPT.md) 内的提示词即可。实现代码使用 D 盘独立检出和独立开发 profile；不要在本机已安装的 Nimbalyst 目录里试改。

校验开发包只需要 Python 3.9 或以上的标准库，在包根执行：

```powershell
python scripts/verify-package.py
```

若电脑命令是 `py` 或 `python3`，替换命令名称即可。脚本检查本包文件、哈希、JSON 和 Markdown 本地文件链接，不安装依赖、不启动应用、不连接设备。它不证明 Nimbalyst 的功能、UI 或外部网址已通过验收。

技能许可和来源见 [SOURCE.json](skills/SOURCE.json)；截图、第三方源码和其它资料不因技能的 MIT 许可自动变为 MIT。
