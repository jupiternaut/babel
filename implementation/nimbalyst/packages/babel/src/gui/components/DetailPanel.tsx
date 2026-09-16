import { useMemo, useState, type ReactNode } from "react";
import type { ActionCapability, TaskCard, TaskDetail } from "../api.ts";
import type { RunRecord, TrackerActivity, TrackerComment } from "../../contracts.ts";
import { runStatusLabel, statusLabel, typeLabel, verificationLabel } from "../labels.ts";
import type { TrackerDraft } from "../types.ts";

type TabId = "detail" | "session" | "review" | "history" | "archive";

export function seedDraft(detail: TaskDetail): TrackerDraft {
  const acc = detail.record.fields.acceptance ?? [];
  return {
    title: String(detail.record.fields.title ?? ""),
    description: String(detail.record.fields.description ?? detail.record.content.markdown ?? ""),
    priority: String(detail.record.fields.priority ?? "normal"),
    owner: String(detail.record.fields.owner ?? ""),
    acceptanceText: acc.map((item) => `${item.required ? "*" : ""}${item.text}`).join("\n"),
    dependsOnText: (detail.record.fields.dependsOn ?? []).join(", "),
    comment: "",
    message: "",
    respondText: "",
    reviewComment: "",
    startSummary: "",
    baseRevision: detail.record.revision,
  };
}

export function parseAcceptance(text: string): Array<{ id: string; text: string; required: boolean }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const required = line.startsWith("*");
      return {
        id: `acc-${index + 1}`,
        text: required ? line.slice(1).trim() : line,
        required,
      };
    });
}

export function DetailPanel({
  detail,
  draft,
  cards,
  caps,
  connected,
  history,
  viewingRun,
  toolNotes,
  onDraft,
  onClose,
  onSave,
  onStart,
  onArchive,
  onRestore,
  onComment,
  onRelations,
  onMessage,
  onRespond,
  onCancel,
  onReconcile,
  onRetry,
  onAccept,
  onChanges,
  onViewRun,
}: {
  detail: TaskDetail;
  draft: TrackerDraft;
  cards: TaskCard[];
  caps: Record<string, ActionCapability>;
  connected: boolean;
  history: {
    comments: TrackerComment[];
    activity: TrackerActivity[];
    runs: RunRecord[];
  } | null;
  viewingRun: RunRecord | null;
  toolNotes: Array<{ label: string; state: string }>;
  onDraft: (patch: Partial<TrackerDraft>) => void;
  onClose: () => void;
  onSave: () => void;
  onStart: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onComment: () => void;
  onRelations: () => void;
  onMessage: () => void;
  onRespond: (requestId: string) => void;
  onCancel: () => void;
  onReconcile: (resolution: "cancelled" | "failed") => void;
  onRetry: () => void;
  onAccept: () => void;
  onChanges: () => void;
  onViewRun: (runId: string | null) => void;
}) {
  const card = detail.card;
  const latest = detail.latestRun;
  const shownRun = viewingRun ?? latest;
  const viewingOld = Boolean(viewingRun && latest && viewingRun.id !== latest.id);
  const tabs = useMemo(() => {
    const list: Array<{ id: TabId; label: string }> = [{ id: "detail", label: "详情" }];
    if (card.stage === "RUNNING" || latest || shownRun) list.push({ id: "session", label: "会话" });
    if (shownRun?.diff || shownRun?.status === "review_required" || shownRun?.status === "verifying" || shownRun?.verification?.length) {
      list.push({ id: "review", label: "审查" });
    }
    list.push({ id: "history", label: "历史" });
    if (card.stage === "ARCHIVED") list.push({ id: "archive", label: "归档" });
    return list;
  }, [card.stage, latest, shownRun]);

  const cap = (name: string) => {
    if (!connected) return { allowed: false, reason: "已断线，执行操作已禁用", code: "UNAVAILABLE" };
    return caps[name] ?? { allowed: true };
  };

  const ActionBtn = ({
    name,
    label,
    onClick,
    primary,
  }: {
    name: string;
    label: string;
    onClick: () => void;
    primary?: boolean;
  }) => {
    const item = cap(name);
    return (
      <span>
        <button
          type="button"
          className={primary ? "btn btn-primary" : "btn"}
          disabled={!item.allowed}
          title={item.reason}
          onClick={onClick}
        >
          {label}
        </button>
        {!item.allowed && item.reason ? (
          <span className="reason"> {item.reason}{item.code ? `（${item.code}）` : ""}</span>
        ) : null}
      </span>
    );
  };

  return (
    <aside className="detail" aria-label="条目详情">
      <div className="detail-head">
        <div>
          <h2>{draft.title || card.title}</h2>
          <p className="muted">
            {typeLabel(card.primaryType)} · {statusLabel(card.status)}
            {card.readOnly ? " · 只读" : null}
          </p>
          <p className="faint">
            {card.trackerId} · revision {detail.record.revision}
            {draft.baseRevision !== detail.record.revision ? " · 服务端已更新，保存时可能冲突" : null}
          </p>
        </div>
        <button type="button" className="icon-btn" aria-label="关闭详情" onClick={onClose}>
          ×
        </button>
      </div>
      <DetailTabs tabs={tabs}>
        {(tab) => (
          <>
            <div hidden={tab !== "detail"} className="tab-panels">
              <div className="field">
                <label htmlFor="field-title">标题</label>
                <input
                  id="field-title"
                  value={draft.title}
                  disabled={card.readOnly || !connected}
                  onChange={(event) => onDraft({ title: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="field-body">正文</label>
                <textarea
                  id="field-body"
                  value={draft.description}
                  disabled={card.readOnly || !connected}
                  onChange={(event) => onDraft({ description: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="field-priority">优先级</label>
                <select
                  id="field-priority"
                  value={draft.priority}
                  disabled={card.readOnly || !connected}
                  onChange={(event) => onDraft({ priority: event.target.value })}
                >
                  <option value="low">低</option>
                  <option value="normal">普通</option>
                  <option value="high">高</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="field-owner">负责人</label>
                <input
                  id="field-owner"
                  value={draft.owner}
                  disabled={card.readOnly || !connected}
                  onChange={(event) => onDraft({ owner: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="field-acc">验收项（每行一项，* 开头表示必需）</label>
                <textarea
                  id="field-acc"
                  value={draft.acceptanceText}
                  disabled={card.readOnly || !connected}
                  onChange={(event) => onDraft({ acceptanceText: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="field-deps">依赖（trackerId，逗号分隔）</label>
                <input
                  id="field-deps"
                  value={draft.dependsOnText}
                  disabled={card.readOnly || !connected}
                  onChange={(event) => onDraft({ dependsOnText: event.target.value })}
                  placeholder="fixture-tracker-pdf"
                />
                <p className="faint">可选：{cards.filter((row) => row.trackerId !== card.trackerId).slice(0, 8).map((row) => row.trackerId).join("、") || "当前列表暂无其他条目"}</p>
              </div>
              <div className="actions">
                <ActionBtn name="task.update" label="保存" onClick={onSave} />
                <ActionBtn name="relation.set" label="保存依赖" onClick={onRelations} />
                {card.stage === "TODO" ? (
                  <ActionBtn name="run.start" label="开始模拟" primary onClick={onStart} />
                ) : null}
                {card.stage !== "ARCHIVED" ? <ActionBtn name="task.archive" label="归档" onClick={onArchive} /> : null}
              </div>
              {card.stage === "TODO" ? (
                <div className="field">
                  <label htmlFor="field-summary">启动摘要（仅开始模拟时发送，不会随保存提交）</label>
                  <input
                    id="field-summary"
                    value={draft.startSummary}
                    disabled={!connected}
                    onChange={(event) => onDraft({ startSummary: event.target.value })}
                    placeholder="可选说明"
                  />
                </div>
              ) : null}
              <p className="faint">保存只写标题、正文和字段，不会启动执行。创建会话也不等于已经开始执行。</p>
            </div>

            <div hidden={tab !== "session"} className="tab-panels">
              {viewingOld ? (
                <p className="muted">正在查看旧执行 {shownRun?.id}，只读，不会改当前 run。</p>
              ) : null}
              {shownRun ? (
                <>
                  <p>
                    {runStatusLabel(shownRun.status)} · {shownRun.deviceId} · 尝试 {shownRun.attempt}
                  </p>
                  <p className="faint">{shownRun.summary}</p>
                  {shownRun.status === "accepted" ? <p className="muted">启动已接受，还不表示这次执行已经成功。</p> : null}
                  {shownRun.status === "cancel_requested" ? <p className="muted">取消尚未确认，不是已停止。</p> : null}
                  {shownRun.status === "lost" ? <p className="muted">失联尚未核对，不能当作已停止。</p> : null}
                  {shownRun.sessionId ? <p className="faint">会话 {shownRun.sessionId}（创建会话不等于开始执行）</p> : null}
                  <section>
                    <h3 className="faint" style={{ fontSize: 12 }}>工具活动</h3>
                    {toolNotes.length === 0 ? <p className="empty">暂无工具活动。</p> : (
                      <ul>
                        {toolNotes.map((item, index) => (
                          <li key={`${item.label}-${index}`}>{item.label} · {item.state === "succeeded" ? "已完成" : item.state === "executing" ? "进行中" : item.state}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section className="messages">
                    {shownRun.messages.map((msg) => (
                      <article key={msg.id} className="message">
                        <div className="role">{msg.role} · {msg.at}</div>
                        <div>{msg.text}</div>
                      </article>
                    ))}
                  </section>
                  {!viewingOld && shownRun.inputRequests.filter((row) => !row.answered).map((req) => (
                    <div key={req.id} className="field">
                      <label htmlFor={`respond-${req.id}`}>待答：{req.prompt}</label>
                      <textarea
                        id={`respond-${req.id}`}
                        value={draft.respondText}
                        disabled={!connected}
                        onChange={(event) => onDraft({ respondText: event.target.value })}
                      />
                      <ActionBtn name="run.respond" label="提交回答" onClick={() => onRespond(req.id)} />
                    </div>
                  ))}
                  {!viewingOld && shownRun.status !== "succeeded" && shownRun.status !== "failed" && shownRun.status !== "cancelled" ? (
                    <div className="field">
                      <label htmlFor="run-message">补充消息（发给当前执行，不是任务讨论）</label>
                      <textarea
                        id="run-message"
                        value={draft.message}
                        disabled={!connected}
                        onChange={(event) => onDraft({ message: event.target.value })}
                      />
                      <div className="actions">
                        <ActionBtn name="run.message" label="发送补充消息" onClick={onMessage} />
                        <ActionBtn name="run.cancel" label="请求取消" onClick={onCancel} />
                      </div>
                    </div>
                  ) : null}
                  {shownRun.status === "lost" || shownRun.status === "cancel_requested" ? (
                    <div className="actions">
                      <ActionBtn name="run.reconcile" label="核对为已取消" onClick={() => onReconcile("cancelled")} />
                      <ActionBtn name="run.reconcile" label="核对为失败" onClick={() => onReconcile("failed")} />
                    </div>
                  ) : null}
                  {(shownRun.status === "failed" || shownRun.status === "cancelled") && !viewingOld ? (
                    <ActionBtn name="run.retry" label="重试执行" onClick={onRetry} />
                  ) : null}
                </>
              ) : (
                <p className="empty">还没有执行记录。待办状态请用「开始模拟」，不要把保存当成启动。</p>
              )}
            </div>

            <div hidden={tab !== "review"} className="tab-panels">
              {shownRun?.diff ? (
                <>
                  <p>
                    <strong>模拟基线</strong>：{shownRun.diff.label}
                  </p>
                  {shownRun.diff.files.map((file) => (
                    <article key={file.path} className="diff-file">
                      <strong>{file.path}</strong>
                      <span className="faint"> +{file.additions} / -{file.deletions}</span>
                      <pre>{file.patch}</pre>
                    </article>
                  ))}
                </>
              ) : (
                <p className="empty">还没有模拟差异。差异绑定当前 run，不是真实 Git 提交。</p>
              )}
              <section>
                <h3 className="faint" style={{ fontSize: 12 }}>验收项</h3>
                {(shownRun?.verification ?? []).length === 0 ? <p className="empty">没有验收项。</p> : (
                  <ul>
                    {(shownRun?.verification ?? []).map((item) => (
                      <li key={item.id}>
                        {item.text} · {verificationLabel(item.state)}
                        {item.required ? " · 必需" : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {!viewingOld && (shownRun?.status === "review_required" || shownRun?.status === "verifying") ? (
                <>
                  <div className="field">
                    <label htmlFor="review-comment">要求修改时的说明</label>
                    <textarea
                      id="review-comment"
                      value={draft.reviewComment}
                      disabled={!connected}
                      onChange={(event) => onDraft({ reviewComment: event.target.value })}
                    />
                  </div>
                  <div className="actions">
                    <ActionBtn name="review.accept" label="接受结果" primary onClick={onAccept} />
                    <ActionBtn name="review.request_changes" label="要求修改" onClick={onChanges} />
                  </div>
                </>
              ) : (
                <p className="faint">
                  {shownRun?.review
                    ? `审查决定：${shownRun.review.decision === "accept" ? "已接受" : "要求修改"}`
                    : "当前不在待审。approved 或进程退出都不能直接当成完成。"}
                </p>
              )}
            </div>

            <div hidden={tab !== "history"} className="tab-panels">
              <section>
                <h3 className="faint" style={{ fontSize: 12 }}>活动</h3>
                {(history?.activity ?? detail.record.system.activity ?? []).length === 0 ? <p className="empty">还没有活动。</p> : (
                  <ul>
                    {(history?.activity ?? detail.record.system.activity ?? []).map((row) => (
                      <li key={row.id}>{row.at} · {row.actorId} · {row.detail}</li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="faint" style={{ fontSize: 12 }}>讨论</h3>
                {(history?.comments ?? detail.record.system.comments ?? []).map((row) => (
                  <article key={row.id} className="message">
                    <div className="role">{row.authorId} · {row.createdAt}</div>
                    <div>{row.body}</div>
                  </article>
                ))}
                <div className="field">
                  <label htmlFor="task-comment">添加讨论（不是当前执行的补充指令）</label>
                  <textarea
                    id="task-comment"
                    value={draft.comment}
                    disabled={!connected || card.readOnly}
                    onChange={(event) => onDraft({ comment: event.target.value })}
                  />
                  <ActionBtn name="comment.add" label="添加讨论" onClick={onComment} />
                </div>
              </section>
              <section>
                <h3 className="faint" style={{ fontSize: 12 }}>执行记录</h3>
                {(history?.runs ?? detail.runs).length === 0 ? <p className="empty">还没有 run。</p> : (
                  <ul>
                    {(history?.runs ?? detail.runs).map((run) => (
                      <li key={run.id}>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => onViewRun(latest && run.id === latest.id ? null : run.id)}
                        >
                          {run.id} · 尝试 {run.attempt} · {runStatusLabel(run.status)}
                          {latest && run.id === latest.id ? " · 当前" : " · 只读查看"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="faint">查看旧 run 只读，不会重启或替换当前执行。</p>
              </section>
            </div>

            {tab === "archive" ? (
            <div className="tab-panels">
              <p>该条目已归档。归档保留结果和历史，不等于发布成功。</p>
              <p className="muted">恢复会回到归档前的语义状态，不会自动执行。</p>
              <ActionBtn name="task.restore" label="恢复（不自动执行）" primary onClick={onRestore} />
            </div>
            ) : null}
          </>
        )}
      </DetailTabs>
    </aside>
  );
}

function DetailTabs({
  tabs,
  children,
}: {
  tabs: Array<{ id: TabId; label: string }>;
  children: (tab: TabId) => ReactNode;
}) {
  const initial = tabs[0]?.id ?? "detail";
  const [tab, setTab] = useState<TabId>(initial);
  const current = tabs.some((row) => row.id === tab) ? tab : initial;
  return (
    <>
      <div className="tabs" role="tablist">
        {tabs.map((row) => (
          <button
            key={row.id}
            type="button"
            role="tab"
            aria-selected={current === row.id}
            onClick={() => setTab(row.id)}
          >
            {row.label}
          </button>
        ))}
      </div>
      {children(current)}
    </>
  );
}
