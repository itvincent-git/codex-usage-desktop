export type TrayPopoverData = {
  account: string | null;
  membership: string | null;
  workspace: string | null;
  quotas: {
    kind: "5h" | "weekly" | "monthly";
    label: string;
    remainingPercent: number | null;
    usedText: string;
    resetText: string;
  }[];
  tokens: { value: string; exact: string } | null;
  cost: string | null;
  labels: {
    remaining: string;
    today: string;
    cost: string;
    unavailable: string;
    showMain: string;
    quit: string;
  };
};
