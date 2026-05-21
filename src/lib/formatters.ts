const numberFormatter = new Intl.NumberFormat("en-US");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const currencyShortFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatNumber(value: number) {
  return numberFormatter.format(Math.round(value));
}

export function formatCompactNumber(value: number) {
  if (Math.abs(value) < 1_000_000) {
    return formatNumber(value);
  }

  return compactNumberFormatter.format(value);
}

export function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

export function formatCurrencyShort(value: number) {
  return currencyShortFormatter.format(value);
}

export function formatPercent(value: number) {
  return percentFormatter.format(value);
}
