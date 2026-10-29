import { $, browser, expect } from "@wdio/globals";

describe("language startup", () => {
  it("uses the saved language in the native app", async () => {
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "ja"));
      await browser.refresh();
      await expect($('//button[@aria-label="設定"]')).toBeDisplayed();
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  });

  for (const { code, name, settings, languageSettings } of [
    { code: "zh-Hant", name: "繁體中文", settings: "設定", languageSettings: "語言設定" },
    { code: "ko", name: "한국어", settings: "설정", languageSettings: "언어 설정" },
  ]) {
    it(`switches from English to ${name} and restores it after refresh`, async () => {
      const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
      try {
        await browser.execute(() => localStorage.setItem("language", "en"));
        await browser.refresh();
        const settingsTab = $('//button[@aria-label="Settings"]');
        await expect(settingsTab).toBeDisplayed();
        await settingsTab.click();

        const languageSelect = $('//button[@role="combobox" and normalize-space()="English"]');
        await expect(languageSelect).toBeDisplayed();
        await languageSelect.waitForEnabled();
        await languageSelect.click();
        const languageOption = $(`//*[@role="option" and normalize-space()="${name}"]`);
        await expect(languageOption).toBeDisplayed();
        await languageOption.click();

        const translatedSettingsTab = $(`//button[@aria-label="${settings}"]`);
        await expect($(`h1=${settings}`)).toBeDisplayed();
        await expect($(`h3=${languageSettings}`)).toBeDisplayed();
        await expect($(`//button[@role="combobox" and normalize-space()="${name}"]`)).toBeDisplayed();
        expect(await browser.execute(() => localStorage.getItem("language"))).toBe(code);

        await browser.refresh();
        await expect(translatedSettingsTab).toBeDisplayed();
        await translatedSettingsTab.click();
        await expect($(`h3=${languageSettings}`)).toBeDisplayed();
        await expect($(`//button[@role="combobox" and normalize-space()="${name}"]`)).toBeDisplayed();
      } finally {
        await browser.execute((language) => {
          if (language === null) localStorage.removeItem("language");
          else localStorage.setItem("language", language);
        }, previousLanguage);
        await browser.refresh();
      }
    });
  }
});
