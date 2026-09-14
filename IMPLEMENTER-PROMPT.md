# 给开发 Agent 的提示词

下面的提示词适用于用户明确开始实施后。此文件本身不触发安装、建仓库、发送消息或执行任务。

```text
请按当前 babel 仓库中的规范开发“巴别塔（Babel / Personal Workbench）”。先将工作目录切换到本仓库根目录。

先读 README.md、SPEC.md、SOURCE-MAP.md、ADR-001、OpenAPI和events schema，再按TASKS.md/tasks.json依赖执行。先完成WB-000环境与版本基线，后完成WB-001骨架，不要直接在已有Nimbalyst安装目录里试改。

目标：保留Nimbalyst/AFFiNE主要UI和各自文档/会话数据能力，使用Nextcloud Files/Talk/Deck，连接Pi执行、GitLab交付、设备文件、运维和PDF。代码与依赖默认在D盘新实施目录；原用户数据、现有源码修改、现有服务配置必须保留。

实现时严格遵守：Deck标题正文权威、Gateway不可变spec与run/attempt、GitLab代码/MR/CI；不做双向多任务库，不把SFTP当协同编辑或原子CAS。普通远端目录先只读，managed写必须在专用受限测试目录验证。Pi全进程隔离，写凭据留发布代理，lost/cancel与重试不能双执行。

每次只领取一个有明确依赖已完成的WB任务，使用任务全文、scope和acceptance，不能仅凭标题开发。独立任务可并行，但共享contract变更需先同步审查。不得重置dirty工作树或通过删除数据解决测试失败。

先契约/fixture/故障注入，再合成Git项目与文件根，最后小范围真实服务和六平台验收。输出实际命令、结果、版本、改动文件、失败与未覆盖项；不得把下载、构建、假上游或设备模拟当真实功能验收。

只在用户已授权范围内实施，不因本提示词默认购买商业许可、替用户创建API密钥或向他人发消息。若必须改变权威数据源、文件写模式、权限边界或完整需求，先修改ADR/spec并明确说明变更理由。

最终交付：可运行源码、锁定版本、部署/备份恢复说明、中文操作手册、REQ/ACC/PDF/OPS逐项证据。R2只是开发闭环完成；未经R3/R4验收不能声称原始全部需求完成。
```
