const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

export function shortcutLabel(key: string) {
  return `${isMac() ? "⌘" : "Ctrl+"}${isMac() ? key.replace("Shift+", "⇧") : key}`;
}

export function shortcutAria(key: string) {
  return `${isMac() ? "Meta" : "Control"}+${key}`;
}

export function isPrimaryShortcut(event: KeyboardEvent, shift = false) {
  return !event.defaultPrevented && !event.isComposing && !event.altKey && event.shiftKey === shift
    && (isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}
