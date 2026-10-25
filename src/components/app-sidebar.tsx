import { CalendarDays, ChartColumn, Folder, LayoutDashboard, Logs, PanelLeftClose, PanelLeftOpen, Settings, Terminal, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DashboardView } from "@/components/dashboard-header";

type AppSidebarProps = {
  view: DashboardView;
  onViewChange: (view: DashboardView) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  showLogsTab: boolean;
  limits: ReactNode;
};

const pages = [
  { view: "dashboard", label: "dashboard", icon: LayoutDashboard },
  { view: "sessions", label: "sessions", icon: Terminal },
  { view: "models", label: "model", icon: ChartColumn },
  { view: "daily", label: "daily", icon: CalendarDays },
  { view: "monthly", label: "monthly", icon: Wallet },
  { view: "projects", label: "project", icon: Folder },
  { view: "logs", label: "logs", icon: Logs },
] as const;

const MIN_WIDTH = 160;
const MAX_WIDTH = 360;
// Keep the macOS traffic lights fully inside the collapsed sidebar.
const COLLAPSED_WIDTH = 80;
export const clampSidebarWidth = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));

export function AppSidebar({ view, onViewChange, collapsed, onToggleCollapsed, width, onWidthChange, showLogsTab, limits }: AppSidebarProps) {
  const { t } = useTranslation();
  const toggleLabel = t(collapsed ? "header.expand_sidebar" : "header.collapse_sidebar");
  const [resizingWidth, setResizingWidth] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  const isResizing = resizingWidth !== null;

  useEffect(() => {
    if (!isResizing) return;
    const resize = (event: MouseEvent) => {
      if (!drag.current) return;
      drag.current.width = clampSidebarWidth(drag.current.startWidth + event.clientX - drag.current.startX);
      setResizingWidth(drag.current.width);
    };
    const finishResize = () => {
      if (!drag.current) return;
      onWidthChange(drag.current.width);
      drag.current = null;
      setResizingWidth(null);
    };
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", finishResize);
    window.addEventListener("blur", finishResize);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", finishResize);
      window.removeEventListener("blur", finishResize);
    };
  }, [isResizing, onWidthChange]);

  return (
    <aside data-app-sidebar style={{ width: collapsed ? COLLAPSED_WIDTH : resizingWidth ?? width }} className="relative flex h-full shrink-0 flex-col border-r border-border/80 bg-[rgb(var(--sidebar))]">
      <div aria-hidden="true" className="h-[var(--window-drag-height)] shrink-0" />
      <div className={`flex h-16 shrink-0 items-center gap-2 px-3 ${collapsed ? "justify-center" : "justify-between"}`}>
        {!collapsed ? <span className="truncate text-sm font-semibold tracking-tight" title={t("header.app_title")}>Codex Usage</span> : null}
        <button type="button" onClick={onToggleCollapsed} aria-label={toggleLabel} title={toggleLabel} aria-expanded={!collapsed} aria-controls="app-navigation" className="relative z-20 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <nav id="app-navigation" aria-label={t("header.navigation")} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div role="tablist" aria-orientation="vertical" aria-label={t("header.navigation")} className="space-y-1">
          {pages.filter((page) => page.view !== "logs" || showLogsTab).map(({ view: page, label, icon: Icon }) => (
            <button key={page} type="button" role="tab" aria-selected={view === page} aria-label={t(`common.${label}`)} title={collapsed ? t(`common.${label}`) : undefined} data-testid={`${page}-nav-tab`} onClick={() => onViewChange(page)} className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring ${collapsed ? "justify-center" : "text-left"} ${view === page ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed ? <span className="truncate">{t(`common.${label}`)}</span> : null}
            </button>
          ))}
        </div>
      </nav>
      <div className={`mx-2 max-h-[55%] shrink-0 overflow-y-auto border-t border-border/80 pb-4 pt-3 ${collapsed ? "" : "px-1"}`}>{limits}</div>
      <div className="shrink-0 border-t border-border/80 p-2">
        <button type="button" onClick={() => onViewChange("settings")} aria-label={t("common.settings")} title={collapsed ? t("common.settings") : undefined} className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${collapsed ? "justify-center" : "text-left"}`}>
          <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
          {!collapsed ? <span>{t("common.settings")}</span> : null}
        </button>
      </div>
      {!collapsed ? (
        <div
          role="separator"
          tabIndex={0}
          aria-label={t("header.resize_sidebar")}
          aria-orientation="vertical"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={resizingWidth ?? width}
          className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none select-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 hover:after:bg-primary/50 focus-visible:after:bg-primary"
          onMouseDown={(event) => {
            if (event.button !== 0 || drag.current) return;
            event.preventDefault();
            event.currentTarget.focus();
            drag.current = { startX: event.clientX, startWidth: width, width };
            setResizingWidth(width);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            onWidthChange(clampSidebarWidth(width + (event.key === "ArrowRight" ? 8 : -8)));
          }}
        >
          {resizingWidth !== null ? <div className="fixed inset-0 cursor-col-resize" /> : null}
        </div>
      ) : null}
    </aside>
  );
}
