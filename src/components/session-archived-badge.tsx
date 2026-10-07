import { Archive } from "lucide-react";
import { useTranslation } from "react-i18next";

export function SessionArchivedBadge({ path }: { path: string }) {
  const { t } = useTranslation();
  if (!/(^|[\\/])archived_sessions[\\/]/.test(path)) return null;

  return (
    <span
      data-testid="session-archived-badge"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold text-amber-700 dark:text-amber-300"
    >
      <Archive className="h-3 w-3" aria-hidden="true" />
      {t("sessions.archived")}
    </span>
  );
}
