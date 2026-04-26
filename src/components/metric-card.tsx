import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
};

export function MetricCard({ label, value, detail }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="space-y-4">
        <CardDescription className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </CardDescription>
        <CardTitle className="text-3xl sm:text-4xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

