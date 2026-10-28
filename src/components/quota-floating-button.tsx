import { invoke } from "@tauri-apps/api/core";
import { PanelsTopLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

export function QuotaFloatingButton() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  async function open() {
    setOpening(true);
    setError(null);
    try {
      await invoke("show_quota_window");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="relative z-20">
      <Button variant="secondary" size="sm" onClick={() => void open()} disabled={opening}>
        <PanelsTopLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {t("floating.open")}
      </Button>
      {error ? <p role="alert" className="absolute right-0 top-full mt-1 w-64 rounded border bg-background p-2 text-xs text-error">{error}</p> : null}
    </div>
  );
}
