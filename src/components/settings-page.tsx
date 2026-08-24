import { RotateCcw, Sparkles, RefreshCw, CheckCircle, ArrowUpRight, RotateCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UpdateCheckResponse, CodexLimitsResponse } from "@/lib/api";
import type { UpdateInstallStatus, UpdateProgressState } from "@/hooks/use-usage-dashboard";
import { hasSubscription } from "./codex-limits-card";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
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
  updateProgress: UpdateProgressState;
  updateInstallError: string | null;
  onCheckUpdates: () => void;
  onUpgrade: () => void;
  onOpenUpdateRelease: () => void;
  launchAtLogin: boolean;
  launchAtLoginError: string | null;
  isLaunchAtLoginUpdating: boolean;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  showLogsTab: boolean;
  onShowLogsTabChange: (show: boolean) => void;
  trayTitleShow: { limit5h: boolean; limitWeekly: boolean; tokens: boolean; cost: boolean };
  onTrayTitleShowChange: (key: "limit5h" | "limitWeekly" | "tokens" | "cost", value: boolean) => void;
  trayMenuShow: { limit5h: boolean; limitWeekly: boolean; tokens: boolean; cost: boolean };
  onTrayMenuShowChange: (key: "limit5h" | "limitWeekly" | "tokens" | "cost", value: boolean) => void;
  codexLimits: CodexLimitsResponse | null;
};

const TRAY_OPTION_KEYS = {
  limit5h: "5h",
  limitWeekly: "weekly",
  tokens: "tokens",
  cost: "cost",
} as const;

type SettingsSection = "general" | "menuBar" | "maintenance";

const SETTINGS_SECTIONS: SettingsSection[] = ["general", "menuBar", "maintenance"];

export function SettingsPage({
  isResetting,
  isDisabled,
  onReset,
  updateInfo,
  isUpdateChecking,
  updateCheckError,
  updateInstallStatus,
  updateProgress,
  updateInstallError,
  onCheckUpdates,
  onUpgrade,
  onOpenUpdateRelease,
  launchAtLogin,
  launchAtLoginError,
  isLaunchAtLoginUpdating,
  onLaunchAtLoginChange,
  showLogsTab,
  onShowLogsTabChange,
  trayTitleShow,
  onTrayTitleShowChange,
  trayMenuShow,
  onTrayMenuShowChange,
  codexLimits,
}: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const isRateLimitError = !!(
    updateInfo?.releaseNotes?.includes("GitHub API rate limit exceeded") ||
    updateInfo?.releaseNotes?.includes("GitHub API 访问受限")
  );
  const parsedReleaseNotes = useMemo(() => {
    if (!updateInfo?.releaseNotes) return "";
    try {
      const parsed = JSON.parse(updateInfo.releaseNotes);
      if (parsed && typeof parsed === "object") {
        const lang = i18n.language?.startsWith("zh") ? "zh" : "en";
        return parsed[lang] || parsed["en"] || updateInfo.releaseNotes;
      }
    } catch (e) {
      // Ignored: not a JSON object
    }
    return updateInfo.releaseNotes;
  }, [updateInfo?.releaseNotes, i18n.language]);
  const hasSub = hasSubscription(codexLimits);
  const currentLanguage = i18n.language || "en";

  const optionKeys: Array<"limit5h" | "limitWeekly" | "tokens" | "cost"> = hasSub
    ? ["limit5h", "limitWeekly", "tokens", "cost"]
    : ["limitWeekly", "tokens", "cost"];

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
      ? updateProgress.percent === null
        ? t("settings.btn_downloading_update")
        : t("settings.btn_downloading_update_progress", { percent: updateProgress.percent })
      : t("settings.btn_download_update");

  const renderSectionTab = (section: SettingsSection) => {
    const selected = activeSection === section;
    const label = t(`settings.nav_${section === "menuBar" ? "menu_bar" : section}`);
    const sectionId = `settings-section-${section}`;

    return (
      <button
        key={section}
        type="button"
        role="tab"
        id={`settings-tab-${section}`}
        aria-selected={selected}
        aria-controls={sectionId}
        onClick={() => {
          setActiveSection(section);
          document.getElementById(sectionId)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
        }}
        className={`min-w-0 whitespace-normal break-words rounded-md px-3 py-2 text-left text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-background ${
          selected
            ? "bg-indigo-600 text-white shadow-sm"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        {label}
      </button>
    );
  };

  const generalContent = (
    <>
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
                  <SelectItem value="ja">{t("settings.lang_ja")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          <CardTitle>{t("settings.launch_at_login_title")}</CardTitle>
          <CardDescription>{t("settings.launch_at_login_desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              {launchAtLoginError ? (
                <p className="max-w-lg text-sm leading-6 text-error dark:text-red-400">
                  {launchAtLoginError}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              id="toggle-launch-at-login"
              aria-label={t("settings.toggle_launch_at_login_aria")}
              aria-pressed={launchAtLogin}
              onClick={() => onLaunchAtLoginChange(!launchAtLogin)}
              disabled={isDisabled || isLaunchAtLoginUpdating}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                launchAtLogin ? "bg-indigo-600" : "bg-neutral-700"
              } ${isDisabled || isLaunchAtLoginUpdating ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  launchAtLogin ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </CardContent>
      </Card>
    </>
  );

  const menuBarContent = (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.menu_bar_title")}</CardTitle>
        <CardDescription>{t("settings.menu_bar_desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="border-t border-border pt-5 space-y-4">
          <h4 className="text-sm font-medium text-foreground">{t("settings.menu_bar_show_title")}</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {optionKeys.map((key) => (
              <label key={`title-${key}`} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trayTitleShow[key]}
                  onChange={(e) => onTrayTitleShowChange(key, e.target.checked)}
                  disabled={isDisabled}
                  className="h-4 w-4 rounded border-border bg-neutral-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-background disabled:opacity-50"
                />
                <span className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {key === "limitWeekly" && !hasSub
                    ? t("settings.menu_bar_opt_monthly")
                    : t(`settings.menu_bar_opt_${TRAY_OPTION_KEYS[key]}`)}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-5 space-y-4">
          <h4 className="text-sm font-medium text-foreground">{t("settings.menu_bar_show_menu")}</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {optionKeys.map((key) => (
              <label key={`menu-${key}`} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trayMenuShow[key]}
                  onChange={(e) => onTrayMenuShowChange(key, e.target.checked)}
                  disabled={isDisabled}
                  className="h-4 w-4 rounded border-border bg-neutral-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-background disabled:opacity-50"
                />
                <span className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {key === "limitWeekly" && !hasSub
                    ? t("settings.menu_bar_opt_monthly")
                    : t(`settings.menu_bar_opt_${TRAY_OPTION_KEYS[key]}`)}
                </span>
              </label>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const maintenanceContent = (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.cache_title")}</CardTitle>
          <CardDescription>{t("settings.cache_desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-start border-t border-border pt-5 sm:justify-end">
            <Button variant="secondary" size="lg" onClick={onReset} disabled={isDisabled}>
              <RotateCcw className={`h-4 w-4 ${isResetting ? "animate-spin" : ""}`} />
              {isResetting ? t("settings.btn_resetting") : t("settings.btn_reset")}
            </Button>
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
              <div className="rounded-lg bg-red-500/5 dark:bg-red-500/10 border border-red-500/20 p-4 text-sm text-error dark:text-red-400">
                {updateCheckError}
              </div>
            ) : null}

            {updateInstallError ? (
              <div className="rounded-lg bg-red-500/5 dark:bg-red-500/10 border border-red-500/20 p-4 text-sm text-error dark:text-red-400">
                {updateInstallError}
              </div>
            ) : null}

            {updateInfo ? (
              <div className="border-t border-border pt-5 space-y-4">
                {updateInfo.hasUpdate ? (
                  <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/60 via-purple-50/40 to-indigo-50/20 dark:border-indigo-500/20 dark:bg-gradient-to-r dark:from-indigo-950/35 dark:via-purple-950/20 dark:to-indigo-950/10 p-5 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400 animate-pulse" />
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
                      isRateLimitError ? (
                        <div className="rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-500/20 p-3 text-xs text-amber-800 dark:text-amber-300 leading-normal flex items-start gap-2 select-text font-sans">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div className="whitespace-pre-wrap">
                            {t("update.rate_limit_error")}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg bg-indigo-50/50 dark:bg-black/25 border border-indigo-100 dark:border-white/5 p-3 text-xs font-mono text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
                          {parsedReleaseNotes}
                        </div>
                      )
                    ) : null}
                    {isInstallingUpdate ? (
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-500/15"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={updateProgress.percent ?? undefined}
                      >
                        <div
                          className={`h-full rounded-full bg-indigo-600 transition-all duration-300 dark:bg-indigo-400 ${
                            updateProgress.percent === null ? "w-1/2 animate-pulse" : ""
                          }`}
                          style={updateProgress.percent === null ? undefined : { width: `${updateProgress.percent}%` }}
                        />
                      </div>
                    ) : null}
                    {updateInstallError && updateInfo.releaseUrl ? (
                      <Button variant="ghost" size="sm" onClick={onOpenUpdateRelease}>
                        {t("settings.btn_view_release")} <ArrowUpRight className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-emerald-100 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5 p-4 text-sm">
                    <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
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
    </>
  );

  return (
    <div className="max-w-5xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{t("settings.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
        <div
          role="tablist"
          aria-label={t("settings.nav_aria")}
          className="flex gap-2 overflow-x-auto rounded-lg border border-border bg-card p-2 lg:sticky lg:top-4 lg:flex-col lg:self-start lg:overflow-visible"
        >
          {SETTINGS_SECTIONS.map(renderSectionTab)}
        </div>

        <div
          role="tabpanel"
          id="settings-panel"
          aria-label={t("settings.title")}
          className="space-y-4"
        >
          <section
            id="settings-section-general"
            aria-labelledby="settings-tab-general"
            className="scroll-mt-4 space-y-4"
          >
            {generalContent}
          </section>
          <section
            id="settings-section-menuBar"
            aria-labelledby="settings-tab-menuBar"
            className="scroll-mt-4"
          >
            {menuBarContent}
          </section>
          <section
            id="settings-section-maintenance"
            aria-labelledby="settings-tab-maintenance"
            className="scroll-mt-4 space-y-4"
          >
            {maintenanceContent}
          </section>
        </div>
      </div>
    </div>
  );
}
