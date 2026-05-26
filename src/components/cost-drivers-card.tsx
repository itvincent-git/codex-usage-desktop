import { CalendarDays, Cpu, FolderGit2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import { formatCurrencyShort, formatPercent } from "@/lib/formatters";

type CostDriverItem = {
  label: string;
  costUSD: number;
  share: number;
};

type CostDriversCardProps = {
  overview: OverviewResponse;
};

export function CostDriversCard({ overview }: CostDriversCardProps) {
  const totalCost = overview.totals.costUSD;
  const models = overview.models ?? [];
  const projects = overview.projects ?? [];
  
  const buildCostDrivers = (items: Array<{ label: string; costUSD: number }>): CostDriverItem[] =>
    [...items]
      .sort((left, right) => right.costUSD - left.costUSD)
      .slice(0, 3)
      .map((item) => ({
        label: item.label,
        costUSD: item.costUSD,
        share: totalCost > 0 ? item.costUSD / totalCost : 0,
      }));

  const topModels = buildCostDrivers(models.map((model) => ({ label: model.model, costUSD: model.costUSD })));
  const topProjects = buildCostDrivers(projects.map((project) => ({ label: project.displayName, costUSD: project.costUSD })));
  const topDates = buildCostDrivers(overview.daily.map((day) => ({ label: day.date, costUSD: day.costUSD })));

  return (
    <Card className="h-full flex flex-col rounded-lg">
      <CardHeader className="border-b border-border p-3 sm:px-4 sm:py-3 shrink-0">
        <div className="space-y-0.5">
          <CardTitle className="text-lg sm:text-xl flex items-center gap-2">
            <Cpu className="h-4.5 w-4.5 text-primary" />
            Cost Drivers
          </CardTitle>
          <CardDescription className="text-xs">Top spend by model, project, and date</CardDescription>
        </div>
      </CardHeader>

      <CardContent className="p-3 sm:p-4 flex-1 flex flex-col justify-center">
        <div className="grid gap-3 grid-cols-1 md:grid-cols-3 flex-1 items-stretch">
          <DriverGroup icon={Cpu} title="Models" items={topModels} emptyLabel="No model data" />
          <DriverGroup icon={FolderGit2} title="Projects" items={topProjects} emptyLabel="No project data" />
          <DriverGroup icon={CalendarDays} title="Dates" items={topDates} emptyLabel="No date data" />
        </div>
      </CardContent>
    </Card>
  );
}

function DriverGroup({
  icon: Icon,
  title,
  items,
  emptyLabel,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: CostDriverItem[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/45 p-2.5 flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-1.5">
          <div className="rounded-md bg-primary/10 p-1 text-primary">
            <Icon className="h-3.5 w-3.5" />
          </div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
        </div>

        {items.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {items.map((item, index) => (
              <DriverRankRow key={`${item.label}-${index}`} item={item} rank={index + 1} />
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-md bg-muted/45 px-2 py-1.5 text-xs text-muted-foreground">{emptyLabel}</p>
        )}
      </div>
    </div>
  );
}

function DriverRankRow({ item, rank }: { item: CostDriverItem; rank: number }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-semibold text-muted-foreground">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <p className="truncate text-[11px] font-medium text-foreground" title={item.label}>
              {item.label}
            </p>
            <p className="shrink-0 font-mono text-[10px] font-semibold text-foreground">
              {formatCurrencyShort(item.costUSD)}
            </p>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(Math.max(item.share, 0), 1) * 100}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right text-[9px] text-muted-foreground">
              {formatPercent(item.share)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
