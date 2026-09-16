# M1-02a：Pi RPC 工程预检证据

代码为包含本目录的提交；基线与精确源码哈希见 [validation.json](validation.json) 和 [source-sha256.json](source-sha256.json)。本片开发完成，独立验收未勾选，不是三端真实任务执行交付。

- [真实 Pi 预检](real-probe.json)：Mac M3 / Pi 0.84.1 / Node 24.15；空配置 get_state/get_messages 成功，空会话、无模型请求，返回后 PID 已不存在。
- [定向回归](focused-corrected.log)：12 项通过，包含请求乱序、中文/Unicode 分帧、超时不重发、响应与结束事件分离、异常输入、EOF/流错误、CLI 参数及隔离环境。
- [Babel 全包](test-babel.log)：334 通过、4 跳过；[类型](typecheck-babel-final.log)通过。
- [宿主全仓](test-host.log)：14195 通过、26 跳过、0 失败；[26 工作区类型](typecheck-host.log)通过。
- [首次缺模块](before.log)、[写入已关闭流时的异常](focused-final.log)保留失败记录；后者修复后定向和完整检查均无该未处理错误。

独立验收步骤：

1. 固定提交，按 [入口文档](../../nimbalyst/packages/babel/PI-INTEGRATION.md) 在 Babel 包目录运行 CLI，使用实际安装的 Pi 绝对路径。确认 JSON 标注 pi-rpc-probe，模型执行和任务集成均为 false。
2. 检查空配置、请求种类、空闲/空消息、子进程退出与临时目录清理；既有 Pi 会话和 M0 演示服务不受影响。
3. 无参数、错误路径、未知选项必须非零退出；协议替身负例另跑对应测试，不用它替代真实 Pi 预检。
4. 记录提交、平台、Pi 版本、实际输出后决定 M1-02a 验收标记。M1-02、M1-03 与三端 Pi 界面仍保持未完成。

仓库日志只清理行尾空格及末尾空行；原始日志保留在 validation.json 的 logRoot，原始与入库日志的 SHA-256 分别登记。
