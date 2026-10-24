import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { openUrl, type CodexQuotaForecastResponse, type CodexResetAnnouncement } from "@/lib/api";
import { cn } from "@/lib/utils";

const SOURCE_URL = "https://codex-reset.com/";
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
  const formatDate = (value?: string | null) => {
    if (!value || !Number.isFinite(Date.parse(value))) return t("forecast.unknown");
    return new Date(value).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  };

  useEffect(() => {
    if (!data) return;
    const delay = end > now ? Math.min(30_000, end - now) : 30_000;
    const timer = window.setTimeout(() => refreshClock((tick) => tick + 1), delay);
    return () => window.clearTimeout(timer);
  }, [data, end, now]);

  return (
    <Card data-testid="global-reset-forecast" className="min-w-0 rounded-lg">
      <CardContent className="space-y-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("forecast.title")}</h2>
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isRefreshing} aria-label={t(error && !data ? "forecast.retry" : "forecast.refresh")}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isRefreshing && "animate-spin")} aria-hidden="true" />
            {t(error && !data ? "forecast.retry" : "forecast.refresh")}
          </Button>
        </div>
        {error ? <p role="alert" className="text-xs text-warning">{t(data ? "forecast.refresh_failed" : "forecast.load_failed")}</p> : null}
        {!data && !error ? <p role="status" className="text-xs text-muted-foreground">{t("forecast.loading")}</p> : null}
        {data ? <>
          <div data-testid="forecast-announcement" className={cn("space-y-2 rounded-md border p-3 text-xs leading-relaxed", promised && !stale ? "border-warning/30 bg-warning/5" : "border-border bg-muted/20")}>
            <p data-testid="forecast-status" role="status" className="text-sm font-semibold">{t(`forecast.status_${status}`)}</p>
            <p className="text-muted-foreground">{t(`forecast.description_${status}`)}</p>
            {showEvidence ? <>
              {alert?.localizedSummary || alert?.summary ? <p className="whitespace-pre-wrap break-words">{alert.localizedSummary || alert.summary}</p> : null}
              {!pending && validWindow ? <p>{t("forecast.window", { start: formatDate(alert?.window?.startAt), end: formatDate(alert?.window?.endAt) })}</p> : null}
            </> : !stale && (windowEnded || alert?.state === "expired") && !answered ? <p className="text-muted-foreground">{t("forecast.expired")}</p> : null}
          </div>
          {showEvidence ? <section aria-label={t("forecast.evidence_title")} className="space-y-2 text-xs">
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
          <p className="text-[11px] text-muted-foreground">{t("forecast.updated", { time: formatDate(data.updatedAt) })}</p>
        </> : null}
        {data ? <section aria-label={t("forecast.feed_title")} className="space-y-2 border-t border-border/60 pt-3 text-xs">
          <h3 className="font-semibold">{t("forecast.feed_title")}</h3>
          <p className="text-[11px] text-muted-foreground">{t("forecast.feed_note")}</p>
          {data.recentPosts == null ? <p className="text-muted-foreground">{t("forecast.feed_unavailable")}</p>
            : data.recentPosts.length === 0 ? <p className="text-muted-foreground">{t("forecast.feed_empty")}</p>
            : <>
              {evidenceStale || error ? <p role="status" className="text-warning">{t("forecast.feed_stale")}</p> : null}
              <ul className="space-y-2">
                {data.recentPosts.map((post) => <li key={post.id} className="space-y-1.5 rounded-md border border-border/60 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <time dateTime={post.at} className="text-muted-foreground">{formatDate(post.at)}</time>
                    <ExternalLink href={post.url}>{t("forecast.post_link")} ↗</ExternalLink>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{post.text}</p>
                </li>)}
              </ul>
            </>}
          {data.evidenceUpdatedAt ? <p className="text-[11px] text-muted-foreground">{t("forecast.feed_updated", { time: formatDate(data.evidenceUpdatedAt) })}</p> : null}
        </section> : null}
        <div className="border-t border-border/60 pt-3 text-[11px]">
          Data: <ExternalLink href={SOURCE_URL}>codex-reset.com</ExternalLink>
        </div>
      </CardContent>
    </Card>
  );
}
