import { useEffect, useEffectEvent } from "react";
import { isPrimaryShortcut } from "@/lib/keyboard-shortcuts";

export function useRefreshShortcut(onRefresh: () => void, active = true, capture = false) {
  const refresh = useEffectEvent(onRefresh);
  useEffect(() => {
    if (!active) return;
    function handleKey(event: KeyboardEvent) {
      if (!isPrimaryShortcut(event) || event.key.toLowerCase() !== "r") return;
      event.preventDefault();
      if (!event.repeat) refresh();
    }
    window.addEventListener("keydown", handleKey, capture);
    return () => window.removeEventListener("keydown", handleKey, capture);
  }, [active, capture]);
}
