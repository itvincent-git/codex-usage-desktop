import { $, $$, browser, expect } from "@wdio/globals";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("UI UX accessibility and compact layouts", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;
  let preferences: Record<string, string | null>;

  before(async () => {
    if (process.env.CODEX_USAGE_REFRESH_E2E !== "1") return;
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    const entries = [
      { type: "session_meta", payload: { cwd: "/ui-ux-regressions" } },
      { type: "turn_context", payload: { model: "gpt-5", cwd: "/ui-ux-regressions" } },
      { type: "event_msg", payload: { type: "user_message", message: "Check keyboard access and readable data" } },
      { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1234567, cached_input_tokens: 123456, output_tokens: 12345, total_tokens: 1246912 } } } },
    ];
    writeFileSync(join(sessions, "ui-ux.jsonl"), entries.map(entry => JSON.stringify({ timestamp, ...entry })).join("\n") + "\n");
    preferences = await browser.execute(async () => {
      const keys = ["language", "sidebar_width", "sidebar_collapsed", "show_logs_tab"];
      const previous = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "en");
      localStorage.setItem("sidebar_width", "240");
      localStorage.setItem("sidebar_collapsed", "false");
      localStorage.setItem("show_logs_tab", "false");
      await (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("scan_usage");
      return previous;
    });
    await browser.refresh();
    await browser.setWindowSize(1100, 760);
    await $('[data-testid="dashboard-hero"]').waitForDisplayed({ timeout: 90_000 });
    await $("button=Rescan local logs").waitForEnabled({ timeout: 90_000 });
  });

  after(async () => {
    if (!preferences) return;
    unlinkSync(join(process.env.CODEX_HOME!, "sessions", "ui-ux.jsonl"));
    await browser.tauri.execute(({ core }) => core.invoke("scan_usage"));
    await browser.tauri.execute(({ core }) => core.invoke("plugin:window|set_theme", { label: "main", value: null }));
    await browser.execute(previous => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    }, preferences);
    await browser.setWindowSize(1440, 960);
    await browser.refresh();
  });

  run("isolates covered content and restores focus for date and chart dialogs", async () => {
    const trigger = $('button[aria-label="Select time range"]');
    await expect(trigger).toBeDisplayed();
    await trigger.execute(el => el.focus());
    await browser.keys("Enter");
    const customRange = $('//*[@role="menuitem" and normalize-space(.)="Select Custom Range..."]');
    await customRange.waitForDisplayed();
    await customRange.click();
    const dialog = $('[role="dialog"][aria-label="Select Custom Range"]');
    await dialog.waitForDisplayed();
    await expect(dialog.$('button[aria-label="Close custom range modal"]')).toBeFocused();

    const expectBackgroundInert = async () => {
      const state = await $("button=Rescan local logs").execute(el => {
        el.focus();
        return { inert: !!el.closest("[inert]"), focused: document.activeElement === el };
      });
      expect(state).toEqual({ inert: true, focused: false });
    };
    await expectBackgroundInert();
    await browser.keys("Tab");
    expect(await browser.execute(() => !!document.activeElement?.closest('[role="dialog"], [data-app-sidebar]'))).toBe(true);
    await browser.keys("Escape");
    await dialog.waitForExist({ reverse: true });
    await expect(trigger).toBeFocused();
    await expect($("button=Rescan local logs")).not.toHaveAttribute("inert");
    expect(await browser.execute(() => document.querySelector("[data-app-content] > .overflow-y-auto")!.hasAttribute("inert"))).toBe(false);

    const expand = $('button[aria-label="Expand chart to full screen"]');
    await expand.click();
    await expect($('button[aria-label="Exit full screen"]')).toBeFocused();
    await expectBackgroundInert();
    await browser.keys("Escape");
    await $('[role="dialog"]').waitForExist({ reverse: true });
    await expect($('button[aria-label="Expand chart to full screen"]')).toBeFocused();

    const info = $('button[aria-label="Estimated cost"]');
    await info.execute(el => el.focus());
    await expect(info).toBeFocused();
    // The embedded driver does not perform native button activation for Enter.
    // Keyboard activation is covered by the component test; exercise the native popover here.
    await info.click();
    await $('[role="dialog"][aria-label="Estimated cost"]').waitForDisplayed();
    await expect($('[role="dialog"][aria-label="Estimated cost"]')).toHaveText(expect.stringContaining("USD"));
    await browser.keys("Escape");
    await expect(info).toBeFocused();
  });

  run("keeps account access visible and supports the vertical tabs keyboard pattern", async () => {
    const accounts = $('[data-testid="accounts-nav-tab"]');
    expect(await accounts.execute(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    await $("button=Manage accounts").click();
    await expect(accounts).toHaveAttribute("aria-selected", "true");
    const dashboard = $('[data-testid="dashboard-nav-tab"]');
    await dashboard.click();
    await dashboard.execute(el => el.focus());
    await browser.keys("ArrowDown");
    const sessions = $('[data-testid="sessions-nav-tab"]');
    await expect(sessions).toBeFocused();
    await expect(sessions).toHaveAttribute("aria-selected", "true");
    await expect($("#page-sessions")).toHaveAttribute("aria-labelledby", "sessions-nav-tab");
    expect(await $$('[data-app-sidebar] [role="tab"][tabindex="0"]').length).toBe(1);
    await browser.keys("End");
    await expect(accounts).toBeFocused();
    await browser.keys("Home");
    await expect(dashboard).toBeFocused();
    await $('[data-testid="dashboard-hero"]').waitForDisplayed();
    const heights = await browser.execute(() => Array.from(document.querySelectorAll('[aria-label="Trend series"] button, [aria-label="Trend view"] button')).map(el => el.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(28);
  });

  run("shows costs without horizontal scrolling with a wide sidebar", async () => {
    await browser.execute(() => localStorage.setItem("sidebar_width", "360"));
    await browser.refresh();
    for (const page of ["daily", "monthly"]) {
      await $(`[data-testid="${page}-nav-tab"]`).click();
      const table = $(".usage-data-table");
      await table.waitForDisplayed({ timeout: 90_000 });
      const layout = await table.execute(el => {
        const scroller = el.parentElement!;
        const cell = el.querySelector("tbody tr td:last-child")!;
        const bounds = scroller.getBoundingClientRect();
        const cost = cell.getBoundingClientRect();
        return { clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth, visible: cost.right <= bounds.right && cost.left >= bounds.left };
      }) as { clientWidth: number; scrollWidth: number; visible: boolean };
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
      expect(layout.visible).toBe(true);
      await browser.saveScreenshot(`/tmp/codex-ui-ux-fixed-${page}.png`);
    }
  });

  run("uses readable text colors in native light and dark themes", async () => {
    await $('[data-testid="dashboard-nav-tab"]').click();
    await $('[data-testid="dashboard-hero"]').waitForDisplayed();
    for (const theme of ["light", "dark"]) {
      await browser.tauri.execute(({ core }, value) => core.invoke("plugin:window|set_theme", { label: "main", value }), theme);
      await browser.waitUntil(async () => browser.execute(value => matchMedia("(prefers-color-scheme: dark)").matches === (value === "dark"), theme));
      await browser.waitUntil(async () => browser.execute(() => {
        const root = getComputedStyle(document.documentElement);
        const color = root.getPropertyValue("--primary").trim().split(/\s+/).join(", ");
        const surface = root.getPropertyValue("--surface").trim().split(/\s+/).join(", ");
        return getComputedStyle(document.querySelector('[data-testid="dashboard-nav-tab"]')!).color === `rgb(${color})`
          && getComputedStyle(document.querySelector(".trend-metrics > div")!).backgroundColor === `rgb(${surface})`;
      }));
      const ratios = await browser.execute(() => {
        const style = getComputedStyle(document.documentElement);
        const rgb = (name: string) => style.getPropertyValue(name).trim().split(/\s+/).map(Number);
        const luminance = (color: number[]) => color.map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
        const ratio = (a: number[], b: number[]) => { const pair = [luminance(a), luminance(b)].sort((x, y) => y - x); return (pair[0] + 0.05) / (pair[1] + 0.05); };
        return ["--primary", "--success-foreground", "--warning-foreground", "--error-foreground", "--muted-foreground"].flatMap(token => ["--surface", "--background"].map(background => ratio(rgb(token), rgb(background)))).concat(ratio(rgb("--primary-foreground"), rgb("--primary")));
      });
      expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
      await browser.saveScreenshot(`/tmp/codex-ui-ux-fixed-${theme}.png`);
    }
  });
});
