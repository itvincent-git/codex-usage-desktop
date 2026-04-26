import type { DatabaseSync } from "node:sqlite";
import { recordScanRun, upsertDailyRows } from "./db";
import { resolveAppTimezone } from "./date";
import { runCodexDailyReport } from "./codexCli";

function normalizeReportDate(dateLabel: string) {
  return new Date(`${dateLabel} 00:00:00 UTC`).toISOString().slice(0, 10);
}

export async function scanCodexUsage(options: {
  db: DatabaseSync;
  codexHome?: string;
  timezone?: string;
}) {
  const timezone = options.timezone ?? resolveAppTimezone();
  const scannedAt = new Date().toISOString();
  const report = await runCodexDailyReport({
    codexHome: options.codexHome,
    timezone,
  });

  const rows = report.daily.map((row) => ({
    ...row,
    date: normalizeReportDate(row.date),
    updatedAt: scannedAt,
  }));

  upsertDailyRows(options.db, rows);
  recordScanRun(options.db, scannedAt, timezone, rows.length);

  return {
    importedDays: rows.length,
    scannedAt,
    timezone,
  };
}
