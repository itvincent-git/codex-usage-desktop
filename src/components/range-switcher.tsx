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
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import type { RangeKey } from "@/lib/api";
import { useState } from "react";
import { createPortal } from "react-dom";
import { getRangeLabel } from "@/lib/usage-dashboard";
import dayjs from "dayjs";
import type { DateRange } from "react-day-picker";
import { useTranslation } from "react-i18next";
import { zhCN, enUS } from "date-fns/locale";

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
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.resolvedLanguage?.startsWith("zh") ? zhCN : enUS;
  const selectedRange = ranges.find((range) => range.value === value);
  const displayLabel = selectedRange ? t(`ranges.${selectedRange.value}`, { defaultValue: selectedRange.label }) : getRangeLabel(value, t);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    if (value.startsWith("custom:")) {
      const [start, end] = value.slice("custom:".length).split("_");
      return {
        from: start ? new Date(start) : undefined,
        to: end ? new Date(end) : undefined,
      };
    }
    return {
      from: new Date(dayjs().subtract(30, "day").format("YYYY-MM-DD")),
      to: new Date(),
    };
  });
  const [error, setError] = useState<string | null>(null);

  const handleApply = () => {
    if (!dateRange?.from || !dateRange?.to) {
      setError(t("range_switcher.err_select_both"));
      return;
    }
    if (dayjs(dateRange.to).isBefore(dayjs(dateRange.from), "day")) {
      setError(t("range_switcher.err_end_before_start"));
      return;
    }
    const startStr = dayjs(dateRange.from).format("YYYY-MM-DD");
    const endStr = dayjs(dateRange.to).format("YYYY-MM-DD");
    setError(null);
    onChange(`custom:${startStr}_${endStr}`);
    setIsModalOpen(false);
  };

  const handleSelect = (range: DateRange | undefined, selectedDay: Date) => {
    if (dateRange?.from && dateRange?.to) {
      setDateRange({
        from: selectedDay,
        to: undefined,
      });
      setError(null);
    } else {
      setDateRange(range);
      setError(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "min-w-[11rem] justify-between")}
            aria-label={t("range_switcher.aria_select_range")}
          >
            <span>{displayLabel}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[11rem]">
          <DropdownMenuRadioGroup value={value} onValueChange={(nextValue) => onChange(nextValue as RangeKey)}>
            {ranges.map((range) => (
              <DropdownMenuRadioItem key={range.value} value={range.value}>
                {t(`ranges.${range.value}`, { defaultValue: range.label })}
              </DropdownMenuRadioItem>
            ))}
            {value.startsWith("custom:") && (
              <DropdownMenuRadioItem value={value}>
                {getRangeLabel(value, t)}
              </DropdownMenuRadioItem>
            )}
          </DropdownMenuRadioGroup>
          <div className="h-px bg-border my-1" />
          <DropdownMenuItem
            onSelect={() => setIsModalOpen(true)}
            className="text-primary font-medium focus:text-primary cursor-pointer justify-center"
          >
            {t("range_switcher.custom_range")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-all duration-300"
            onClick={() => setIsModalOpen(false)}
          >
            <div
              className="bg-surface border border-border rounded-2xl w-full max-w-sm p-6 shadow-2xl flex flex-col space-y-4 animate-in fade-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h3 className="text-lg font-bold text-foreground">{t("range_switcher.modal_title")}</h3>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground transition cursor-pointer"
                  aria-label={t("range_switcher.modal_close_aria")}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex flex-col items-center py-2 space-y-3">
                <div className="text-center text-xs text-muted-foreground min-h-[1.25rem]">
                  {dateRange?.from ? (
                    <span>
                      {dateRange.to ? (
                        t("range_switcher.selected_range", {
                          start: dayjs(dateRange.from).format("YYYY-MM-DD"),
                          end: dayjs(dateRange.to).format("YYYY-MM-DD"),
                          defaultValue: `Selected: ${dayjs(dateRange.from).format("YYYY-MM-DD")} to ${dayjs(dateRange.to).format("YYYY-MM-DD")}`
                        })
                      ) : (
                        t("range_switcher.selected_start_only", {
                          start: dayjs(dateRange.from).format("YYYY-MM-DD"),
                          defaultValue: `Selected: ${dayjs(dateRange.from).format("YYYY-MM-DD")} (Choose end date...)`
                        })
                      )}
                    </span>
                  ) : (
                    <span>{t("range_switcher.choose_start")}</span>
                  )}
                </div>
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={handleSelect}
                  disabled={{ after: new Date() }}
                  className="rounded-md border bg-card border-border/60"
                  locale={currentLocale}
                />
              </div>

              {error && (
                <p className="text-xs text-error font-medium text-center">{error}</p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDateRange(undefined)}
                  className="flex-1 rounded-lg border border-border py-2 text-xs font-medium hover:bg-muted transition cursor-pointer text-muted-foreground"
                >
                  {t("range_switcher.btn_clear")}
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 rounded-lg border border-border py-2 text-xs font-medium hover:bg-muted transition cursor-pointer"
                >
                  {t("range_switcher.btn_cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  className="flex-1 rounded-lg bg-primary py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition shadow-glow cursor-pointer"
                >
                  {t("range_switcher.btn_apply")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
