export function resolveAppTimezone() {
  return process.env.CODEX_USAGE_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function dateKeyInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to resolve date key.");
  }

  return `${year}-${month}-${day}`;
}

export function shiftDateKey(dateKey: string, deltaDays: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

export function listDateKeys(startDate: string, endDate: string) {
  const keys: string[] = [];
  let current = startDate;

  while (current <= endDate) {
    keys.push(current);
    current = shiftDateKey(current, 1);
  }

  return keys;
}

