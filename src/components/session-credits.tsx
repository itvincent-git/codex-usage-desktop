import { useTranslation } from "react-i18next";
import type { SessionCreditsRow } from "@/lib/api";
import { formatSessionCredits } from "@/lib/session-credits";

export function SessionCredits({ row, loading, error, hasThreadId }: {
  row?: SessionCreditsRow; loading: boolean; error: string | null; hasThreadId: boolean;
}) {
  const { t } = useTranslation();
  const amount = row?.dataStatus !== "unavailable" ? row?.balanceUsageCredits : null;
  const reason = !hasThreadId ? "invalidThread" : error ?? "unavailable";
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground" data-testid="session-credits"
    title={[t("session_credits.description"), amount, row?.dataAsOf ? `${t("session_credits.data_as_of")}: ${row.dataAsOf}` : null,
      amount?.startsWith("-") ? t("session_credits.adjustment") : null, !amount || error ? t(`session_credits.errors.${reason}`) : null].filter(Boolean).join("\n")}>
    <span>{t("session_credits.label")}</span>
    <strong className="font-semibold tabular-nums text-foreground">{amount != null ? `${formatSessionCredits(amount)} credits` : loading && !row && hasThreadId ? t("session_credits.loading") : "—"}</strong>
    {row?.dataStatus === "partial" ? <span>{t("session_credits.partial")}</span> : null}
    {row?.stale && amount != null ? <span>{t("session_credits.cached")}</span> : null}
    {row?.isMock ? <span className="text-amber-600">{t("session_credits.mock")}</span> : null}
  </div>;
}
