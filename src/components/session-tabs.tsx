import * as ContextMenu from "@radix-ui/react-context-menu";
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { SessionDetailRow } from "@/lib/api";

export type SessionTab = { id: number; session: SessionDetailRow };
export type SessionTabCloseAction = "close" | "others" | "after" | "all";

export function SessionTabs({ tabs, selectedId, onSelect, onClose, onBack }: {
  tabs: SessionTab[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number, action?: SessionTabCloseAction) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const selectedRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const tab = selectedRef.current;
    if (!tab) return;
    tab.focus({ preventScroll: true });
    const list = listRef.current;
    if (!list || !tab.parentElement) return;
    const item = tab.parentElement.getBoundingClientRect();
    const viewport = list.getBoundingClientRect();
    if (item.left < viewport.left) list.scrollLeft += item.left - viewport.left;
    else if (item.right > viewport.right) list.scrollLeft += item.right - viewport.right;
  }, [selectedId, tabs.length]);

  function handleKey(event: KeyboardEvent, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowLeft": nextIndex = (index + tabs.length - 1) % tabs.length; break;
      case "ArrowRight": nextIndex = (index + 1) % tabs.length; break;
      case "Home": nextIndex = 0; break;
      case "End": nextIndex = tabs.length - 1; break;
      case "Delete":
        event.preventDefault();
        if (!event.repeat) onClose(tabs[index].id);
        return;
      default: return;
    }
    event.preventDefault();
    onSelect(tabs[nextIndex].id);
  }

  return (
    <div data-session-tabs className="pointer-events-none relative z-10 flex min-h-[var(--window-controls-height)] min-w-0 shrink-0 items-center gap-2 border-b border-border/70 bg-surface pl-3 pr-8">
      {selectedId !== null ? (
        <Button variant="secondary" size="sm" className="pointer-events-auto shrink-0" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t("sessions.tabs.back")}
        </Button>
      ) : null}
      <div ref={listRef} role="tablist" aria-label={t("sessions.tabs.label")} className="pointer-events-auto flex min-w-0 items-center gap-1 overflow-x-auto px-1 py-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(({ id, session }, index) => {
          const title = session.threadName || session.sessionId.replace(/\.jsonl(?:\.zst)?$/, "");
          const selected = id === selectedId;
          const tabbable = selected || (selectedId === null && index === 0);
          const closeActions = [
            { action: "close", disabled: false },
            { action: "others", disabled: tabs.length === 1 },
            { action: "after", disabled: index === tabs.length - 1 },
            { action: "all", disabled: false },
          ] as const;
          return (
            <ContextMenu.Root key={id} modal={false}>
              <ContextMenu.Trigger role="presentation" className={`flex min-w-0 max-w-[12rem] shrink-0 items-center rounded-md border ${selected ? "border-primary/25 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}>
                <button
                  ref={selected ? selectedRef : undefined}
                  type="button"
                  id={`session-tab-${id}`}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`session-panel-${id}`}
                  aria-haspopup="menu"
                  aria-keyshortcuts="Delete"
                  tabIndex={tabbable ? 0 : -1}
                  title={title}
                  className="min-w-0 select-none truncate rounded px-2 py-1 text-left text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => onSelect(id)}
                  onKeyDown={(event) => handleKey(event, index)}
                >
                  {title}
                </button>
                <button
                  type="button"
                  tabIndex={tabbable ? 0 : -1}
                  aria-label={t("sessions.tabs.close", { title })}
                  title={t("sessions.tabs.close", { title })}
                  className="mr-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onClose(id)}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content
                  data-session-tab-menu
                  aria-label={title}
                  collisionPadding={8}
                  className="z-50 min-w-[12rem] rounded-sm border border-border bg-background p-1 text-foreground shadow-lg"
                >
                  {closeActions.map(({ action, disabled }) => (
                    <ContextMenu.Item
                      key={action}
                      disabled={disabled}
                      className="cursor-default select-none rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
                      onSelect={() => onClose(id, action)}
                    >
                      {t(`sessions.tabs.menu.${action}`)}
                    </ContextMenu.Item>
                  ))}
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
    </div>
  );
}
