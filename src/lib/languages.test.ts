import { describe, expect, it } from "vitest";
import { format } from "date-fns";
import { findLanguage, getLanguage, languages } from "./languages";
import { getReleaseNotes } from "./release-notes";

function translationEntries(translations: object, prefix = ""): [string, string][] {
  return Object.entries(translations).flatMap(([key, value]) => {
    const path = `${prefix}${key}`;
    return typeof value === "string" ? [[path, value]] : translationEntries(value, `${path}.`);
  });
}

describe("language configuration", () => {
  it("matches supported system locales without treating Traditional Chinese as Simplified Chinese", () => {
    expect(findLanguage("en-GB")).toBe("en");
    expect(findLanguage("zh-Hans-SG")).toBe("zh");
    expect(findLanguage("ja-JP")).toBe("ja");
    expect(languages.ja.dateLocale.code).toBe("ja");
  });

  it.each([
    "zh-Hant", "zh-Hant-TW", "zh-Hant-HK", "zh-Hant-MO", "ZH-hANT",
    "zh-TW", "zh-TW-u-nu-latn", "zh-HK", "zh-HK-x-private", "zh-MO", "zh-MO-u-ca-chinese",
  ])("recognizes %s as Traditional Chinese", (locale) => {
    expect(findLanguage(locale)).toBe("zh-Hant");
    expect(getLanguage(locale)).toBe("zh-Hant");
  });

  it.each(["zh", "zh-CN", "zh-SG", "zh-Hans", "zh-Hans-CN", "zh-CN-u-nu-latn"])(
    "keeps %s as Simplified Chinese", (locale) => {
      expect(findLanguage(locale)).toBe("zh");
    },
  );

  it.each(["fr-FR", "unknown", "zh-Hantfoo", "zh-TWfoo"])("falls back to English for %s", (locale) => {
    expect(findLanguage(locale)).toBeUndefined();
    expect(getLanguage(locale)).toBe("en");
  });

  it("uses Taiwanese date and number locales", () => {
    const language = languages["zh-Hant"];
    expect(language.dateLocale.code).toBe("zh-TW");
    expect(language.intlLocale).toBe("zh-TW");
    expect(format(new Date(2026, 9, 7), "PPPP", { locale: language.dateLocale })).toBe("2026年10月7日 星期三");
  });

  it("includes all Chinese translation keys and preserves interpolation parameters", () => {
    const simplified = Object.fromEntries(translationEntries(languages.zh.translations));
    const traditional = Object.fromEntries(translationEntries(languages["zh-Hant"].translations));
    expect(Object.keys(traditional).sort()).toEqual(Object.keys(simplified).sort());
    for (const [key, value] of Object.entries(traditional)) {
      expect(value.trim(), key).not.toBe("");
      const parameters = (text: string) => (text.match(/\{\{[^}]+\}\}|\{(?:remaining|reset)\}/g) ?? []).sort();
      expect(parameters(value), key).toEqual(parameters(simplified[key]));
    }
  });

  it("selects localized release notes and falls back to English", () => {
    const notes = JSON.stringify({ en: "English notes", zh: "中文说明", ja: "日本語の説明" });
    expect(getReleaseNotes(notes, "ja-JP")).toBe("日本語の説明");
    expect(getReleaseNotes(notes, "fr-FR")).toBe("English notes");
    expect(getReleaseNotes('{"en":"English notes","ja":null}', "ja")).toBe("English notes");
    expect(getReleaseNotes("Plain notes", "ja")).toBe("Plain notes");
  });

  it("selects Traditional Chinese release notes and falls back to English when missing", () => {
    const notes = JSON.stringify({ en: "English notes", zh: "简体说明", "zh-Hant": "繁體更新說明" });
    for (const locale of ["zh-Hant", "zh-TW", "zh-HK", "zh-MO"]) {
      expect(getReleaseNotes(notes, locale)).toBe("繁體更新說明");
      expect(getReleaseNotes('{"en":"English notes","zh":"简体说明"}', locale)).toBe("English notes");
    }
    expect(getReleaseNotes(notes, "zh")).toBe("简体说明");
    expect(getReleaseNotes('{"en":"English notes","zh-Hant":null}', "zh-Hant")).toBe("English notes");
  });
});
