import { useState } from "react";
import { AlertTriangle, Check, Copy, FolderOpen, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { scheduleCacheRebuild, type UsageDiagnostics } from "@/lib/api";
import { usageFailureKind } from "@/lib/usage-recovery";
import tauriConfig from "../../src-tauri/tauri.conf.json";

export function UsageRecoveryCard({ scanning, pending, error, diagnostics, diagnosticsError, hasCachedData, busy, onRetry, onDetect, onChoose, onExpandRange }: {
  scanning: boolean;
  pending: boolean;
  error: string | null;
  diagnostics: UsageDiagnostics | null;
  diagnosticsError: string | null;
  hasCachedData: boolean;
  busy: boolean;
  onRetry: () => void;
  onDetect: () => void;
  onChoose: () => void;
  onExpandRange: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [rebuildPath, setRebuildPath] = useState<string | null>(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const directoryFailure = diagnostics && ["missingDirectory", "unreadableDirectory", "databaseError"].includes(diagnostics.status);
  const failure = usageFailureKind(error) ?? usageFailureKind(diagnostics?.error);
  const status = pending ? "scanning" : failure ?? (directoryFailure ? diagnostics.status : error ? "failed" : diagnostics?.status === "ready" ? "emptyRange" : diagnostics?.status ?? "failed");
  const showDirectoryActions = ["failed", "missingDirectory", "unreadableDirectory", "noSessions", "noUsage"].includes(status);
  const detail = error || diagnostics?.error || diagnosticsError;
  async function scheduleRebuild() {
    if (!window.confirm(t("recovery.rebuild_confirm"))) return;
    setIsScheduling(true);
    try {
      setRebuildPath(await scheduleCacheRebuild());
      setRebuildError(null);
    } catch (error) {
      setRebuildError(String(error));
    } finally {
      setIsScheduling(false);
    }
  }
  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ version: tauriConfig.version, ...diagnostics, error: detail }, null, 2));
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <Card data-testid="usage-recovery" className="mb-5 overflow-hidden border-warning/30">
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-warning/10 p-2.5 text-warning">
            {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          </div>
          <div className="min-w-0 space-y-1.5" role="status" aria-live="polite">
            <h2 className="text-lg font-semibold">{t(`recovery.title_${status}`)}</h2>
            <p className="text-sm leading-6 text-muted-foreground">{t(`recovery.description_${status}`)}</p>
          </div>
        </div>
        {hasCachedData && error ? <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">{t("recovery.cached_preserved")}</p> : null}
        {diagnostics ? <dl className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 text-xs sm:grid-cols-2">
          <div className="sm:col-span-2"><dt className="text-muted-foreground">{t("recovery.directory")}</dt><dd className="mt-1 break-all font-mono" data-testid="diagnostic-directory">{diagnostics.codexHome}</dd></div>
          {diagnostics.cachePath && (status.startsWith("cache") || status === "diskFull" || status === "databaseError") ? <div className="sm:col-span-2"><dt className="text-muted-foreground">{t("recovery.cache_path")}</dt><dd className="mt-1 break-all font-mono">{diagnostics.cachePath}</dd></div> : null}
          <div><dt className="text-muted-foreground">{t("recovery.environment")}</dt><dd className="mt-1">{diagnostics.runtime === "native" ? t("recovery.native") : diagnostics.runtime}</dd></div>
          <div><dt className="text-muted-foreground">{t("recovery.files")}</dt><dd className="mt-1">{diagnostics.error ? "—" : diagnostics.filesFound}</dd></div>
        </dl> : null}
        {detail && !pending ? <details open={status === "sessionParseError" || status === "sessionReadError"} className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t("recovery.details")}</summary>
          <p className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-muted/30 p-3">{detail}</p>
        </details> : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={busy || scanning} onClick={onRetry}><RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />{t("recovery.retry")}</Button>
          {showDirectoryActions ? <>
            <Button size="sm" variant="secondary" disabled={busy || scanning} onClick={onDetect}><Search className="h-3.5 w-3.5" />{t("recovery.detect")}</Button>
            <Button size="sm" variant="secondary" disabled={busy || scanning} onClick={onChoose}><FolderOpen className="h-3.5 w-3.5" />{t("recovery.choose_directory")}</Button>
          </> : null}
          {status === "cacheCorrupt" ? <Button size="sm" variant="secondary" disabled={busy || scanning || isScheduling || !!rebuildPath} onClick={() => void scheduleRebuild()}>{t("recovery.rebuild_cache")}</Button> : null}
          {status === "emptyRange" ? <Button size="sm" variant="secondary" disabled={busy} onClick={onExpandRange}>{t("recovery.expand_range")}</Button> : null}
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => void copyDiagnostics()}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{t(copied ? "recovery.copied" : "recovery.copy")}</Button>
        </div>
        {copyError ? <p role="alert" className="text-xs text-warning">{t("recovery.copy_failed")}</p> : null}
        {rebuildPath ? <p role="status" className="text-sm">{t("recovery.rebuild_scheduled")}<span className="mt-1 block break-all font-mono text-xs">{rebuildPath}</span></p> : null}
        {rebuildError ? <p role="alert" className="break-all text-xs text-warning">{rebuildError}</p> : null}
        <p className="text-xs leading-5 text-muted-foreground">{t("recovery.local_only")}</p>
      </CardContent>
    </Card>
  );
}
