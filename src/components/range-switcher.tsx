import { ChevronDown, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { RangeKey } from "@/lib/api";
import { useState } from "react";
import { getRangeLabel } from "@/lib/usage-dashboard";
import dayjs from "dayjs";

type RangeSwitcherProps = {
  value: RangeKey;
  onChange: (value: RangeKey) => void;
};

const ranges: Array<{ value: RangeKey; label: string }> = [
  { value: "1d", label: "Last 1 Day" },
  { value: "2d", label: "Last 2 Days" },
  { value: "7d", label: "Last 7 Days" },
  { value: "14d", label: "Last 14 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "60d", label: "Last 60 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "180d", label: "Last 180 Days" },
  { value: "365d", label: "Last 365 Days" },
];

export function RangeSwitcher({ value, onChange }: RangeSwitcherProps) {
  const selectedRange = ranges.find((range) => range.value === value);
  const displayLabel = selectedRange ? selectedRange.label : getRangeLabel(value);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    if (value.startsWith("custom:")) {
      return value.slice("custom:".length).split("_")[0];
    }
    return dayjs().subtract(30, "day").format("YYYY-MM-DD");
  });
  const [endDate, setEndDate] = useState(() => {
    if (value.startsWith("custom:")) {
      return value.slice("custom:".length).split("_")[1];
    }
    return dayjs().format("YYYY-MM-DD");
  });
  const [error, setError] = useState<string | null>(null);

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      setError("Please select both start and end dates.");
      return;
    }
    if (dayjs(endDate).isBefore(dayjs(startDate))) {
      setError("End date must be after or equal to start date.");
      return;
    }
    setError(null);
    onChange(`custom:${startDate}_${endDate}`);
    setIsModalOpen(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "min-w-[11rem] justify-between")}
            aria-label="Select time range"
          >
            <span>{displayLabel}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[11rem]">
          <DropdownMenuRadioGroup value={value} onValueChange={(nextValue) => onChange(nextValue as RangeKey)}>
            {ranges.map((range) => (
              <DropdownMenuRadioItem key={range.value} value={range.value}>
                {range.label}
              </DropdownMenuRadioItem>
            ))}
            {value.startsWith("custom:") && (
              <DropdownMenuRadioItem value={value}>
                {getRangeLabel(value)}
              </DropdownMenuRadioItem>
            )}
          </DropdownMenuRadioGroup>
          <div className="h-px bg-border my-1" />
          <DropdownMenuItem
            onSelect={() => setIsModalOpen(true)}
            className="text-primary font-medium focus:text-primary cursor-pointer justify-center"
          >
            Select Custom Range...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-all duration-300"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-surface border border-border rounded-2xl w-full max-w-sm p-6 shadow-2xl flex flex-col space-y-4 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Select Custom Range</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground transition cursor-pointer"
                aria-label="Close custom range modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleApply} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate || dayjs().format("YYYY-MM-DD")}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  max={dayjs().format("YYYY-MM-DD")}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition"
                  required
                />
              </div>

              {error && (
                <p className="text-xs text-error font-medium">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium hover:bg-muted transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition shadow-glow cursor-pointer"
                >
                  Apply Range
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
