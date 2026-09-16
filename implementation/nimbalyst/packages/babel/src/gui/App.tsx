import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  command,
  formatApiError,
  getCapabilities,
  getHistory,
  getTask,
  GUI_DEFAULT_PROJECT,
  health,
  listDevices,
  listProjects,
  listReady,
  listTasks,
  listViews,
  newIdempotencyKey,
  showRun,
  watchEvents,
  type ActionCapability,
  type TaskCard,
  type TaskDetail,
} from "./api.ts";
import { Board } from "./components/Board.tsx";
import { CardMenu, cardMenuActions } from "./components/CardMenu.tsx";
import { DetailPanel, parseAcceptance, seedDraft } from "./components/DetailPanel.tsx";
import { Dialog } from "./components/Dialog.tsx";
import { NativeList } from "./components/NativeList.tsx";
import { ResizeHandle } from "./components/ResizeHandle.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { createLabel, STAGE_LABELS } from "./labels.ts";
import type { NavKey, Notice, TrackerDraft, ViewMode } from "./types.ts";
import { STAGES } from "./types.ts";
import type { DeviceRecord, ProjectRecord, RunRecord, SavedView, Stage, TrackerActivity, TrackerComment } from "./api.ts";

function navCreateType(nav: NavKey): string {
  return nav.kind === "type" ? nav.type : "task";
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem("babel-gui-theme");
    return stored === "dark" ? "dark" : "light";
  });
  const [projectId, setProjectId] = useState(GUI_DEFAULT_PROJECT);
  const [viewMode, setViewMode] = useState<ViewMode>("execution");
  const [nav, setNav] = useState<NavKey>({ kind: "board" });
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<TaskCard[]>([]);
  const [counts, setCounts] = useState<Record<Stage, number>>({ TODO: 0, RUNNING: 0, DONE: 0, ARCHIVED: 0 });
  const [demoLabel, setDemoLabel] = useState("演示数据");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [devices, setDevices] = useState<Array<DeviceRecord & { demo?: true }>>([]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [caps, setCaps] = useState<Record<string, ActionCapability>>({});
  const [history, setHistory] = useState<{ comments: TrackerComment[]; activity: TrackerActivity[]; runs: RunRecord[] } | null>(null);
  const [viewingRun, setViewingRun] = useState<RunRecord | null>(null);
  const [toolNotes, setToolNotes] = useState<Array<{ label: string; state: string }>>([]);
  const [drafts, setDrafts] = useState<Record<string, TrackerDraft>>({});
  const [connected, setConnected] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [menu, setMenu] = useState<{ trackerId: string; x: number; y: number; restore?: HTMLElement } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [leftW, setLeftW] = useState(240);
  const [rightW, setRightW] = useState(390);
  const [narrowStage, setNarrowStage] = useState<Stage>("TODO");
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [busy, setBusy] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const selectedRef = useRef(selectedId);
  const menuRestoreRef = useRef<HTMLElement | null>(null);
  const searchTimer = useRef<number>(0);
  const [searchApplied, setSearchApplied] = useState("");

  selectedRef.current = selectedId;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("babel-gui-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => setSearchApplied(search), 200);
    return () => window.clearTimeout(searchTimer.current);
  }, [search]);

  const compact = viewport < 1100;
  const isNarrow = viewport < 768;
  const showDetail = Boolean(selectedId && detail);
  const createType = navCreateType(nav);
  const createText = createLabel(createType);

  const listQuery = useMemo(() => {
    const q = searchApplied.trim();
    const base: Record<string, unknown> = {
      viewMode,
      includeArchived: true,
      statusScope: "all",
    };
    if (q) base.q = q;
    if (nav.kind === "board") {
      base.types = "executable";
      base.viewMode = viewMode;
    } else if (nav.kind === "all") {
      base.types = "all";
    } else if (nav.kind === "type") {
      base.types = [nav.type];
    } else if (nav.kind === "view") {
      base.viewId = nav.viewId;
    }
    return base;
  }, [nav, viewMode, searchApplied]);

  const fail = useCallback((error: unknown) => {
    const formatted = formatApiError(error);
    setNotice({ ...formatted, tone: "error" });
    if (formatted.code === "UNAVAILABLE") setConnected(false);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      if (nav.kind === "ready") {
        const ready = await listReady(projectId);
        const q = searchApplied.trim().toLowerCase();
        const filtered = q
          ? ready.items.filter((item) => `${item.title} ${item.description} ${item.trackerId}`.toLowerCase().includes(q))
          : ready.items;
        setItems(filtered);
        const next = { TODO: 0, RUNNING: 0, DONE: 0, ARCHIVED: 0 } as Record<Stage, number>;
        for (const card of filtered) next[card.stage] += 1;
        setCounts(next);
      } else {
        const result = await listTasks(projectId, listQuery);
        setItems(result.items);
        setCounts(result.counts);
        setDemoLabel(result.demoLabel || "演示数据");
        cursorRef.current = String(result.cursor);
      }
      setConnected(true);
      setLastSync(new Date().toISOString());
    } catch (error) {
      fail(error);
    }
  }, [fail, listQuery, nav.kind, projectId, searchApplied]);

  const refreshDetail = useCallback(async (trackerId: string) => {
    try {
      const next = await getTask(projectId, trackerId);
      setDetail(next);
      const cap = await getCapabilities(projectId, {
        trackerId,
        runId: next.latestRun?.id ?? undefined,
      });
      setCaps(cap.actions);
      const hist = await getHistory(projectId, trackerId);
      setHistory({ comments: hist.comments, activity: hist.activity, runs: hist.runs });
      setDrafts((prev) => prev[trackerId] ? prev : { ...prev, [trackerId]: seedDraft(next) });
      setConnected(true);
      setLastSync(new Date().toISOString());
    } catch (error) {
      fail(error);
    }
  }, [fail, projectId]);

  const refreshMeta = useCallback(async () => {
    try {
      const [proj, dev, view] = await Promise.all([
        listProjects(),
        listDevices(projectId),
        listViews(projectId),
      ]);
      setProjects(proj.projects);
      setDevices(dev.devices);
      setViews(view.views);
      setConnected(true);
    } catch (error) {
      fail(error);
    }
  }, [fail, projectId]);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (selectedId) void refreshDetail(selectedId);
    else {
      setDetail(null);
      setViewingRun(null);
      setHistory(null);
    }
  }, [selectedId, refreshDetail]);

  useEffect(() => {
    let refreshTimer = 0;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refreshList();
        if (selectedRef.current) void refreshDetail(selectedRef.current);
      }, 160);
    };
    const watch = watchEvents(projectId, cursorRef.current, {
      onOpen: () => setConnected(true),
      onError: () => setConnected(false),
      onEvent: (event) => {
        cursorRef.current = event.cursor;
        setConnected(true);
        setLastSync(event.occurredAt);
        if (event.type === "tool.started" || event.type === "tool.finished") {
          const tool = event.payload.tool as { label?: string; state?: string } | undefined;
          if (tool?.label) {
            setToolNotes((prev) => [...prev, { label: tool.label ?? "", state: tool.state ?? event.type }]);
          }
        }
        scheduleRefresh();
      },
    });
    const beat = window.setInterval(() => {
      void health()
        .then(() => {
          setConnected(true);
          setLastSync(new Date().toISOString());
        })
        .catch(() => setConnected(false));
    }, 20000);
    return () => {
      watch.close();
      window.clearTimeout(refreshTimer);
      window.clearInterval(beat);
    };
  }, [projectId, refreshDetail, refreshList]);

  useEffect(() => {
    document.documentElement.style.setProperty("--left-w", `${leftW}px`);
    document.documentElement.style.setProperty("--right-w", showDetail ? `${rightW}px` : "0px");
  }, [leftW, rightW, showDetail]);

  const runCommand = useCallback(async (
    name: Parameters<typeof command>[0],
    input: Record<string, unknown>,
    options: { expectedRevision?: number; idempotencyKey?: string } = {},
  ) => {
    setBusy(true);
    try {
      const result = await command(name, projectId, input, options);
      setNotice({
        code: result.commandStatus,
        message: result.settled ? "命令已完成。" : "命令已接受，尚未完成。",
        tone: "info",
      });
      await refreshList();
      if (selectedRef.current) await refreshDetail(selectedRef.current);
      return result;
    } catch (error) {
      fail(error);
      return null;
    } finally {
      setBusy(false);
    }
  }, [fail, projectId, refreshDetail, refreshList]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setViewingRun(null);
    setToolNotes([]);
    if (compact) setSidebarOpen(false);
  }, [compact]);

  const closeDetail = useCallback(() => {
    const id = selectedRef.current;
    setSelectedId(null);
    setDetail(null);
    setViewingRun(null);
    if (id) document.getElementById(`card-${id}`)?.focus();
  }, []);

  const patchDraft = useCallback((patch: Partial<TrackerDraft>) => {
    const id = selectedRef.current;
    if (!id) return;
    setDrafts((prev) => {
      const current = prev[id];
      if (!current) return prev;
      return { ...prev, [id]: { ...current, ...patch } };
    });
  }, []);

  const currentDraft = selectedId ? drafts[selectedId] : undefined;

  const startCard = useCallback(async (card: TaskCard) => {
    const draft = drafts[card.trackerId];
    await runCommand("run.start", {
      trackerId: card.trackerId,
      summary: draft?.startSummary || undefined,
    }, { idempotencyKey: newIdempotencyKey() });
  }, [drafts, runCommand]);

  const acceptCard = useCallback(async (card: TaskCard) => {
    if (!card.latestRunId) {
      setNotice({ code: "PRECONDITION", message: "没有待审执行，不能标为完成。", tone: "error" });
      return;
    }
    await runCommand("review.accept", { runId: card.latestRunId }, { expectedRevision: card.revision });
  }, [runCommand]);

  const onMenuAction = useCallback(async (trackerId: string, action: string) => {
    const card = items.find((row) => row.trackerId === trackerId);
    setMenu(null);
    menuRestoreRef.current?.focus();
    if (!card && action !== "open") return;
    if (action === "open") {
      select(trackerId);
      return;
    }
    if (!card) return;
    if (action === "start") await startCard(card);
    if (action === "accept") await acceptCard(card);
    if (action === "changes" && card.latestRunId) {
      await runCommand("review.request_changes", { runId: card.latestRunId, comment: drafts[card.trackerId]?.reviewComment });
    }
    if (action === "cancel" && card.latestRunId) await runCommand("run.cancel", { runId: card.latestRunId });
    if (action === "reconcile" && card.latestRunId) {
      await runCommand("run.reconcile", { runId: card.latestRunId, resolution: "cancelled" });
    }
    if (action === "retry") await runCommand("run.retry", { trackerId: card.trackerId, runId: card.latestRunId ?? undefined });
    if (action === "archive") await runCommand("task.archive", { trackerId: card.trackerId });
    if (action === "restore") await runCommand("task.restore", { trackerId: card.trackerId });
  }, [acceptCard, drafts, items, runCommand, select, startCard]);

  const onDropStage = useCallback(async (trackerId: string, stage: Stage) => {
    const card = items.find((row) => row.trackerId === trackerId);
    if (!card) return;
    if (stage === "RUNNING") {
      if (card.stage === "TODO") {
        await startCard(card);
        return;
      }
      setNotice({ code: "PRECONDITION", message: "只有待办可以拖到运行列以启动模拟。", tone: "error" });
      return;
    }
    if (stage === "DONE") {
      if (card.runStatus === "review_required" || card.runStatus === "verifying") {
        await acceptCard(card);
        return;
      }
      setNotice({
        code: "COMPLETION_GUARD",
        message: "不能直接标为完成。拖到完成必须走验收，当前执行还不在待审。",
        tone: "error",
      });
      return;
    }
    if (stage === "ARCHIVED") {
      setNotice({ code: "USAGE", message: "归档请用菜单或详情中的归档，不要靠拖拽改状态。", tone: "info" });
    }
  }, [acceptCard, items, startCard]);

  const onMoveFocus = useCallback((trackerId: string, key: string) => {
    const grouped = STAGES.map((stage) => items.filter((item) => item.stage === stage));
    let col = grouped.findIndex((colItems) => colItems.some((item) => item.trackerId === trackerId));
    if (col < 0) return;
    let row = grouped[col].findIndex((item) => item.trackerId === trackerId);
    if (key === "ArrowDown") row += 1;
    if (key === "ArrowUp") row -= 1;
    if (key === "ArrowRight") col += 1;
    if (key === "ArrowLeft") col -= 1;
    if (key === "Home") row = 0;
    if (key === "End") row = grouped[col].length - 1;
    col = clamp(col, 0, 3);
    const column = grouped[col];
    if (!column.length) return;
    row = clamp(row, 0, column.length - 1);
    const next = column[row];
    setSelectedId(next.trackerId);
    document.getElementById(`card-${next.trackerId}`)?.focus();
  }, [items]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menu) {
        event.preventDefault();
        setMenu(null);
        menuRestoreRef.current?.focus();
        return;
      }
      if (createOpen) {
        setCreateOpen(false);
        return;
      }
      if (selectedId) {
        event.preventDefault();
        closeDetail();
      } else if (compact && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDetail, compact, createOpen, menu, selectedId, sidebarOpen]);

  const openMenu = (trackerId: string, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    menuRestoreRef.current = el;
    setMenu({ trackerId, x: box.left, y: box.bottom + 4, restore: el });
    const card = items.find((row) => row.trackerId === trackerId);
    void getCapabilities(projectId, { trackerId, runId: card?.latestRunId ?? undefined })
      .then((result) => setCaps(result.actions))
      .catch(fail);
  };

  const saveSelected = async () => {
    if (!detail || !currentDraft) return;
    const result = await runCommand("task.update", {
      trackerId: detail.record.id,
      title: currentDraft.title,
      description: currentDraft.description,
      priority: currentDraft.priority,
      owner: currentDraft.owner || undefined,
      acceptance: parseAcceptance(currentDraft.acceptanceText),
    }, { expectedRevision: currentDraft.baseRevision });
    if (result?.revision != null) patchDraft({ baseRevision: result.revision });
  };

  const saveRelations = async () => {
    if (!detail || !currentDraft) return;
    const dependsOn = currentDraft.dependsOnText.split(/[,，\s]+/).map((id) => id.trim()).filter(Boolean);
    await runCommand("relation.set", { trackerId: detail.record.id, dependsOn }, { expectedRevision: currentDraft.baseRevision });
  };

  const useBoard = viewMode === "execution" && nav.kind !== "ready";

  const menuCard = menu ? items.find((row) => row.trackerId === menu.trackerId) ?? detail?.card : undefined;

  return (
    <div className="app">
      <a className="skip-link" href="#main">跳到看板</a>
      <div className="banner" role="status">
        <strong>{demoLabel || "演示数据"}</strong>
        <span>这是非宿主 Vite 预览，不计入 Nimbalyst 集成验收。原生 Trackers、编辑器、会话和 Git 审查只在独立 profile 的 Electron 执行视图中验收。</span>
      </div>
      <TopBar
        viewMode={viewMode}
        theme={theme}
        connected={connected}
        canCreate
        createLabel={createText}
        compact={compact}
        sidebarOpen={sidebarOpen}
        onViewMode={setViewMode}
        onTheme={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
        onReset={() => setResetOpen(true)}
        onInject={(scenario) => {
          void runCommand("demo.inject", {
            scenario,
            trackerId: selectedId ?? undefined,
            runId: detail?.latestRun?.id ?? undefined,
          });
        }}
        onCreate={() => setCreateOpen(true)}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onSaveView={() => setSaveViewOpen(true)}
      />
      {!connected ? (
        <div className="offline-note">
          已断线，显示缓存列表。执行按钮已禁用。
          {lastSync ? ` 最后同步：${lastSync}` : " 尚未同步成功。"}
        </div>
      ) : null}
      {notice ? (
        <div className={notice.tone === "error" ? "error-banner offline-note" : "offline-note"} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.message}
          {notice.code ? `（${notice.code}）` : ""}
        </div>
      ) : null}
      <div className="live" role="status">{busy ? "正在提交命令" : ""}</div>
      <div className="body">
        {compact && sidebarOpen ? <div className="drawer-backdrop" onClick={() => setSidebarOpen(false)} /> : null}
        <Sidebar
          open={!compact || sidebarOpen}
          projectId={projectId}
          projects={projects}
          devices={devices}
          views={views}
          nav={nav}
          search={search}
          onSearch={setSearch}
          onProject={(id) => {
            setProjectId(id);
            setSelectedId(null);
            setDrafts({});
            setSidebarOpen(false);
          }}
          onNav={(next) => {
            setNav(next);
            if (next.kind === "board") setViewMode("execution");
            if (next.kind === "all" || next.kind === "type" || next.kind === "ready") setViewMode("native-list");
            if (compact) setSidebarOpen(false);
          }}
        />
        {!compact ? (
          <ResizeHandle label="调整左侧栏宽度" onDelta={(delta) => setLeftW((w) => clamp(w + delta, 160, 420))} />
        ) : null}
        <main className="center" id="main">
          <div className="center-toolbar">
            {isNarrow && useBoard ? (
              <div className="stage-switch segmented" role="group" aria-label="阶段">
                {STAGES.map((stage) => (
                  <button key={stage} type="button" aria-pressed={narrowStage === stage} onClick={() => setNarrowStage(stage)}>
                    {STAGE_LABELS[stage]}
                  </button>
                ))}
              </div>
            ) : (
              <span className="muted">
                {nav.kind === "ready" ? "Ready：依赖已就绪的未关闭条目，不是全部待办。" : viewMode === "execution" ? "执行看板" : "原生列表"}
              </span>
            )}
          </div>
          {useBoard ? (
            <Board
              items={items}
              counts={counts}
              selectedId={selectedId}
              narrowStage={narrowStage}
              isNarrow={isNarrow}
              canCreate={connected}
              createLabel={createText}
              onSelect={select}
              onCreate={() => setCreateOpen(true)}
              onOpenMenu={openMenu}
              onDropStage={onDropStage}
              onMoveFocus={onMoveFocus}
            />
          ) : (
            <NativeList items={items} selectedId={selectedId} onSelect={select} onOpenMenu={openMenu} />
          )}
        </main>
        {showDetail && detail && currentDraft ? (
          <>
            {!compact ? (
              <ResizeHandle label="调整右侧栏宽度" onDelta={(delta) => setRightW((w) => clamp(w + delta, 280, 560))} />
            ) : null}
            <DetailPanel
              key={detail.record.id}
              detail={detail}
              draft={currentDraft}
              cards={items}
              caps={caps}
              connected={connected}
              history={history}
              viewingRun={viewingRun}
              toolNotes={toolNotes}
              onDraft={patchDraft}
              onClose={closeDetail}
              onSave={() => void saveSelected()}
              onStart={() => void startCard(detail.card)}
              onArchive={() => void runCommand("task.archive", { trackerId: detail.record.id })}
              onRestore={() => void runCommand("task.restore", { trackerId: detail.record.id })}
              onComment={async () => {
                if (!currentDraft.comment.trim()) return;
                await runCommand("comment.add", { trackerId: detail.record.id, body: currentDraft.comment.trim() });
                patchDraft({ comment: "" });
              }}
              onRelations={() => void saveRelations()}
              onMessage={async () => {
                if (!detail.latestRun || !currentDraft.message.trim()) return;
                await runCommand("run.message", {
                  runId: detail.latestRun.id,
                  text: currentDraft.message.trim(),
                  clientMessageId: newIdempotencyKey(),
                });
                patchDraft({ message: "" });
              }}
              onRespond={async (requestId) => {
                if (!detail.latestRun) return;
                await runCommand("run.respond", {
                  runId: detail.latestRun.id,
                  requestId,
                  text: currentDraft.respondText,
                });
                patchDraft({ respondText: "" });
              }}
              onCancel={() => detail.latestRun && void runCommand("run.cancel", { runId: detail.latestRun.id })}
              onReconcile={(resolution) => detail.latestRun && void runCommand("run.reconcile", { runId: detail.latestRun.id, resolution })}
              onRetry={() => void runCommand("run.retry", { trackerId: detail.record.id, runId: detail.latestRun?.id ?? undefined })}
              onAccept={() => detail.latestRun && void runCommand("review.accept", { runId: detail.latestRun.id }, { expectedRevision: currentDraft.baseRevision })}
              onChanges={() => detail.latestRun && void runCommand("review.request_changes", { runId: detail.latestRun.id, comment: currentDraft.reviewComment || undefined })}
              onViewRun={(runId) => {
                if (!runId) {
                  setViewingRun(null);
                  return;
                }
                void showRun(projectId, runId)
                  .then((result) => setViewingRun(result.run))
                  .catch(fail);
              }}
            />
          </>
        ) : null}
      </div>
      {menu && menuCard ? (
        <CardMenu
          x={menu.x}
          y={menu.y}
          actions={cardMenuActions(menuCard, caps, connected)}
          onAction={(id) => void onMenuAction(menu.trackerId, id)}
          onClose={() => {
            setMenu(null);
            menuRestoreRef.current?.focus();
          }}
        />
      ) : null}
      {createOpen ? (
        <Dialog title={createText} onClose={() => setCreateOpen(false)}>
          <div className="field">
            <label htmlFor="new-title">标题</label>
            <input id="new-title" value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} />
          </div>
          <div className="actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const result = await runCommand("task.create", { title: createTitle.trim(), primaryType: createType });
                if (result?.trackerId) {
                  setCreateTitle("");
                  setCreateOpen(false);
                  select(result.trackerId);
                }
              }}
            >
              创建
            </button>
            <button type="button" className="btn" onClick={() => setCreateOpen(false)}>取消</button>
          </div>
        </Dialog>
      ) : null}
      {resetOpen ? (
        <Dialog title="重置演示数据？" onClose={() => setResetOpen(false)}>
          <p>这会把当前演示项目恢复为初始 fixture，不会读取真实账号或设备。</p>
          <div className="actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                await runCommand("demo.reset", {});
                setDrafts({});
                setSelectedId(null);
                setResetOpen(false);
              }}
            >
              重置演示
            </button>
            <button type="button" className="btn" onClick={() => setResetOpen(false)}>取消</button>
          </div>
        </Dialog>
      ) : null}
      {saveViewOpen ? (
        <Dialog title="保存当前筛选" onClose={() => setSaveViewOpen(false)}>
          <div className="field">
            <label htmlFor="view-name">视图名称</label>
            <input id="view-name" value={saveViewName} onChange={(event) => setSaveViewName(event.target.value)} />
          </div>
          <div className="actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                if (!saveViewName.trim()) return;
                await runCommand("view.save", {
                  name: saveViewName.trim(),
                  definition: listQuery,
                });
                setSaveViewName("");
                setSaveViewOpen(false);
                await refreshMeta();
              }}
            >
              保存视图
            </button>
            <button type="button" className="btn" onClick={() => setSaveViewOpen(false)}>取消</button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
