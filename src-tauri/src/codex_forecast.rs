use crate::types::{CodexForecastAlert, CodexQuotaForecastResponse};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const FORECAST_URL: &str = "https://codex-reset.com/api/forecast";
const MIN_INTERVAL: Duration = Duration::from_secs(60);
const USER_AGENT: &str = concat!(
    "codex-usage-desktop/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/itvincent-git/codex-usage-desktop)"
);

#[derive(Deserialize)]
struct Forecast {
    probabilities: Probabilities,
    updated_at: String,
    confidence: Option<String>,
    last_reset_at: Option<String>,
    latest_alert: Option<CodexForecastAlert>,
}

#[derive(Deserialize)]
struct Probabilities {
    rounded_24h: i64,
    rounded_48h: i64,
}

fn parse(body: &str) -> Result<CodexQuotaForecastResponse, String> {
    let response: Forecast = serde_json::from_str(body)
        .map_err(|error| format!("Failed to parse forecast JSON: {error}"))?;
    Ok(CodexQuotaForecastResponse {
        probability_24h: response.probabilities.rounded_24h,
        probability_48h: response.probabilities.rounded_48h,
        updated_at: response.updated_at,
        confidence: response.confidence,
        last_reset_at: response.last_reset_at,
        latest_alert: response.latest_alert,
    })
}

#[derive(Default)]
struct Cache {
    next_request: Option<Instant>,
    locale: String,
    result: Option<Result<CodexQuotaForecastResponse, String>>,
}

impl Cache {
    fn get_or_fetch(
        &mut self,
        locale: &str,
        now: Instant,
        request: impl FnOnce() -> (Result<CodexQuotaForecastResponse, String>, Duration),
    ) -> Result<CodexQuotaForecastResponse, String> {
        if self.next_request.is_none_or(|next| now >= next) {
            let (result, retry_after) = request();
            self.next_request = Some(now + retry_after.max(MIN_INTERVAL));
            self.locale = locale.to_string();
            self.result = Some(result);
        }
        let mut result = self.result.clone().expect("cached request result");
        // A language change must also respect the global request interval.
        // Use the original English summary until a localized copy can be fetched.
        if self.locale != locale {
            if let Ok(data) = &mut result {
                if let Some(alert) = &mut data.latest_alert {
                    alert.localized_summary = None;
                }
            }
        }
        result
    }
}

pub fn fetch(locale: &str) -> Result<CodexQuotaForecastResponse, String> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    let locale = match locale {
        "zh" | "zh-Hant" => "zh",
        "ja" => "ja",
        _ => "en",
    };
    // Hold the lock through the bounded request so all concurrent callers share
    // its result (including errors), and every trigger respects the same clock.
    CACHE
        .get_or_init(Default::default)
        .lock()
        .map_err(|error| error.to_string())?
        .get_or_fetch(locale, Instant::now(), || request(FORECAST_URL, locale))
}

fn retry_delay(value: Option<&str>, now: DateTime<Utc>) -> Duration {
    value
        .and_then(|value| {
            value
                .trim()
                .parse::<u64>()
                .ok()
                .map(Duration::from_secs)
                .or_else(|| {
                    DateTime::parse_from_rfc2822(value)
                        .ok()
                        .and_then(|date| (date.with_timezone(&Utc) - now).to_std().ok())
                })
        })
        .unwrap_or(MIN_INTERVAL)
        .max(MIN_INTERVAL)
}

fn request(url: &str, locale: &str) -> (Result<CodexQuotaForecastResponse, String>, Duration) {
    let started = Instant::now();
    let mut delay = MIN_INTERVAL;
    let result = (|| {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(6))
            .user_agent(USER_AGENT)
            .build()
            .map_err(|error| format!("Failed to build forecast HTTP client: {error}"))?;
        let response = client
            .get(url)
            .query(&[("locale", locale)])
            .header("Accept", "application/json")
            .send()
            .map_err(|error| format!("Forecast request failed: {error}"))?;
        let status = response.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            delay = retry_delay(
                response
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok()),
                Utc::now(),
            ) + started.elapsed();
        }
        if !status.is_success() {
            return Err(format!("Forecast endpoint returned status {status}"));
        }
        let body = response
            .text()
            .map_err(|error| format!("Failed to read forecast response: {error}"))?;
        parse(&body)
    })();
    if let Err(error) = &result {
        log::warn!("{error}");
    }
    (result, delay)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    };
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    fn fixture(alert: serde_json::Value) -> String {
        json!({"probabilities":{"rounded_24h":0,"rounded_48h":100},
            "updated_at":"2026-10-24T00:00:00Z", "confidence":"low",
            "last_reset_at":"2026-10-23T00:00:00Z", "latest_alert":alert})
        .to_string()
    }

    #[test]
    fn maps_documented_probabilities_and_null_signals() {
        let data = parse(&fixture(serde_json::Value::Null)).unwrap();
        assert_eq!((data.probability_24h, data.probability_48h), (0, 100));
        assert_eq!(data.confidence.as_deref(), Some("low"));
        assert_eq!(data.updated_at, "2026-10-24T00:00:00Z");
        assert_eq!(data.last_reset_at.as_deref(), Some("2026-10-23T00:00:00Z"));
        assert!(data.latest_alert.is_none());
    }

    #[test]
    fn retains_alert_states_without_inventing_confirmation_or_probabilities() {
        for (kind, state, pending) in [
            ("watch", "active", None),
            ("watch", "active", Some("done")),
            ("watch", "active", Some("on_its_way")),
            ("watch", "expired", None),
            ("reset", "confirmed", None),
            ("future-kind", "future-state", None),
        ] {
            let data = parse(&fixture(
                json!({"kind":kind,"state":state,"pending":pending,
                "score":93,"summary":"Original", "localized_summary":"摘要",
                "window":{"start_at":"2026-10-24T01:00:00Z","end_at":"2026-10-24T02:00:00Z"},
                "observed_at":"2026-10-23T00:00:00Z"}),
            ))
            .unwrap();
            assert_eq!((data.probability_24h, data.probability_48h), (0, 100));
            let encoded = serde_json::to_value(&data).unwrap();
            assert_eq!(encoded["probability24h"], 0);
            assert_eq!(encoded["probability48h"], 100);
            assert_eq!(encoded["latestAlert"]["localizedSummary"], "摘要");
            assert_eq!(
                encoded["latestAlert"]["window"]["endAt"],
                "2026-10-24T02:00:00Z"
            );
            let alert = data.latest_alert.unwrap();
            assert_eq!(alert.state.as_deref(), Some(state));
            assert_eq!(alert.pending.as_deref(), pending);
            assert_eq!(alert.score, Some(93));
            assert!(alert.confirmed_at.is_none());
            assert_eq!(alert.localized_summary.as_deref(), Some("摘要"));
            assert_eq!(
                alert.window.unwrap().end_at.as_deref(),
                Some("2026-10-24T02:00:00Z")
            );
        }
        assert!(parse(
            r#"{"probabilities":{"rounded_24h":39,"rounded_48h":63},"updated_at":"now"}"#
        )
        .is_ok());
    }

    #[test]
    fn caches_success_and_failure_for_at_least_sixty_seconds_across_locales() {
        let mut cache = Cache::default();
        let now = Instant::now();
        cache
            .get_or_fetch("zh", now, || {
                (
                    parse(&fixture(json!({"localized_summary":"摘要"}))),
                    MIN_INTERVAL,
                )
            })
            .unwrap();
        let cached = cache
            .get_or_fetch("en", now + Duration::from_secs(59), || panic!("too soon"))
            .unwrap();
        assert!(cached.latest_alert.unwrap().localized_summary.is_none());
        assert!(cache
            .get_or_fetch("en", now + MIN_INTERVAL, || (
                Err("offline".into()),
                MIN_INTERVAL
            ))
            .is_err());
        assert_eq!(
            cache.get_or_fetch("en", now + Duration::from_secs(119), || panic!(
                "retry too soon"
            )),
            Err("offline".into())
        );
        assert!(cache
            .get_or_fetch("ja", now + Duration::from_secs(120), || (
                parse(&fixture(serde_json::Value::Null)),
                MIN_INTERVAL
            ))
            .is_ok());
    }

    #[test]
    fn concurrent_callers_share_one_request() {
        let cache = Arc::new(Mutex::new(Cache::default()));
        let calls = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(8));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let (cache, calls, barrier) = (cache.clone(), calls.clone(), barrier.clone());
                thread::spawn(move || {
                    barrier.wait();
                    cache
                        .lock()
                        .unwrap()
                        .get_or_fetch("en", Instant::now(), || {
                            calls.fetch_add(1, Ordering::SeqCst);
                            (parse(&fixture(serde_json::Value::Null)), MIN_INTERVAL)
                        })
                        .unwrap()
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn honors_retry_after_and_identifies_the_client() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/api/forecast", server.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            let mut buffer = [0; 4096];
            let n = stream.read(&mut buffer).unwrap();
            let received = String::from_utf8_lossy(&buffer[..n]);
            assert!(received.contains("/api/forecast?locale=ja"));
            assert!(received.contains(USER_AGENT));
            stream.write_all(b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 180\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let (result, delay) = request(&url, "ja");
        handle.join().unwrap();
        assert!(result.unwrap_err().contains("429"));
        assert!(delay >= Duration::from_secs(180));
        assert!(delay < Duration::from_secs(181));
        let mut cache = Cache::default();
        let now = Instant::now();
        assert!(cache
            .get_or_fetch("en", now, || (Err("429".into()), delay))
            .is_err());
        assert!(cache
            .get_or_fetch("en", now + Duration::from_secs(179), || panic!(
                "retry too soon"
            ))
            .is_err());
        assert!(cache
            .get_or_fetch("en", now + delay, || (
                parse(&fixture(serde_json::Value::Null)),
                MIN_INTERVAL
            ))
            .is_ok());
    }

    #[test]
    fn retry_after_accepts_dates_and_falls_back_to_sixty_seconds() {
        let now = DateTime::parse_from_rfc3339("2026-10-24T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        for value in [
            None,
            Some("garbage"),
            Some("0"),
            Some("-1"),
            Some("Fri, 23 Oct 2026 00:00:00 GMT"),
        ] {
            assert_eq!(retry_delay(value, now), MIN_INTERVAL);
        }
        assert_eq!(
            retry_delay(Some("Sat, 24 Oct 2026 00:03:00 GMT"), now),
            Duration::from_secs(180)
        );
        assert_eq!(
            retry_delay(
                Some("Sat, 24 Oct 2026 00:03:00 GMT"),
                now + chrono::Duration::milliseconds(500)
            ),
            Duration::from_millis(179_500)
        );
    }
}
