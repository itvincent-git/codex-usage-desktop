import { Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SessionQuotaUsage, SessionQuotaWindowUsage } from "@/lib/api";

type SessionQuotaUsageProps = {
  usage?: SessionQuotaUsage | null;
  detailed?: boolean;
};

function formatDelta(window: SessionQuotaWindowUsage, approximate: string) {
  return window.belowResolution
    ? "<1%"
    : `${approximate} +${Math.round(window.observedDeltaPercent)}%`;
}

function formatTime(value: string, locale: string) {
  return new Date(value).toLocaleString(locale);
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
            <span className="min-w-0 text-right font-semibold text-foreground">
              {group.windows.length > 0
                ? group.windows.map((window) => formatDelta(window, t("sessions.quota.approx"))).join(" / ")
                : "--"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3" aria-labelledby="session-quota-title">
      <div className="flex items-center gap-2">
        <Clock3 className="h-4 w-4 text-amber-500" />
        <h3 id="session-quota-title" className="text-sm font-bold">{t("sessions.quota.title")}</h3>
        <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">{t("sessions.quota.estimated")}</span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.key} className="rounded-md border border-border/50 bg-background/60 p-2">
            <div className="mb-1 text-xs font-semibold">{group.label}</div>
            {group.windows.length === 0 ? (
              <div className="text-sm font-bold text-muted-foreground">--</div>
            ) : (
              <div className="space-y-1.5">
                {group.windows.map((window, index) => (
                  <div key={index} className="text-xs text-muted-foreground">
                    <span className="font-bold text-foreground">{formatDelta(window, t("sessions.quota.approx"))}</span>
                    <span className="ml-2">{formatTime(window.observedStartAt, i18n.language)} – {formatTime(window.observedEndAt, i18n.language)}</span>
                    <div>{t("sessions.quota.resets", { value: window.resetsAt ? formatTime(window.resetsAt, i18n.language) : "--" })}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{caveat}</p>
    </section>
  );
}
