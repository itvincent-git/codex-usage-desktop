import { ChevronDown } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { RangeKey } from "@/lib/api";

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
];

export function RangeSwitcher({ value, onChange }: RangeSwitcherProps) {
  const selectedRange = ranges.find((range) => range.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "min-w-[11rem] justify-between")}
          aria-label="Select time range"
        >
          <span>{selectedRange?.label}</span>
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
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
