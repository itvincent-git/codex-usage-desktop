import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { openUrl, type CodexQuotaForecastResponse, type CodexResetAnnouncement } from "@/lib/api";
import { cn } from "@/lib/utils";

const MAX_SIGNAL_AGE_MS = 5 * 60_000;

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="text-primary underline-offset-4 hover:underline" href={href} target="_blank" rel="noreferrer" onClick={(event) => {
    event.preventDefault();
    void openUrl(href).catch((error) => console.error("Failed to open forecast link", error));
  }}>{children}</a>;
}

export function CodexForecastCard({ data, error, isRefreshing, onRefresh, resets }: {
  data: CodexQuotaForecastResponse | null;
  error: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  resets?: CodexResetAnnouncement[] | null;
}) {
  const { t, i18n } = useTranslation();
  const [, refreshClock] = useState(0);
  const now = Date.now();
  const alert = data?.latestAlert;
  const end = Date.parse(alert?.window?.endAt ?? "");
  const start = Date.parse(alert?.window?.startAt ?? "");
  const sourceAt = Date.parse(alert?.sourceAt ?? "");
  const updatedAt = Date.parse(data?.updatedAt ?? "");
  const stale = !!error || !Number.isFinite(updatedAt) || now - updatedAt >= MAX_SIGNAL_AGE_MS;
  const answered = Number.isFinite(sourceAt) && (
    Date.parse(data?.lastResetAt ?? "") >= sourceAt
    || resets?.some((reset) => reset.resetType === "regular" && Date.parse(reset.announcedAt) >= sourceAt)
  );
  const pending = alert?.pending === "done" || alert?.pending === "on_its_way";
  const windowEnded = Number.isFinite(end) && end <= now;
  const validWindow = Number.isFinite(end) && !windowEnded && (!Number.isFinite(start) || start <= end);
  const watch = alert?.kind === "watch" && alert.state === "active" && !!alert.url
    && Number.isFinite(sourceAt) && sourceAt <= now && !answered;
  const promised = watch && data?.hasOfficialSignal && !pending && !windowEnded
    && (alert.score === 83 || (alert.score === 93 && validWindow));
  const status = stale ? "stale" : watch && pending ? "pending"
    : promised ? validWindow ? "timed" : "untimed" : "no_signal";
  const showEvidence = watch && (pending || promised);
  const posts = data?.evidencePosts;
  const original = posts?.find((post) => post.id === alert?.id || post.url === alert?.url);
  const contextMissing = !original || posts?.some((post) => post.isReply
    && (!post.replyToId || !posts.some((parent) => parent.id === post.replyToId)));
  const evidenceStale = data?.evidenceStale || !Number.isFinite(Date.parse(data?.evidenceUpdatedAt ?? ""))
    || now - Date.parse(data?.evidenceUpdatedAt ?? "") >= MAX_SIGNAL_AGE_MS;
  const formatDate = (value?: string | null, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) => {
    if (!value || !Number.isFinite(Date.parse(value))) return t("forecast.unknown");
    return new Date(value).toLocaleString(i18n.language, options);
  };
  const compactDate: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false };
  const feedDate = data?.recentPosts?.length && data.recentPosts.every((post) =>
    formatDate(post.at, { dateStyle: "medium" }) === formatDate(data.recentPosts![0].at, { dateStyle: "medium" })
  ) ? formatDate(data.recentPosts[0].at, { dateStyle: "medium" }) : null;

  useEffect(() => {
    if (!data) return;
    const delay = end > now ? Math.min(30_000, end - now) : 30_000;
    const timer = window.setTimeout(() => refreshClock((tick) => tick + 1), delay);
    return () => window.clearTimeout(timer);
  }, [data, end, now]);

  return (
    <Card data-testid="global-reset-forecast" className="min-w-0 rounded-lg">
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><RotateCcw className="h-5 w-5 text-primary" aria-hidden="true" />{t("forecast.title")}</h2>
          <Button variant="ghost" size="sm" className="bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary" onClick={onRefresh} disabled={isRefreshing} aria-label={t(error && !data ? "forecast.retry" : "forecast.refresh")}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isRefreshing && "animate-spin")} aria-hidden="true" />
            {t(error && !data ? "forecast.retry" : "forecast.refresh")}
          </Button>
        </div>
        {error ? <p role="alert" className="text-xs text-warning">{t(data ? "forecast.refresh_failed" : "forecast.load_failed")}</p> : null}
        {!data ? (
          <div data-testid="forecast-skeleton" role="status" aria-label={t("forecast.loading")}>
            <div aria-hidden="true" className="grid min-w-0 gap-4 motion-safe:animate-pulse lg:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]">
              <div className="space-y-4 rounded-xl border border-border p-4">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-5 w-3/4 rounded bg-muted" />
                <div className="h-3 w-full rounded bg-muted" />
                <div className="h-3 w-2/3 rounded bg-muted" />
              </div>
              <div className="space-y-3">
                <div className="h-4 w-32 rounded bg-muted" />
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="flex gap-3 border-b border-border/60 py-2.5">
                    <div className="h-3 w-12 shrink-0 rounded bg-muted" />
                    <div className="h-3 flex-1 rounded bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        {data ? <>
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]">
            <div data-testid="forecast-announcement" className={cn("min-w-0 space-y-3 rounded-xl border p-4 text-xs leading-relaxed", stale ? "border-border bg-muted/20" : pending && watch ? "border-success/30 bg-success/5" : promised ? "border-primary/25 bg-primary/5" : "border-warning/30 bg-warning/5")}>
              <p className="text-muted-foreground">{t("forecast.status_label")}</p>
              <p data-testid="forecast-status" role="status" className={cn("flex items-start gap-2 text-base font-semibold", stale ? "text-muted-foreground" : pending && watch ? "text-success" : promised ? "text-primary" : "text-amber-700 dark:text-amber-400")}>
                <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", stale ? "bg-muted-foreground" : pending && watch ? "bg-success" : promised ? "bg-primary" : "bg-warning")} aria-hidden="true" />
                {t(`forecast.status_${status}`)}
              </p>
              <p className="text-muted-foreground">{t(`forecast.description_${status}`)}</p>
              {showEvidence ? <>
                {alert?.localizedSummary || alert?.summary ? <p className="whitespace-pre-wrap break-words">{alert.localizedSummary || alert.summary}</p> : null}
                {!pending && validWindow ? <p className="font-medium text-primary">{t("forecast.window", { start: formatDate(alert?.window?.startAt), end: formatDate(alert?.window?.endAt) })}</p> : null}
              </> : !stale && (windowEnded || alert?.state === "expired") && !answered ? <p className="text-muted-foreground">{t("forecast.expired")}</p> : null}
              <p className="border-t border-border/60 pt-3 text-[11px] text-muted-foreground">{t("forecast.updated", { time: formatDate(data.updatedAt, compactDate) })}</p>
            </div>
            <section aria-label={t("forecast.feed_title")} className="min-w-0 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{t("forecast.feed_title")}</h3>
                {feedDate ? <span className="text-[11px] text-muted-foreground">{feedDate}</span> : null}
              </div>
              {data.recentPosts == null ? <p className="text-muted-foreground">{t("forecast.feed_unavailable")}</p>
                : data.recentPosts.length === 0 ? <p className="text-muted-foreground">{t("forecast.feed_empty")}</p>
                : <>
                  {evidenceStale || error ? <p role="status" className="text-warning">{t("forecast.feed_stale")}</p> : null}
                  <ul className="divide-y divide-border/60">
                    {data.recentPosts.map((post) => <li key={post.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-2 py-2.5 leading-5 first:rounded-md first:bg-primary/5">
                      <time dateTime={post.at} title={formatDate(post.at)} className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{formatDate(post.at, feedDate ? { hour: "2-digit", minute: "2-digit", hour12: false } : compactDate)}</time>
                      <p className="whitespace-pre-wrap break-words">{post.text}</p>
                      <span className="whitespace-nowrap"><ExternalLink href={post.url}>{t("forecast.post_link")} ↗</ExternalLink></span>
                    </li>)}
                  </ul>
                </>}
            </section>
          </div>
          {showEvidence ? <section aria-label={t("forecast.evidence_title")} className="space-y-2 border-t border-border/60 pt-3 text-xs">
            <h3 className="font-semibold">{t("forecast.evidence_title")}</h3>
            <p className="text-[11px] text-muted-foreground">{t("forecast.evidence_via")}</p>
            <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
              <div><dt className="text-muted-foreground">{t("forecast.published")}</dt><dd className="mt-1">{formatDate(alert?.sourceAt)}</dd></div>
              <div><dt className="text-muted-foreground">{t("forecast.source")}</dt><dd className="mt-1"><ExternalLink href={alert!.url!}>@thsottiaux ↗</ExternalLink></dd></div>
            </dl>
            {!pending && alert?.window ? <p className="text-muted-foreground">{t("forecast.original_window", { label: alert.window.label ?? t("forecast.unknown"), zone: alert.window.timeZone ?? t("forecast.unknown") })}</p> : null}
            {evidenceStale ? <p role="status" className="text-warning">{t("forecast.evidence_stale")}</p> : null}
            {contextMissing ? <p className="text-warning">{t(posts == null ? "forecast.evidence_unavailable" : "forecast.context_missing")}</p> : null}
            {original ? <ul className="space-y-2">
              {posts!.map((post) => <li key={post.id} className="space-y-1.5 rounded-md border border-border/60 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-medium">{t(post.id === original.id ? "forecast.original_post" : "forecast.context_post")}</span>
                  <time dateTime={post.at} className="text-muted-foreground">{formatDate(post.at)}</time>
                </div>
                <blockquote className="whitespace-pre-wrap break-words">{post.text}</blockquote>
                <ExternalLink href={post.url}>{t("forecast.post_link")} ↗</ExternalLink>
              </li>)}
            </ul> : null}
            {data.evidenceUpdatedAt ? <p className="text-[11px] text-muted-foreground">{t("forecast.evidence_updated", { time: formatDate(data.evidenceUpdatedAt) })}</p> : null}
            {!pending && alert?.score != null ? <p className="text-[11px] text-muted-foreground">{t("forecast.signal_score", { score: alert.score })}</p> : null}
          </section> : null}
        </> : null}
      </CardContent>
    </Card>
  );
}
