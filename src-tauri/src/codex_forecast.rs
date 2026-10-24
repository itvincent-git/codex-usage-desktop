use crate::types::{CodexForecastAlert, CodexForecastPost, CodexQuotaForecastResponse};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const FORECAST_URL: &str = "https://codex-reset.com/api/forecast";
const FEED_URL: &str = "https://codex-reset.com/api/feed";
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
        recent_posts: None,
        posts_stale: false,
        posts_updated_at: None,
    })
}

#[derive(Deserialize)]
struct Feed {
    tweets: Vec<FeedPost>,
    fetched_at: Option<String>,
    #[serde(default)]
    stale: bool,
}

#[derive(Deserialize)]
struct FeedPost {
    id: String,
    text: String,
    url: String,
    at: String,
    kind: Option<String>,
    #[serde(default)]
    explicit_reset_claim: bool,
    tease_classification: Option<TeaseClassification>,
}

#[derive(Deserialize)]
struct TeaseClassification {
    #[serde(default)]
    teasing: bool,
}

fn recent_posts(mut feed: Feed) -> Vec<CodexForecastPost> {
    feed.tweets.sort_by(|a, b| b.at.cmp(&a.at));
    feed.tweets
        .into_iter()
        .take(5)
        .map(|post| {
            let kind = post.kind.as_deref();
            let text = post.text.to_ascii_lowercase();
            let signal = if kind == Some("signal")
                || (kind == Some("candidate")
                    && (text.starts_with("landing ") || text.starts_with("lands ")))
            {
                Some("expected")
            } else if matches!(kind, Some("reset" | "candidate")) || post.explicit_reset_claim {
                Some("reset")
            } else if post.tease_classification.is_some_and(|value| value.teasing) {
                Some("hint")
            } else {
                None
            };
            CodexForecastPost {
                id: post.id,
                text: post.text,
                url: post.url,
                at: post.at,
                signal: signal.map(str::to_string),
            }
        })
        .collect()
}

fn request_feed(url: &str) -> Result<Feed, reqwest::Error> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent(USER_AGENT)
        .build()?
        .get(url)
        .header("Accept", "application/json")
        .send()?
        .error_for_status()?
        .json()
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
            let (mut result, retry_after) = request();
            if let (Ok(data), Some(Ok(previous))) = (&mut result, &self.result) {
                if data.recent_posts.is_none() && previous.recent_posts.is_some() {
                    data.recent_posts = previous.recent_posts.clone();
                    data.posts_updated_at = previous.posts_updated_at.clone();
                    data.posts_stale = true;
                }
            }
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
        .get_or_fetch(locale, Instant::now(), || {
            let (mut result, delay) = request(FORECAST_URL, locale);
            if let Ok(data) = &mut result {
                match request_feed(FEED_URL) {
                    Ok(feed) => {
                        data.posts_stale = feed.stale;
                        data.posts_updated_at = feed.fetched_at.clone();
                        data.recent_posts = Some(recent_posts(feed));
                    }
                    Err(error) => log::warn!("Failed to load Tibo posts: {error}"),
                }
            }
            (result, delay)
        })
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
    fn maps_five_recent_posts_and_provider_signals_without_claiming_confirmation() {
        let posts: Vec<_> = [
            ("other", "I demand a reset", false),
            ("codex", "We'll see", true),
            ("candidate", "Today is reset day", false),
            ("candidate", "Landing tomorrow before 10am PST", false),
            ("signal", "Within the next two hours", false),
            ("boost", "CLI updates", false),
        ]
        .into_iter()
        .enumerate()
        .map(|(i, (kind, text, teasing))| {
            json!({
                "id": i.to_string(), "text": text,
                "url": format!("https://x.com/thsottiaux/status/{i}"),
                "at": format!("2026-10-24T00:0{i}:00Z"), "kind": kind,
                "reset_verification_status": "expired",
                "tease_classification": { "teasing": teasing }
            })
        })
        .collect();
        let feed: Feed = serde_json::from_value(json!({ "tweets": posts })).unwrap();
        let posts = recent_posts(feed);
        assert_eq!(posts.len(), 5);
        assert_eq!(
            posts
                .iter()
                .map(|p| p.signal.as_deref())
                .collect::<Vec<_>>(),
            vec![
                None,
                Some("expected"),
                Some("expected"),
                Some("reset"),
                Some("hint")
            ]
        );
        assert_eq!(posts[0].id, "5");
        assert_eq!(posts[1].url, "https://x.com/thsottiaux/status/4");
        let feed: Feed = serde_json::from_value(json!({"tweets": [{
            "id": "1", "text": "I demand a reset", "url": "https://x.com/thsottiaux/status/1",
            "at": "2026-10-24T00:00:00Z", "kind": "other"
        }]}))
        .unwrap();
        assert!(recent_posts(feed)[0].signal.is_none());
    }

    #[test]
    fn retains_previous_posts_as_stale_when_only_the_feed_fails() {
        let now = Instant::now();
        let mut cache = Cache::default();
        let mut first = parse(&fixture(serde_json::Value::Null)).unwrap();
        first.recent_posts = Some(vec![CodexForecastPost {
            id: "1".into(),
            text: "Post".into(),
            url: "https://x.com/thsottiaux/status/1".into(),
            at: "2026-10-24T00:00:00Z".into(),
            signal: None,
        }]);
        first.posts_updated_at = Some("2026-10-24T00:00:00Z".into());
        cache
            .get_or_fetch("en", now, || (Ok(first.clone()), MIN_INTERVAL))
            .unwrap();
        let refreshed = cache
            .get_or_fetch("en", now + MIN_INTERVAL, || {
                (parse(&fixture(serde_json::Value::Null)), MIN_INTERVAL)
            })
            .unwrap();
        assert_eq!(refreshed.recent_posts, first.recent_posts);
        assert_eq!(refreshed.posts_updated_at, first.posts_updated_at);
        assert!(refreshed.posts_stale);
    }

    #[test]
    fn loads_feed_from_http_and_preserves_source_freshness() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/api/feed", server.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            let mut buffer = [0; 4096];
            let n = stream.read(&mut buffer).unwrap();
            let received = String::from_utf8_lossy(&buffer[..n]);
            assert!(received.contains("/api/feed"));
            assert!(received.contains(USER_AGENT));
            let body = r#"{"tweets":[],"stale":true,"fetched_at":"2026-10-24T00:00:00Z"}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let feed = request_feed(&url).unwrap();
        handle.join().unwrap();
        assert!(feed.stale);
        assert_eq!(feed.fetched_at.as_deref(), Some("2026-10-24T00:00:00Z"));
        assert!(recent_posts(feed).is_empty());
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
