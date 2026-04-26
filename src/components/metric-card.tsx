import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
};

export function MetricCard({ label, value, detail }: MetricCardProps) {
  return (
    <Card className="rounded-md">
      <CardHeader className="space-y-2 p-4 pb-3">
        <CardDescription className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </CardDescription>
        <CardTitle className="text-2xl leading-none sm:text-[1.75rem]">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
