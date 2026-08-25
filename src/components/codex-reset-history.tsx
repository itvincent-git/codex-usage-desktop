import dayjs, { type Dayjs } from "dayjs";
import { ChevronDown, ChevronUp, ExternalLink, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchCodexResetHistory, openUrl, type CodexResetAnnouncement } from "@/lib/api";

const HISTORY_DAYS = 30;
const DEFAULT_VISIBLE_RESETS = 5;

type CalendarDay = {
  date: Dayjs;
  inRange: boolean;
  resets: CodexResetAnnouncement[];
  resetType: CodexResetAnnouncement["resetType"] | "mixed" | null;
};

export type ResetHistorySummary = {
  resets: CodexResetAnnouncement[];
  averageIntervalDays: number | null;
  longestIntervalDays: number | null;
  calendarDays: CalendarDay[];
};

export function buildResetHistorySummary(
  resets: CodexResetAnnouncement[],
  now: Dayjs = dayjs(),
): ResetHistorySummary {
  const sortedResets = [...resets].sort(
    (left, right) => dayjs(right.announcedAt).valueOf() - dayjs(left.announcedAt).valueOf(),
  );
  const intervals = sortedResets.slice(0, -1).map((reset, index) =>
    dayjs(reset.announcedAt).diff(sortedResets[index + 1].announcedAt, "minute", true) / (60 * 24),
  );
  const startDate = now.startOf("day").subtract(HISTORY_DAYS - 1, "day");
  const endDate = now.endOf("day");
  const resetsByDate = new Map<string, CodexResetAnnouncement[]>();

  for (const reset of sortedResets) {
    const key = dayjs(reset.announcedAt).format("YYYY-MM-DD");
    const existing = resetsByDate.get(key);
    if (existing) existing.push(reset);
    else resetsByDate.set(key, [reset]);
  }

  const calendarDays: CalendarDay[] = [];
  let date = startDate.startOf("week");
  const calendarEnd = endDate.endOf("week");
  while (!date.isAfter(calendarEnd, "day")) {
    const dayResets = resetsByDate.get(date.format("YYYY-MM-DD")) ?? [];
    const resetTypes = new Set(dayResets.map((reset) => reset.resetType));
    calendarDays.push({
      date,
      inRange: !date.isBefore(startDate, "day") && !date.isAfter(endDate, "day"),
      resets: dayResets,
      resetType: resetTypes.size > 1 ? "mixed" : dayResets[0]?.resetType ?? null,
    });
    date = date.add(1, "day");
  }

  return {
    resets: sortedResets,
    averageIntervalDays: intervals.length
      ? intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length
      : null,
    longestIntervalDays: intervals.length ? Math.max(...intervals) : null,
    calendarDays,
  };
}

function formatDays(value: number | null, format: (value: number) => string) {
  return value === null ? "—" : format(Math.round(value * 10) / 10);
}

function formatRelativeTime(timestamp: string, locale: string, now = dayjs()) {
  const elapsedMinutes = Math.max(0, now.diff(timestamp, "minute"));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (elapsedMinutes < 60) return formatter.format(-elapsedMinutes, "minute");
  if (elapsedMinutes < 24 * 60) return formatter.format(-Math.floor(elapsedMinutes / 60), "hour");
  return formatter.format(-Math.floor(elapsedMinutes / (24 * 60)), "day");
}

export function LatestResetButton({ reset, onOpen }: { reset: CodexResetAnnouncement; onOpen: () => void }) {
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

function MetricCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] opacity-65">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

function ResetCalendar({ summary }: { summary: ResetHistorySummary }) {
  const { t, i18n } = useTranslation();
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    dayjs().startOf("week").add(index, "day").toDate().toLocaleDateString(i18n.resolvedLanguage, { weekday: "short" }),
  );
  const firstDay = summary.calendarDays.find((day) => day.inRange)?.date;
  const lastDay = [...summary.calendarDays].reverse().find((day) => day.inRange)?.date;

  return (
    <section className="mt-5" aria-labelledby="reset-calendar-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 id="reset-calendar-title" className="text-sm font-bold">{t("limits.reset_calendar_title")}</h4>
          <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
            {firstDay?.format("YYYY-MM-DD")} – {lastDay?.format("YYYY-MM-DD")}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground" aria-label={t("limits.reset_calendar_legend")}>
          {(["regular", "banked", "none"] as const).map((type) => (
            <span key={type} className="inline-flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-[4px] border ${type === "regular" ? "border-orange-500 bg-orange-500" : type === "banked" ? "border-sky-500 bg-sky-300" : "border-border bg-muted/70"}`} />
              {type === "none" ? t("limits.reset_type_none") : t(`limits.reset_type_${type}`)}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-background/35 p-3">
        <div className="min-w-[320px]">
          <div className="mb-1.5 grid grid-cols-7 gap-1.5 text-center text-[9px] text-muted-foreground">
            {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {summary.calendarDays.map((day) => {
              const latestReset = day.resets[0];
              const resetLabel = day.resets.length
                ? day.resets.map((reset) => t(`limits.reset_type_${reset.resetType}`)).join(", ")
                : t("limits.reset_type_none");
              const label = t("limits.reset_calendar_day_label", {
                date: day.date.format("YYYY-MM-DD"),
                status: resetLabel,
              });
              const color = day.resetType === "mixed"
                ? "border-orange-500 bg-gradient-to-br from-orange-500 from-50% to-sky-300 to-50%"
                : day.resetType === "regular"
                  ? "border-orange-500 bg-orange-500"
                  : day.resetType === "banked"
                    ? "border-sky-500 bg-sky-300"
                    : "border-border bg-muted/70";

              if (!day.inRange) return <span key={day.date.format("YYYY-MM-DD")} className="h-9" aria-hidden="true" />;
              return latestReset ? (
                <button
                  key={day.date.format("YYYY-MM-DD")}
                  type="button"
                  data-testid="reset-history-day"
                  data-reset-type={day.resetType}
                  className={`flex h-9 items-center justify-center rounded-md border text-[10px] font-semibold tabular-nums shadow-sm transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring ${day.resetType === "regular" || day.resetType === "mixed" ? "text-white" : "text-foreground"} ${color}`}
                  aria-label={label}
                  title={label}
                  onClick={() => void openUrl(latestReset.source.url)}
                >
                  {day.date.date()}
                </button>
              ) : (
                <span
                  key={day.date.format("YYYY-MM-DD")}
                  data-testid="reset-history-day"
                  data-reset-type="none"
                  className={`flex h-9 items-center justify-center rounded-md border text-[10px] tabular-nums text-muted-foreground ${color}`}
                  aria-label={label}
                  title={label}
                >
                  {day.date.date()}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function ResetAnnouncements({ resets }: { resets: CodexResetAnnouncement[] }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const visibleResets = isExpanded ? resets : resets.slice(0, DEFAULT_VISIBLE_RESETS);
  const canExpand = resets.length > DEFAULT_VISIBLE_RESETS;

  return (
    <section className="mt-5" aria-labelledby="reset-announcements-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 id="reset-announcements-title" className="text-sm font-bold">
            {t("limits.reset_announcements_title")}
          </h4>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {t("limits.reset_announcements_count", { visible: visibleResets.length, total: resets.length })}
          </p>
        </div>
        {canExpand ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((expanded) => !expanded)}
          >
            {isExpanded ? t("limits.reset_announcements_collapse") : t("limits.reset_announcements_expand")}
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>

      <ol className="mt-3 space-y-2">
        {visibleResets.map((reset) => (
          <li key={reset.id} className="rounded-xl border border-border bg-background/35 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${reset.resetType === "banked" ? "bg-sky-300/25 text-sky-700 dark:text-sky-300" : "bg-orange-500/10 text-orange-600 dark:text-orange-400"}`}>
                {t(`limits.reset_type_${reset.resetType}`)}
              </span>
              <time className="text-[10px] tabular-nums text-muted-foreground" dateTime={reset.announcedAt}>
                {dayjs(reset.announcedAt).format("YYYY-MM-DD HH:mm")}
              </time>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">{reset.text}</p>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void openUrl(reset.source.url)}
            >
              @{reset.source.author} · {t("limits.reset_history_source")}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ResetHistoryContent({ resets }: { resets: CodexResetAnnouncement[] }) {
  const { t, i18n } = useTranslation();
  const summary = useMemo(() => buildResetHistorySummary(resets), [resets]);
  const latestReset = summary.resets[0];
  const locale = i18n.resolvedLanguage ?? i18n.language;

  return (
    <>
      <section className="rounded-xl border border-border bg-background/35 p-4">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{t("limits.latest_reset")}</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-bold tracking-tight">{formatRelativeTime(latestReset.announcedAt, locale)}</p>
            <time className="mt-1 block text-[10px] tabular-nums text-muted-foreground" dateTime={latestReset.announcedAt}>
              {dayjs(latestReset.announcedAt).format("YYYY-MM-DD HH:mm")}
            </time>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500 px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-orange-600 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void openUrl(latestReset.source.url)}
          >
            @{latestReset.source.author}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </section>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <MetricCard label={t("limits.reset_count")} value={String(summary.resets.length)} tone="border-amber-300/70 bg-amber-300/20" />
        <MetricCard label={t("limits.reset_average_interval")} value={formatDays(summary.averageIntervalDays, (value) => t("limits.reset_days_short", { value }))} tone="border-rose-300/70 bg-rose-300/20" />
        <MetricCard label={t("limits.reset_longest_wait")} value={formatDays(summary.longestIntervalDays, (value) => t("limits.reset_days_short", { value }))} tone="border-sky-300/70 bg-sky-300/20" />
      </div>

      <ResetCalendar summary={summary} />
      <ResetAnnouncements resets={summary.resets} />
    </>
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
    const request = requestRef.current ?? fetchCodexResetHistory(HISTORY_DAYS);
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
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface/95 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 bg-muted/20 px-5 py-4">
          <div>
            <h3 id="codex-reset-history-title" className="text-lg font-bold text-foreground">{t("limits.reset_history_title")}</h3>
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
            <p className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error">{t("limits.reset_history_error")}</p>
          ) : resets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t("limits.reset_history_empty")}</p>
          ) : (
            <ResetHistoryContent resets={resets} />
          )}
        </div>
      </div>
    </div>
  );
}
