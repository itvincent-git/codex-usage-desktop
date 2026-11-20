import { $, $$, browser, expect } from "@wdio/globals";
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("session detail tabs", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("keeps two replays and returns to the same project list", async () => {
    const home = process.env.CODEX_HOME!;
    const sessions = join(home, "sessions");
    const archived = join(home, "archived_sessions");
    mkdirSync(sessions, { recursive: true });
    mkdirSync(archived, { recursive: true });
    const projectPath = "/session-tabs-test";
    const betaThread = "01977e3d-d9f6-72b7-93cf-f3f2f83c3b42";
    const betaName = `rollout-2026-10-15T09-00-00-${betaThread}.jsonl`;
    const alpha = join(sessions, "tabs-alpha.jsonl");
    const beta = join(sessions, betaName);
    const timestamp = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    const encode = (time: string, records: object[]) => records.map((record) => JSON.stringify({ timestamp: time, ...record })).join("\n") + "\n";
    const message = (text: string) => ({ type: "event_msg", payload: { type: "agent_message", message: text } });
    const log = (name: string, daysAgo: number, id?: string, cwd = projectPath) => encode(timestamp(daysAgo), [
      { type: "session_meta", payload: { id, cwd } },
      { type: "turn_context", payload: { model: "gpt-5", cwd } },
      { type: "event_msg", payload: { type: "task_started", turn_id: "intro" } },
      { type: "event_msg", payload: { type: "user_message", message: `Tabs fixture ${name}` } },
      message("Introductory reply"),
      { type: "event_msg", payload: { type: "task_complete", turn_id: "intro" } },
      { type: "event_msg", payload: { type: "task_started", turn_id: "reading" } },
      message(`${name} needle first\n\n${"A paragraph to make the replay scroll.\n\n".repeat(70)}${name} needle second\n\n${"More replay content.\n\n".repeat(70)}`),
      { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } } },
    ]);
    writeFileSync(alpha, log("Alpha", 1));
    writeFileSync(beta, log("Beta", 2, betaThread));
    writeFileSync(join(sessions, "tabs-ignored.jsonl"), log("Ignored", 1).replace("Tabs fixture Ignored", "Unrelated project session"));
    const overflowNames = Array.from({ length: 6 }, (_, index) => `Long session title for scrolling ${index + 1}`);
    for (const [index, name] of overflowNames.entries()) {
      writeFileSync(join(sessions, `tab-overflow-${index}.jsonl`), log(name, 1, undefined, "/tab-overflow-test"));
    }
    await browser.execute(async () => {
      localStorage.setItem("language", "en");
      localStorage.setItem("auto_refresh_interval_minutes", "60");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
    });
    await browser.refresh();
    await browser.setWindowSize(1200, 780);

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    const tabs = () => $('[role="tablist"][aria-label="Open sessions"]');
    const tab = (name: string) => tabs().$(`[role="tab"]=Tabs fixture ${name}`);
    const card = (name: string) => `[data-testid="session-card"]:has(h3[title="Tabs fixture ${name}"])`;
    const detail = () => $('[aria-labelledby="session-detail-title"]');
    const searchInput = () => detail().$('input[type="search"]');
    const searchStatus = () => detail().$('[role="search"] [role="status"]');
    const detailScroll = () => detail().$('[data-testid="session-detail-scroll"]');
    const back = $("button=Back to list");
    const readAfterSecondMatch = async (position: number) => {
      await detail().$('button[aria-label="Next match (Enter)"]').click();
      await expect(searchStatus()).toHaveText("2 / 2");
      await browser.waitUntil(async () => detail().$('[data-testid="session-search-current"]').execute(
        (element) => element.nextSibling?.textContent?.startsWith(" second") ?? false,
      ));
      return browser.execute((top) => {
        const scroll = document.querySelector<HTMLElement>('[aria-labelledby="session-detail-title"] [data-testid="session-detail-scroll"]')!;
        scroll.scrollTop = top;
        return scroll.scrollTop;
      }, position);
    };
    const expectSelected = async (name: string) => {
      await expect(tab(name)).toHaveAttribute("aria-selected", "true");
      await expect(tab(name)).toBeFocused();
      await expect(detail().$("h2")).toHaveText(`Tabs fixture ${name}`);
    };

    const sessionsNav = $('[data-testid="sessions-nav-tab"]');
    await $("button=Rescan local logs").waitForEnabled({ timeout: 90_000 });
    await sessionsNav.click();
    await $(card("Alpha")).waitForDisplayed();
    await $(card("Alpha")).click();
    await expectSelected("Alpha");
    const introTurn = () => detail().$('//button[@aria-expanded and .//*[normalize-space(.)="Turn intro"]]');
    await introTurn().waitForDisplayed();
    await introTurn().click();
    await expect(introTurn()).toHaveAttribute("aria-expanded", "false");
    await browser.keys([modifier, "f"]);
    await expect(searchInput()).toBeFocused();
    await searchInput().setValue("Alpha needle");
    await expect(searchStatus()).toHaveText("1 / 2");
    const alphaScroll = await readAfterSecondMatch(200);
    expect(alphaScroll).toBe(200);

    await back.click();
    await expect($(card("Alpha"))).toBeFocused();
    await expect(tab("Alpha")).toHaveAttribute("aria-selected", "false");
    const alphaId = await tab("Alpha").getAttribute("id");
    await $(card("Alpha")).click();
    await expectSelected("Alpha");
    expect(await tab("Alpha").getAttribute("id")).toBe(alphaId);
    await expect(tabs().$$('[role="tab"]')).toBeElementsArrayOfSize(1);

    const projectsNav = $('[data-testid="projects-nav-tab"]');
    await projectsNav.click();
    await expect(tab("Alpha")).toHaveAttribute("aria-selected", "false");
    const projectRow = $('//tr[@role="button" and .//p[text()="/session-tabs-test"]]');
    await projectRow.waitForDisplayed();
    await projectRow.click();
    const project = $('[aria-labelledby="modal-project-title"]');
    const projectSearch = project.$('input[aria-label="Search project sessions"]');
    const projectScroll = project.$('[data-testid="project-modal-scroll"]');
    const days = () => project.$$('[id^="date-group-"] > button');
    await project.$('[data-testid="session-card"]:has(h3[title="Unrelated project session"])').waitForDisplayed();
    await projectSearch.setValue("Tabs fixture");
    await expect(project.$("p=Showing 2 matching sessions")).toBeDisplayed();
    await expect(days()).toBeElementsArrayOfSize(2);
    await days()[0].click();
    await days()[1].click();
    await expect(days()[0]).toHaveAttribute("aria-expanded", "false");
    await expect(days()[1]).toHaveAttribute("aria-expanded", "true");
    const betaCard = () => project.$(card("Beta"));
    await betaCard().waitForDisplayed();
    await betaCard().execute((element) => {
      const scroll = element.closest<HTMLElement>('[data-testid="project-modal-scroll"]')!;
      scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 40;
      element.addEventListener("click", () => {
        scroll.dataset.positionAtOpen = String(scroll.scrollTop);
      }, { capture: true, once: true });
    });
    await betaCard().click();
    await expectSelected("Beta");
    const projectPosition = Number(await projectScroll.getAttribute("data-position-at-open"));
    expect(projectPosition).toBeGreaterThan(0);
    const betaId = await tab("Beta").getAttribute("id");
    await expect(tabs().$$('[role="tab"]')).toBeElementsArrayOfSize(2);
    await expect($$('[id^="session-panel-"]')).toBeElementsArrayOfSize(2);
    await detail().$("button=Raw JSONL").click();
    await browser.keys([modifier, "f"]);
    await searchInput().setValue("Beta needle");
    await expect(searchStatus()).toHaveText("1 / 2");
    const betaScroll = await readAfterSecondMatch(160);
    expect(betaScroll).toBe(160);

    await tab("Alpha").click();
    await expectSelected("Alpha");
    await expect(searchInput()).toHaveValue("Alpha needle");
    await expect(searchStatus()).toHaveText("2 / 2");
    await expect(introTurn()).toHaveAttribute("aria-expanded", "false");
    expect(await detailScroll().execute((element) => element.scrollTop)).toBe(alphaScroll);
    await browser.keys("ArrowRight");
    await expectSelected("Beta");
    await expect(detail().$("div=Raw JSONL preview")).toBeDisplayed();
    await expect(searchInput()).toHaveValue("Beta needle");
    await expect(searchStatus()).toHaveText("2 / 2");
    expect(await detailScroll().execute((element) => element.scrollTop)).toBe(betaScroll);

    await $('button[aria-label="Settings"]').click();
    await expect($("h1=Settings")).toBeDisplayed();
    await expect(tabs()).not.toBeDisplayed();
    await $("button=Back").click();
    await expectSelected("Beta");
    await expect(searchStatus()).toHaveText("2 / 2");
    await browser.keys("Home");
    await expectSelected("Alpha");
    await browser.keys("End");
    await expectSelected("Beta");
    await browser.keys("ArrowLeft");
    await expectSelected("Alpha");
    await browser.keys("End");

    appendFileSync(alpha, encode(timestamp(1), [message("Unrefreshed Alpha update")]));
    renameSync(beta, join(archived, betaName));
    await browser.keys([modifier, "r"]);
    await expect(detail().$('[data-testid="session-archived-badge"]')).toHaveText("Archived");
    expect(await tab("Beta").getAttribute("id")).toBe(betaId);
    await expect(detail().$("div=Raw JSONL preview")).toBeDisplayed();
    await expect(searchStatus()).toHaveText("2 / 2");
    expect(await detailScroll().execute((element) => element.scrollTop)).toBe(betaScroll);
    await tab("Alpha").click();
    await expectSelected("Alpha");
    await expect(detail()).not.toHaveText(expect.stringContaining("Unrefreshed Alpha update"));
    await expect(searchStatus()).toHaveText("2 / 2");

    await back.click();
    await expect(projectSearch).toHaveValue("Tabs fixture");
    await expect(days()[0]).toHaveAttribute("aria-expanded", "false");
    await expect(days()[1]).toHaveAttribute("aria-expanded", "true");
    await expect(betaCard().$('[data-testid="session-archived-badge"]')).toHaveText("Archived");
    expect(await projectScroll.execute((element) => element.scrollTop)).toBe(projectPosition);
    await betaCard().click();
    await expectSelected("Beta");
    expect(await tab("Beta").getAttribute("id")).toBe(betaId);
    await expect(tabs().$$('[role="tab"]')).toBeElementsArrayOfSize(2);

    await $('button[aria-label="Close tab: Tabs fixture Beta"]').click();
    await expectSelected("Alpha");
    await expect(tab("Beta")).not.toBeExisting();
    await back.click();
    await betaCard().click();
    await expectSelected("Beta");
    expect(await tab("Beta").getAttribute("id")).not.toBe(betaId);
    await browser.keys("Home");
    await expectSelected("Alpha");
    await browser.keys("Delete");
    await expectSelected("Beta");
    await expect(tabs().$$('[role="tab"]')).toBeElementsArrayOfSize(1);
    await expect(introTurn()).toHaveAttribute("aria-expanded", "true");

    await browser.keys([modifier, "f"]);
    await searchInput().setValue("Beta needle");
    await expect(searchStatus()).toHaveText("1 / 2");
    await browser.keys("Escape");
    await expect(searchInput()).toHaveValue("");
    await browser.keys("Escape");
    await expect(searchInput()).not.toBeExisting();
    await expect(tab("Beta")).toHaveAttribute("aria-selected", "true");
    await browser.keys("Escape");
    await expect(tabs()).not.toBeExisting();
    await expect(project).toBeDisplayed();
    await expect(projectSearch).toHaveValue("Tabs fixture");
    await expect(days()[1]).toHaveAttribute("aria-expanded", "true");
    await expect(betaCard()).toBeFocused();

    await sessionsNav.click();
    for (const name of overflowNames) {
      await $(card(name)).waitForDisplayed();
      await $(card(name)).click();
      await expectSelected(name);
      if (name !== overflowNames.at(-1)) await back.click();
    }
    const tabStrip = () => browser.execute(() => {
      const list = document.querySelector('[role="tablist"][aria-label="Open sessions"]')!;
      const bounds = list.getBoundingClientRect();
      const selected = list.querySelector('[aria-selected="true"]')!.parentElement!.getBoundingClientRect();
      return { offset: list.scrollLeft, selectedVisible: selected.left >= bounds.left - 1 && selected.right <= bounds.right + 1 };
    });
    const lastOffset = (await tabStrip()).offset;
    expect(lastOffset).toBeGreaterThan(0);
    await browser.keys("Home");
    await expectSelected(overflowNames[0]);
    const first = await tabStrip();
    expect(first.offset).toBeLessThan(lastOffset);
    expect(first.selectedVisible).toBe(true);
    await browser.keys("End");
    await expectSelected(overflowNames.at(-1)!);
    expect(await tabStrip()).toEqual({ offset: lastOffset, selectedVisible: true });
    await browser.refresh();
    await sessionsNav.waitForDisplayed();
    await expect(tabs()).not.toBeExisting();
  }).timeout(180_000);
});
