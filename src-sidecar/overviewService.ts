import type { DatabaseSync } from "node:sqlite";
import { queryDailyRows, queryLatestUpdateAt } from "./db";
import { dateKeyInTimezone, listDateKeys, resolveAppTimezone, shiftDateKey } from "./date";
import type { OverviewResponse, RangeKey } from "./types";

const rangeDaysMap: Record<RangeKey, number> = {
  "1d": 1,
  "7d": 7,
};

export function getOverview(options: {
  db: DatabaseSync;
  range: RangeKey;
  timezone?: string;
  now?: Date;
}): OverviewResponse {
  const timezone = options.timezone ?? resolveAppTimezone();
  const days = rangeDaysMap[options.range];
  const endDate = dateKeyInTimezone(options.now ?? new Date(), timezone);
  const startDate = shiftDateKey(endDate, -(days - 1));
  const rows = queryDailyRows(options.db, startDate, endDate);
  const rowsByDate = new Map(rows.map((row) => [row.date, row]));
  const daily = listDateKeys(startDate, endDate).map((date) => {
    const row = rowsByDate.get(date);
    return {
      date,
      inputTokens: row?.inputTokens ?? 0,
      cachedInputTokens: row?.cachedInputTokens ?? 0,
      outputTokens: row?.outputTokens ?? 0,
      totalTokens: row?.totalTokens ?? 0,
      costUSD: row?.costUSD ?? 0,
    };
  });

  const totals = daily.reduce(
    (accumulator, day) => {
      accumulator.inputTokens += day.inputTokens;
      accumulator.cachedInputTokens += day.cachedInputTokens;
      accumulator.outputTokens += day.outputTokens;
      accumulator.totalTokens += day.totalTokens;
      accumulator.costUSD += day.costUSD;
      return accumulator;
    },
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUSD: 0,
    },
  );

  return {
    range: options.range,
    days,
    timezone,
    startDate,
    endDate,
    updatedAt: queryLatestUpdateAt(options.db),
    daily,
    totals: {
      ...totals,
      avgTokensPerDay: totals.totalTokens / days,
      avgCostPerDay: totals.costUSD / days,
      cacheHitRate: totals.inputTokens === 0 ? 0 : totals.cachedInputTokens / totals.inputTokens,
      costPerMillionTokens: totals.totalTokens === 0 ? 0 : (totals.costUSD / totals.totalTokens) * 1_000_000,
    },
  };
}

