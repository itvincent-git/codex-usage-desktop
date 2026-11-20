import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { SessionDetailRow } from "@/lib/api";

export type SessionTab = { id: number; session: SessionDetailRow };

export function SessionTabs({ tabs, selectedId, onSelect, onClose, onBack }: {
  tabs: SessionTab[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
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
    <div data-session-tabs className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border/70 bg-surface px-3 py-1">
      {selectedId !== null ? (
        <Button variant="secondary" size="sm" className="shrink-0" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t("sessions.tabs.back")}
        </Button>
      ) : null}
      <div ref={listRef} role="tablist" aria-label={t("sessions.tabs.label")} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1">
        {tabs.map(({ id, session }, index) => {
          const title = session.threadName || session.sessionId.replace(/\.jsonl(?:\.zst)?$/, "");
          const selected = id === selectedId;
          const tabbable = selected || (selectedId === null && index === 0);
          return (
            <div key={id} role="presentation" className={`flex min-w-0 max-w-[12rem] shrink-0 items-center rounded-md border ${selected ? "border-primary/25 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}>
              <button
                ref={selected ? selectedRef : undefined}
                type="button"
                id={`session-tab-${id}`}
                role="tab"
                aria-selected={selected}
                aria-controls={`session-panel-${id}`}
                aria-keyshortcuts="Delete"
                tabIndex={tabbable ? 0 : -1}
                title={title}
                className="min-w-0 truncate rounded px-2 py-1 text-left text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
