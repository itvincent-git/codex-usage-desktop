import { Area, AreaChart, Bar, BarChart, Line, LineChart, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewResponse } from "@/lib/api";
import type { MetricCardKind } from "@/lib/usage-dashboard";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  kind: MetricCardKind;
  label: string;
  value: string;
  detail: string;
  daily: OverviewResponse["daily"];
  cacheHitRate: number;
};

const metricStyles: Record<MetricCardKind, { bg: string; line: string }> = {
  tokens: { bg: "bg-blue-500/10", line: "rgb(37 99 235)" },
  cost: { bg: "bg-primary/10", line: "rgb(var(--primary))" },
  average: { bg: "bg-violet-500/10", line: "rgb(124 58 237)" },
  cache: { bg: "bg-success/10", line: "rgb(var(--success))" },
  costPerMillion: { bg: "bg-warning/10", line: "rgb(var(--warning))" },
};

export function MetricCard({ kind, label, value, detail, daily, cacheHitRate }: MetricCardProps) {
  const style = metricStyles[kind];

  return (
    <Card className="group rounded-lg border-border/80 bg-surface/95">
      <CardHeader className="space-y-2 p-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardDescription className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </CardDescription>
          <span className={cn("h-2.5 w-2.5 rounded-full", style.bg)} />
        </div>
        <CardTitle className="font-sans text-2xl leading-none tracking-normal sm:text-[1.75rem]">{value}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4">
        <MiniMetricChart kind={kind} daily={daily} cacheHitRate={cacheHitRate} stroke={style.line} />
        <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function MiniMetricChart({
  kind,
  daily,
  cacheHitRate,
  stroke,
}: {
  kind: MetricCardKind;
  daily: OverviewResponse["daily"];
  cacheHitRate: number;
  stroke: string;
}) {
  if (kind === "cache") {
    return <CacheRing value={cacheHitRate} />;
  }

  const data = daily.map((day) => ({
    date: day.date,
    billableInputTokens: Math.max(day.inputTokens - day.cachedInputTokens, 0),
    cachedInputTokens: day.cachedInputTokens,
    outputTokens: day.outputTokens,
    totalTokens: day.totalTokens,
    costUSD: day.costUSD,
    averageCost: day.costUSD,
    costPerMillion: day.totalTokens > 0 ? day.costUSD / (day.totalTokens / 1_000_000) : 0,
  }));

  if (data.length === 0) {
    return <div className="h-16 rounded-md bg-muted/40" />;
  }

  if (kind === "tokens") {
    return (
      <div className="h-16">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <Bar dataKey="billableInputTokens" stackId="tokens" fill="rgb(37 99 235)" radius={[2, 2, 0, 0]} />
            <Bar dataKey="cachedInputTokens" stackId="tokens" fill="rgb(var(--success))" radius={[2, 2, 0, 0]} />
            <Bar dataKey="outputTokens" stackId="tokens" fill="rgb(124 58 237)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (kind === "cost") {
    return (
      <div className="h-16">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="metricCostGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.24} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="costUSD"
              stroke={stroke}
              strokeWidth={2}
              fill="url(#metricCostGradient)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const dataKey = kind === "costPerMillion" ? "costPerMillion" : "averageCost";

  return (
    <div className="h-16">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <Line type="monotone" dataKey={dataKey} stroke={stroke} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CacheRing({ value }: { value: number }) {
  const percent = Math.min(Math.max(value * 100, 0), 100);
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="flex h-16 items-center justify-center">
      <svg viewBox="0 0 64 64" className="h-16 w-16" role="img" aria-label={`${Math.round(percent)}% cache hit`}>
        <circle cx="32" cy="32" r={radius} fill="none" stroke="rgb(var(--border))" strokeWidth="8" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="rgb(var(--success))"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="8"
          transform="rotate(-90 32 32)"
        />
      </svg>
    </div>
  );
}
