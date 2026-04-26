export type RangeKey = "1d" | "7d";

export type OverviewResponse = {
  range: RangeKey;
  days: number;
  timezone: string;
  startDate: string;
  endDate: string;
  updatedAt: string | null;
  daily: Array<{
    date: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
  }>;
  totals: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
    avgTokensPerDay: number;
    avgCostPerDay: number;
    cacheHitRate: number;
    costPerMillionTokens: number;
  };
};

export type ScanResponse = {
  importedDays: number;
  scannedAt: string;
  timezone: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:43110";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function scanUsage(): Promise<ScanResponse> {
  const response = await fetch(`${API_BASE_URL}/api/scan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });

  return readJson<ScanResponse>(response);
}

export async function fetchOverview(range: RangeKey): Promise<OverviewResponse> {
  const response = await fetch(`${API_BASE_URL}/api/overview?range=${range}`);
  return readJson<OverviewResponse>(response);
}

