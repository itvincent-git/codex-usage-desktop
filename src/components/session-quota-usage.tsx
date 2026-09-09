import { Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SessionQuotaUsage, SessionQuotaWindowUsage } from "@/lib/api";

type SessionQuotaUsageProps = {
  usage?: SessionQuotaUsage | null;
  detailed?: boolean;
};

function remainingPercent(window: SessionQuotaWindowUsage) {
  return Math.min(Math.max(100 - window.observedEndPercent, 0), 100);
}

function formatUsage(window: SessionQuotaWindowUsage, approximate: string) {
  return window.belowResolution
    ? "<1%"
    : `${approximate} ${Math.round(window.observedDeltaPercent)}%`;
}

function formatDetailedUsage(window: SessionQuotaWindowUsage) {
  return window.belowResolution ? "<1%" : `${Math.round(window.observedDeltaPercent)}%`;
}

function formatRemainingRange(window: SessionQuotaWindowUsage) {
  const start = Math.min(Math.max(100 - window.observedStartPercent, 0), 100);
  const end = Math.min(Math.max(100 - window.observedEndPercent, 0), 100);
  return `${Math.round(start)}% → ${Math.round(end)}%`;
}

function formatTime(value: string, locale: string) {
  return new Date(value).toLocaleString(locale);
}

function quotaTone(percent: number) {
  if (percent <= 0) {
    return {
      name: "empty",
      className: "border-rose-500/25 bg-rose-500/5 text-rose-700 dark:text-rose-300",
      fillClassName: "bg-rose-500/20",
    };
  }
  if (percent <= 33) {
    return {
      name: "low",
      className: "border-rose-500/25 bg-rose-500/5 text-rose-700 dark:text-rose-300",
      fillClassName: "bg-rose-500/20",
    };
  }
  if (percent <= 66) {
    return {
      name: "medium",
      className: "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300",
      fillClassName: "bg-amber-500/20",
    };
  }
  return {
    name: "high",
    className: "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
    fillClassName: "bg-emerald-500/20",
  };
}

export function SessionQuotaUsageView({ usage, detailed = false }: SessionQuotaUsageProps) {
  const { t, i18n } = useTranslation();
  const groups = [
    { key: "five_hour", label: t("sessions.quota.five_hour"), windows: usage?.fiveHour ?? [] },
    { key: "weekly", label: t("sessions.quota.weekly"), windows: usage?.weekly ?? [] },
  ];
  const caveat = t("sessions.quota.caveat");

  if (!detailed) {
    return (
      <div className="space-y-1 text-[10px] tabular-nums" aria-label={t("sessions.quota.aria_label")} title={caveat}>
        {groups.map((group) => (
          <div key={group.key} className="grid grid-cols-[auto_1fr] gap-x-2">
            <span className="font-semibold text-muted-foreground">{group.label}</span>
            {group.windows.length > 0 ? (
              <span className="flex min-w-0 flex-col items-end justify-center gap-1 font-semibold">
                {group.windows.map((window, index) => {
                  const fillPercent = remainingPercent(window);
                  const tone = quotaTone(fillPercent);
                  const usageValue = formatUsage(window, t("sessions.quota.approx"));
                  const percentValue = `${Math.round(fillPercent)}%`;
                  const value = t("sessions.quota.usage_and_remaining", {
                    usage: usageValue,
                    remaining: percentValue,
                  });
                  return (
                    <span
                      key={`${window.observedStartAt}-${index}`}
                      role="img"
                      aria-label={t("sessions.quota.usage_label", {
                        window: group.label,
                        usage: usageValue,
                        remaining: percentValue,
                      })}
                      data-quota-tone={tone.name}
                      className={`relative isolate inline-flex min-w-[3rem] justify-end overflow-hidden rounded border px-1 py-px ${tone.className}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute inset-y-0 left-0 -z-10 ${tone.fillClassName}`}
                        style={{ width: `${fillPercent}%`, minWidth: fillPercent > 0 ? 2 : undefined }}
                      />
                      <span className="relative whitespace-nowrap">{value}</span>
                    </span>
                  );
                })}
              </span>
            ) : <span className="min-w-0 text-right font-semibold text-muted-foreground">--</span>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="flex flex-wrap items-start gap-x-4 gap-y-1 text-[11px]" aria-labelledby="session-quota-title" title={caveat}>
      <div className="flex items-center gap-1.5 py-0.5">
        <Clock3 className="h-3.5 w-3.5 text-amber-500" />
        <h3 id="session-quota-title" className="font-semibold">{t("sessions.quota.title")}</h3>
        <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">{t("sessions.quota.estimated")}</span>
      </div>
      <div className="flex flex-1 flex-wrap gap-x-4 gap-y-1">
        {groups.map((group) => (
          <div key={group.key} className="flex items-baseline gap-2 py-0.5">
            <div className="shrink-0 font-semibold text-muted-foreground">{group.label}</div>
            {group.windows.length === 0 ? (
              <div className="font-bold text-muted-foreground">--</div>
            ) : (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {group.windows.map((window, index) => (
                  <div key={index} className="text-muted-foreground" title={`${formatTime(window.observedStartAt, i18n.language)} – ${formatTime(window.observedEndAt, i18n.language)}\n${t("sessions.quota.resets", { value: window.resetsAt ? formatTime(window.resetsAt, i18n.language) : "--" })}`}>
                    <span className="font-bold text-foreground">
                      {t("sessions.quota.used_and_remaining_change", {
                        usage: formatDetailedUsage(window),
                        remaining: formatRemainingRange(window),
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="sr-only">{caveat}</p>
    </section>
  );
}
