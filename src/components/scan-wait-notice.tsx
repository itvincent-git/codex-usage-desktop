import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { UsageDiagnostics } from "@/lib/api";
import tauriConfig from "../../src-tauri/tauri.conf.json";

export function ScanWaitNotice({ active, diagnostics }: { active: boolean; diagnostics: UsageDiagnostics | null }) {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(0);
  const [copyStatus, setCopyStatus] = useState<"copied" | "copy_failed" | null>(null);
  useEffect(() => {
    setSeconds(0);
    setCopyStatus(null);
    if (!active) return;
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!active || seconds < 30) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ version: tauriConfig.version, ...diagnostics, status: "waitingForLocalData", elapsedSeconds: seconds }, null, 2));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("copy_failed");
    }
  }
  return <div role="status" data-testid="scan-wait-notice" className="mb-5 space-y-3 rounded-xl border border-warning/30 bg-warning/5 p-5">
    <p className="font-semibold">{t("recovery.slow_title", { seconds })}</p>
    <p className="text-sm leading-6 text-muted-foreground">{t("recovery.slow_description")}</p>
    <Button size="sm" variant="secondary" onClick={() => void copy()}>{t("recovery.copy")}</Button>
    {copyStatus ? <p className="text-xs">{t(`recovery.${copyStatus}`)}</p> : null}
  </div>;
}
