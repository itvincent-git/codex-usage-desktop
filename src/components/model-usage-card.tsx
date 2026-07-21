import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import {
  buildDonutData,
  modelTone,
  priceTones,
  sortModels,
  tokenBreakdown,
  type ModelRow,
  type ModelSort,
  type PriceTone,
} from "@/lib/model-analytics";
import { formatCompactNumber, formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type ModelUsageCardProps = { models: OverviewResponse["models"] };

const priceToneClasses: Record<PriceTone, string> = {
  low: "text-sky-600 dark:text-sky-400",
  medium: "text-amber-600 dark:text-amber-400",
  high: "text-rose-600 dark:text-rose-400",
  equal: "text-foreground",
  unavailable: "text-muted-foreground",
};

function TokenBar({ row, label }: { row: Pick<ModelRow, "inputTokens" | "cachedInputTokens" | "outputTokens" | "totalTokens">; label: string }) {
  const parts = tokenBreakdown(row);
  const total = Math.max(row.totalTokens, parts.nonCachedInput + parts.cachedInput + parts.output, 1);
  return (
    <div role="img" aria-label={label} className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      <span className="bg-sky-500" style={{ width: `${parts.nonCachedInput / total * 100}%` }} />
      <span className="bg-emerald-500" style={{ width: `${parts.cachedInput / total * 100}%` }} />
      <span className="bg-violet-500" style={{ width: `${parts.output / total * 100}%` }} />
    </div>
  );
}

function Price({ value, tone, unavailable }: { value: number | null; tone: PriceTone; unavailable: string }) {
  return (
    <span data-price-tone={tone} className={cn("font-medium tabular-nums", priceToneClasses[tone])}>
      {value == null ? unavailable : formatCurrency(value)}
    </span>
  );
}

export function ModelUsageCard({ models }: ModelUsageCardProps) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<ModelSort>("tokens");
  const totals = useMemo(() => models.reduce((result, model) => ({
    inputTokens: result.inputTokens + model.inputTokens,
    cachedInputTokens: result.cachedInputTokens + model.cachedInputTokens,
    outputTokens: result.outputTokens + model.outputTokens,
    totalTokens: result.totalTokens + model.totalTokens,
    costUSD: result.costUSD + model.costUSD,
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0 }), [models]);
  const sortedModels = useMemo(() => sortModels(models, sort), [models, sort]);
  const donutData = useMemo(() => buildDonutData(models, t("models.other")), [models, t]);
  const tones = useMemo(() => ({
    input: priceTones(models, "inputCostPerMillionTokens"),
    cached: priceTones(models, "cachedInputCostPerMillionTokens"),
    output: priceTones(models, "outputCostPerMillionTokens"),
    effective: priceTones(models, "effectiveCostPerMillionTokens"),
  }), [models]);
  const cacheHitRate = totals.inputTokens > 0 ? totals.cachedInputTokens / totals.inputTokens : 0;
  const effectiveRate = totals.totalTokens > 0 && models.some((model) => model.pricingStatus !== "unavailable")
    ? totals.costUSD / totals.totalTokens * 1_000_000
    : null;
  const unavailable = t("models.pricing_unavailable");

  if (models.length === 0) {
    return <Card><CardContent className="py-14 text-center text-sm text-muted-foreground">{t("models.no_data")}</CardContent></Card>;
  }

  const summary = [
    [t("models.summary.active_models"), formatNumber(models.length)],
    [t("models.summary.total_tokens"), formatCompactNumber(totals.totalTokens)],
    [t("models.summary.estimated_cost"), formatCurrency(totals.costUSD)],
    [t("models.summary.cache_hit"), formatPercent(cacheHitRate)],
    [t("models.summary.effective_price"), effectiveRate == null ? unavailable : formatCurrency(effectiveRate)],
  ];

  return (
    <div className="space-y-4" data-testid="model-analytics">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {summary.map(([label, value]) => (
          <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold tabular-nums text-foreground">{value}</p></CardContent></Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("models.composition.title")}</CardTitle><CardDescription>{t("models.composition.subtitle")}</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">{t("models.composition.total")}</p><p className="font-bold tabular-nums">{formatNumber(totals.totalTokens)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t("models.composition.input_total")}</p><p className="font-bold tabular-nums">{formatNumber(totals.inputTokens)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t("models.composition.cached")}</p><p className="font-bold tabular-nums">{formatNumber(totals.cachedInputTokens)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t("models.composition.output")}</p><p className="font-bold tabular-nums">{formatNumber(totals.outputTokens)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t("models.summary.cache_hit")}</p><p className="font-bold tabular-nums">{formatPercent(cacheHitRate)}</p></div>
            </div>
            <TokenBar row={totals} label={t("models.composition.bar_label", { input: formatNumber(Math.max(totals.inputTokens - totals.cachedInputTokens, 0)), cached: formatNumber(totals.cachedInputTokens), output: formatNumber(totals.outputTokens), total: formatNumber(totals.totalTokens) })} />
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-sky-500" />{t("models.composition.uncached")}</span>
              <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />{t("models.composition.cached")}</span>
              <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-violet-500" />{t("models.composition.output")}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("models.distribution.title")}</CardTitle><CardDescription>{t("models.distribution.subtitle")}</CardDescription></CardHeader>
          <CardContent className="flex min-h-[240px] flex-col items-center gap-3 sm:flex-row">
            <div className="h-48 w-full min-w-0 sm:w-1/2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={donutData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2}>{donutData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip formatter={(value) => formatNumber(Number(value))} /></PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid w-full gap-2 text-xs sm:w-1/2">
              {donutData.map((entry) => <div key={entry.name} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate"><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />{entry.name}</span><span className="tabular-nums text-muted-foreground">{formatPercent(entry.value / Math.max(totals.totalTokens, 1))}</span></div>)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><CardTitle>{t("models.comparison.title")}</CardTitle><CardDescription>{t("models.comparison.subtitle")}</CardDescription></div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">{t("models.sort.label")}<select aria-label={t("models.sort.label")} value={sort} onChange={(event) => setSort(event.target.value as ModelSort)} className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"><option value="tokens">{t("models.sort.tokens")}</option><option value="cost">{t("models.sort.cost")}</option><option value="effective">{t("models.sort.effective")}</option></select></label>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-3 text-[11px] text-muted-foreground" aria-label={t("models.price_legend.label")}>
            {(["low", "medium", "high", "equal"] as const).map((tone) => <span key={tone} className={priceToneClasses[tone]}>● {t(`models.price_legend.${tone}`)}</span>)}
          </div>
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="min-w-[1120px] w-full border-separate border-spacing-0 text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><th className="border-b border-border pb-2">{t("models.groups.model")}</th><th className="border-b border-border px-4 pb-2">{t("models.groups.tokens")}</th><th className="border-b border-border px-4 pb-2">{t("models.groups.prices")}</th><th className="border-b border-border pb-2">{t("models.groups.cost")}</th></tr></thead>
              <tbody>{sortedModels.map((model) => {
                const identity = modelTone(model.model);
                const parts = tokenBreakdown(model);
                const usageShare = model.totalTokens / Math.max(totals.totalTokens, 1);
                const costShare = totals.costUSD > 0 ? model.costUSD / totals.costUSD : 0;
                return <tr key={model.model} data-model-row={model.model} className="align-top">
                  <td className="border-b border-border/70 py-4 pr-4"><div className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: identity.color }} /><span className={cn("rounded-full border px-2 py-0.5 font-semibold", identity.className)}>{model.model}</span></div><p className="mt-2 text-xs tabular-nums text-muted-foreground">{formatPercent(usageShare)} {t("models.of_usage")}</p></td>
                  <td className="border-b border-border/70 px-4 py-4"><div className="mb-2 flex justify-between gap-4"><strong className="tabular-nums">{formatNumber(model.totalTokens)}</strong><span className="text-xs text-muted-foreground">{t("models.composition.input_total")} {formatNumber(model.inputTokens)} · {t("models.composition.cached")} {formatNumber(model.cachedInputTokens)} · {t("models.composition.output")} {formatNumber(model.outputTokens)}</span></div><TokenBar row={model} label={t("models.composition.bar_label", { input: formatNumber(parts.nonCachedInput), cached: formatNumber(parts.cachedInput), output: formatNumber(parts.output), total: formatNumber(model.totalTokens) })} /></td>
                  <td className="border-b border-border/70 px-4 py-4"><div className="grid grid-cols-4 gap-3 text-xs"><div title={t("models.prices.input_tooltip")}><p className="mb-1 text-muted-foreground">{t("models.prices.input")}</p><Price value={model.inputCostPerMillionTokens} tone={tones.input.get(model.model)!} unavailable={unavailable} /></div><div title={t("models.prices.cached_tooltip")}><p className="mb-1 text-muted-foreground">{t("models.prices.cached")}</p><Price value={model.cachedInputCostPerMillionTokens} tone={tones.cached.get(model.model)!} unavailable={unavailable} /></div><div title={t("models.prices.output_tooltip")}><p className="mb-1 text-muted-foreground">{t("models.prices.output")}</p><Price value={model.outputCostPerMillionTokens} tone={tones.output.get(model.model)!} unavailable={unavailable} /></div><div title={t("models.prices.effective_tooltip")}><p className="mb-1 text-muted-foreground">{t("models.prices.effective")}</p><Price value={model.effectiveCostPerMillionTokens} tone={tones.effective.get(model.model)!} unavailable={unavailable} /></div></div></td>
                  <td className="border-b border-border/70 py-4 text-right"><p data-effective-tone={tones.effective.get(model.model)} className={cn("font-bold tabular-nums", priceToneClasses[tones.effective.get(model.model)!])}>{formatCurrency(model.costUSD)}</p><p className="mt-1 text-xs tabular-nums text-muted-foreground">{formatPercent(costShare)} {t("models.of_cost")}</p></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
