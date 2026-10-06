import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { formatCompactNumber, formatCurrency, formatCurrencyShort, formatNumber, formatPercent } from "./formatters";

describe("number formatting", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it.each(["en", "zh", "zh-Hant", "ja"])("uses English token numbers in %s", async (language) => {
    await i18n.changeLanguage(language);
    expect(formatNumber(1_234_567)).toBe("1,234,567");
    expect(formatCompactNumber(123_456)).toBe("123,456");
    expect(formatCompactNumber(1_234_567)).toBe("1.23M");
  });

  it("keeps costs and percentages localized", async () => {
    await i18n.changeLanguage("ja");
    expect(formatCurrency(12.5)).toBe(new Intl.NumberFormat("ja-JP", {
      style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4,
    }).format(12.5));
    expect(formatPercent(0.125)).toBe(new Intl.NumberFormat("ja-JP", {
      style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
    }).format(0.125));
  });

  it.each(["zh", "zh-Hant"])("omits US from Chinese currency amounts in %s", async (language) => {
    await i18n.changeLanguage(language);
    expect(formatCurrency(12.5)).toBe("$12.50");
    expect(formatCurrencyShort(12.5)).toBe("$12.50");
    expect(formatCurrency(1_234.5678)).toBe("$1,234.5678");
    expect(formatCurrencyShort(1_234.5678)).toBe("$1,234.57");
  });
});
