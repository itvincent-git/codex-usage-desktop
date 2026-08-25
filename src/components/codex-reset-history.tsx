import { ExternalLink, RotateCcw, X } from "lucide-react";
import dayjs from "dayjs";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchCodexResetHistory,
  openUrl,
  type CodexResetAnnouncement,
} from "@/lib/api";

export function LatestResetButton({
  reset,
  onOpen,
}: {
  reset: CodexResetAnnouncement;
  onOpen: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className="group flex min-w-0 items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={onOpen}
      aria-label={t("limits.latest_reset_open")}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <RotateCcw className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[10px] font-semibold leading-none text-foreground/80">
          {t("limits.latest_reset")}
        </span>
        <span className="mt-1 block truncate text-[9px] tabular-nums text-muted-foreground">
          {dayjs(reset.announcedAt).format("MM-DD HH:mm")} · {t(`limits.reset_type_${reset.resetType}`)}
        </span>
      </span>
      <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-90" aria-hidden="true" />
    </button>
  );
}

export function CodexResetHistoryModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [resets, setResets] = useState<CodexResetAnnouncement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestRef = useRef<Promise<CodexResetAnnouncement[]> | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const request = requestRef.current ?? fetchCodexResetHistory(30);
    requestRef.current = request;

    void request
      .then((data) => {
        if (active) setResets(data);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="codex-reset-history-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface/95 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 bg-muted/20 px-5 py-4">
          <div>
            <h3 id="codex-reset-history-title" className="text-lg font-bold text-foreground">
              {t("limits.reset_history_title")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("limits.reset_history_description")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("limits.reset_history_loading")}</p>
          ) : error ? (
            <p className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error">
              {t("limits.reset_history_error")}
            </p>
          ) : resets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {t("limits.reset_history_empty")}
            </p>
          ) : (
            <ol className="space-y-3">
              {resets.map((reset) => (
                <li key={reset.id} className="rounded-xl border border-border bg-background/35 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {t(`limits.reset_type_${reset.resetType}`)}
                    </span>
                    <time className="text-[10px] tabular-nums text-muted-foreground" dateTime={reset.announcedAt}>
                      {dayjs(reset.announcedAt).format("YYYY-MM-DD HH:mm")}
                    </time>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">{reset.text}</p>
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30"
                    onClick={() => void openUrl(reset.source.url)}
                  >
                    @{reset.source.author} · {t("limits.reset_history_source")}
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
