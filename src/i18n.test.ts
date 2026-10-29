// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Korean language startup", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.stubGlobal("navigator", { language: "ko-KR", languages: ["ko-KR", "en-US"] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("detects Korean from the system language list", async () => {
    vi.stubGlobal("navigator", { language: "fr-FR", languages: ["fr-FR", "ko-KR", "en-US"] });
    const { default: i18n } = await import("./i18n");
    expect(i18n.resolvedLanguage).toBe("ko");
    expect(i18n.t("settings.language_title")).toBe("언어 설정");
  });

  it("detects Korean when only navigator.language is available", async () => {
    vi.stubGlobal("navigator", { language: "ko-KR" });
    const { default: i18n } = await import("./i18n");
    expect(i18n.resolvedLanguage).toBe("ko");
  });

  it("restores saved Korean on an English system", async () => {
    localStorage.setItem("language", "ko");
    vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
    const { default: i18n } = await import("./i18n");
    expect(i18n.resolvedLanguage).toBe("ko");
  });

  it("preserves an explicit English preference on a Korean system", async () => {
    localStorage.setItem("language", "en");
    const { default: i18n } = await import("./i18n");
    expect(i18n.resolvedLanguage).toBe("en");
  });

  it("uses Korean when the saved language is unsupported", async () => {
    localStorage.setItem("language", "unsupported");
    const { default: i18n } = await import("./i18n");
    expect(i18n.resolvedLanguage).toBe("ko");
  });

  it("uses Korean when local storage is unavailable", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Storage unavailable"); } });
    const { default: i18n } = await import("./i18n");
    expect(i18n.resolvedLanguage).toBe("ko");
  });

  it.each([0, 1, 2])("renders Korean count labels for %i without falling back to English", async (count) => {
    const { default: i18n } = await import("./i18n");
    expect(i18n.t("sessions.count_sessions", { count })).toBe(`세션 ${count}개`);
    expect(i18n.t("sessions.count_turns", { count })).toBe(`${count}턴`);
    expect(i18n.t("settings.auto_refresh_minutes", { count })).toBe(`${count}분마다`);
  });
});
