import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModelUsageCard } from "@/components/model-usage-card";
import { RangeSwitcher } from "@/components/range-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchModelPricingCatalog, type ModelPricingCatalogResponse, type OverviewResponse, type RangeKey } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

type ModelsPageProps = {
  models: OverviewResponse["models"];
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
};

export function ModelsPage({ models, range, onRangeChange }: ModelsPageProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<"usage" | "catalog">("usage");
  const [catalog, setCatalog] = useState<ModelPricingCatalogResponse | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [page, setPage] = useState(1);
  const requestRef = useRef<Promise<ModelPricingCatalogResponse> | null>(null);

  const loadCatalog = () => {
    if (catalog || requestRef.current) return;
    setError(false);
    requestRef.current = fetchModelPricingCatalog();
    void requestRef.current.then(setCatalog).catch(() => setError(true)).finally(() => {
      requestRef.current = null;
    });
  };

  const providers = useMemo(() => Array.from(new Set(catalog?.models.map((model) => model.provider) ?? []))
    .sort((left, right) => left.localeCompare(right)), [catalog]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (catalog?.models ?? []).filter((model) =>
      (provider === "all" || model.provider === provider)
      && (!normalized || model.model.toLowerCase().includes(normalized) || model.provider.toLowerCase().includes(normalized))
    );
  }, [catalog, provider, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleModels = useMemo(() => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [currentPage, filtered]);

  const selectView = (nextView: "usage" | "catalog") => {
    setView(nextView);
    if (nextView === "catalog") loadCatalog();
  };
  const resetPage = () => setPage(1);
  const price = (value: number | null, status: string) => {
    if (value == null) return "—";
    if (status === "free" && value === 0) return t("models.catalog.free");
    return formatCurrency(value);
  };

  return <div className="space-y-4">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">{t("models.title")}</h2>
        <p className="text-sm text-muted-foreground">{view === "usage" ? t("models.subtitle") : t("models.catalog.subtitle")}</p>
      </div>
      {view === "usage" ? <RangeSwitcher value={range} onChange={onRangeChange} /> : null}
    </div>

    <div role="tablist" aria-label={t("models.views.label")} className="inline-flex rounded-lg border border-border bg-muted/50 p-1">
      {(["usage", "catalog"] as const).map((item) => <button key={item} id={`models-${item}-tab`} type="button" role="tab" aria-selected={view === item} aria-controls={`models-${item}-panel`} onClick={() => selectView(item)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", view === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t(`models.views.${item}`)}</button>)}
    </div>

    {view === "usage" ? <div id="models-usage-panel" role="tabpanel" aria-labelledby="models-usage-tab"><ModelUsageCard models={models} /></div> : <div id="models-catalog-panel" role="tabpanel" aria-labelledby="models-catalog-tab" className="space-y-4" data-testid="pricing-catalog">
      {catalog?.isLimited ? <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t("models.catalog.limited")}</div> : null}
      {catalog ? <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1"><span className="sr-only">{t("models.catalog.search")}</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder={t("models.catalog.search")} className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>
        <Select value={provider} onValueChange={(value) => { setProvider(value); resetPage(); }}><SelectTrigger aria-label={t("models.catalog.provider")} className="w-full sm:w-[220px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("models.catalog.all_providers")}</SelectItem>{providers.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
      </div> : null}
      {!catalog && !error ? <Card><CardContent className="py-14 text-center text-sm text-muted-foreground">{t("models.catalog.loading")}</CardContent></Card> : null}
      {error ? <Card><CardContent className="py-14 text-center text-sm text-destructive">{t("models.catalog.error")}</CardContent></Card> : null}
      {catalog && filtered.length === 0 ? <Card><CardContent className="py-14 text-center text-sm text-muted-foreground">{t("models.catalog.no_results")}</CardContent></Card> : null}
      {catalog && filtered.length > 0 ? <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><caption className="sr-only">{t("models.catalog.unit")}</caption><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="p-4">{t("models.catalog.model")}</th><th className="p-4">{t("models.catalog.provider")}</th><th className="p-4 text-right">{t("models.prices.input")}<span className="block font-normal">{t("models.catalog.unit")}</span></th><th className="p-4 text-right">{t("models.prices.cached")}<span className="block font-normal">{t("models.catalog.unit")}</span></th><th className="p-4 text-right">{t("models.prices.output")}<span className="block font-normal">{t("models.catalog.unit")}</span></th></tr></thead><tbody>{visibleModels.map((model) => <tr key={`${model.model}:${model.provider}`} className="border-b last:border-0"><td className="p-4 font-medium">{model.model}</td><td className="p-4 text-muted-foreground">{model.provider}</td>{[model.inputCostPerMillionTokens, model.cachedInputCostPerMillionTokens, model.outputCostPerMillionTokens].map((value, index) => <td key={index} className="p-4 text-right tabular-nums">{price(value, model.pricingStatus)}</td>)}</tr>)}</tbody></table></div></CardContent></Card> : null}
      {catalog && filtered.length > 0 ? <div className="flex items-center justify-between text-sm text-muted-foreground"><span>{t("models.catalog.count", { count: filtered.length })}</span><div className="flex items-center gap-2"><Button variant="secondary" size="icon" aria-label={t("models.catalog.previous")} disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-4 w-4" /></Button><span>{t("models.catalog.page", { page: currentPage, pages: pageCount })}</span><Button variant="secondary" size="icon" aria-label={t("models.catalog.next")} disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight className="h-4 w-4" /></Button></div></div> : null}
    </div>}
  </div>;
}
