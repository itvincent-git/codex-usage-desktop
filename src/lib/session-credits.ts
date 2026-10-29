// Render decimal strings without passing the original amount through Number.
export function formatSessionCredits(raw: string): string {
  const match = /^([+-]?)(\d*\.?\d+|\d+\.)(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return "—";
  const sign = match[1] === "-" ? "-" : "";
  const digits = match[2].replace(".", "");
  if (!/[1-9]/.test(digits)) return "0.00";
  const decimal = (match[2].includes(".") ? match[2].indexOf(".") : match[2].length) + Number(match[3] ?? 0);
  const first = digits.search(/[1-9]/);
  const power = decimal - first - 1;
  const significant = digits.slice(first).replace(/0+$/, "");
  if (power < -6 || power > 12) return `${sign}${significant[0]}${significant.length > 1 ? `.${significant.slice(1, 7)}` : ""}e${power >= 0 ? "+" : ""}${power}`;
  const expanded = decimal <= 0 ? `0.${"0".repeat(-decimal)}${digits}`
    : decimal >= digits.length ? `${digits}${"0".repeat(decimal - digits.length)}`
      : `${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
  const [whole, fraction = ""] = expanded.split(".");
  const places = Math.max(2, power < -1 ? -power + 1 : 2);
  // Truncate only the concise display; the tooltip retains the exact amount.
  return `${sign}${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(places, "0").slice(0, places)}`;
}
