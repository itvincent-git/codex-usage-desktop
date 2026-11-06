import { useEffect, useRef, type RefObject } from "react";

export function useModalFocus(
  dialogRef: RefObject<HTMLDivElement | null>,
  closeButtonRef: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
  isActive = true,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Preserve the opener when StrictMode replays effects while the background is inert.
    if (previousFocusRef.current === null && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [closeButtonRef]);

  useEffect(() => {
    if (!isActive) return;

    const focusableElements = () => Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => (dialogRef.current?.contains(element) || element.closest("[data-app-sidebar]")) && !element.closest('[hidden], [inert], [aria-hidden="true"]'));

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
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target) && !(event.target instanceof Element && event.target.closest("[data-app-sidebar]"))) {
        closeButtonRef.current?.focus({ preventScroll: true });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocus);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocus);
    };
  }, [closeButtonRef, dialogRef, isActive, onClose]);
}
