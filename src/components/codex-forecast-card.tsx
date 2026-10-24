import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { openUrl, type CodexQuotaForecastResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

const SOURCE_URL = "https://codex-reset.com/";
const METHOD_URL = "https://codex-reset.com/forecast-method";

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="text-primary underline-offset-4 hover:underline" href={href} target="_blank" rel="noreferrer" onClick={(event) => {
    event.preventDefault();
    void openUrl(href).catch((error) => console.error("Failed to open forecast link", error));
  }}>{children}</a>;
}

export function CodexForecastCard({ data, error, isRefreshing, onRefresh }: {
  data: CodexQuotaForecastResponse | null;
  error: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const alert = data?.latestAlert;
  const end = alert?.window?.endAt ? Date.parse(alert.window.endAt) : NaN;
  const windowEnded = Number.isFinite(end) && end <= now;
  const confirmed = alert?.kind === "reset" && alert.state === "confirmed";
  const expired = alert?.state === "expired";
  const pending = alert?.pending === "done" || alert?.pending === "on_its_way";
  const active = alert?.kind === "watch" && (alert.state === "active" || pending) && !expired;
  const waiting = active && (pending || windowEnded);
  const status = waiting ? "waiting" : active ? "official" : "model";
  const lastReset = data?.lastResetAt ?? (confirmed ? alert.observedAt ?? alert.confirmedAt : null);
  const formatDate = (value?: string | null) => {
    if (!value || !Number.isFinite(Date.parse(value))) return t("forecast.unknown");
    return new Date(value).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  };

  useEffect(() => {
    if (!active || !Number.isFinite(end)) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, end]);

  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  const countdown = `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const confidence = data?.confidence && ["low", "moderate", "medium", "high"].includes(data.confidence)
    ? t(`forecast.confidence_${data.confidence}`) : t("forecast.unknown");

  return (
    <Card data-testid="global-reset-forecast" className="min-w-0 rounded-lg">
      <CardContent className="space-y-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{t("forecast.title")}</h2>
            {data ? <span data-testid="forecast-status" className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", status === "model" ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning")}>{t(`forecast.status_${status}`)}</span> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isRefreshing} aria-label={t(error && !data ? "forecast.retry" : "forecast.refresh")}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isRefreshing && "animate-spin")} aria-hidden="true" />
            {t(error && !data ? "forecast.retry" : "forecast.refresh")}
          </Button>
        </div>
        {error ? <p role="alert" className="text-xs text-warning">{t(data ? "forecast.refresh_failed" : "forecast.load_failed")}</p> : null}
        {!data && !error ? <p role="status" className="text-xs text-muted-foreground">{t("forecast.loading")}</p> : null}
        {data ? <>
          <div className="grid gap-4 sm:grid-cols-2">
            {([24, 48] as const).map((hours) => {
              const probability = hours === 24 ? data.probability24h : data.probability48h;
              return <div key={hours} data-forecast-horizon={`${hours}h`} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{t("forecast.horizon", { hours })}</span>
                  <span className="font-mono text-xl font-semibold tabular-nums">{probability}%</span>
                </div>
                <div role="progressbar" aria-label={t("forecast.horizon", { hours })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={probability} className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${probability}%` }} />
                </div>
              </div>;
            })}
          </div>
          <dl className="grid gap-x-5 gap-y-2 text-[11px] sm:grid-cols-3">
            <div><dt className="text-muted-foreground">{t("forecast.confidence")}</dt><dd className="mt-1">{confidence}</dd></div>
            <div><dt className="text-muted-foreground">{t("forecast.last_reset")}</dt><dd className="mt-1">{formatDate(lastReset)}</dd></div>
            <div><dt className="text-muted-foreground">{t("forecast.updated")}</dt><dd className="mt-1">{formatDate(data.updatedAt)}</dd></div>
          </dl>
        </> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-[11px]">
          <span>Data: <ExternalLink href={SOURCE_URL}>codex-reset.com</ExternalLink></span>
          {data ? <button type="button" className="flex items-center gap-1 text-muted-foreground hover:text-foreground" aria-expanded={expanded} aria-controls="forecast-details" onClick={() => setExpanded(!expanded)}>
            {t(expanded ? "forecast.hide_details" : "forecast.details")}<ChevronDown className={cn("h-3.5 w-3.5", expanded && "rotate-180")} aria-hidden="true" />
          </button> : null}
        </div>
        {expanded && data ? <div id="forecast-details" className="space-y-3 border-t border-border/60 pt-3 text-xs leading-relaxed">
          <p className="text-muted-foreground">{t("forecast.scope")}</p>
          {alert ? <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <p className="font-medium">{t(confirmed ? "forecast.confirmed" : expired ? "forecast.expired" : active ? "forecast.status_official" : "forecast.latest_alert")}</p>
            {alert.localizedSummary || alert.summary ? <p className="whitespace-pre-wrap break-words">{alert.localizedSummary || alert.summary}</p> : null}
            {alert.score != null ? <p>{t("forecast.signal_score", { score: alert.score })}</p> : null}
            {alert.window && (alert.window.startAt || alert.window.endAt) ? <p>{t("forecast.window", { start: formatDate(alert.window.startAt), end: formatDate(alert.window.endAt) })}</p> : null}
            {waiting ? <p className="text-warning">{t(windowEnded ? "forecast.window_ended" : "forecast.pending")}</p> : active && Number.isFinite(end) ? <p className="font-mono tabular-nums">{t("forecast.countdown", { time: countdown })}</p> : null}
            {confirmed ? <p>{t("forecast.confirmed_at", { time: formatDate(alert.observedAt ?? alert.confirmedAt ?? data.lastResetAt) })}</p> : null}
            {alert.url ? <ExternalLink href={alert.url}>{t("forecast.source")}</ExternalLink> : null}
          </div> : <p className="text-muted-foreground">{t("forecast.no_alert")}</p>}
          <p className="text-muted-foreground">{t("forecast.method")}</p>
          <ExternalLink href={METHOD_URL}>{t("forecast.method_link")}</ExternalLink>
        </div> : null}
      </CardContent>
    </Card>
  );
}
