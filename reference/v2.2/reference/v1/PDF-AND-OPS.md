# PDF 双语笔记与运维观测开发规格

文档版本：1.0-draft。日期：2026-09-13。性质：待实现的开发规格；本文不代表相关软件已安装、已集成或已通过设备实测。

主架构：保留 Nimbalyst 与 AFFiNE 的主要界面，Nextcloud 提供 Files/Talk/Deck，TypeScript Gateway 与 PostgreSQL 保存跨应用引用、作业和事件。PDF 模块不替换 AFFiNE 的 CRDT 文档同步系统；运维模块不向普通开发 Agent 开放系统管理权限。

## 1. 交付边界与现成能力

| 模块 | 可以复用 | 本项目必须开发 | 交付阶段 |
|---|---|---|---|
| PDF 阅读 | zotero/reader 的 PDF 阅读、标注与 Web 构建 | 身份与文件授权、版本绑定、批注保存、设备缓存、段落定位、AFFiNE 引用 | R4 PDF 专项里程碑 |
| PDF 翻译 | PDFMathTranslate-next/BabelDOC 的文档翻译和双语输出 | 排队、状态归一化、源段落与译文映射、原文下插译文的重排视图 | R4 PDF 专项里程碑 |
| 服务探测 | Uptime Kuma 的服务检查、Prometheus 指标 | 只读适配器、统一状态、去重事件、任务卡片回链 | R3 运维薄切片，纳入主契约后实现 |
| 主机资源 | Beszel 的 Hub/Agent、资源与容器历史 | 只读摘要适配器、缺测标记、服务与主机关联 | R3 运维薄切片，纳入主契约后实现 |
| 人工管理 | Cockpit 的主机服务与管理界面 | 经过权限检查的“打开管理页面”入口 | 外链方式；不开发嵌入式管理员终端 |

Zotero reader 确认提供 Web 构建，但这不等于已有本项目的自托管账号、移动手写和同步服务。其代码采用 AGPLv3；保留相关来源与许可证，实施时对固定提交完成依赖清单。[reader 源码](https://github.com/zotero/reader)、[许可](https://github.com/zotero/reader/blob/master/COPYING)

PDFMathTranslate-next 提供 CLI、界面及双语翻译能力；其双语 PDF 输出不等于“原 PDF 每一行下面插入译文”。本项目把后者拆成可以验证的段落重排能力。实现前锁定 `PDFMathTranslate-next/PDFMathTranslate-next` 的发行版与提交，避免把另一个组织下的 fork 当作固定上游。[上游源码](https://github.com/PDFMathTranslate-next/PDFMathTranslate-next)

**API 范围规则：** 本文所有路径采用 `/api/v1/` 命名空间。凡未进入主 `contracts/openapi.json` 的接口均为 **FUTURE 草案**，未实现并扩展契约前不得在客户端中调用，不得宣称已可用。PDF 接口全部属于 FUTURE；运维接口必须由主契约明确接纳后才进入 R3。接口命名空间的 `v1` 指协议版本，不表示所有模块都会在首个产品版本交付。

## 2. PDF 需求

| ID | 规范要求 | 优先级 |
|---|---|---|
| PDF-001 | 从已有 `resource_id` 导入 PDF；保留原件，不覆盖原文件。导入时冻结字节哈希和可读取的不可变快照 | PDF 首版必做 |
| PDF-002 | 原版视图支持分页、缩放、搜索、文本高亮、区域批注、文字评论，批注绑定原件版本 | PDF 首版必做 |
| PDF-003 | 建立段落、原文和页内位置映射；译文必须能回到原文页和段落 | PDF 首版必做 |
| PDF-004 | 重排视图按“原文段落 → 中文译文”排列，支持隐藏原文/译文；公式、图表保留可跳转的原版位置 | PDF 首版必做 |
| PDF-005 | 用户可把所选原文、译文和批注作为引用卡插入 AFFiNE；卡片保存来源定位和版本，不把全文写进 Gateway | PDF 首版必做 |
| PDF-006 | 全文抽取、OCR、翻译、导出均为可取消的后台作业；显示真实阶段和已完成单位数 | PDF 首版必做 |
| PDF-007 | 支持指定缓存的 PDF 与批注离线阅读；写入恢复后按显式冲突规则同步 | PDF 首版必做 |
| PDF-008 | 按文档权限分别控制阅读、标注、翻译、导出，跨项目引用不扩大原文可见性 | PDF 首版必做 |
| PDF-009 | 原件更新后创建新版本；旧批注仍可打开旧版，不自动漂移到新页 | PDF 首版必做 |
| PDF-010 | iOS/iPadOS/Android 必须做真实触控验收；能在桌面缩窄窗口运行不算跨端通过 | PDF 首版必做 |
| PDF-011 | 导出带批注 PDF、双语 PDF 和 Markdown 笔记；产物标明原件及翻译版本 | PDF 后续 |
| PDF-012 | Apple Pencil/Android 手写笔笔迹、压感、手掌误触处理 | PDF 后续，独立设备验收 |
| PDF-013 | 对固定版面执行严格逐行插译并重新分页 | PDF 后续研究项；不是首版承诺 |

本包阶段映射：PDF-001至010全部为R4必需；PDF-011的Markdown笔记导出与PDF-012的基础手写也纳入R4。带批注/双语PDF导出、压感和高级防误触列后续扩展，PDF-013列研究项，不把它们混入R4完成声明。R4的“行间对译”明确采用原段下插译文的重排阅读模式，不能声称已完成固定版面逐物理行插译。

首版优先支持可提取文本的学术 PDF。扫描件必须显示“需要 OCR”并进入单独作业；密码保护文档需要交互解锁，不在日志中保存密码。损坏、超限或解析失败必须返回具体错误，不允许伪造空译文成功。

### 2.1 两种视图的行为

**原版视图**是批注定位的依据。使用冻结 PDF 渲染；文本高亮、矩形和笔迹均引用原版坐标。屏幕旋转和缩放仅是显示变换，不重写坐标。

**双语重排视图**由段落数据生成，不是给 PDF 页叠一层固定高度的译文。原文段落后显示译文；用户点击任一段，原版视图定位到相同 `paragraph_id`。遇到双栏、跨页段落、脚注或顺序不确定时显示“顺序待核对”，允许用户跳回原页。

对未实现映射的页面，应显示该页原件和整页译文入口，不把机器猜测的段落标成精确对应。公式不作为普通散文翻译，保存其定位；译文长度变化不能推动原版高亮位置。

### 2.2 数据模型

ID 使用 UUID；JSON 字段中的页序号固定从 0 开始。所有时间为 UTC ISO 8601。业务对象通过 `project_id` 与共同资源模型关联；原件、译文、批注具有独立版本。

| 实体 | 必需字段 | 不变量 |
|---|---|---|
| `pdf_document` | `document_id, project_id, resource_id, title, latest_version_id, created_by` | 标题改变不产生内容版本；一个逻辑文档可有多份原件版本 |
| `pdf_document_version` | `version_id, document_id, resource_version_ref, sha256, byte_size, page_count, snapshot_resource_id, created_at` | 发布后不可变；不能仅用路径或 mtime 标识版本 |
| `pdf_extraction` | `extraction_id, version_id, parser_name, parser_commit, config_hash, state, created_at` | 同一 PDF 用新解析器重跑创建新抽取版本 |
| `pdf_paragraph` | `paragraph_id, extraction_id, order_index, kind, text, text_hash, language, source_segments[], confidence` | `paragraph_id` 仅在该抽取版本内稳定；不得用重复段落文字单独充当主键 |
| `pdf_translation` | `translation_id, paragraph_id, source_text_hash, target_language, engine, model, engine_version, prompt_hash, output_text, revision, supersedes_id, reviewed_by` | 保存原译与人工修订历史；不记录令牌或密钥 |
| `pdf_annotation` | `annotation_id, version_id, type, selector, body, color, author_id, revision, deleted_at, client_operation_id` | 批注绑定原版版本；删除用 tombstone；重复离线操作不创建第二份 |
| `pdf_note_link` | `note_link_id, project_id, affine_workspace_id, affine_doc_id, affine_block_id, document_id, version_id, annotation_ids[], paragraph_ids[]` | AFFiNE 文档正文仍由 AFFiNE 权威保存；这里只保存引用 |
| `pdf_job` | `job_id, document_version_id, kind, state, attempt, lease_epoch, requested_by, provider_ref, config_hash, progress, output_resource_ids[], error_code` | 作业与开发 Agent 的 `run_id` 分开；可关联相同项目 |

`source_segments[]` 每项至少包含：

```json
{
  "page_index": 4,
  "page_label": "3",
  "coordinate_system": "cropbox-normalized-unrotated-v1",
  "quads": [[0.10, 0.22, 0.44, 0.22, 0.44, 0.26, 0.10, 0.26]],
  "text_quote": {"exact": "example source text", "prefix": "before ", "suffix": " after"},
  "text_start": 120,
  "text_end": 139
}
```

坐标约定：去除 PDF 页旋转后的 CropBox，左上角为 `(0,0)`，右下角为 `(1,1)`；四边形点依次为左上、右上、右下、左下。适配器负责 PDF 原生坐标与此坐标系双向转换。`text_start/text_end` 为该抽取版本该页规范化字符串的 Unicode code point 半开区间，不是 UTF-16 下标。`page_label` 只用于显示；罗马数字页码也不能代替 `page_index`。

跨页段落保留多个 segment。任何抽取或映射升级必须新增 `extraction_id`；迁移批注只生成待确认候选，不能直接改写旧 `version_id`。接受候选后生成新批注并保留 `derived_from_annotation_id`。

批注 `selector` 可以为文本多段选择、区域矩形或笔迹路径；都必须含版本和坐标系统。来自重排译文的批注另存 `translation_id + revision + quote` 并关联原段落，不把译文的字符偏移冒充原文字符偏移。

### 2.3 PDF 后台作业与队列

`kind = extract | ocr | translate | export`。作业状态：

```text
queued → running → succeeded
                 → failed
queued → cancelled
running → cancel_requested → cancelled
```

`phase` 是作业状态的补充：`fetching / extracting / translating / composing / exporting`。`progress` 为 `{completed_units, total_units, unit}`，总量未知时 `total_units=null` 并显示阶段；不能把下载完成算作翻译 100%。

执行规范：

1. 入队与 outbox 事件在同一个 PostgreSQL 事务中提交。用户重复提交相同 `Idempotency-Key` 返回同一 `job_id`；相同 key 不同请求体返回 `409`。
2. 去重键至少含 `version_id + kind + language + engine/model + config_hash + extraction_id`。人工指定“重新执行”创建新尝试，保留原因。
3. Worker 通过带租约的领取获得作业；每次重新领取递增 `lease_epoch`。服务端拒绝旧租约 Worker 的完成写入，避免失联 Worker 回来覆盖新结果。
4. 默认每个用户最多 2 个执行中翻译作业，OCR 与翻译的总体并发由部署配置限制；不得根据设备有 GPU 就默认可同时运行所有模型。
5. Worker 只获取该作业授权的输入快照与输出目录。它不得使用开发 Agent 的凭证，也不接受任意 shell 命令和任意下载 URL。
6. 暂存输出采用临时资源，确认文件可打开、页数/元数据合理、哈希完成后再提交为结果。取消或失败的部分结果标成 `partial`，不作为成功下载入口。
7. 认证失败、参数错误、原文件损坏不自动重试；网络超时/可重试上游错误最多 3 次并指数退避。Worker 失联标 `worker_lost`，进入人工可见的重试策略，避免无限扣费。
8. 本地 Ollama 与外部服务为显式 provider。任务创建前显示实际处理位置；选择本地失败时不自动改发云端。密钥只保存在服务端 secret store。
9. 本机初始限制建议 100 MiB 或 500 页，均为待压测配置值。超过限制返回 `413` 与可操作说明，不能把限制写成上游软件的固有限制。

PDFMathTranslate-next 的 CLI/API 能力要由适配器转换为此作业协议；它不天然返回本表中的段落 ID 和跨设备事件。开工的第一个原型门槛是对 3 份样本文档获得可追溯的抽取结果。如果上游没有可稳定使用的结构化导出，需要独立抽取层，不能仅抓取终端日志猜测段落映射。

### 2.4 PDF API 草案（全部 FUTURE）

| 方法与路径 | 请求要点 | 成功响应 | 读写权限 |
|---|---|---|---|
| `POST /api/v1/pdf/documents` | `project_id, resource_id, expected_resource_revision` | `202 {document_id, version_id, job_id}` | 源资源 read + 项目资料管理 |
| `GET /api/v1/pdf/documents/{document_id}` | 无 | `200` 文档及版本概要 | 文档 read |
| `GET /api/v1/pdf/versions/{version_id}/content` | 支持 HTTP Range | `200/206` PDF 字节 | 每次请求检查 read；不返回上游永久凭证 |
| `GET /api/v1/pdf/versions/{version_id}/paragraphs` | `extraction_id, cursor, limit<=200` | `200 {items,next_cursor}` | 文档 read |
| `GET /api/v1/pdf/versions/{version_id}/annotations` | `cursor` | `200 {items,next_cursor}`，包括同步需要的 tombstone | 文档 read + 对应批注可见权限 |
| `POST /api/v1/pdf/versions/{version_id}/annotations` | `client_operation_id, type, selector, body` | `201`；相同操作重放返回原对象 | 文档 annotate |
| `PATCH /api/v1/pdf/annotations/{annotation_id}` | `If-Match` + 修改字段 | `200` 新 revision；过期 `412` | 本人批注 write 或显式编辑权限 |
| `DELETE /api/v1/pdf/annotations/{annotation_id}` | `If-Match` | `204` tombstone；过期 `412` | 本人批注 write 或显式编辑权限 |
| `POST /api/v1/pdf/jobs` | `kind, version_id, extraction_id?, provider_ref?, config` + Idempotency-Key | `202 {job_id,state}` | translate/export 等具体权限，不由 read 自动推导 |
| `GET /api/v1/pdf/jobs/{job_id}` | 无 | `200` 状态、真实进度、已授权结果 | 项目 read + 原文 read |
| `POST /api/v1/pdf/jobs/{job_id}/cancel` | Idempotency-Key | `202` 或已终止时 `200` | 请求人或项目任务管理 |
| `PATCH /api/v1/pdf/translations/{translation_id}` | `If-Match, output_text` | `200` 新修订；过期 `412` | 文档 translation:edit |
| `POST /api/v1/pdf/note-links` | 现有 AFFiNE 文档/块 ID 与所选来源 ID | `201` 引用记录 | 原文 read + 目标 AFFiNE 文档 write |

通用错误还包括 `401` 未登录、`403` 明确无权、`404` 不存在或跨项目不可见、`409` 原件版本已变化/幂等冲突、`422` 定位不合法、`429` 队列或请求配额超限。权限撤销后不得靠可猜测的 document/job ID 读取旧 API 缓存。

`note-links` 接口不直接修改 AFFiNE CRDT；由 AFFiNE 扩展在用户当前文档会话中提交引用块，再登记引用。如 AFFiNE 写入成功而登记失败，用稳定 operation ID 补登记，不重复插入块。

### 2.5 离线和并发策略

- 仅用户主动选择“离线可用”的文档缓存原件；移动端应显示缓存字节数、版本和最近同步时间。浏览器可能清理缓存，不能承诺永远离线可用。
- PDF 原件不可变，因此同一版本缓存不做内容合并。设备 A 更新原件时，设备 B 仍打开旧版并显示“有新版”，批注不会被强制迁移。
- 新增批注使用 UUID 和 `client_operation_id` 去重；不同批注并行新增可直接合并。
- 同一批注的评论、颜色、位置发生并发更新时以 `revision + If-Match` 检测；返回 `412`，展示本地/远端差异并让用户保留一方或复制成新批注。禁止静默最后写入覆盖。
- 删除与修改冲突同样交由显式处理；删除后的 tombstone 至少保留到所有有效设备的同步游标越过删除事件，过期设备重新全量同步，不复活旧批注。
- 翻译修订保留不可变历史。用户改译文时上游重译生成新候选，不覆盖人工修订。
- AFFiNE 正文仍按其原有 CRDT 工作；不得用此处的批注 revision 机制替代整篇笔记的协同编辑。
- 断线后 UI 显示待同步数和失败项。权限撤销后的离线修改不能上传；用户可在其仍获准的数据范围内处理本地草稿。撤权不能远程抹去用户已合法下载的所有文件，这不是服务端可保证的能力。

## 3. 运维观测需求

| ID | 规范要求 | 优先级 |
|---|---|---|
| OPS-001 | 展示每个服务的状态、检查时间、检查位置、响应时间及最近故障，不只显示图标 | R3 薄切片 |
| OPS-002 | 展示 Ubuntu 主机与容器的 CPU、内存、磁盘概要及历史入口；缺测显示 unknown | R3 薄切片 |
| OPS-003 | GitLab 与 MediaWiki 使用语义检查；登录页返回 200 不直接算后端正常 | R3 薄切片 |
| OPS-004 | 故障采用状态机与去重键；重复上报只更新同一 incident | R3 薄切片 |
| OPS-005 | 按项目配置把故障关联为一个 Deck 任务，恢复后更新同一事件；不自动完成用户修复任务 | R3 薄切片 |
| OPS-006 | 区分服务故障、主机失联、采集器失联、监控平台失联和告警投递失败 | R3 薄切片 |
| OPS-007 | 维修期可静默通知但继续采样；确认告警不等于服务恢复 | R3 薄切片 |
| OPS-008 | 修复入口打开 Cockpit/日志/预先编写的 runbook；默认不自动执行重启、删除和更新 | R3 薄切片 |
| OPS-009 | 至少一个外部探测者运行在被监控 Ubuntu 之外，才能宣称覆盖整机故障 | 上线运维告警前必须 |
| OPS-010 | 控制重复通知，保留事件与投递审计，可重试未送达消息 | R3 薄切片 |
| OPS-011 | 对人工授权的具体 runbook 开发带审批、回滚和最小凭证的修复流程 | 后续；不自动随普通 Pi 功能启用 |

### 3.1 采集与适配边界

```text
Uptime Kuma ── metrics/受控通知 ─┐
Beszel Hub ── 只读 API ─────────┼→ Ops adapter → Gateway/Postgres → Nimbalyst/AFFiNE 摘要
独立外部探测者 ─ 心跳/检查 ─────┘                         └→ 事件 → Deck/Talk

管理员 ── 单独登录 ── Cockpit ── Ubuntu 服务与日志
```

Uptime Kuma 首版优先读取其文档所述 `/metrics`，并可用通知作为加速触发；不依赖未经固定版本验证的内部 Socket.IO 管理 API。指标快照和通知需要共同做状态协调，单靠故障通知无法证明监控器持续在线。[Prometheus 集成](https://github.com/louislam/uptime-kuma/wiki/Prometheus-Integration)、[API key](https://github.com/louislam/uptime-kuma/wiki/API-Keys)

Beszel 通过独立只读身份访问其 PocketBase API；记录固定版本的 collection/schema 映射，并用真实响应夹具验证。只读账户不得有系统配置删除或写权限。原始长周期资源历史继续由 Beszel 保存，Gateway 只保留 UI 摘要与故障事件。[Beszel API](https://beszel.dev/guide/rest-api)、[功能与架构](https://beszel.dev/guide/what-is-beszel)

若固定版本不能提供所需最小权限或缺少采样时间戳，必须明确标记 `adapter_blocked` 并记录缺口；不能临时把超级管理员 token 发给前端，也不能用抓取后台 HTML 代替稳定数据契约。

监控认证与开发 Agent 认证分开。Cockpit 入口提供当前服务名和 runbook 链接，不在 URL 中附密码或令牌；跨域嵌入失败时明确打开新页面。[Cockpit 文档](https://cockpit-project.org/guide/latest/)

### 3.2 对象和状态机

| 实体 | 关键字段 |
|---|---|
| `ops_service` | `service_id, project_id, host_id, name, owner_user_id, environment, runbook_resource_id, cockpit_url_ref` |
| `ops_probe` | `probe_id, service_id, collector_id, vantage_id, kind, interval_s, timeout_s, stale_after_s, expected_contract_hash, credential_ref` |
| `ops_observation` | `observation_id, probe_id, observed_at, received_at, source_sequence, result, latency_ms, evidence_summary, evidence_resource_id` |
| `ops_incident` | `incident_id, service_id, probe_group, failure_class, fingerprint, state, first_seen_at, last_seen_at, recovery_started_at, resolved_at, acknowledged_by, linked_task_id` |
| `ops_delivery` | `delivery_id, incident_id, event_id, channel, target_ref, state, attempt, next_attempt_at, provider_receipt_ref` |

观察结果：`ok | failed | timeout | auth_error | invalid_response | unknown`。`auth_error` 指探测配置/凭证错误，不直接推断业务不可用；`invalid_response` 保存类型错误摘要，不存含秘密的完整响应。

服务聚合状态：`healthy | degraded | down | unknown | maintenance`。服务结果和观测新鲜度分开保存：`last_known_state` 可以是 down，但当前采集失联时 `current_state=unknown`，页面保留“上次确认故障”的时间。

故障事件状态：

```text
open → acknowledged → recovering → resolved
open ───────────────→ recovering → resolved
recovering → open / acknowledged    # 再次出现有效失败，保留已确认者
```

默认触发策略（可配置、必须写入测试夹具）：

- 服务探测每 30 秒一次，超时 5 秒；连续 3 次失败后打开 incident。Kuma 自己的重试次数必须折算进实际触发延迟，不能两层重复计数后仍声称 90 秒。
- 失败计数根据不同 `observation_id/source_sequence` 增加。同一通知重复送达 20 次只算一个观察。
- 恢复需连续 2 次有效成功才进入 resolved；采集器恢复或收到 HTTP 200 但响应断言失败都不能关闭事件。
- 快照超过 90 秒未更新时标记采集 stale，创建采集链路故障事件；原服务 incident 不因此自动恢复。
- 去重范围为 `service_id + probe_group + failure_class + 未关闭事件`。同一范围只允许一个未关闭 incident，数据库使用唯一约束/事务解决并发创建。
- 主机和该主机全部服务同时不可达时建立关联事件，折叠重复通知，保留各服务观察；同一网络路径失败只能证明该路径不可达，不能断言机器物理断电。
- 维修期保留 `maintenance_until` 和操作人，仍保存原始结果；结束后重新执行确认计数。
- 对已经 resolved 的事件，10 分钟内同类复发可关联为同一故障的下一 episode；需要保存原恢复区间，不抹去抖动历史。

首条通知触发于确认故障；持续故障默认不每轮发送，30 分钟汇总提醒可配置。状态恶化、恢复和告警投递失败是独立事件。用户未配置持续提醒时保持安静。

### 3.3 GitLab、MediaWiki 与主机检查

| 对象 | 检查合同 | 失败解释 |
|---|---|---|
| GitLab 进程 | `GET /-/health`，确认预期状态与响应内容 | 应用服务器基础检查，不代表数据库/Redis正常 |
| GitLab 依赖 | `GET /-/readiness?all=1`，要求 200、合法 JSON 且所有返回的检查通过 | 记录具体失败依赖；503 为未就绪；403 是探测 IP 未放行等配置问题 |
| GitLab 用户入口 | 从用户所用域名访问登录/公开入口并检查正常响应 | 区分反向代理、DNS、TLS与实例内部错误 |
| MediaWiki API | `api.php?action=query&meta=siteinfo&siprop=general&format=json`，解析 `query.general` 并匹配登记站点标识 | 不能把 PHP 错误页、登录 HTML、代理错误当作 JSON 成功 |
| MediaWiki 页面读取 | 查询专用健康测试页当前修订与预期标记，至少绕开单纯静态首页缓存 | 反映数据库读取链路；不声称检测到写入能力 |
| Ubuntu 主机 | Beszel 最近样本、磁盘剩余、内存/CPU持续阈值、主机外部连通性 | 高负载属于性能退化；无样本属于 unknown，不能显示 0% |
| 背景作业 | 对需要的定时任务接入完成心跳和最后成功时间 | 进程存在不等于任务已成功完成；此项必须逐服务定义 |

GitLab 健康端点需按官方要求配置探测 IP 允许列表；本规格针对用户的自托管实例，不能把单实例 readiness 策略直接推广为大型多副本集群的整体用户可用率。[GitLab 健康检查](https://docs.gitlab.com/administration/monitoring/health_check/)

MediaWiki `siteinfo` 是正式 Action API。页面读取探针应使用已知测试页面和最小读取身份；首版不创建、修改或删除 Wiki 页面，因此不声称覆盖写入完整性。[MediaWiki Siteinfo](https://www.mediawiki.org/wiki/API:Siteinfo)、[修订查询](https://www.mediawiki.org/wiki/API:Revisions)

磁盘初始告警配置建议 `free<10%` 或 `free<20GiB` 持续 5 分钟；恢复需高于相应阈值加 2 个百分点/5GiB 持续 5 分钟。CPU/内存阈值在基线采集后设置，避免实验任务的正常负载造成告警风暴。数值是本项目待调优默认值，不是实测结论。

### 3.4 外部探测与告警投递

至少两类观测位置：Ubuntu 内部的应用依赖检查，以及另一台常驻设备对 Ubuntu 的用户访问路径检查。MacBook/Windows 笔记本可能休眠，不能未经验证就列作 24 小时可靠观察者。

若所有设备仅在同一家庭局域网，可以检测 Ubuntu 整机失联，但不能保证在路由器/网络/整屋断电时发出通知。要覆盖该范围，需要不同故障域的常驻探测者和通知通道，作为明确的部署选项。

Talk 与运维服务同在 Ubuntu 时，Ubuntu 停机后无法依靠该 Talk 发出通知。外部观察者必须能独立发送至少一种通知，并保留告警投递日志；未配置时工作台显示“仅本机服务检查，整机故障通知未覆盖”。Beszel 的外部心跳可以作为监控自身的信号，但不代替从用户网络路径实际请求服务。[Beszel 心跳配置](https://beszel.dev/guide/environment-variables)

### 3.5 Ops API 草案（主契约未列入的全部 FUTURE）

| 方法与路径 | 合同 | 权限 |
|---|---|---|
| `GET /api/v1/ops/services` | 分页返回状态、last_observed_at、freshness、观察位置、当前 incident 与资源摘要 | 项目 `ops:read` |
| `GET /api/v1/ops/services/{service_id}` | 当前状态、探针概要、依赖和获准的诊断链接 | 项目 `ops:read` |
| `GET /api/v1/ops/incidents` | 按项目、状态过滤，游标分页 | 项目 `ops:read` |
| `POST /api/v1/ops/incidents/{incident_id}/acknowledge` | Idempotency-Key；记录确认人；不改变服务 health | 项目 `ops:triage` |
| `POST /api/v1/ops/incidents/{incident_id}/task-link` | 创建或返回唯一 Deck 任务关联，明确项目/看板；不直接启动 Agent | 项目 `ops:triage` + 对应 Deck 写入权 |
| `POST /api/v1/ops/observations:batch` | 最多 100 条经认证采集者的结果；逐条去重；拒绝跨 service 范围上报 | 仅采集器 `ops:ingest`，绑定允许的 probe_id |
| `POST /api/v1/ops/maintenance-windows` | 明确对象、原因、起止时间；重放幂等 | 项目 `ops:manage` |

`task-link` 是R3新增能力，须先扩展主 Task/Deck 契约；R2的只读导入不能假装已有创建接口。`incident_id` 作为本地幂等键和写入卡片的稳定关联标记，不假定Deck支持Idempotency-Key。创建响应丢失时先以标记核对上游，结果不确定则进入reconciliation_required，不盲重试POST。不能绕过共同任务权限。任务描述包含故障证据和 runbook。服务恢复时写入恢复记录，用户仍决定该修复任务是否验收完成。

没有 `restart-service`、`delete-container` 或任意 shell API。普通开发 Worker 即使能看到 incident 也不因此取得管理权限。

## 4. 事件协议与断线续读

PDF与Ops复用主事件的持久化、去重和续读机制，但它们没有run_id，不能伪造开发run来满足RunEvent。R3/R4必须先新增按aggregate鉴权的独立事件Schema，再扩展订阅接口。下面是FUTURE草案，不符合当前RunEvent的API契约；共同字段沿用type、sequence、occurred_at、received_at，其余聚合字段在新Schema中定义。

```json
{
  "schema_version": 1,
  "event_id": "3c4bf044-bfe9-4301-9093-6f701c05aab7",
  "type": "ops.incident.opened",
  "project_id": "5289d45b-e3b6-4879-98c7-2f1705b813d8",
  "aggregate_type": "ops_incident",
  "aggregate_id": "592c08ba-1a6b-4736-af7b-f7db0ab52c73",
  "sequence": 1,
  "occurred_at": "2026-09-13T20:00:00Z",
  "received_at": "2026-09-13T20:00:01Z",
  "correlation_id": "18b61977-05c8-42a0-9285-95c23cd47fbc",
  "payload": {"service_id": "00f8bd34-38f1-4901-bc23-f453a64ea6d6", "state": "open", "failure_class": "dependency_failed"}
}
```

建议事件：`pdf.version.created`、`pdf.job.phase_changed`、`pdf.job.progress`、`pdf.job.completed`、`pdf.job.failed`、`pdf.annotation.changed`、`pdf.annotation.deleted`、`ops.observation.received`、`ops.service.state_changed`、`ops.incident.opened`、`ops.incident.acknowledged`、`ops.incident.resolved`、`ops.collector.stale`、`ops.notification.failed`。

服务端保存按租户/项目过滤后的全局事件游标；前端断线重连从游标继续读。事件至少一次投递，消费者根据 `event_id` 去重，以 `aggregate_revision` 拒绝倒退。旧观察仍可入历史，但不能推翻更晚样本。游标过期时返回 resync 指示并获取全量概要，不假装无事件。

事件不携带原文全文、PDF字节、密码、完整带 token URL 或环境变量。接收端每次订阅及续读都检查项目权限。未知 `schema_version` 不猜测处理，保存为兼容性错误并显示适配器需要升级。

## 5. 验收案例

以下均为待执行测试合同。必须交付日志、测试输入和实际界面证据，不能用实现说明替代通过记录。

### 5.1 PDF 验收

| Case | 对应需求 | 输入/动作 | 通过标准 |
|---|---|---|---|
| PDF-T01 | PDF-001/009 | 同一路径替换为不同 PDF，再导入 | 两个 version_id 与不同 sha256；旧批注仍打开旧版 |
| PDF-T02 | PDF-002/003 | 普通、双栏、旋转页各选择 10 处文字 | 30 个固定锚点在缩放/旋转后仍落在正确文字；测试坐标转换误差不超过 2 CSS px（记录缩放与 DPR） |
| PDF-T03 | PDF-003/004 | 含跨页段落、公式、脚注的论文 | 原译切换点击定位正确；不确定段落有标记；无伪造精确映射 |
| PDF-T04 | PDF-004 | 原文 1 行，译文 5 行 | 重排阅读不遮挡下一段；原版 PDF 坐标不变 |
| PDF-T05 | PDF-005 | 同一批注插入 AFFiNE，登记接口超时后重试 | 只有一个引用块；点击可回原件版/页/批注 |
| PDF-T06 | PDF-006 | 连续提交同一幂等 key 10 次 | 一个 job_id；更换请求体却沿用 key 返回 409 |
| PDF-T07 | PDF-006 | Worker 租约过期，旧 Worker 晚到成功结果 | 旧 lease_epoch 完成写入被拒绝，新结果不被覆盖 |
| PDF-T08 | PDF-006 | 翻译一半取消、模拟上游 401/超时 | 取消停止发布成功产物；401不重试；超时按有限策略重试 |
| PDF-T09 | PDF-007 | 两设备离线修改同一批注后重连 | 返回显式冲突，无丢失覆盖；选择保留/复制后收敛 |
| PDF-T10 | PDF-007 | 一端删除批注，另一端旧缓存上传修改 | 不静默复活已删批注；冲突可见 |
| PDF-T11 | PDF-008 | 用户移出项目后用旧 URL、job ID、Range 请求和事件游标读取 | 均不能获得新服务端数据；离线下载限制在说明中明确 |
| PDF-T12 | PDF-006/008 | 文档选择本地翻译后断开 Ollama | 明确失败且网络记录无对外翻译请求 |
| PDF-T13 | PDF-010 | Windows/Ubuntu/Mac 浏览器、iPhone Safari、iPad Safari、Android Chrome 实机 | 打开、缩放、选中文字、评论、键盘遮挡、旋转、后台恢复均有版本/设备与录屏证据 |
| PDF-T14 | PDF-010 | 手机/平板断网后后台挂起，再恢复网络 | 待同步状态可见；不重复批注；已被系统清除缓存时解释并重新获取 |
| PDF-T15 | PDF-001/006 | 扫描件、损坏PDF、超过限制、加密PDF | 各自进入明确路径或错误，不以空结果成功 |

段落质量单独交付人工评审：至少 5 份代表性文档，包含双栏、公式、表格、脚注和扫描件。每份抽取至少 20 个段落检查原文顺序、译文对应与来源跳转；预定支持的文本型文档要求 100 个抽检项至少 95 个对应正确，错误必须保留示例。此门槛是验收目标，不是机器翻译语义准确率的承诺。

触控专项不得仅用 Playwright 桌面仿真代替真机。手写若尚未通过，入口不显示“支持 Apple Pencil”；可以保留系统鼠标/触控评论功能。

### 5.2 Ops 验收

| Case | 对应需求 | 输入/动作 | 通过标准 |
|---|---|---|---|
| OPS-T01 | OPS-003 | 测试 GitLab 首页仍 200，但 readiness 依赖失败 | 显示依赖故障和证据；不显示全部健康 |
| OPS-T02 | OPS-003 | MediaWiki探针返回登录HTML200、合法JSON错误、正常站点JSON | 前两者不得 healthy；第三者按契约通过 |
| OPS-T03 | OPS-004 | 同一观察通知并发重放 20 次 | 一条观察效果、一个未关闭 incident、至多一张关联任务 |
| OPS-T04 | OPS-004/007 | 失败→一次成功→失败→连续两次成功 | 一次成功不关闭；确认恢复后只产生一次恢复事件 |
| OPS-T05 | OPS-006 | 停止采集器但保留被监控服务 | 显示 collector stale/unknown，不把所有服务报告成 down |
| OPS-T06 | OPS-006 | 撤销监控凭证 | 显示 auth_error 与配置问题，不声称业务宕机 |
| OPS-T07 | OPS-005 | 故障创建任务后服务自行恢复 | 更新同一个事件及任务记录；任务不被擅自验收完成 |
| OPS-T08 | OPS-007 | 进入维修期，触发真实失败后结束维修 | 观察记录完整，静默通知；结束后重新确认状态 |
| OPS-T09 | OPS-008 | 普通 Pi Worker 请求重启服务/访问管理员凭证 | 无该API权限；审计显示拒绝；开发功能仍正常 |
| OPS-T10 | OPS-009 | 在测试窗口让 Ubuntu 服务机断网/关机 | 独立观察者在约定时间内报告不可达；不能依赖同机Talk发送 |
| OPS-T11 | OPS-010 | 通知通道失败而服务仍故障 | 显示 notification_failed，有有限重试；不把“发送API成功”当成用户已读 |
| OPS-T12 | OPS-006 | 模拟旧观察晚到、时钟偏差、事件游标过期 | 当前状态不倒退；时间偏差可见；触发重同步 |
| OPS-T13 | OPS-002 | Beszel采样缺失后恢复 | 缺失期间显示unknown/缺口，不能补成CPU0%、内存0% |

在测试环境执行会中断服务的案例；生产 Ubuntu 的断电/断网演练须另选维护窗口。首版目标是在正常局域网条件下，前端展示滞后不超过 2 个采集周期；必须报告实际采集周期、重试策略和测得延迟。

## 6. 实施任务拆分

每项任务在共同看板上使用稳定需求 ID、输入夹具、验收命令和交付证据。以下标题可直接创建开发卡片，但不能只把标题发给 Agent。

| 任务 ID | 标题 | 依赖 | 必交付 |
|---|---|---|---|
| OPS-D01 | 实现 Kuma/Beszel 只读适配器及样本归一化 | 固定上游版本、最小权限测试账户 | 脱敏响应夹具、映射测试、失联行为 |
| OPS-D02 | 实现状态机、观测去重与 incident 聚合 | OPS-D01 | OPS-T03/T04/T05/T12 的自动测试 |
| OPS-D03 | 在现有 UI 增加运维摘要与人工管理入口 | OPS-D02、主登录权限 | 浏览器截图、权限测试；无管理凭证泄露 |
| OPS-D04 | 对接 Deck/Talk 故障卡片和 outbox 投递 | OPS-D02、主任务/消息适配器 | 幂等与恢复验收；不自动启动 Pi |
| OPS-D05 | 部署独立观察者并演练监控平台失联 | OPS-D01/D04、已选常驻设备 | 覆盖范围声明、断连证据、独立通知日志 |
| PDF-D01 | 验证 reader 构建与段落映射最小原型 | 固定上游SHA、3份测试PDF | 原版→段落→译文→原页可回溯；许可清单 |
| PDF-D02 | 实现不可变 PDF 版本与抽取数据模型 | PDF-D01、Files授权接口 | 数据迁移、哈希/版本与坐标转换测试 |
| PDF-D03 | 实现翻译队列适配器、取消及租约隔离 | PDF-D02、公共作业基础 | 重试/取消/旧Worker结果拒绝测试 |
| PDF-D04 | 实现原版批注、段落插译及笔记引用 | PDF-D02/D03、AFFiNE扩展 | 两视图联动、引用去重和来源测试 |
| PDF-D05 | 实现离线批注同步和显式冲突处理 | PDF-D04 | 双设备断线/撤权/重连案例 |
| PDF-D06 | 完成六平台阅读及移动触控实机验收 | PDF-D05 | 设备清单、版本、录屏、未通过项目 |

本文件允许先交付 Ops，再交付 PDF；不能因为 PDF 后置而把用户的 PDF 要求从总验收中删除。总项目“全部完成”必须包含已约定的 PDF 首版需求和跨端实测。
