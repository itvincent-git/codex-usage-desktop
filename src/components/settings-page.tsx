import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SettingsPageProps = {
  isResetting: boolean;
  isDisabled: boolean;
  onReset: () => void;
};

export function SettingsPage({ isResetting, isDisabled, onReset }: SettingsPageProps) {
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
    </div>
  );
}
