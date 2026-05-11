import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/formatters";

type ModelUsageCardProps = {
  models: OverviewResponse["models"];
};

export function ModelUsageCard({ models }: ModelUsageCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Usage</CardTitle>
        <CardDescription>Token and cost totals grouped by model for the selected window.</CardDescription>
      </CardHeader>
      <CardContent>
        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground">No model activity in this window.</p>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="border-b border-border px-0 pb-3 font-medium">Model</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">Total Token</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">Input</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">Output</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">Cache</th>
                  <th className="border-b border-border px-0 pb-3 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr key={model.model} className="align-top">
                    <td className="border-b border-border/70 px-0 py-4 font-medium text-foreground">{model.model}</td>
                    <td className="border-b border-border/70 px-3 py-4 text-right tabular-nums text-foreground">
                      {formatNumber(model.totalTokens)}
                    </td>
                    <td className="border-b border-border/70 px-3 py-4 text-right tabular-nums text-foreground">
                      {formatNumber(model.inputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-3 py-4 text-right tabular-nums text-foreground">
                      {formatNumber(model.outputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-3 py-4 text-right tabular-nums text-muted-foreground">
                      {formatNumber(model.cachedInputTokens)}
                    </td>
                    <td className="border-b border-border/70 px-0 py-4 text-right tabular-nums font-medium text-foreground">
                      {formatCurrency(model.costUSD)}
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
