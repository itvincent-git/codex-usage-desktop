import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OverviewResponse } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import {
  defaultProjectSortDirection,
  isPositivePeak,
  positivePeaks,
  projectCostTone,
  projectTokenBreakdown,
  sortProjects,
  type CostTone,
  type ProjectSort,
  type SortDirection,
} from "@/lib/project-analytics";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { projectLabel } from "@/lib/project-reference";

type ProjectUsageCardProps = {
  projects: OverviewResponse["projects"];
  onProjectClick?: (project: OverviewResponse["projects"][number]) => void;
};

const costToneClasses: Record<CostTone, string> = {
  zero: "bg-muted-foreground/25",
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-rose-500",
};

function Peak({ show, label }: { show: boolean; label: string }) {
  return show ? <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">{label}</span> : null;
}

export function ProjectUsageCard({ projects, onProjectClick }: ProjectUsageCardProps) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<ProjectSort>("total");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const sortedProjects = useMemo(() => sortProjects(projects, sort, direction), [direction, projects, sort]);
  const peaks = useMemo(() => positivePeaks(projects), [projects]);

  const changeSort = (value: ProjectSort) => {
    setSort(value);
    setDirection(defaultProjectSortDirection(value));
  };

  return (
    <Card data-testid="project-comparison">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground" aria-label={t("projects.token_legend")}>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-sky-500" />{t("projects.legend.uncached")}</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-500" />{t("projects.legend.cached")}</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-violet-500" />{t("projects.legend.output")}</span>
            <span className="text-emerald-600 dark:text-emerald-400">● {t("projects.legend.low_cost")}</span>
            <span className="text-amber-600 dark:text-amber-400">● {t("projects.legend.medium_cost")}</span>
            <span className="text-rose-600 dark:text-rose-400">● {t("projects.legend.high_cost")}</span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor="project-sort" className="shrink-0 text-xs text-muted-foreground">{t("projects.sort.label")}</label>
            <Select value={sort} onValueChange={(value) => changeSort(value as ProjectSort)}>
              <SelectTrigger id="project-sort" aria-label={t("projects.sort.label")} className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total">{t("projects.sort.total")}</SelectItem>
                <SelectItem value="name">{t("projects.sort.name")}</SelectItem>
                <SelectItem value="input">{t("projects.sort.input")}</SelectItem>
                <SelectItem value="cached">{t("projects.sort.cached")}</SelectItem>
                <SelectItem value="output">{t("projects.sort.output")}</SelectItem>
                <SelectItem value="cost">{t("projects.sort.cost")}</SelectItem>
              </SelectContent>
            </Select>
            <button type="button" onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-border bg-surface text-foreground transition hover:bg-muted focus:ring-2 focus:ring-indigo-500" aria-label={direction === "asc" ? t("projects.sort.ascending") : t("projects.sort.descending")}>
              {direction === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {projects.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">{t("projects.no_projects")}</p>
        ) : (
          <div className="overflow-x-auto px-4 sm:px-6">
            <table className="min-w-[900px] w-full border-separate border-spacing-0 text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <th className="w-[28%] border-b border-border py-3 font-medium">{t("projects.cols.project")}</th>
                <th className="w-[52%] border-b border-border px-4 py-3 font-medium">{t("projects.cols.composition")}</th>
                <th className="w-[20%] border-b border-border py-3 text-right font-medium">{t("projects.cols.cost")}</th>
              </tr></thead>
              <tbody>{sortedProjects.map((project) => {
                const parts = projectTokenBreakdown(project);
                const width = peaks.totalTokens > 0 ? project.totalTokens / peaks.totalTokens * 100 : 0;
                const segmentTotal = Math.max(parts.nonCachedInput + parts.cachedInput + parts.output, 1);
                const costWidth = peaks.costUSD > 0 ? project.costUSD / peaks.costUSD * 100 : 0;
                const costTone = projectCostTone(project.costUSD, peaks.costUSD);
                const cacheHitRate = project.inputTokens > 0 ? project.cachedInputTokens / project.inputTokens : 0;
                const activate = () => onProjectClick?.(project);
                const label = projectLabel(project);
                return <tr key={project.project} role={onProjectClick ? "button" : undefined} tabIndex={onProjectClick ? 0 : undefined} aria-label={onProjectClick ? t("projects.open_details", { project: label }) : undefined} onClick={activate} onKeyDown={(event) => {
                  if (onProjectClick && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); activate(); }
                }} className={cn("group align-top", onProjectClick && "cursor-pointer hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50")}>
                  <td className="border-b border-border/70 py-4 pr-4"><div className="flex min-w-0 items-center gap-2"><p className="truncate font-medium text-foreground group-hover:text-primary">{label}</p>{project.codexProjectName ? <span className="shrink-0 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-500">{t("projects.codex_project")}</span> : null}</div><p className="mt-1 break-all font-mono text-xs leading-5 text-muted-foreground">{project.project}</p></td>
                  <td className="border-b border-border/70 px-4 py-4">
                    <div className="mb-2.5 flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 font-semibold tabular-nums">{formatNumber(project.totalTokens)}<Peak show={isPositivePeak(project.totalTokens, peaks.totalTokens)} label={t("projects.highest")} /></span><span className="text-xs text-muted-foreground">{t("projects.relative_peak", { percent: Math.round(width) })}</span></div>
                    <div className="h-2.5 w-full rounded-full bg-muted"><div className="flex h-full overflow-hidden rounded-full" style={{ width: `${width}%` }} role="img" aria-label={t("projects.bar_label", { total: formatNumber(project.totalTokens), input: formatNumber(project.inputTokens), cached: formatNumber(project.cachedInputTokens), output: formatNumber(project.outputTokens) })}><span className="bg-sky-500" style={{ width: `${parts.nonCachedInput / segmentTotal * 100}%` }} /><span className="bg-emerald-500" style={{ width: `${parts.cachedInput / segmentTotal * 100}%` }} /><span className="bg-violet-500" style={{ width: `${parts.output / segmentTotal * 100}%` }} /></div></div>
                    <div className="mt-2.5 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                      <span>{t("projects.values.input")} <b className="text-foreground">{formatNumber(project.inputTokens)}</b> <Peak show={isPositivePeak(project.inputTokens, peaks.inputTokens)} label={t("projects.highest")} /></span>
                      <span>{t("projects.values.cached")} <b className="text-foreground">{formatNumber(project.cachedInputTokens)}</b> <span className="text-emerald-600 dark:text-emerald-400">({formatPercent(cacheHitRate)})</span> <Peak show={isPositivePeak(project.cachedInputTokens, peaks.cachedInputTokens)} label={t("projects.highest")} /></span>
                      <span>{t("projects.values.output")} <b className="text-foreground">{formatNumber(project.outputTokens)}</b> <Peak show={isPositivePeak(project.outputTokens, peaks.outputTokens)} label={t("projects.highest")} /></span>
                    </div>
                  </td>
                  <td className="border-b border-border/70 py-4 text-right tabular-nums"><div className="ml-auto w-full max-w-48 space-y-2"><div className="flex items-center justify-end gap-2 font-medium text-foreground">{formatCurrency(project.costUSD)}<Peak show={isPositivePeak(project.costUSD, peaks.costUSD)} label={t("projects.highest")} /></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", costToneClasses[costTone])} data-cost-tone={costTone} style={{ width: `${costWidth}%` }} /></div></div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
