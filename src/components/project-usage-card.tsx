import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/formatters";

type ProjectUsageCardProps = {
  projects: OverviewResponse["projects"];
};

export function ProjectUsageCard({ projects }: ProjectUsageCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Usage</CardTitle>
        <CardDescription>Token and cost totals grouped by project directory for the selected window.</CardDescription>
      </CardHeader>
      <CardContent>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No project activity in this window.</p>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="min-w-52 border-b border-border px-0 pb-3 font-medium">Project</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">Total Tokens</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">Input</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">Cache</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">Output</th>
                  <th className="border-b border-border px-0 pb-3 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.project} className="align-top">
                    <td className="border-b border-border/70 px-0 py-4">
                      <div className="max-w-72 space-y-1">
                        <div className="truncate font-medium text-foreground">{project.displayName}</div>
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
