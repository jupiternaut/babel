# Pi 厂商 Hook 适配器

状态：适配示例，**不是**已连接的 Pi Worker 或真实设备。

脚本：`vendor-pi.mjs`（共用 `vendor-lib.mjs`）。协议名、Worker 字段和密钥处理只留在本目录，不得写入 `core/**`。

## 支持的事件版本

| eventVersion | 说明 |
|---|---|
| `pi.agent.v1` | 当前唯一接受的 Pi 信封 |

识别的 `kind`/`type`（对齐 Gateway `WorkerEvent.kind` 的离线名字，不是已接通协议）：`run.finished` / `session.end` / `exited` / `lost` / `tool` / `tool.done` / `message` / `log` / `diff` / `artifact` / `cancel_ack`。

未知版本或类型拒绝。密钥字段不会进入适配输出。

## 完成语义

`exited` / `run.finished` 只生成观察信封，固定 `businessComplete: false`。适配器退出码 0 或看到厂商 finished **不能** 把 run 标为 succeeded，也不能跳过权威查询。

`lost` 映射为 `vendorResult: "lost"` 且 `stopped: false`（失联不是已停止）。

## 调用

```text
node vendor-pi.mjs < event.json
node vendor-pi.mjs --timeout-ms 50 --sleep-ms 200
```

可作为 observe Hook。透传 Babel `run.finished` 时仍是观察，不构成验收。
