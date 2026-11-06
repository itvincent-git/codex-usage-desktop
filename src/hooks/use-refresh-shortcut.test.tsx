// @vitest-environment jsdom
import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRefreshShortcut } from "./use-refresh-shortcut";

afterEach(() => vi.restoreAllMocks());

it.each(["MacIntel", "Win32"])("uses the platform modifier and ignores composition, repeats and other shortcuts on %s", (platform) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  const refresh = vi.fn();
  renderHook(() => useRefreshShortcut(refresh));
  const modifier = platform === "MacIntel" ? { metaKey: true } : { ctrlKey: true };
  for (const extra of [{ isComposing: true }, { shiftKey: true }, { altKey: true }, { repeat: true }]) {
    fireEvent.keyDown(window, { key: "r", ...modifier, ...extra });
  }
  fireEvent.keyDown(window, { key: "r", ...(platform === "MacIntel" ? { ctrlKey: true } : { metaKey: true }) });
  expect(refresh).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(window, { key: "r", ...modifier })).toBe(false);
  expect(refresh).toHaveBeenCalledOnce();
});

it("routes refresh to the active modal and uses its latest callback", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const background = vi.fn();
  const project = vi.fn();
  const detail = vi.fn();
  renderHook(() => useRefreshShortcut(background));
  const modal = renderHook(({ callback, active }) => useRefreshShortcut(callback, active, true), {
    initialProps: { callback: project, active: true },
  });
  fireEvent.keyDown(window, { key: "r", metaKey: true });
  expect(project).toHaveBeenCalledOnce();
  expect(background).not.toHaveBeenCalled();
  modal.rerender({ callback: detail, active: true });
  fireEvent.keyDown(window, { key: "r", metaKey: true });
  expect(detail).toHaveBeenCalledOnce();
  expect(project).toHaveBeenCalledOnce();
  modal.rerender({ callback: detail, active: false });
  fireEvent.keyDown(window, { key: "r", metaKey: true });
  expect(background).toHaveBeenCalledOnce();
});
