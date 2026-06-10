import { RotateCcw, Sparkles, RefreshCw, CheckCircle, ArrowUpRight, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UpdateCheckResponse } from "@/lib/api";
import type { UpdateInstallStatus } from "@/hooks/use-usage-dashboard";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SettingsPageProps = {
  isResetting: boolean;
  isDisabled: boolean;
  onReset: () => void;
  updateInfo: UpdateCheckResponse | null;
  isUpdateChecking: boolean;
  updateCheckError: string | null;
  updateInstallStatus: UpdateInstallStatus;
  updateInstallError: string | null;
  onCheckUpdates: () => void;
  onUpgrade: () => void;
  onOpenUpdateRelease: () => void;
  showLogsTab: boolean;
  onShowLogsTabChange: (show: boolean) => void;
  trayTitleShow: { limit5h: boolean; limitWeekly: boolean; tokens: boolean; cost: boolean };
  onTrayTitleShowChange: (key: "limit5h" | "limitWeekly" | "tokens" | "cost", value: boolean) => void;
  trayMenuShow: { limit5h: boolean; limitWeekly: boolean; tokens: boolean; cost: boolean };
  onTrayMenuShowChange: (key: "limit5h" | "limitWeekly" | "tokens" | "cost", value: boolean) => void;
};

const TRAY_OPTION_KEYS = {
  limit5h: "5h",
  limitWeekly: "weekly",
  tokens: "tokens",
  cost: "cost",
} as const;

export function SettingsPage({
  isResetting,
  isDisabled,
  onReset,
  updateInfo,
  isUpdateChecking,
  updateCheckError,
  updateInstallStatus,
  updateInstallError,
  onCheckUpdates,
  onUpgrade,
  onOpenUpdateRelease,
  showLogsTab,
  onShowLogsTabChange,
  trayTitleShow,
  onTrayTitleShowChange,
  trayMenuShow,
  onTrayMenuShowChange,
}: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.language || "en";

  const handleLanguageChange = (lang: string) => {
    void i18n.changeLanguage(lang);
    try {
      localStorage.setItem("language", lang);
    } catch (e) {
      // Ignore
    }
  };

  const isInstallingUpdate = updateInstallStatus === "downloading";
  const isUpdateInstalled = updateInstallStatus === "installed";
  const upgradeLabel = isUpdateInstalled
    ? t("settings.btn_restart_update")
    : isInstallingUpdate
      ? t("settings.btn_downloading_update")
      : t("settings.btn_download_update");

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.title")}</CardTitle>
          <CardDescription>{t("settings.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-foreground">{t("settings.cache_title")}</h4>
              <p className="max-w-lg text-sm leading-6 text-muted-foreground">
                {t("settings.cache_desc")}
              </p>
            </div>
            <Button variant="secondary" size="lg" onClick={onReset} disabled={isDisabled}>
              <RotateCcw className={`h-4 w-4 ${isResetting ? "animate-spin" : ""}`} />
              {isResetting ? t("settings.btn_resetting") : t("settings.btn_reset")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.display_title")}</CardTitle>
          <CardDescription>{t("settings.display_desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-foreground">{t("settings.show_logs_title")}</h4>
              <p className="max-w-lg text-sm leading-6 text-muted-foreground">
                {t("settings.show_logs_desc")}
              </p>
            </div>
            <button
              type="button"
              id="toggle-show-logs-tab"
              aria-label={t("settings.toggle_logs_aria")}
              onClick={() => onShowLogsTabChange(!showLogsTab)}
              disabled={isDisabled}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                showLogsTab ? "bg-indigo-600" : "bg-neutral-700"
              } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  showLogsTab ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.menu_bar_title")}</CardTitle>
          <CardDescription>{t("settings.menu_bar_desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="border-t border-border pt-5 space-y-4">
            <h4 className="text-sm font-medium text-foreground">{t("settings.menu_bar_show_title")}</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["limit5h", "limitWeekly", "tokens", "cost"] as const).map((key) => (
                <label key={`title-${key}`} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trayTitleShow[key]}
                    onChange={(e) => onTrayTitleShowChange(key, e.target.checked)}
                    disabled={isDisabled}
                    className="h-4 w-4 rounded border-border bg-neutral-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-background disabled:opacity-50"
                  />
                  <span className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t(`settings.menu_bar_opt_${TRAY_OPTION_KEYS[key]}`)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-5 space-y-4">
            <h4 className="text-sm font-medium text-foreground">{t("settings.menu_bar_show_menu")}</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["limit5h", "limitWeekly", "tokens", "cost"] as const).map((key) => (
                <label key={`menu-${key}`} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trayMenuShow[key]}
                    onChange={(e) => onTrayMenuShowChange(key, e.target.checked)}
                    disabled={isDisabled}
                    className="h-4 w-4 rounded border-border bg-neutral-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-background disabled:opacity-50"
                  />
                  <span className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t(`settings.menu_bar_opt_${TRAY_OPTION_KEYS[key]}`)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.language_title")}</CardTitle>
          <CardDescription>{t("settings.language_desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-foreground">{t("settings.language_label")}</h4>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={currentLanguage}
                onValueChange={handleLanguageChange}
                disabled={isDisabled}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t("settings.language_label")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t("settings.lang_en")}</SelectItem>
                  <SelectItem value="zh">{t("settings.lang_zh")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.updates_title")}</CardTitle>
          <CardDescription>{t("settings.updates_desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-foreground">{t("settings.current_version")}</h4>
                <p className="text-sm text-muted-foreground">
                  v{updateInfo?.currentVersion || tauriConfig.version}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Button 
                  variant="secondary" 
                  size="lg" 
                  onClick={onCheckUpdates} 
                  disabled={isDisabled || isUpdateChecking}
                >
                  <RefreshCw className={`h-4 w-4 ${isUpdateChecking ? "animate-spin" : ""}`} />
                  {isUpdateChecking ? t("settings.btn_checking") : t("settings.btn_check_updates")}
                </Button>
              </div>
            </div>

            {updateCheckError ? (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-200">
                {updateCheckError}
              </div>
            ) : null}

            {updateInstallError ? (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-200">
                {updateInstallError}
              </div>
            ) : null}

            {updateInfo ? (
              <div className="border-t border-border pt-5 space-y-4">
                {updateInfo.hasUpdate ? (
                  <div className="rounded-xl border border-indigo-500/20 bg-gradient-to-r from-indigo-950/20 to-transparent p-5 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-indigo-400 animate-pulse" />
                          {t("settings.update_available", { version: updateInfo.latestVersion })}
                        </h5>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {t("settings.update_available_desc")} {updateInfo.releaseName ? `"${updateInfo.releaseName}"` : ""}
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={onUpgrade}
                        disabled={isDisabled || isInstallingUpdate}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white"
                      >
                        {isUpdateInstalled ? <RotateCw className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                        {upgradeLabel}
                      </Button>
                    </div>
                    {updateInfo.releaseNotes ? (
                      <div className="rounded-lg bg-black/10 border border-white/5 p-3 text-xs font-mono text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                        {updateInfo.releaseNotes}
                      </div>
                    ) : null}
                    {updateInstallError && updateInfo.releaseUrl ? (
                      <Button variant="ghost" size="sm" onClick={onOpenUpdateRelease}>
                        {t("settings.btn_view_release")} <ArrowUpRight className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-200/90">
                    <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
                    <div>
                      <p className="font-medium text-foreground">{t("settings.up_to_date")}</p>
                      <p className="text-xs text-muted-foreground">{t("settings.up_to_date_desc", { version: updateInfo.currentVersion })}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
