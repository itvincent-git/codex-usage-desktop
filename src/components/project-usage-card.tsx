import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

type ProjectUsageCardProps = {
  projects: OverviewResponse["projects"];
  onProjectClick?: (project: OverviewResponse["projects"][number]) => void;
};

const costToneClasses: Record<CostTone, string> = {
  zero: "bg-muted text-muted-foreground",
  low: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  high: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

function Peak({ show, label }: { show: boolean; label: string }) {
  return show ? <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">{label}</span> : null;
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
      <CardHeader className="gap-4 border-b border-border/60 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label={t("projects.token_legend")}>
            <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />{t("projects.legend.uncached")}</span>
            <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />{t("projects.legend.cached")}</span>
            <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-violet-500" />{t("projects.legend.output")}</span>
            <span className="text-emerald-600 dark:text-emerald-400">● {t("projects.legend.low_cost")}</span>
            <span className="text-amber-600 dark:text-amber-400">● {t("projects.legend.medium_cost")}</span>
            <span className="text-rose-600 dark:text-rose-400">● {t("projects.legend.high_cost")}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="project-sort" className="text-muted-foreground">{t("projects.sort.label")}</label>
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
            <Button type="button" variant="secondary" size="icon" onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")} className="h-9 w-9 text-muted-foreground" aria-label={direction === "asc" ? t("projects.sort.ascending") : t("projects.sort.descending")}>
              {direction === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {projects.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{t("projects.no_projects")}</p>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="min-w-[900px] w-full border-separate border-spacing-0 text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="w-[28%] border-b border-border py-3 font-medium">{t("projects.cols.project")}</th>
                <th className="w-[52%] border-b border-border px-5 py-3 font-medium">{t("projects.cols.composition")}</th>
                <th className="w-[20%] border-b border-border py-3 font-medium">{t("projects.cols.cost")}</th>
              </tr></thead>
              <tbody>{sortedProjects.map((project) => {
                const parts = projectTokenBreakdown(project);
                const width = peaks.totalTokens > 0 ? project.totalTokens / peaks.totalTokens * 100 : 0;
                const segmentTotal = Math.max(parts.nonCachedInput + parts.cachedInput + parts.output, 1);
                const costWidth = peaks.costUSD > 0 ? project.costUSD / peaks.costUSD * 100 : 0;
                const costTone = projectCostTone(project.costUSD, peaks.costUSD);
                const cacheHitRate = project.inputTokens > 0 ? project.cachedInputTokens / project.inputTokens : 0;
                const activate = () => onProjectClick?.(project);
                return <tr key={project.project} role={onProjectClick ? "button" : undefined} tabIndex={onProjectClick ? 0 : undefined} aria-label={onProjectClick ? t("projects.open_details", { project: project.displayName }) : undefined} onClick={activate} onKeyDown={(event) => {
                  if (onProjectClick && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); activate(); }
                }} className={cn("group align-top", onProjectClick && "cursor-pointer hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50")}>
                  <td className="border-b border-border/70 py-4 pr-5"><p className="truncate font-semibold text-foreground group-hover:text-primary">{project.displayName}</p><p className="mt-1 break-all font-mono text-[10px] leading-4 text-muted-foreground">{project.project}</p></td>
                  <td className="border-b border-border/70 px-5 py-4">
                    <div className="mb-2 flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 font-bold tabular-nums">{formatNumber(project.totalTokens)}<Peak show={isPositivePeak(project.totalTokens, peaks.totalTokens)} label={t("projects.highest")} /></span><span className="text-[10px] text-muted-foreground">{t("projects.relative_peak", { percent: Math.round(width) })}</span></div>
                    <div className="h-2.5 w-full rounded-full bg-muted"><div className="flex h-full overflow-hidden rounded-full" style={{ width: `${width}%` }} role="img" aria-label={t("projects.bar_label", { total: formatNumber(project.totalTokens), input: formatNumber(project.inputTokens), cached: formatNumber(project.cachedInputTokens), output: formatNumber(project.outputTokens) })}><span className="bg-sky-500" style={{ width: `${parts.nonCachedInput / segmentTotal * 100}%` }} /><span className="bg-emerald-500" style={{ width: `${parts.cachedInput / segmentTotal * 100}%` }} /><span className="bg-violet-500" style={{ width: `${parts.output / segmentTotal * 100}%` }} /></div></div>
                    <div className="mt-2 grid grid-cols-3 gap-3 text-[10px] text-muted-foreground">
                      <span>{t("projects.values.input")} <b className="text-foreground">{formatNumber(project.inputTokens)}</b> <Peak show={isPositivePeak(project.inputTokens, peaks.inputTokens)} label={t("projects.highest")} /></span>
                      <span>{t("projects.values.cached")} <b className="text-foreground">{formatNumber(project.cachedInputTokens)}</b> <span className="text-emerald-600 dark:text-emerald-400">({formatPercent(cacheHitRate)})</span> <Peak show={isPositivePeak(project.cachedInputTokens, peaks.cachedInputTokens)} label={t("projects.highest")} /></span>
                      <span>{t("projects.values.output")} <b className="text-foreground">{formatNumber(project.outputTokens)}</b> <Peak show={isPositivePeak(project.outputTokens, peaks.outputTokens)} label={t("projects.highest")} /></span>
                    </div>
                  </td>
                  <td className="border-b border-border/70 py-4 pl-2"><div className={cn("rounded-lg p-3", costToneClasses[costTone])} data-cost-tone={costTone}><div className="flex items-center justify-between gap-2"><b className="tabular-nums">{formatCurrency(project.costUSD)}</b><Peak show={isPositivePeak(project.costUSD, peaks.costUSD)} label={t("projects.highest")} /></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-current opacity-60" style={{ width: `${costWidth}%` }} /></div></div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
