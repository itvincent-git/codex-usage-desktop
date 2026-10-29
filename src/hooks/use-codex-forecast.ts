import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCodexQuotaForecast, type CodexQuotaForecastResponse } from "@/lib/api";

export function useCodexForecast(active: boolean, language: string) {
  const locale = language.startsWith("zh") ? "zh" : language.startsWith("ja") ? "ja" : "en";
  const [data, setData] = useState<CodexQuotaForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlight = useRef<{ locale: string; promise: Promise<void> } | null>(null);
  const currentLocale = useRef(locale);
  currentLocale.current = locale;

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current?.locale === locale) return inFlight.current.promise;
    setIsRefreshing(true);
    const request = { locale, promise: Promise.resolve() };
    inFlight.current = request;
    request.promise = (async () => {
      try {
        const response = await fetchCodexQuotaForecast(locale);
        if (currentLocale.current !== locale) return;
        setData(response);
        setError(null);
      } catch (error) {
        if (currentLocale.current !== locale) return;
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (inFlight.current === request) {
          inFlight.current = null;
          setIsRefreshing(false);
        }
      }
    })();
    return request.promise;
  }, [locale]);

  useEffect(() => {
    if (!active) return;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    const timer = window.setInterval(refreshVisible, 60_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [active, refresh]);

  return { data, error, isRefreshing, refresh };
}
