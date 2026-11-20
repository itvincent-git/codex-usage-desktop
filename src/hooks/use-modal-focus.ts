import { useEffect, useRef, type RefObject } from "react";

export function useModalFocus(
  dialogRef: RefObject<HTMLDivElement | null>,
  closeButtonRef: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
  isActive = true,
  options: { isolateBackground?: boolean; restoreFocusRef?: RefObject<HTMLButtonElement | null>; allowSessionTabs?: boolean } = {},
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const { isolateBackground = false, restoreFocusRef, allowSessionTabs = false } = options;
  const manageFocus = !isolateBackground || isActive;

  useEffect(() => {
    if (!manageFocus) return;
    // Preserve the opener when StrictMode replays effects while the background is inert.
    if (previousFocusRef.current === null && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    const background = isolateBackground
      ? document.querySelector<HTMLElement>("[data-app-content] > .overflow-y-auto")
      : null;
    const wasInert = background?.inert ?? false;
    const previousHidden = background?.getAttribute("aria-hidden");
    if (background) {
      background.inert = true;
      background.setAttribute("aria-hidden", "true");
    }
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      if (background) {
        background.inert = wasInert;
        if (previousHidden == null) background.removeAttribute("aria-hidden");
        else background.setAttribute("aria-hidden", previousHidden);
      }
      if (restoreFocusRef) {
        // Portals replace the chart trigger; restore after refs and focus guards settle.
        requestAnimationFrame(() => restoreFocusRef.current?.focus({ preventScroll: true }));
      } else {
        previousFocusRef.current?.focus({ preventScroll: true });
      }
    };
  }, [closeButtonRef, manageFocus, isolateBackground, restoreFocusRef]);

  useEffect(() => {
    if (!isActive) return;
    const navigation = allowSessionTabs ? "[data-app-sidebar], [data-session-tabs]" : "[data-app-sidebar]";

    const focusableElements = () => Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.tabIndex >= 0 && (dialogRef.current?.contains(element) || element.closest(navigation)) && !element.closest('[hidden], [inert], [aria-hidden="true"]'));

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    function handleFocus(event: FocusEvent) {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target) && !(event.target instanceof Element && event.target.closest(navigation))) {
        closeButtonRef.current?.focus({ preventScroll: true });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocus);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocus);
    };
  }, [closeButtonRef, dialogRef, isActive, onClose, allowSessionTabs]);
}
