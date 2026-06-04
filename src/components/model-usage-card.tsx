import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { useTranslation } from "react-i18next";

type ModelUsageCardProps = {
  models: OverviewResponse["models"];
};

export function ModelUsageCard({ models }: ModelUsageCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("models.card_title")}</CardTitle>
        <CardDescription>{t("models.card_subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("models.no_data", { defaultValue: "No model activity in this window." })}</p>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="border-b border-border px-0 pb-3 font-medium">{t("models.cols.model")}</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">{t("models.cols.tokens", { defaultValue: "Total Tokens" })}</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">{t("project_modal.input", { defaultValue: "Input" })}</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">{t("project_modal.output", { defaultValue: "Output" })}</th>
                  <th className="border-b border-border px-3 pb-3 text-right font-medium">{t("common.cache")}</th>
                  <th className="border-b border-border px-0 pb-3 text-right font-medium">{t("common.cost")}</th>
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
