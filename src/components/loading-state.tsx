import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const loadingRows = [
  { label: "Reading sessions", tokens: "tokens", cost: "cost" },
  { label: "Aggregating tokens", tokens: "input", cost: "cache" },
  { label: "Estimating cost", tokens: "models", cost: "usd" },
];

type LoadingStateProps = {
  title: string;
  description: string;
};

export function LoadingState({ title, description }: LoadingStateProps) {
  return (
    <Card
      role="status"
      aria-live="polite"
      aria-label={title}
      className="overflow-hidden hover:translate-y-0 hover:shadow-none"
    >
      <CardHeader className="border-b border-border p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl space-y-2">
            <CardTitle className="text-2xl">{title}</CardTitle>
            <CardDescription className="leading-6">{description}</CardDescription>
          </div>

          <div className="flex w-full items-center justify-between gap-4 rounded-md border border-border bg-muted/30 px-3 py-2 sm:w-auto sm:min-w-44">
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Scan</p>
              <p className="font-mono text-sm tabular-nums text-foreground">00:08</p>
            </div>
            <div className="h-1 w-20 overflow-hidden rounded-full bg-border">
              <div className="h-full w-1/3 rounded-full bg-foreground/70 motion-safe:animate-loading-meter" />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-5 sm:p-6">
        <div className="relative overflow-hidden rounded-md border border-border bg-surface">
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-px bg-foreground/20 motion-safe:animate-loading-scan"
          />

          <div className="grid grid-cols-[1fr_4rem_4rem] gap-2 border-b border-border px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:grid-cols-[1fr_5.5rem_5.5rem] sm:gap-3">
            <span>Pipeline</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Cost</span>
          </div>

          <div className="divide-y divide-border/70">
            {loadingRows.map((row, index) => (
              <div
                key={row.label}
                className="grid grid-cols-[1fr_4rem_4rem] items-center gap-2 px-4 py-4 text-[13px] sm:grid-cols-[1fr_5.5rem_5.5rem] sm:gap-3 sm:text-sm"
              >
                <div className="min-w-0 space-y-2">
                  <p className="font-medium leading-5 text-foreground">{row.label}</p>
                  <div
                    aria-hidden="true"
                    className="h-2 max-w-64 rounded-full bg-muted motion-safe:animate-pulse"
                    style={{ width: `${68 - index * 10}%`, animationDelay: `${index * 120}ms` }}
                  />
                </div>
                <div className="space-y-2 text-right">
                  <span className="font-mono text-xs uppercase text-muted-foreground">{row.tokens}</span>
                  <div
                    aria-hidden="true"
                    className="ml-auto h-2 rounded-full bg-muted motion-safe:animate-pulse"
                    style={{ width: `${48 + index * 8}px`, animationDelay: `${index * 140}ms` }}
                  />
                </div>
                <div className="space-y-2 text-right">
                  <span className="font-mono text-xs uppercase text-muted-foreground">{row.cost}</span>
                  <div
                    aria-hidden="true"
                    className="ml-auto h-2 rounded-full bg-muted motion-safe:animate-pulse"
                    style={{ width: `${38 + index * 7}px`, animationDelay: `${index * 160}ms` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
