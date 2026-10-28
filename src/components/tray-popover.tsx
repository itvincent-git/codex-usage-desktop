import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronRight, PanelsTopLeft, Power } from "lucide-react";
import appIcon from "../../src-tauri/icons/icon.png";
import type { TrayPopoverData } from "@/lib/tray-popover";
import "./tray-popover.css";

export function TrayPopover() {
  const [data, setData] = useState<TrayPopoverData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const cleanup = await listen<TrayPopoverData>("tray-popover-updated", ({ payload }) => {
        if (active) setData(payload);
      });
      if (!active) { cleanup(); return; }
      unlisten = cleanup;
      const snapshot = await invoke<TrayPopoverData | null>("get_tray_popover");
      if (active) setData(snapshot);
    })().catch((err) => { if (active) setError(String(err)); });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void getCurrentWindow().hide();
      if (event.metaKey && event.key.toLowerCase() === "q") {
        event.preventDefault();
        void invoke("tray_popover_action", { action: "quit" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      active = false;
      unlisten?.();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const element = panel.current!;
    const observer = new ResizeObserver(() => {
      void getCurrentWindow().setSize(new LogicalSize(390, Math.ceil(element.getBoundingClientRect().height)))
        .catch((err) => setError(String(err)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  async function showMain() {
    try {
      await invoke("tray_popover_action", { action: "showMain" });
    } catch (err) { setError(String(err)); }
  }

  return (
    <main ref={panel} className="tray-popover" aria-label="Codex Usage">
      <header className="tray-header">
        <img className="tray-app-icon" src={appIcon} alt="" width="44" height="44" />
        <div className="tray-identity">
          <h1>Codex Usage</h1>
          {data?.account ? <p title={data.account}>{data.account}</p> : null}
          {data?.workspace ? <p title={data.workspace}>{data.workspace}</p> : null}
        </div>
        {data?.membership ? <span className="tray-membership">{data.membership}</span> : null}
      </header>
      {data?.quotas.length ? <section className="tray-quotas">
        {data.quotas.map((quota) => {
          const remaining = quota.remainingPercent === null ? null : Math.min(100, Math.max(0, quota.remainingPercent));
          return <section key={quota.kind} className="tray-quota" data-quota={quota.kind}>
            <div className="tray-quota-heading">
              <h2><span className="tray-quota-dot" />{quota.label}</h2>
              <div className="tray-remaining"><strong>{remaining === null ? "—" : `${Math.round(remaining)}%`}</strong><span>{data.labels.remaining}</span></div>
            </div>
            <div className="tray-progress" role="progressbar" aria-label={quota.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining ?? undefined} aria-valuetext={remaining === null ? data.labels.unavailable : undefined}>
              <span style={{ width: `${remaining ?? 0}%` }} />
            </div>
            <div className="tray-quota-detail"><span>{quota.usedText}</span><span>{quota.resetText}</span></div>
          </section>;
        })}
      </section> : null}
      {data && (data.tokens || data.cost !== null) ? <section className="tray-today" aria-label={data.labels.today}>
        <h2>{data.labels.today}</h2>
        <div className="tray-metrics">
          {data.tokens ? <div className="tray-metric"><span>Tokens</span><strong>{data.tokens.value}</strong><small>{data.tokens.exact}</small></div> : null}
          {data.cost !== null ? <div className="tray-metric"><span>{data.labels.cost}</span><strong>{data.cost}</strong></div> : null}
        </div>
      </section> : null}
      {error ? <p className="tray-error" role="alert">{error}</p> : null}
      <footer className="tray-actions">
        <button type="button" onClick={() => void showMain()}><PanelsTopLeft aria-hidden="true" /><span>{data?.labels.showMain ?? "Show Main Window"}</span><ChevronRight className="tray-action-hint" aria-hidden="true" /></button>
        <button type="button" onClick={() => void invoke("tray_popover_action", { action: "quit" }).catch((err) => setError(String(err)))}><Power aria-hidden="true" /><span>{data?.labels.quit ?? "Quit"}</span><kbd>⌘Q</kbd></button>
      </footer>
    </main>
  );
}
