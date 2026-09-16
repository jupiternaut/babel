import type { DeviceRecord, ProjectRecord, SavedView } from "../api.ts";
import { NATIVE_TYPE_IDS, typeLabel } from "../labels.ts";
import type { NavKey } from "../types.ts";

function sameNav(a: NavKey, b: NavKey): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "type" && b.kind === "type") return a.type === b.type;
  if (a.kind === "view" && b.kind === "view") return a.viewId === b.viewId;
  return true;
}

export function Sidebar({
  open,
  projectId,
  projects,
  devices,
  views,
  nav,
  search,
  onSearch,
  onProject,
  onNav,
}: {
  open: boolean;
  projectId: string;
  projects: ProjectRecord[];
  devices: Array<DeviceRecord & { demo?: true }>;
  views: SavedView[];
  nav: NavKey;
  search: string;
  onSearch: (value: string) => void;
  onProject: (id: string) => void;
  onNav: (nav: NavKey) => void;
}) {
  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="导航">
      <div className="sidebar-search">
        <label htmlFor="list-search">筛选当前列表</label>
        <input
          id="list-search"
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="标题或编号"
          autoComplete="off"
        />
      </div>

      <details className="nav-group" open>
        <summary>项目</summary>
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className="nav-item"
            aria-current={project.id === projectId}
            onClick={() => onProject(project.id)}
          >
            <span>{project.name}</span>
            <span className="badge">演示</span>
          </button>
        ))}
      </details>

      <details className="nav-group" open>
        <summary>设备</summary>
        {devices.map((device) => (
          <div key={device.id} className="nav-item" style={{ cursor: "default" }}>
            <span>{device.label}</span>
            <span className="nav-sub">{device.displayStatus}</span>
          </div>
        ))}
        {devices.length === 0 ? <p className="empty">没有演示设备。</p> : null}
      </details>

      <details className="nav-group" open>
        <summary>Trackers</summary>
        <p className="faint" style={{ margin: "0 8px 4px", fontSize: 12 }}>视图</p>
        <button type="button" className="nav-item" aria-current={sameNav(nav, { kind: "ready" })} onClick={() => onNav({ kind: "ready" })}>
          Ready
        </button>
        <button type="button" className="nav-item" aria-current={sameNav(nav, { kind: "all" })} onClick={() => onNav({ kind: "all" })}>
          全部
        </button>
        <button type="button" className="nav-item" aria-current={sameNav(nav, { kind: "board" })} onClick={() => onNav({ kind: "board" })}>
          执行看板
        </button>
        {views.filter((view) => !view.builtin).map((view) => (
          <button
            key={view.viewId}
            type="button"
            className="nav-item"
            aria-current={sameNav(nav, { kind: "view", viewId: view.viewId })}
            onClick={() => onNav({ kind: "view", viewId: view.viewId })}
          >
            {view.name}
            {view.builtin ? <span className="nav-sub">内置</span> : null}
          </button>
        ))}
        <p className="faint" style={{ margin: "12px 8px 4px", fontSize: 12 }}>类型</p>
        {NATIVE_TYPE_IDS.map((type) => (
          <button
            key={type}
            type="button"
            className="nav-item"
            aria-current={sameNav(nav, { kind: "type", type })}
            onClick={() => onNav({ kind: "type", type })}
          >
            {typeLabel(type)}
          </button>
        ))}
      </details>

      <details className="nav-group">
        <summary>集成</summary>
        <div className="nav-item" style={{ cursor: "default" }}>
          <span>Google Tasks</span>
          <span className="nav-sub">未接入（M0）</span>
        </div>
        <div className="nav-item" style={{ cursor: "default" }}>
          <span>Pi</span>
          <span className="nav-sub">未接入（M0）</span>
        </div>
      </details>

      <details className="nav-group">
        <summary>运维</summary>
        <div className="nav-item" style={{ cursor: "default" }}>
          <span>设备接入</span>
          <span className="nav-sub">未接入（M0）</span>
        </div>
        <div className="nav-item" style={{ cursor: "default" }}>
          <span>Hook 管理</span>
          <span className="nav-sub">未接入（M0）</span>
        </div>
      </details>
    </aside>
  );
}
