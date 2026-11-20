import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { ArrowUpRight, ChevronLeft, Grip, Minus, RefreshCw, Settings2, X } from "lucide-react";
import { floatingAction, floatingBalance, compactTokenNumber, tokenNumber, usagePeriods, type FloatingPreferences, type FloatingUsage, type TokenTotals, type UsagePeriod } from "@/lib/floating";
import "./floating-window.css";

type View = "overview" | "projects" | "settings";
type DragSession = {
  x: number; y: number; moved: boolean; busy: boolean;
  next: { x: number; y: number } | null;
  dock: FloatingPreferences["dock"]; detached: boolean; grabX: number; grabY: number;
  origin: Promise<{ x: number; y: number; scale: number } | null>;
};
function TokenComposition({ value }: { value: TokenTotals }) {
  const parts = [{ label: "输入", value: value.input, className: "input" }, { label: "缓存", value: value.cached, className: "cached" }, { label: "输出", value: value.output, className: "output" }];
  const denominator = value.total;
  return <section className="float-composition" aria-label="Token 构成">
    <div className="float-composition-bar">{parts.map(part => <i key={part.className} className={part.className} style={{ width: `${denominator > 0 ? part.value / denominator * 100 : 0}%` }} />)}</div>
    <div className="float-composition-values">{parts.map(part => <div key={part.className}><span><i className={part.className} />{part.label}</span><strong title={part.value.toLocaleString("zh-CN")}>{tokenNumber(part.value)}</strong></div>)}</div>
  </section>;
}

export function FloatingWindow() {
  const [preferences, setPreferences] = useState<FloatingPreferences>({ enabled: false, expanded: false });
  const [data, setData] = useState<FloatingUsage | null>(null);
  const [view, setView] = useState<View>("overview");
  const [period, setPeriod] = useState<UsagePeriod>("today");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [extensionLength, setExtensionLength] = useState(76);
  const transitionUntil = useRef(0);
  const loading = useRef(false);
  const enabled = useRef(false);
  const mounted = useRef(true);
  const drag = useRef<DragSession | null>(null);
  const positioning = useRef<Promise<void>>(Promise.resolve());
  const compactClickSuppressed = useRef(false);

  useEffect(() => { setExtensionLength(preferences.extensionLength ?? 76); }, [preferences.extensionLength]);
  async function saveLength(value: number) {
    try { setPreferences(await floatingAction("setLength", value)); }
    catch (error) { setError(String(error)); }
  }

  const refresh = useCallback(async () => {
    if (loading.current || !enabled.current) return;
    loading.current = true;
    setRefreshing(true);
    try {
      const next = await invoke<FloatingUsage>("fetch_floating_usage");
      if (mounted.current) { setData(next); setError(null); }
    } catch (error) {
      if (mounted.current) setError(String(error));
    } finally {
      loading.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  const action = useCallback(async (command: Parameters<typeof floatingAction>[0]) => {
    try {
      await positioning.current;
      const morph = command === "expand" || command === "collapse" || command === "finishDrag";
      if (morph) {
        const wait = transitionUntil.current - Date.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        transitionUntil.current = Date.now() + 200;
        setTransitioning(true);
      }
      setPreferences(await floatingAction(command));
      if (morph) {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, transitionUntil.current - Date.now())));
        if (mounted.current) setTransitioning(false);
      }
    }
    catch (error) { setError(String(error)); }
  }, []);

  async function refreshAll() {
    setQuotaLoading(true);
    const [quota] = await Promise.allSettled([invoke("fetch_codex_limits"), refresh()]);
    await refresh();
    if (quota.status === "rejected") setError(`额度更新失败：${String(quota.reason)}`);
    setQuotaLoading(false);
  }

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const cleanups: (() => void)[] = [];

    const register = async (promise: Promise<() => void>) => {
      const cleanup = await promise;
      if (!active) cleanup(); else cleanups.push(cleanup);
    };
    void (async () => {
      await register(listen<FloatingPreferences>("floating-preferences", ({ payload }) => {
        const wasEnabled = enabled.current;
        enabled.current = payload.enabled;
        setPreferences(payload);
        if (payload.enabled && !wasEnabled) void refresh();
      }));
      await register(listen("floating-updated", () => void refresh()));
      const current = await invoke<FloatingPreferences>("floating_preferences");
      if (active) { enabled.current = current.enabled; setPreferences(current); void refresh(); }
    })().catch(error => { if (active) setError(String(error)); });
    const timer = setInterval(() => void refresh(), 30_000);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void action("collapse");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      active = false;
      mounted.current = false;
      clearInterval(timer);

      cleanups.forEach(cleanup => cleanup());
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [action, refresh]);

  function endPointer() {
    const moved = drag.current?.moved;
    drag.current = null;
    if (moved) void action("finishDrag");
  }

  function startPointer(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || Date.now() < transitionUntil.current) return;
    compactClickSuppressed.current = false;
    const window = getCurrentWindow();
    drag.current = {
      x: event.screenX, y: event.screenY, moved: false, busy: false, next: null,
      dock: preferences.expanded ? "free" : preferences.dock, detached: false, grabX: event.clientX, grabY: event.clientY,
      origin: Promise.all([window.outerPosition(), window.scaleFactor()])
        .then(([position, scale]) => ({ x: position.x, y: position.y, scale }))
        .catch(error => { setError(String(error)); return null; }),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  async function moveWindow(session: DragSession) {
    session.busy = true;
    try {
      const origin = await session.origin;
      if (!origin) return;
      // Coalesce moves and use screen coordinates: moving the window changes client coordinates.
      // Native startDragging after a pointer-move can lose AppKit's current mouse event.
      while (session.next) {
        const next = session.next;
        session.next = null;
        const attachedLeft = session.dock === "left" || session.dock === "bottomLeft";
        const attachedRight = session.dock === "right" || session.dock === "bottomRight";
        if (!session.detached && ((attachedLeft && next.x > 5) || (attachedRight && next.x < -5))) {
          session.detached = true;
          // Animate on the old canvas first: shrinking the native window first clips
          // the entire width transition. Keep the same DOM node/pointer capture.
          const orb = document.querySelector<HTMLElement>(".float-orb");
          if (orb && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
            const before = getComputedStyle(orb);
            const animation = orb.animate([
              { width: before.width, transform: before.transform, borderRadius: before.borderRadius, left: before.left },
              { width: "36px", transform: "translateX(0)", borderRadius: "18px", left: "4px" },
            ], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
            // Keep following the pointer during the morph, rather than pausing
            // dragging for the animation's duration.
            while (animation.playState === "running") {
              const latest = session.next as { x: number; y: number } | null;
              if (latest) {
                next.x = latest.x;
                next.y = latest.y;
                session.next = null;
              }
              await getCurrentWindow().setPosition(new PhysicalPosition(
                Math.round(origin.x + next.x * origin.scale),
                Math.round(origin.y + next.y * origin.scale),
              ));
              await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            }
            await animation.finished;
            setTimeout(() => animation.cancel(), 50);
          }
          // Keep the grab point under the pointer when the extended strip shrinks.
          if (session.dock === "bottomLeft" || session.dock === "bottomRight") {
            origin.x += (session.grabX - 22) * origin.scale;
            origin.y += (session.grabY - 22) * origin.scale;
          }
          setPreferences(await floatingAction("detach"));
        }
        await getCurrentWindow().setPosition(new PhysicalPosition(
          Math.round(origin.x + next.x * origin.scale),
          Math.round(origin.y + next.y * origin.scale),
        ));
      }
    } catch (error) { setError(String(error)); }
    finally { session.busy = false; }
  }

  function movePointer(event: PointerEvent<HTMLElement>) {
    const start = drag.current;
    if (!start) return;
    const delta = { x: event.screenX - start.x, y: event.screenY - start.y };
    if (!start.moved && Math.hypot(delta.x, delta.y) < 5) return;
    start.moved = true;
    compactClickSuppressed.current = true;
    start.next = delta;
    if (!start.busy) positioning.current = moveWindow(start);
  }

  const balance = floatingBalance(data);
  const remaining = balance.percent;
  const percentText = remaining === null ? "—" : String(Math.round(remaining));
  const quotaStale = !!data?.quotaWarning || !balance.updatedAt || Date.now() - new Date(balance.updatedAt).getTime() > 10 * 60_000;
  const color = remaining !== null && remaining < 20 ? "#bb4c45" : "#737373";
  const ringStyle = { "--remaining": `${(remaining ?? 0) * 3.6}deg`, "--quota-color": color } as CSSProperties;
  const quotaLabel = remaining === null ? `${balance.label}待更新` : `${balance.label} ${percentText}%${quotaStale ? "，等待更新" : ""}`;

  const dock = preferences.dock ?? "free";
  const bottom = dock === "bottomLeft" || dock === "bottomRight";
  const left = dock === "left" || dock === "bottomLeft";
  const side = dock !== "free";
  if (!preferences.expanded) return <main className={`float-compact dock-${dock}${bottom ? ` dock-${left ? "left" : "right"} is-extended` : ""}`} style={ringStyle} data-transitioning={transitioning}>
    <button className={`float-orb${quotaStale ? " is-stale" : ""}`} aria-label={`展开 Token 浮窗，${quotaLabel}`} title={`${quotaLabel} · 拖动可移动`} onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer} onClick={(event) => { if (event.detail === 0 || !compactClickSuppressed.current) void action("expand"); }}>
      <span className="float-gauge" aria-hidden="true">
        <svg className="float-ring" viewBox="2.5 2.5 27 27">
          <path className="track" d="M16 3.5 A12.5 12.5 0 1 1 16 28.5 A12.5 12.5 0 1 1 16 3.5" />
          <path className="progress" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - (remaining ?? 0)} d={side && !bottom ? left ? "M16 3.5 A12.5 12.5 0 0 1 16 28.5" : "M16 3.5 A12.5 12.5 0 0 0 16 28.5" : "M16 3.5 A12.5 12.5 0 1 1 16 28.5 A12.5 12.5 0 1 1 16 3.5"} />
        </svg>
        <span className={`float-orb-core${remaining === null ? " is-empty" : ""}`}><strong>{percentText}<small>{remaining === null ? "" : "%"}</small></strong></span>
      </span>
      {bottom ? <span className="float-bottom-info" title="本机今日用量"><span>今日</span><b>{data ? compactTokenNumber(data.today.total) : "—"}</b></span> : null}
      {error || quotaStale ? <span className="float-orb-error" aria-label="数据待更新" title={data?.quotaWarning ?? error ?? "额度待更新"}>!</span> : null}
    </button>
  </main>;

  const selected = data?.[period];
  const projects = data?.projects;
  const weekTotal = data?.week?.total;
  const usageLabel = "本机";
  const periodLabel = "本机 · 周一至周日";
  return <main className="float-shell" style={ringStyle} data-transitioning={transitioning} aria-label="Token 桌面浮窗">
    <header className="float-header">
      <div className="float-drag" onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer} title="拖动浮窗"><Grip size={15} /><span>用量</span></div>
      <div className="float-header-actions">
        <button aria-label="浮窗设置" onClick={() => setView(view === "settings" ? "overview" : "settings")} aria-pressed={view === "settings"}><Settings2 size={16} /></button>
        <button aria-label="收起浮窗" onClick={() => void action("collapse")}><Minus size={18} /></button>
      </div>
    </header>
    {view === "settings" ? <section className="float-settings"><div className="float-settings-content">
      <button className="float-back" onClick={() => setView("overview")}><ChevronLeft size={14} />返回统计</button>
      <h1>浮窗设置</h1>
      <div className="float-length-setting">
        <label htmlFor="float-extension-length">下方贴边长度 <strong>{extensionLength}</strong></label>
        <input id="float-extension-length" aria-label="下方贴边长度" type="range" min="60" max="120" step="4" value={extensionLength} onChange={event => setExtensionLength(Number(event.target.value))} onPointerUp={event => void saveLength(Number(event.currentTarget.value))} onKeyUp={event => void saveLength(Number(event.currentTarget.value))} onBlur={event => void saveLength(Number(event.currentTarget.value))} />
        <p>左右下方的半圆显示本机今日用量。可调短以避开 Dock 放大区域。</p>
      </div>
      <div className="float-rules"><span>日与月</span><strong>自然日／月</strong><span>周用量</span><strong>周一至周日</strong></div>
      </div><div className="float-setting-actions"><button onClick={() => void action("main")}><ArrowUpRight size={15} />打开主界面</button><button onClick={() => void action("hide")}><X size={15} />隐藏浮窗</button></div>
    </section> : <>
      <div className="float-quota"><span>{balance.label}{quotaStale ? <small> · 待更新</small> : null}</span><strong>{remaining === null ? "—" : `${percentText}%`}</strong><div className="float-quota-track"><i style={{ width: `${remaining ?? 0}%` }} /></div></div>
      <nav className="float-tabs" aria-label="浮窗视图"><button aria-pressed={view === "overview"} onClick={() => setView("overview")}>用量总览</button><button aria-pressed={view === "projects"} onClick={() => setView("projects")}>本周项目</button></nav>
      {view === "overview" ? <section className="float-overview">
        <div className="float-periods" role="group" aria-label="统计周期">{usagePeriods.map(item => <button key={item.key} aria-pressed={period === item.key} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div>
        <div className="float-main-number"><span>{usagePeriods.find(item => item.key === period)?.label}用量</span><strong data-testid="floating-token-total" title={selected?.total.toLocaleString("zh-CN")}>{selected ? tokenNumber(selected.total) : "—"}</strong><small>tokens</small></div>
        <p className="float-range">{period === "today" ? usageLabel + "今日" : period === "week" ? periodLabel : usageLabel + ""}</p>
        {selected ? <TokenComposition value={selected} /> : <p className="float-placeholder">{data ? "本周期暂无数据" : "正在读取本机使用记录…"}</p>}
      </section> : <section className="float-projects"><p className="float-range">{periodLabel}</p><div className="float-project-list">{projects?.length ? projects.map(project => <div className="float-project" key={project.path}><div><span title={project.path}>{project.name}</span><strong title={project.tokens.total.toLocaleString("zh-CN")}>{tokenNumber(project.tokens.total)}</strong></div><div className="float-project-track"><i style={{ width: `${weekTotal ? project.tokens.total / weekTotal * 100 : 0}%` }} /></div></div>) : <p className="float-placeholder">本周期还没有项目用量</p>}</div></section>}
    </>}
    <footer className="float-footer"><span title={data?.quotaWarning ?? error ?? undefined}>{(data?.quotaWarning ? "额度未更新 · 显示上次数据" : error ? "读取失败 · 保留上次数据" : refreshing ? "正在更新…" : data ? `更新于 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(data.updatedAt))}` : "等待数据")}</span><button aria-label="刷新浮窗" disabled={refreshing || quotaLoading} onClick={() => void refreshAll()}><RefreshCw size={13} className={refreshing || quotaLoading ? "float-spinning" : ""} /></button></footer>
  </main>;
}
