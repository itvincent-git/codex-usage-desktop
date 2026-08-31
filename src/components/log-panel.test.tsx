// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { LogPanel } from "./log-panel";

const loggerCallbacks = vi.hoisted(() => [] as Array<(payload: { level: number; message: string }) => void>);

vi.mock("@tauri-apps/plugin-log", () => ({
  attachLogger: vi.fn((callback) => {
    loggerCallbacks.push(callback);
    return Promise.resolve(() => {});
  }),
  LogLevel: {
    Trace: 0,
    Debug: 1,
    Info: 2,
    Warn: 3,
    Error: 4,
  },
}));

describe("LogPanel", () => {
  beforeEach(async () => {
    loggerCallbacks.length = 0;
    await i18n.changeLanguage("en");
  });

  it("copies all rendered logs in display order", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<LogPanel isActive />);

    act(() => {
      loggerCallbacks[0]({ level: 2, message: "Indexer started" });
      loggerCallbacks[0]({ level: 3, message: "Retrying scan" });
    });

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toMatch(/\] INFO Indexer started\n\[.*\] WARN Retrying scan$/);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("scrolls to the newest log when the logs page becomes active", () => {
    const { rerender } = render(<LogPanel isActive={false} />);

    act(() => {
      loggerCallbacks[0]({ level: 2, message: "Latest log" });
    });

    const scrollContainer = screen.getByText("Latest log").parentElement!.parentElement!;
    Object.defineProperty(scrollContainer, "scrollHeight", { configurable: true, value: 720 });
    fireEvent.scroll(scrollContainer, { target: { scrollTop: 0 } });

    rerender(<LogPanel isActive />);

    expect(scrollContainer.scrollTop).toBe(720);
  });
});
