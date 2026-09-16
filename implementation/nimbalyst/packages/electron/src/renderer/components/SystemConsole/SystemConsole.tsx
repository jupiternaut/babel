import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ProcessInfo,
  ServiceSnapshot,
} from "../../../../../babel/src/system/types";
import { consoleRequest } from "./client";
import { useSystemConsole } from "./useSystemConsole";
import "./SystemConsole.css";

const states: Record<ServiceSnapshot["state"], string> = {
  running: "运行中",
  stopped: "已停止",
  starting: "启动中",
  stopping: "停止中",
  unknown: "未知",
  unavailable: "不可用",
};
const healthLabels = {
  healthy: "健康",
  unhealthy: "异常",
  unknown: "未知",
  "not-configured": "未配置",
};
export function formatBytes(value: number) {
  return value >= 1073741824
    ? `${(value / 1073741824).toFixed(1)} GB`
    : `${(value / 1048576).toFixed(1)} MB`;
}
const percent = (value: number | null) =>
  value === null ? "采样中" : `${value.toFixed(1)}%`;
const time = (value?: string) =>
  value ? new Date(value).toLocaleString() : "—";

export function SystemConsole({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return isOpen ? <ConsoleWorkspace onClose={onClose} /> : null;
}

function ProcessConfirmation({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sc-confirm"
      role="alertdialog"
      aria-labelledby="sc-confirm-title"
      aria-describedby="sc-confirm-description"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

function ConsoleWorkspace({ onClose }: { onClose: () => void }) {
  const data = useSystemConsole();
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"services" | "processes" | "operations">(
    "services"
  );
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [sort, setSort] = useState<{
    key: "name" | "pid" | "cpuPercent" | "memoryBytes";
    descending: boolean;
  }>({ key: "memoryBytes", descending: true });
  const [logs, setLogs] = useState("");
  const [logError, setLogError] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [confirm, setConfirm] = useState<ProcessInfo>();
  const [force, setForce] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const selected = data.services.find((s) => s.definition.id === selectedId);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    setLogs("");
    setLogError("");
    if (!selectedId || document.hidden) return;
    const controller = new AbortController();
    setLogLoading(true);
    consoleRequest<{ text: string }>(
      "query",
      { name: "logs", serviceId: selectedId, limit: 200 },
      controller.signal
    )
      .then((r) => {
        if (!controller.signal.aborted) setLogs(r.text);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setLogError(String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLogLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, data.lastUpdated]);
  const filteredProcesses = useMemo(
    () =>
      data.processes
        .filter((p) =>
          `${p.name} ${p.pid} ${p.executable ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase())
        )
        .sort((a, b) => {
          const left = a[sort.key] ?? -1,
            right = b[sort.key] ?? -1;
          return (
            (typeof left === "string"
              ? left.localeCompare(String(right))
              : Number(left) - Number(right)) * (sort.descending ? -1 : 1)
          );
        }),
    [data.processes, search, sort]
  );
  const filteredServices = data.services.filter((s) =>
    `${s.definition.label} ${s.definition.id} ${s.definition.kind}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const busyService = (id: string) =>
    data.stale ||
    data.busy.includes(id) ||
    data.operations.some((o) => o.targetId === id && o.status === "running");
  const processBusy = (pid: number) =>
    data.stale || data.busy.includes(`process:${pid}`) ||
    data.operations.some(o => o.targetId === `process:${pid}` && o.status === "running");
  const setProcess = (process: ProcessInfo) => {
    setConfirm(process);
    setForce(false);
    setAcknowledged(false);
  };
  const r = data.resources;
  return createPortal(
    <dialog
      ref={dialog}
      className="system-console"
      aria-labelledby="system-console-title"
      onCancel={(e) => {
        e.preventDefault();
        if (confirm) setConfirm(undefined);
        else onClose();
      }}
    >
      <header className="sc-header">
        <div>
          <div className="sc-eyebrow">本机控制台</div>
          <h1 id="system-console-title">设备与服务</h1>
          <p>
            {r
              ? `${r.hostname} · ${r.platform} · 已运行 ${Math.floor(
                  r.uptimeSeconds / 3600
                )} 小时`
              : "正在连接本机后台服务"}
          </p>
        </div>
        <div className="sc-header-actions">
          <span className={data.stale ? "sc-warning" : "sc-success"}>
            {data.stale ? "数据未就绪 / 已过期" : "实时连接"}
          </span>
          <button
            disabled={data.loading}
            onClick={() =>
              void (data.connected ? data.refresh() : data.connect())
            }
          >
            {data.loading ? "刷新中…" : "刷新 / 重试"}
          </button>
          <button onClick={onClose} aria-label="关闭设备与服务">
            关闭
          </button>
        </div>
      </header>
      {data.error && (
        <div className="sc-error" role="alert">
          {data.error}
        </div>
      )}
      <section className="sc-resources" aria-label="资源摘要">
        <div>
          <span>CPU</span>
          <strong>{r ? percent(r.cpuPercent) : "—"}</strong>
          <small>主机使用率</small>
        </div>
        <div>
          <span>内存</span>
          <strong>
            {r
              ? `${formatBytes(r.memory.usedBytes)} / ${formatBytes(
                  r.memory.totalBytes
                )}`
              : "—"}
          </strong>
          <small>
            {r ? `${formatBytes(r.memory.availableBytes)} 可用` : "等待采样"}
          </small>
        </div>
        <div>
          <span>服务</span>
          <strong>
            {data.services.filter((s) => s.snapshot.state === "running").length}{" "}
            <small>/ {data.services.length} 运行</small>
          </strong>
          <small>后台统一管理</small>
        </div>
        <div>
          <span>磁盘可用</span>
          <strong>
            {r?.disks.length
              ? r.disks
                  .map((d) => `${d.name} ${formatBytes(d.freeBytes)}`)
                  .join(" · ")
              : "—"}
          </strong>
          <small>
            {data.lastUpdated
              ? `更新于 ${new Date(data.lastUpdated).toLocaleTimeString()}`
              : "尚未获得快照"}
          </small>
        </div>
      </section>
      {!!r?.warnings.length && (
        <div className="sc-warning sc-notice" role="status">
          {r.warnings.join(" · ")}
        </div>
      )}
      <nav className="sc-toolbar" aria-label="控制台视图">
        <div className="sc-tabs">
          {(["services", "processes", "operations"] as const).map((id) => (
            <button
              key={id}
              aria-pressed={tab === id}
              onClick={() => {
                setTab(id);
                setSearch("");
              }}
            >
              {id === "services"
                ? "服务"
                : id === "processes"
                ? "进程"
                : "操作记录"}
            </button>
          ))}
        </div>
        <input
          aria-label="搜索控制台"
          placeholder={
            tab === "processes"
              ? "搜索进程、PID 或路径"
              : tab === "services"
              ? "搜索服务或类型"
              : "搜索动作或目标"
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </nav>
      <div className="sc-content">
        {tab === "services" && (
          <div className={`sc-services ${selected ? "sc-with-detail" : ""}`}>
            <div className="sc-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>服务</th>
                    <th>运行状态</th>
                    <th>自启动</th>
                    <th>运行操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map(({ definition: d, snapshot: s }) => (
                    <tr
                      key={d.id}
                      className={selectedId === d.id ? "sc-selected" : ""}
                    >
                      <td>
                        <button
                          className="sc-service-name"
                          onClick={() => setSelectedId(d.id)}
                        >
                          {d.label}
                        </button>
                        <small>
                          {d.kind} · {d.id}
                        </small>
                      </td>
                      <td>
                        <span className={`sc-state sc-state-${s.state}`}>
                          {states[s.state]}
                        </span>
                        {s.message && (
                          <small className="sc-warning">{s.message}</small>
                        )}
                      </td>
                      <td>
                        <label className="sc-switch">
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={`${d.label} 自启动`}
                            checked={s.autostart.enabled === true}
                            disabled={
                              busyService(d.id) || s.autostart.enabled === null
                            }
                            onChange={(e) =>
                              void data.act({
                                name: "service.autostart",
                                serviceId: d.id,
                                enabled: e.target.checked,
                              })
                            }
                          />
                          {s.autostart.enabled === null
                            ? "未知 / 不支持"
                            : s.autostart.enabled
                            ? "已启用"
                            : "已关闭"}
                        </label>
                        <small title={s.autostart.detail}>
                          {s.autostart.trigger}
                        </small>
                      </td>
                      <td>
                        <div className="sc-actions">
                          <button
                            disabled={
                              busyService(d.id) || s.state !== "stopped"
                            }
                            onClick={() =>
                              void data.act({
                                name: "service.start",
                                serviceId: d.id,
                              })
                            }
                          >
                            启动
                          </button>
                          <button
                            disabled={
                              busyService(d.id) || s.state !== "running"
                            }
                            onClick={() =>
                              void data.act({
                                name: "service.stop",
                                serviceId: d.id,
                              })
                            }
                          >
                            停止
                          </button>
                          <button
                            disabled={
                              busyService(d.id) ||
                              !["running", "stopped"].includes(s.state)
                            }
                            onClick={() =>
                              void data.act({
                                name: "service.restart",
                                serviceId: d.id,
                              })
                            }
                          >
                            重启
                          </button>
                        </div>
                        {data.busy.includes(d.id) && (
                          <small role="status">正在执行…</small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredServices.length && (
                <div className="sc-empty">
                  {data.loading
                    ? "正在读取服务…"
                    : search
                    ? "没有匹配的服务"
                    : "尚未配置服务。请在后台服务配置中添加需要管理的目标。"}
                </div>
              )}
            </div>
            {selected && (
              <aside className="sc-detail" aria-label="服务详情">
                <div className="sc-detail-heading">
                  <h2>{selected.definition.label}</h2>
                  <button
                    onClick={() => setSelectedId(undefined)}
                    aria-label="关闭服务详情"
                  >
                    收起
                  </button>
                </div>
                <p>
                  {selected.definition.description ||
                    selected.definition.target}
                </p>
                <dl>
                  <dt>目标</dt>
                  <dd>{selected.definition.target}</dd>
                  <dt>健康检查</dt>
                  <dd>{healthLabels[selected.snapshot.health]}</dd>
                  <dt>端口</dt>
                  <dd>{selected.definition.ports?.join(", ") || "未配置"}</dd>
                  <dt>依赖</dt>
                  <dd>{selected.definition.dependsOn?.join(", ") || "无"}</dd>
                  <dt>自启动来源</dt>
                  <dd>
                    {selected.snapshot.autostart.detail ||
                      selected.snapshot.autostart.trigger}
                  </dd>
                  <dt>最近采样</dt>
                  <dd>{time(selected.snapshot.sampledAt)}</dd>
                  <dt>进程</dt>
                  <dd>
                    {selected.snapshot.processes
                      .map((p) => `${p.pid} (${time(p.startedAt)})`)
                      .join(", ") || "无"}
                  </dd>
                </dl>
                <h3>日志</h3>
                {logError && (
                  <p role="alert" className="sc-error">
                    {logError}
                  </p>
                )}
                <pre aria-label="服务日志">
                  {logLoading ? "读取日志…" : logs || "暂无日志输出"}
                </pre>
                <h3>最近操作</h3>
                {data.operations
                  .filter((o) => o.targetId === selectedId)
                  .slice(0, 5)
                  .map((o) => (
                    <p key={o.id}>
                      {o.action} · {o.status}
                      <small>
                        {time(o.requestedAt)} {o.error?.message}
                      </small>
                    </p>
                  ))}
              </aside>
            )}
          </div>
        )}
        {tab === "processes" && (
          <div className="sc-table-scroll">
            <p className="sc-process-count">
              {filteredProcesses.length} 个进程 · CPU 为两次采样之间的占比
            </p>
            <table>
              <thead>
                <tr>
                  {(
                    [
                      ["name", "进程"],
                      ["pid", "PID"],
                      ["cpuPercent", "CPU"],
                      ["memoryBytes", "内存"],
                    ] as const
                  ).map(([key, label]) => (
                    <th
                      key={key}
                      aria-sort={
                        sort.key === key
                          ? sort.descending
                            ? "descending"
                            : "ascending"
                          : "none"
                      }
                    >
                      <button
                        onClick={() =>
                          setSort({
                            key,
                            descending:
                              sort.key === key
                                ? !sort.descending
                                : key !== "name",
                          })
                        }
                      >
                        {label}{" "}
                        {sort.key === key ? (sort.descending ? "↓" : "↑") : ""}
                      </button>
                    </th>
                  ))}
                  <th>启动时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredProcesses.map((p) => (
                  <tr key={`${p.pid}:${p.startedAt}`}>
                    <td title={p.executable}>
                      {p.name}
                      <small className="sc-path">{p.executable}</small>
                    </td>
                    <td>{p.pid}</td>
                    <td>{percent(p.cpuPercent)}</td>
                    <td>{formatBytes(p.memoryBytes)}</td>
                    <td>{time(p.startedAt)}</td>
                    <td>
                      <button
                        className="sc-danger"
                        disabled={processBusy(p.pid) || !p.startedAt}
                        onClick={() => setProcess(p)}
                      >
                        终止
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredProcesses.length && (
              <div className="sc-empty">
                {data.loading ? "正在读取进程…" : "没有匹配的进程"}
              </div>
            )}
          </div>
        )}
        {tab === "operations" && (
          <div className="sc-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>请求时间</th>
                  <th>动作</th>
                  <th>目标</th>
                  <th>结果</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {data.operations
                  .filter((o) =>
                    `${o.action} ${o.targetId}`
                      .toLowerCase()
                      .includes(search.toLowerCase())
                  )
                  .map((o) => (
                    <tr key={o.id}>
                      <td>{time(o.requestedAt)}</td>
                      <td>{o.action}</td>
                      <td>{o.targetId}</td>
                      <td
                        className={o.status === "failed" ? "sc-error-text" : ""}
                      >
                        {o.status}
                      </td>
                      <td>
                        {o.error
                          ? `${o.error.code}: ${o.error.message}`
                          : o.after
                          ? `${states[o.before?.state ?? "unknown"]} → ${
                              states[o.after.state]
                            }`
                          : time(o.finishedAt)}
                        <small>{o.id}</small>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!data.operations.length && (
              <div className="sc-empty">
                暂无操作记录。桌面和 CLI 发起的操作会统一显示在这里。
              </div>
            )}
          </div>
        )}
      </div>
      <footer className="sc-footer">
        <span>
          每 5 秒刷新 · 隐藏窗口时暂停采样 · 关闭工作区后后台服务继续运行
        </span>
        {r?.platform === "win32" && (
          <button
            disabled={
              data.elevating ||
              data.busy.length > 0 ||
              data.operations.some((o) => o.status === "running")
            }
            title="会重新启动本机控制服务，并弹出 Windows UAC 授权；不会更改目标服务的运行状态。"
            onClick={() => void data.elevate()}
          >
            {data.elevating ? "等待 Windows 授权…" : "以管理员权限运行控制服务"}
          </button>
        )}
      </footer>
      {confirm && (
        <ProcessConfirmation onClose={() => setConfirm(undefined)}>
          <h2 id="sc-confirm-title">终止进程 {confirm.name}？</h2>
          <p id="sc-confirm-description">
            PID <strong>{confirm.pid}</strong>
            <br />
            启动于 <strong>{time(confirm.startedAt)}</strong>
            <br />
            未保存的工作可能丢失。后台将再次核对 PID 与启动时间，防止终止复用该
            PID 的其他进程。
          </p>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            我已核对这个进程的 PID 和启动时间
          </label>
          <label>
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            强制终止
          </label>
          <div className="sc-actions">
            <button autoFocus onClick={() => setConfirm(undefined)}>
              取消
            </button>
            <button
              className="sc-danger"
              disabled={!acknowledged || processBusy(confirm.pid)}
              onClick={() => {
                void data.act({
                  name: "process.terminate",
                  process: { pid: confirm.pid, startedAt: confirm.startedAt },
                  force,
                });
                setConfirm(undefined);
              }}
            >
              确认终止
            </button>
          </div>
        </ProcessConfirmation>
      )}
    </dialog>,
    document.body
  );
}
