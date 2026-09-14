# 巴别塔 BABEL · Nimbalyst 开发规范

本仓库汇集当前开发 SPEC、Trackers 源码映射、设计参考、终端与 Hooks 契约和 Agent 工作规则。文档来自本地独立开发包；此次发布不包含正在开发的源码、依赖、凭据或运行数据。

更新日期：2026-09-14，规格 v2.3。当前状态：**规格与设计准备，应用改造尚未实施**。第一阶段是无需 API Key、共用核心的 Nimbalyst GUI + 交互 TUI + JSON CLI + 应用 Hooks 原型 M0。旧版完整保留在 [v2.2 存档](reference/v2.2/README.md)。

## 从这里开始

| 顺序 | 文件 | 用途 |
|---|---|---|
| 1 | [AGENTS.md](AGENTS.md) | 给开发 Agent 的入口、约束、技能选择和验收要求 |
| 2 | [Trackers 一一映射](NIMBALYST-TRACKER-MAPPING.md) | 确定每个面板、记录、写入口对应哪段宿主代码 |
| 3 | [开发 SPEC v2.3](NIMBALYST-DEVELOPMENT-SPEC.md) | 共用核心、状态机、协议、NB 任务与验收矩阵 |
| 4 | [TUI/Hooks 契约](NIMBALYST-TUI-HOOKS-SPEC.md) | 无头运行、CLI输出、Hook校验/投递及自动化测试 |
| 5 | [功能对照表](CAPABILITY-MATRIX.md) | 每项业务在 GUI/TUI/CLI/Hooks 的对应与完成条件 |
| 6 | [视觉约束](design/visual-contract.md)与[覆盖计划](design/UI-VISUAL-PLAN.md) | GUI参考图和TUI实际交互基准 |
| 7 | [启动开发提示词](START-HERE-PROMPT.md) | 可直接发给 Cursor、Codex 或 Pi 的当前实施指令 |
| 8 | [开发任务并发编排](MULTI-AGENT-PLAN.md) | 主控＋三工作角色、依赖图、文件归属和集成交接 |

### 这次补了什么

- `AGENTS.md`：只写跨任务不变的规则，细节通过链接读取，避免每次加载整套资料。
- `skills/vendor/`：携带三个经过选择的设计技能、必要参考文件与 MIT 许可证；[使用指南](skills/SKILLS-GUIDE.md)规定何时读取。
- `design/`：保留原图及原生 Trackers 截图，新增视觉约束、场景计划和逐张生图提示词。
- `design/demo-fixtures.json`：统一任务名称、演示身份和场景。这是设计数据，不是生产 API 合同。
- `PACKAGE-MANIFEST.json`：记录文件来源与 SHA-256；[校验脚本](scripts/verify-package.py)可在别的电脑复核内容完整性。

## 哪些资料是当前规则

当前业务规则以 **开发 SPEC v2.3 + Trackers 映射 + TUI/Hooks 契约 + ADR-005** 为准，并已同步到 AGENTS、实施提示词、系统规格、视觉文档和功能矩阵。图片用于布局方向，不能覆盖状态守卫、类型语义或源码证据。

新增功能先定义公共命令/查询/事件，再接三端；关闭桌面窗口后 TUI/CLI 仍可使用独立非图形服务。Hooks 提供校验与观测，模型通过命令、相关事件、查询和断言测试；Hook收到“完成”不等于验收通过。GUI内共用provider的要求不误用为跨进程共用JS对象。

[系统规格](NIMBALYST-SYSTEM-SPEC.md)保留整体背景；[SOURCE-MAP](SOURCE-MAP.md)和[源码证据 JSON](design/nimbalyst-source-evidence.json)记录既有源码研究。源码基线是 `d6e1d008d9ee264a7447f3533fa9f48f158a70b0`，实施前必须重新核对检出的 HEAD。源码本身未复制到开发包。

下列内容为历史或需求参考，不能重新启用其中已被替代的底座：

- [ADR-001](decisions/ADR-001.md)、[ADR-002](decisions/ADR-002.md)：保留决策过程，已由 [ADR-003](decisions/ADR-003.md)及 [ADR-004](decisions/ADR-004.md)调整。
- [ENTRY-AND-BOARD](ENTRY-AND-BOARD.md)：Hermes、Cline 等参考调查，不意味着重新选择主应用。
- [PDF 与运维早期子规格](reference/v1/PDF-AND-OPS.md)：可借鉴双语定位、批注、旧版引用和健康检查需求；其 Nextcloud/AFFiNE/PostgreSQL 假设必须在 NB-12 实施前逐项重审。
- [开发提示词入口](NIMBALYST-IMPLEMENTER-PROMPT.md)统一指向当前 `START-HERE-PROMPT.md`；旧提示词仅在 v2.2 快照中保留。

原仓库的旧 `tasks.json`、`TASKS.md` 和 `contracts/` 没有混入此包。新版机器可读合同仍是 **NB-01 的待办**；不能因为已有 Markdown 就假定后端接口已经同步。

GitHub 发布保留了[旧仓库完整资料快照](reference/pre-v2.3-repository/README.md)，包括最初合同、历史任务及此前未推送的研究资料；根目录 SPEC/TASKS/IMPLEMENTER-PROMPT 已改为当前入口，旧合同不再放在根目录直接供实施使用。v2.2 开发包另保存在 reference/v2.2。历史快照中的状态只反映对应时点。

## 是否还要继续画图

**需要补关键状态，但当前第二版不能直接称为最终图。** 它少了 Trackers 视图与类型树，并在运行、完成、归档列画了不应存在的新建按钮。

GUI 保留五张主视图：看板首页、待办详情、运行会话、验收差异、历史归档。TUI 增加对应的实际捕获场景、字符网格、鼠标/键盘/中文/resize与PTY验证。失败、等待输入、失联、窄屏和深色由同源原型覆盖；两面板与三端一致性必须用同一记录实际操作证明。

本轮已写制作计划与提示词，**没有批量生成新图片，也没有把任何设计稿标记为最终验收通过**。先修正一张母版，再扩展其余状态；有可运行组件后优先从实际 UI 截图。

## 交给开发 Agent

本机可继续以 `D:\Projects\babel-nimbalyst-dev-kit` 为工作目录，发送 [START-HERE-PROMPT.md](START-HERE-PROMPT.md) 内的提示词；其他电脑克隆本仓库后替换该本机路径。源码放 `implementation/nimbalyst/` 独立检出，使用独立 profile；不要在已安装 Nimbalyst 目录试改。先共享核心和CLI，再完成GUI/TUI/Hooks同一闭环。

校验开发包只需要 Python 3.9 或以上的标准库，在包根执行：

```powershell
python scripts/verify-package.py
```

若电脑命令是 `py` 或 `python3`，替换命令名称即可。脚本检查规格包文件、哈希、JSON 和 Markdown 本地文件链接，跳过正在开发的 `implementation/`、Git元数据与Python缓存；不安装依赖、不启动应用、不连接设备。它不证明源码、Nimbalyst功能、UI或外部网址已通过验收。

技能许可和来源见 [SOURCE.json](skills/SOURCE.json)；截图、第三方源码和其它资料不因技能的 MIT 许可自动变为 MIT。
