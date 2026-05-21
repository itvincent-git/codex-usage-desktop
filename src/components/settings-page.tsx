import { RotateCcw, Sparkles, RefreshCw, CheckCircle, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UpdateCheckResponse } from "@/lib/api";

type SettingsPageProps = {
  isResetting: boolean;
  isDisabled: boolean;
  onReset: () => void;
  updateInfo: UpdateCheckResponse | null;
  isUpdateChecking: boolean;
  updateCheckError: string | null;
  onCheckUpdates: () => void;
  onUpgrade: () => void;
};

export function SettingsPage({
  isResetting,
  isDisabled,
  onReset,
  updateInfo,
  isUpdateChecking,
  updateCheckError,
  onCheckUpdates,
  onUpgrade,
}: SettingsPageProps) {
  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Manage local app state and recovery actions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-foreground">Local cache</h4>
              <p className="max-w-lg text-sm leading-6 text-muted-foreground">
                Clear cached usage, incremental scan data, and pricing data, then rebuild from local Codex logs.
              </p>
            </div>
            <Button variant="secondary" size="lg" onClick={onReset} disabled={isDisabled}>
              <RotateCcw className={`h-4 w-4 ${isResetting ? "animate-spin" : ""}`} />
              {isResetting ? "Resetting" : "Reset cache"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>App Updates</CardTitle>
          <CardDescription>Check for updates and manage desktop application versions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-foreground">Current Version</h4>
                <p className="text-sm text-muted-foreground">
                  v{updateInfo?.currentVersion || "0.4.0"}
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
                  {isUpdateChecking ? "Checking..." : "Check for updates"}
                </Button>
              </div>
            </div>

            {updateCheckError ? (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-200">
                {updateCheckError}
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
                          Version v{updateInfo.latestVersion} is available!
                        </h5>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          A newer release was found on GitHub. {updateInfo.releaseName ? `"${updateInfo.releaseName}"` : ""}
                        </p>
                      </div>
                      <Button variant="primary" size="sm" onClick={onUpgrade} className="bg-indigo-600 hover:bg-indigo-500 text-white">
                        Upgrade <ArrowUpRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {updateInfo.releaseNotes ? (
                      <div className="rounded-lg bg-black/10 border border-white/5 p-3 text-xs font-mono text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                        {updateInfo.releaseNotes}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-200/90">
                    <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
                    <div>
                      <p className="font-medium text-foreground">You are up to date!</p>
                      <p className="text-xs text-muted-foreground">v{updateInfo.currentVersion} is the latest version available.</p>
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

