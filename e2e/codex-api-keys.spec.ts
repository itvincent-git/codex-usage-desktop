import { $, browser, expect } from "@wdio/globals";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountList } from "../src/lib/codex-accounts";

async function accounts(): Promise<AccountList> {
  return browser.execute(async () => {
    const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string) => Promise<T> } }).__TAURI_INTERNALS__;
    return runtime.invoke<AccountList>("list_codex_accounts");
  });
}

describe("API Key accounts in the native app", () => {
  it("saves official and compatible keys, switches endpoints, and restores ChatGPT", async () => {
    await browser.execute(() => { localStorage.clear(); localStorage.setItem("language", "en"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="accounts-nav-tab"]').click();
    await $('[data-account-id="alice"]').waitForDisplayed();
    const home = process.env.CODEX_HOME!;
    const authPath = join(home, "auth.json");
    const configPath = join(home, "config.toml");
    const originalAuth = JSON.parse(readFileSync(authPath, "utf8"));
    const originalConfig = readFileSync(configPath, "utf8");
    for (const [name, key, url] of [
      ["Official API", "fixture-official-api-key", ""],
      ["Gateway API", "fixture-gateway-api-key", "http://localhost:12345/v1"],
    ]) {
      await $("button=Add account").click();
      const methods = $('[role="dialog"]');
      const chatgpt = methods.$('section[aria-labelledby="account-chatgpt-methods"]');
      await expect(chatgpt.$("button=Sign in with browser")).toBeDisplayed();
      await expect(chatgpt.$("button=Use device code")).toBeDisplayed();
      await expect(chatgpt.$("button=Add API Key")).not.toExist();
      await methods.$('section[aria-labelledby="account-api-method"]').$("button=Add API Key").click();
      const dialog = $('[role="dialog"]');
      const fields = dialog.$$("input");
      await expect(dialog.$("button=Save API Key")).toBeDisabled();
      await fields[0].setValue(name);
      await fields[1].setValue(key);
      await expect(fields[1]).toHaveAttribute("type", "password");
      if (url) await fields[2].setValue(url);
      await expect(dialog.$("button=Save API Key")).toBeEnabled();
      if (url) await browser.saveScreenshot("/tmp/codex-api-key-form.png");
      await dialog.$("button=Save API Key").click();
      await expect(dialog).not.toExist();
      const saved = (await accounts()).accounts.find((account) => account.email === name)!;
      expect(saved.authMode).toBe("apikey");
      expect(saved.current).toBe(false);
      expect(JSON.stringify(await accounts())).not.toContain(key);
      expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual(originalAuth);
      const card = $(`[data-account-id="${saved.id}"]`);
      await expect(card.$('[role="meter"]')).not.toExist();
      await expect(card.$('button[aria-label="Refresh"]')).not.toExist();
      await expect(card.$("button=Switch Codex sign-in")).toHaveStyle({ color: "rgb(255,255,255)" });
      await card.$("button=Switch Codex sign-in").click();
      await expect(card).toHaveAttribute("aria-current", "true");
      expect(JSON.parse(readFileSync(authPath, "utf8")).OPENAI_API_KEY).toBe(key);
      expect(readFileSync(configPath, "utf8")).toContain(url || "https://api.openai.com/v1");
      await $('dialog[aria-labelledby="account-restart-title"]').$("button=Got it").click();
      await $('[data-account-id="alice"]').$("button=Switch Codex sign-in").click();
      await expect($('[data-account-id="alice"]')).toHaveAttribute("aria-current", "true");
      await $('dialog[aria-labelledby="account-restart-title"]').$("button=Got it").click();
      expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual(originalAuth);
      expect(readFileSync(configPath, "utf8")).toBe(originalConfig);
    }
  });

  it("clears an imported API endpoint without a configuration backup", async () => {
    const home = process.env.CODEX_HOME!;
    const authPath = join(home, "auth.json");
    const configPath = join(home, "config.toml");
    const originalAuth = JSON.parse(readFileSync(authPath, "utf8"));
    const originalConfig = readFileSync(configPath, "utf8");
    writeFileSync(authPath, JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "fixture-imported-key" }));
    writeFileSync(configPath, `model_provider='openai'\nopenai_base_url='https://gateway.example.test/v1'\n${originalConfig}`);
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="accounts-nav-tab"]').click();
    const alice = $('[data-account-id="alice"]');
    await expect(alice).not.toHaveAttribute("aria-current", "true");
    await alice.$("button=Switch Codex sign-in").click();
    await expect(alice).toHaveAttribute("aria-current", "true");
    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual(originalAuth);
    expect(readFileSync(configPath, "utf8")).toBe(originalConfig);
    await $('dialog[aria-labelledby="account-restart-title"]').$("button=Got it").click();
  });

  it("distinguishes ChatGPT sign-in and API Key setup in Chinese", async () => {
    await browser.execute(() => { localStorage.setItem("language", "zh"); });
    await browser.refresh();
    await $('[data-testid="accounts-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="accounts-nav-tab"]').click();
    await $("button=添加账号").click();
    const dialog = $('[role="dialog"]');
    const chatgpt = dialog.$('section[aria-labelledby="account-chatgpt-methods"]');
    const apiKey = dialog.$('section[aria-labelledby="account-api-method"]');
    await expect(chatgpt.$("h3=ChatGPT 账号")).toBeDisplayed();
    await expect(chatgpt.$("button=在浏览器中登录")).toBeDisplayed();
    await expect(chatgpt.$("button=使用设备码登录").$("svg")).toHaveAttribute("class", expect.stringContaining("lucide-monitor-smartphone"));
    await expect(apiKey.$("h3=API Key")).toBeDisplayed();
    await expect(apiKey.$("button=添加 API Key").$("svg")).toHaveAttribute("class", expect.stringContaining("lucide-key-round"));
    await browser.saveScreenshot("/tmp/codex-add-account-methods-zh.png");
    await dialog.$('button[aria-label="关闭"]').click();
    await expect(dialog).not.toExist();
  });

});
