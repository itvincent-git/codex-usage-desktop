import { cn } from "@/lib/utils";
import type { RangeKey } from "@/lib/api";

type RangeSwitcherProps = {
  value: RangeKey;
  onChange: (value: RangeKey) => void;
};

const ranges: Array<{ value: RangeKey; label: string }> = [
  { value: "1d", label: "Recent 1 Day" },
  { value: "7d", label: "Recent 7 Days" },
];

export function RangeSwitcher({ value, onChange }: RangeSwitcherProps) {
  return (
    <div className="inline-flex rounded-full border border-border bg-surface p-1">
      {ranges.map((range) => (
        <button
          key={range.value}
          type="button"
          onClick={() => onChange(range.value)}
          className={cn(
            "rounded-full px-4 py-2 text-sm font-medium transition",
            value === range.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-black/[0.03] hover:text-foreground",
          )}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

