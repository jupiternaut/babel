import { INJECT_SCENARIOS } from "../labels.ts";
import type { ViewMode } from "../types.ts";

export function TopBar({
  viewMode,
  theme,
  connected,
  canCreate,
  createLabel,
  compact,
  sidebarOpen,
  onViewMode,
  onTheme,
  onReset,
  onInject,
  onCreate,
  onToggleSidebar,
  onSaveView,
}: {
  viewMode: ViewMode;
  theme: "light" | "dark";
  connected: boolean;
  canCreate: boolean;
  createLabel: string;
  compact: boolean;
  sidebarOpen: boolean;
  onViewMode: (mode: ViewMode) => void;
  onTheme: () => void;
  onReset: () => void;
  onInject: (scenario: string) => void;
  onCreate: () => void;
  onToggleSidebar: () => void;
  onSaveView: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-group">
        {compact ? (
          <button
            type="button"
            className="btn"
            aria-expanded={sidebarOpen}
            onClick={onToggleSidebar}
          >
            导航
          </button>
        ) : null}
        <div className="segmented" role="group" aria-label="显示模式">
          <button type="button" aria-pressed={viewMode === "execution"} onClick={() => onViewMode("execution")}>
            执行看板
          </button>
          <button type="button" aria-pressed={viewMode === "native-list"} onClick={() => onViewMode("native-list")}>
            原生列表
          </button>
        </div>
        {canCreate ? (
          <button type="button" className="btn" onClick={onCreate} disabled={!connected}>
            {createLabel}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onSaveView} disabled={!connected}>
          保存当前筛选
        </button>
      </div>
      <div className="topbar-group">
        <label className="faint" htmlFor="inject-scenario">
          注入场景
        </label>
        <select
          id="inject-scenario"
          disabled={!connected}
          defaultValue=""
          onChange={(event) => {
            const value = event.target.value;
            event.target.value = "";
            if (value) onInject(value);
          }}
        >
          <option value="" disabled>
            选择场景
          </option>
          {INJECT_SCENARIOS.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={onReset} disabled={!connected}>
          重置演示
        </button>
        <button type="button" className="btn" onClick={onTheme}>
          {theme === "dark" ? "浅色" : "深色"}
        </button>
      </div>
    </header>
  );
}
