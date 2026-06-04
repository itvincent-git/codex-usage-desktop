import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { useTranslation } from "react-i18next";

type ProjectUsageCardProps = {
  projects: OverviewResponse["projects"];
  onProjectClick?: (project: OverviewResponse["projects"][number]) => void;
};

export function ProjectUsageCard({ projects, onProjectClick }: ProjectUsageCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("projects.card_title")}</CardTitle>
        <CardDescription>{t("projects.card_subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("projects.no_projects", { defaultValue: "No project activity in this window." })}</p>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="min-w-52 border-b border-border px-0 pb-3 font-medium">{t("projects.cols.project")}</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">{t("projects.cols.tokens", { defaultValue: "Total Tokens" })}</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">{t("project_modal.input", { defaultValue: "Input" })}</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">{t("common.cache")}</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">{t("project_modal.output", { defaultValue: "Output" })}</th>
                  <th className="border-b border-border px-0 pb-3 text-right font-medium">{t("projects.cols.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    key={project.project}
                    className={`align-top group ${
                      onProjectClick
                        ? "cursor-pointer transition-colors duration-150 hover:bg-muted/40"
                        : ""
                    }`}
                    onClick={() => onProjectClick?.(project)}
                  >
                    <td className="border-b border-border/70 px-0 py-4">
                      <div className="max-w-72 space-y-1">
                        <div className="truncate font-medium text-foreground transition-colors group-hover:text-primary">
                          {project.displayName}
                        </div>
                        <div className="break-all text-xs leading-5 text-muted-foreground">{project.project}</div>
                      </div>
                    </td>
                    <td className="border-b border-border/70 px-3 py-4 text-right tabular-nums text-foreground">
                      {formatNumber(project.totalTokens)}
                    </td>
                    <td className="border-b border-border/70 px-3 py-4 text-right tabular-nums text-foreground">
                      {formatNumber(project.inputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-3 py-4 text-right tabular-nums text-muted-foreground">
                      {formatNumber(project.cachedInputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-3 py-4 text-right tabular-nums text-foreground">
                      {formatNumber(project.outputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-0 py-4 text-right tabular-nums font-medium text-foreground">
                      {formatCurrency(project.costUSD)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
