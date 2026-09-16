# Wayland / Devin 对标与验收指标

日期：2026-09-16。此文定义产品要求，不是已实现功能或竞品实测成绩。

## 对标对象和边界

Wayland 指 [getwayland.com 的 AI 工作台](https://getwayland.com/)，对应此前引用的[官方首页截图](https://www.getwayland.com/assets/img/screens/dashboard.webp)，不是 Linux 的同名显示协议。Devin 指 Cognition 的开发 Agent 产品。Nimbalyst 继续作为宿主；对标不意味着换壳或覆盖原生 Trackers。

官方参考与本项目要求分开：Wayland 的 Mission Control 文档描述只读任务/定时工作汇总及需要关注、运行、验证等分组；覆盖范围有限，不能当作所有 Agent 的完整状态源。其团队功能提供领导者与成员协作；桌面与 Core 共用配置及执行循环。Devin 文档提供交互式规划、Shell/IDE/Browser 观察和人工接管、代码审查等参考。以下跨端一致性、持久性和安全守卫是我们的要求，不是竞品性能承诺。

来源（2026-09-16 查阅）：

- [Wayland 概览](https://docs.getwayland.com/)
- [Wayland Mission Control](https://docs.getwayland.com/concepts/mission-control/)
- [Wayland Teams](https://docs.getwayland.com/concepts/teams/)
- [Devin 交互式规划](https://docs.devin.ai/work-with-devin/interactive-planning)
- [Devin 会话工具](https://docs.devin.ai/work-with-devin/devin-session-tools)
- [Devin Review](https://docs.devin.ai/work-with-devin/devin-review)

## 能力指标

| ID | 参考与目标 | Babel 实现约束及可核验标准 | 关联 |
|---|---|---|---|
| WD-01 | Wayland 的集中入口；延续已确认的简洁布局 | 设备、项目、集成、运维集中在左；中央仅当前任务四列；右侧按选中项展开。原生类型树、Ready、保存视图仍可达。切视图保留记录身份和已保存字段；不增加第二套任务库。 | CAP-01/02/04，Trackers 映射 |
| WD-02 | Mission Control 的“需要关注” | 从权威 run 状态派生等待输入、失败、失联、待验收列表；显示最后更新时间。用固定场景核对数量、筛选和定位，重复事件不能生成重复卡。需要关注是投影，不是第五个任务阶段；失联不能直接判失败或完成。 | CAP-08/09/17 |
| WD-03 | Wayland 的团队协作 | 明确主控、成员、依赖、文件拥有者和执行设备。独立任务允许并行；共享文件修改按所有权串行集成。模型与权限来自显式配置；我们的 worktree 隔离要求不能归称为 Wayland 的默认行为。 | CAP-05/07/13/19，MULTI-AGENT-PLAN |
| WD-04 | Devin 的规划到执行 | 计划记录目标、相关文件、步骤、假设与验收条件；任务与 run 可追溯。用户修改计划后启动使用最新 revision；需要批准的动作不能因倒计时或 Hook 自动批准。 | CAP-04/07/12/16 |
| WD-05 | Devin 的执行过程可见 | 选中 run 可读命令、工具活动、日志、文件变化及阻塞原因；对话/差异/历史关联同一 runId。切换卡片不创建新执行；图形操作另留截图证据。 | CAP-08/11/15 |
| WD-06 | Devin 的人工接管 | 明确观察、请求暂停、已暂停、人工操作、恢复等状态。只有确认执行已暂停或控制权已移交后才允许冲突写入；恢复不产生第二个活跃 run。 | CAP-09/10/19；新增控制权合同待实现 |
| WD-07 | Devin 的审查与结果交付 | 展示基线与变更、测试结果、产物和审查意见。通过退出码、收到 finished 或拖入完成列都不能绕过完成守卫。人工接受身份可核验；归档保留历史，恢复不自动重跑。 | CAP-11/12/14/15 |
| WD-08 | Wayland Core 的界面与执行分离；我们的三端对等 | GUI/TUI/CLI 访问同一核心与权限守卫；GUI 关闭后任务持续、TUI 可操作。业务结果对等，不要求终端呈现完整网页像素；网页任务提供操作入口、文本结果、产物及接管路径。 | CAP-01～20，HEADLESS/LIFE/PAR |
| WD-09 | 我们的多设备控制台 | macOS 是主要开发与桌面验收环境；Windows、Ubuntu 保留独立适配。设备断线显示未知/过期而非假在线。按设备 ID 和操作 ID 查状态，启停与自启动分别读回；不能误操作另一设备。 | CAP-21/22/26，SYS-01～09 |
| WD-10 | 我们的 Hooks 自动化验收 | CLI 发命令→关联事件→权威查询→断言；覆盖幂等、重复、乱序、超时、重连和拒绝。观察 Hook 重试不重跑业务，Hook 不能自批人工验收。 | CAP-17/19/20，HOOK/EVIDENCE |

## 测量方法与通过条件

这些是本项目的验收目标，不是对 Wayland 或 Devin 做过的测量：

- 正确性：每项固定正例与负例全部通过；权限拒绝不得改变业务状态；同一操作重复提交不得生成第二次执行。
- 响应性：在记录硬件、构建及负载的本地基准中，采集至少 30 次已提交事件到当前可见界面的延迟，目标 p95 ≤ 2 秒；不把后台采样间隔混入渲染延迟。未达标记录原始样本及原因。
- 设备采样：默认 60 秒周期，展示真实采样时间与过期标记；手动刷新可达。运行中任务优先事件流，不能以设备轮询代替执行事件。
- 持续性：关闭 GUI、断开终端、重连后分别核对 runId、状态和事件游标；任务状态不得倒退、重复启动或仅存在窗口内存中。
- 输入与显示：macOS 原生窗口实测鼠标、键盘、中文输入、缩放、深浅色、窄窗口；TUI 实测 PTY、resize、鼠标和退出恢复。独立网页或静态截图不算宿主交互验收。

证据逐项填写：WD/CAP 编号、提交、设备/OS、模式、命令与输入、预期/实际结果、截图或日志路径、失败项。Windows 历史结果见 implementation 下验收文档；不能据此把 macOS 标成通过。

当前状态：指标定义之后已补 Mac 原生工作台、关注、编辑、归档/恢复与三端 demo 子路径证据，见 [TASK_EVIDENCE](TASK_EVIDENCE.md)。这不表示 WD-01～10 整项通过；具体开发完成与待验收功能以 [TASKS](TASKS.md) 和 [CAP 状态](implementation/M0-CAP-STATUS.md) 接续，按 [macOS 交接](MACOS-DEVELOPMENT-HANDOFF.md) 使用已有核心。
