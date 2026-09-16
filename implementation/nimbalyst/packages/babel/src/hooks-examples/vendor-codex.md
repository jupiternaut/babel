# Codex 厂商 Hook 适配器

状态：适配示例，**不是**已连接的 Codex 账号或会话。

脚本：`vendor-codex.mjs`（共用 `vendor-lib.mjs`）。厂商版本、字段名和密钥处理只留在本目录，不得写入 `core/**`。

## 支持的事件版本

| eventVersion | 说明 |
|---|---|
| `codex.hook.v1` | 当前唯一接受的 Codex 信封 |

识别的 `type`：`session.created` / `session.started` / `thread.started` / `turn.started`，以及 `session.completed` / `item.completed` / `turn.completed` / `thread.completed` / `agent-turn-complete` / `task_complete`，另有 `agent_message` / `item.updated`。

未知 `eventVersion` 或 `type` 拒绝，退出码 2。`apiKey` / `token` 等字段会被丢掉，不会出现在适配结果里。

## 完成语义

适配器把厂商 `completed`/`finished` 映射为观察用的 `run.finished`，并固定：

- `businessComplete: false`
- `observationOnly: true`
- `payload.businessComplete: false`

收到 finished **不能** 当作任务 DONE，也不能代替 `review.accept` 或权威 `task.get` / `run.show`。

## 调用

```text
node vendor-codex.mjs < event.json
node vendor-codex.mjs --timeout-ms 50 --sleep-ms 200
```

可作为 `hook.register` 的 observe 可执行文件：stdin 若已是 Babel 事件则透传观察，仍然 `businessComplete: false`。

因果链自引用、超过 8 跳、或同类事件回声会返回 `CAUSAL_LOOP` / `CAUSAL_LIMIT`。跨项目 `actor.projectIds` 不匹配则 `PERMISSION`。
