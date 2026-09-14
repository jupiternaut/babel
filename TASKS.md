# 开发任务与依赖

状态：全部未开始。以下27项是开发任务描述，不是已创建的外部Task或已派发的Agent作业。机器可读版本见 `tasks.json`。

每项先满足depends_on并读取对应规范；独立任务可并行，schema/权限/数据所有权变更必须统一审查。UI中显示的标题不能代替goal、scope与acceptance。

## WB-000 · 核实环境、许可和版本基线

- 阶段：R0；依赖：无。
- 目标：生成versions.lock.json、实际服务器/端口/目录清单、权限和备份恢复证据。
- 拟工作范围：`docs/baseline`、`deploy`。
- 验收：固定Nimbalyst/AFFiNE CE/Nextcloud/Deck/Pi版本与来源；记录真实主机，不复用未经验证旧IP；不得把未测试项标通过。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-001 · 建立契约、数据库和项目骨架

- 阶段：R0；依赖：WB-000。
- 目标：创建独立仓库及迁移，落地OpenAPI类型、错误结构、UUID和project ACL基础。
- 拟工作范围：`packages/contracts`、`apps/gateway`、`deploy`。
- 验收：契约引用与请求响应schema验证通过；迁移及回滚在空测试DB验证；没有用户目录/凭据写入仓库。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-002 · 实现Nextcloud委托登录

- 阶段：R1；依赖：WB-001。
- 目标：LoginFlowV2单poll、加密凭据、client proof绑定、cookie/bearer及登出。
- 拟工作范围：`apps/gateway/auth`、`packages/nextcloud`。
- 验收：覆盖404等待/单次200/响应丢失/过期；不收主密码或记录appPassword；撤权不能回退admin身份。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-003 · 项目权限与设备资源登记

- 阶段：R1；依赖：WB-002。
- 目标：以配置/受控bootstrap登记项目、repository、share和principal，不允许用户传任意服务器。
- 拟工作范围：`apps/gateway/projects`、`apps/gateway/policy`、`deploy`。
- 验收：2用户交叉权限测试；operator不自动读用户内容；非法origin、仓库和share拒绝。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-004 · 实现SFTP外部目录只读桥接

- 阶段：R1；依赖：WB-003。
- 目标：Nextcloud WebDAV adapter提供列表、版本、读取/下载、刷新及离线提示。
- 拟工作范围：`packages/nextcloud`、`apps/gateway/resources`。
- 验收：ACC-08路径/链接/host key用合成fixtures通过；外部目录写一律拒绝；目录分页/大小/超时限制有效。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-005 · 受控目录小文本写代理

- 阶段：R1；依赖：WB-004。
- 目标：实现专用OS账号forced-command writer、operation状态、版本校验和持久幂等。
- 拟工作范围：`apps/worker/managed-files`、`apps/gateway/resources`。
- 验收：只写新建测试根且无交互shell；同ID重试不重复写，超时可query；外部修改冻结写入；无SFTP强CAS假承诺。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-006 · Nimbalyst远程资源面板

- 阶段：R1；依赖：WB-004。
- 目标：复用文件/编辑器能力，添加设备分组、只读capability、URI和错误状态；写功能在WB-005后启用。
- 拟工作范围：`integrations/nimbalyst`。
- 验收：本地编辑不回归；远程只读/离线/冲突清楚显示；只改SOURCE-MAP确认的必要接口。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-007 · Deck任务导入与只读投影

- 阶段：R2；依赖：WB-003。
- 目标：同card关联同task、保留原消息来源，任务编辑跳转Deck。
- 拟工作范围：`packages/nextcloud`、`apps/gateway/tasks`。
- 验收：重复导入同task；原生编辑不会被Gateway旧PUT覆盖；移动卡片后依cardID可重新定位。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-008 · 任务快照与Git输入准备

- 阶段：R2；依赖：WB-007。
- 目标：固定任务指纹/验收/上下文/Git baseSHA，生成授权的git bundle及输入manifest。
- 拟工作范围：`apps/gateway/specifications`、`packages/gitlab`。
- 验收：ACC-03过期spec拒绝；输入hash与权限一致；submodule/LFS等未支持场景明确拒绝。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-009 · 事务队列、租约和outbox

- 阶段：R2；依赖：WB-008。
- 目标：单task活跃run、attempt fence、幂等、重启恢复和副作用核对。
- 拟工作范围：`apps/gateway/runs`、`apps/gateway/outbox`。
- 验收：ACC-02/05/07/14故障注入通过；lease超时不双执行；每次幂等重放先复核授权。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-010 · Pi RPC adapter

- 阶段：R2；依赖：WB-000, WB-001。
- 目标：用固定Pi版本将RPC事件转换为内部观察事件；支持取消与重试/压缩语义。
- 拟工作范围：`packages/pi-adapter`。
- 验收：接受prompt不算完成；agent_end续跑不提前验证；成本未知为null且错误分类保留。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-011 · Ubuntu隔离Worker

- 阶段：R2；依赖：WB-009, WB-010。
- 目标：claim、inputs校验、独立Git目录、heartbeat、进程树取消、失联停止。
- 拟工作范围：`apps/worker`。
- 验收：Worker无GitLab写凭据和宿主socket；ACC-04/05/06全通过；断网停止后才能确认隔离/重派。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-012 · 产物与GitLab发布代理

- 阶段：R2；依赖：WB-011。
- 目标：接收patch/测试，校验fence，在发布代理生成分支/MR，记录CI和验收证据。
- 拟工作范围：`packages/gitlab`、`apps/gateway/artifacts`。
- 验收：真实合成repo MR+CI可审查；未知push响应先查不重复MR；主分支只有人类Maintainer合并。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-013 · SSE与运行详情

- 阶段：R2；依赖：WB-009。
- 目标：持久事件序号、Last-Event-ID补取、project ACL、费用和状态展示。
- 拟工作范围：`apps/gateway/events`、`packages/ui-shared`。
- 验收：断线不漏不重复显示；撤权后流停止；超保留期410+重读快照。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-014 · Nimbalyst共享任务与Pi会话

- 阶段：R2；依赖：WB-007, WB-011, WB-013。
- 目标：通过扩展adapter连接Pi，不伪装成其他provider；任务/运行各用明确ID。
- 拟工作范围：`integrations/nimbalyst`。
- 验收：保留原session/tracker工作流；显示设备/spec版本/最新活动/审核；独立Pi运行不混进同session。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-015 · Talk阶段回传与人工验收

- 阶段：R2；依赖：WB-012, WB-014。
- 目标：发送去重摘要和交付链接；maintainer验收，保留原Deck正文。
- 拟工作范围：`packages/nextcloud`、`apps/gateway/reviews`。
- 验收：同故障不刷屏；用户可从结果回到task/MR；仅通过测试不自动终结开发任务。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-016 · 单Worker完整闭环验收

- 阶段：R2；依赖：WB-005, WB-006, WB-015。
- 目标：在合成项目跑Talk→Deck→Pi→GitLab→回传，执行ACC-01至11（11只验R2部分）、13、14、16至18。
- 拟工作范围：`tests`、`docs/evidence`。
- 验收：真实输出与源码测试分开记录；失败/取消/断网证据齐全；任何失败不标R2完成；ACC-11只验R2部分；ACC-13/14/16/17/18在R2通过。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-017 · AFFiNE任务与资源关联

- 阶段：R3；依赖：WB-016。
- 目标：在原编辑/白板增加关联块或链接组件，保留CRDT后端和权限。
- 拟工作范围：`integrations/affine`。
- 验收：同task/resource ID可跨前台打开；原文档协同/离线无回归；明确授权才导出上下文快照。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-018 · 六平台响应式控制入口

- 阶段：R3；依赖：WB-016。
- 目标：control-web覆盖登录、任务、资源、派发、取消和审核；原生Talk聊天保留。
- 拟工作范围：`apps/control-web`。
- 验收：6平台实际OS记录ACC-12；iOS/Android不假装本地Agent常驻；触控/下载/重连/权限实测。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-019 · Windows与Mac远端、可选Worker

- 阶段：R3；依赖：WB-016。
- 目标：新增SSH文件端并验证权限/路径；按项目需求接Windows/macOS Worker。
- 拟工作范围：`apps/worker`、`deploy`、`tests`。
- 验收：三类桌面被访问端验证；Windows reparse/ADS及mac授权覆盖；每Worker并发1且输出隔离。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-020 · 运维探测及指标适配

- 阶段：R3；依赖：WB-003, WB-009。
- 目标：按PDF-AND-OPS实现GitLab/MediaWiki/网页/Kuma/Beszel只读采集，冻结扩展契约后编码。
- 拟工作范围：`apps/gateway/ops`、`deploy`。
- 验收：probe区分实例/依赖/业务读取；无sudo或自动重启；外部探测缺失时显示盲区。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-021 · 故障事件、去重与修复入口

- 阶段：R3；依赖：WB-020, WB-015。
- 目标：事件关联Talk和待处理卡片，人工Cockpit/日志跳转，恢复同事件。
- 拟工作范围：`apps/gateway/ops`、`apps/control-web`。
- 验收：故障持续只一事件；通知失败不等于业务恢复；通过OPS全部R3用例。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-022 · Zotero Reader文件权限集成

- 阶段：R4；依赖：WB-017, WB-018。
- 目标：阅读组件接Nextcloud授权PDF版本，原版视图与批注持久化基础。
- 拟工作范围：`apps/reader`、`apps/gateway/reading`。
- 验收：web构建不等于手机实测；原文件不被覆写；跨用户/文件版本隔离。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-023 · 段落定位与翻译任务

- 阶段：R4；依赖：WB-022, WB-009。
- 目标：基于PDFMathTranslate-next固定上游，段落→译文映射和可取消任务。
- 拟工作范围：`apps/translation`、`apps/reader`。
- 验收：双栏/公式/扫描样本逐项验收；逐段插译与整页双语区分；hash/模型/术语表版本可追溯。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-024 · 批注、笔记和AFFiNE来源链接

- 阶段：R4；依赖：WB-022, WB-023。
- 目标：实现Annotation/Note数据、Markdown导出和原文跳转；译文更新不抹批注。
- 拟工作范围：`apps/gateway/reading`、`integrations/affine`。
- 验收：批注跨设备可见；PDF换版本提示有新版，旧引用仍定位旧版，仅撤权或旧快照不可用时提示无法访问；不双向盲同步Zotero客户端DB。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-025 · PDF离线冲突与触笔优化

- 阶段：R4；依赖：WB-024。
- 目标：离线队列、annotation revision冲突、原版手写与段下插译触控测试。
- 拟工作范围：`apps/reader`、`tests`。
- 验收：iPad/Android实机；同批注冲突可恢复；通过PDF全部R4用例。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。

## WB-026 · 整体验收、备份和升级恢复

- 阶段：R4；依赖：WB-018, WB-019, WB-021, WB-025。
- 目标：执行完整REQ/ACC/PDF/OPS矩阵，恢复演练并生成用户操作手册与限制。
- 拟工作范围：`docs/evidence`、`deploy`、`tests`。
- 验收：不遗漏四条原始需求；备份包含DB/关联/凭据恢复说明；未通过项明确且不宣布整体完成。
- 证据：改动清单、真实验证命令/结果、仍未覆盖项。
