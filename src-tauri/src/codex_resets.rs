use crate::types::{CodexResetAnnouncement, CodexResetSource};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const TIMELINE_URL: &str = "https://codex-reset.com/api/timeline";
const SOURCE_URL: &str = "https://codex-reset.com/";
const MIN_INTERVAL: Duration = Duration::from_secs(60);
const USER_AGENT: &str = concat!(
    "codex-usage-desktop/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/itvincent-git/codex-usage-desktop)"
);

#[derive(Deserialize)]
struct Timeline {
    events: Vec<TimelineEvent>,
}

#[derive(Deserialize)]
struct TimelineEvent {
    id: String,
    group: String,
    announced_at: String,
    summary: String,
    url: Option<String>,
    #[serde(default)]
    confirmed: bool,
    #[serde(default)]
    banked_grant: bool,
}

pub fn fetch_latest_reset() -> Result<Option<CodexResetAnnouncement>, String> {
    fetch_timeline().map(|resets| {
        resets
            .into_iter()
            .find(|reset| reset.reset_type == "regular")
    })
}

pub fn fetch_reset_history(days: u32) -> Result<Vec<CodexResetAnnouncement>, String> {
    fetch_timeline().map(|resets| history_since(resets, days, Utc::now()))
}

fn history_since(
    resets: Vec<CodexResetAnnouncement>,
    days: u32,
    now: DateTime<Utc>,
) -> Vec<CodexResetAnnouncement> {
    let from = now - ChronoDuration::days(i64::from(days.clamp(1, 365)));
    resets
        .into_iter()
        .filter(|reset| {
            DateTime::parse_from_rfc3339(&reset.announced_at)
                .is_ok_and(|date| date >= from && date <= now)
        })
        .collect()
}

#[derive(Default)]
struct Cache {
    next_request: Option<Instant>,
    result: Option<Result<Vec<CodexResetAnnouncement>, String>>,
}

impl Cache {
    fn get_or_fetch(
        &mut self,
        now: Instant,
        request: impl FnOnce() -> (Result<Vec<CodexResetAnnouncement>, String>, Duration),
    ) -> Result<Vec<CodexResetAnnouncement>, String> {
        if self.next_request.is_none_or(|next| now >= next) {
            let (result, delay) = request();
            self.next_request = Some(now + delay.max(MIN_INTERVAL));
            self.result = Some(result);
        }
        self.result.clone().expect("cached timeline result")
    }
}

fn fetch_timeline() -> Result<Vec<CodexResetAnnouncement>, String> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    // Latest reset, overview and modal share one bounded request, including errors.
    CACHE
        .get_or_init(Default::default)
        .lock()
        .map_err(|error| error.to_string())?
        .get_or_fetch(Instant::now(), || request(TIMELINE_URL))
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

fn request(url: &str) -> (Result<Vec<CodexResetAnnouncement>, String>, Duration) {
    let started = Instant::now();
    let mut delay = MIN_INTERVAL;
    let result = (|| {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(6))
            .user_agent(USER_AGENT)
            .build()
            .map_err(|error| format!("Failed to build Codex Reset HTTP client: {error}"))?;
        let response = client
            .get(url)
            .header("Accept", "application/json")
            .send()
            .map_err(|error| format!("Codex Reset timeline request failed: {error}"))?;
        let status = response.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            delay = retry_delay(
                response
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok()),
                Utc::now(),
            );
        }
        if !status.is_success() {
            return Err(format!("Codex Reset timeline returned status {status}"));
        }
        let body = response
            .text()
            .map_err(|error| format!("Failed to read Codex Reset timeline: {error}"))?;
        parse_timeline(&body)
    })();
    match &result {
        Ok(resets) => log::info!(
            "Codex Reset timeline fetched. count={} elapsedMs={}",
            resets.len(),
            started.elapsed().as_millis()
        ),
        Err(error) => log::warn!(
            "Failed to fetch Codex Reset timeline. elapsedMs={} error={error}",
            started.elapsed().as_millis()
        ),
    }
    (result, delay + started.elapsed())
}

fn parse_timeline(body: &str) -> Result<Vec<CodexResetAnnouncement>, String> {
    let timeline: Timeline = serde_json::from_str(body)
        .map_err(|error| format!("Failed to parse Codex Reset timeline JSON: {error}"))?;
    let mut resets = Vec::new();
    for event in timeline.events {
        let reset_type = match event.group.as_str() {
            "reset" if event.confirmed => "regular",
            "reset" | "credits" if event.banked_grant => "banked",
            _ => continue,
        };
        let date = DateTime::parse_from_rfc3339(&event.announced_at)
            .map_err(|error| format!("Invalid Codex Reset timestamp: {error}"))?;
        let reset = CodexResetAnnouncement {
            id: event.id,
            reset_type: reset_type.to_string(),
            announced_at: date.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            text: event.summary,
            source: CodexResetSource {
                author: None,
                url: event.url.unwrap_or_else(|| SOURCE_URL.to_string()),
            },
        };
        // Some announcements both reset usage and grant a banked reset.
        if reset_type == "regular" && event.banked_grant {
            resets.push(CodexResetAnnouncement {
                id: format!("{}-banked", reset.id),
                reset_type: "banked".to_string(),
                ..reset.clone()
            });
        }
        resets.push(reset);
    }
    resets.sort_by(|left, right| right.announced_at.cmp(&left.announced_at));
    Ok(resets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    fn fixture() -> String {
        json!({"events":[
            {"id":"old", "group":"reset", "announced_at":"2026-09-01T00:00:00Z", "summary":"Archived reset", "url":null, "confirmed":true},
            {"id":"pending", "group":"reset", "announced_at":"2026-10-26T08:00:00Z", "summary":"Tomorrow", "url":null, "confirmed":false},
            {"id":"update", "group":"credits", "announced_at":"2026-10-26T07:00:00Z", "summary":"Grant arrived", "url":null, "banked_grant":false},
            {"id":"reset", "group":"reset", "announced_at":"2026-10-26T06:08:46Z", "summary":"Reset confirmed", "url":"https://x.com/thsottiaux/status/1", "confirmed":true},
            {"id":"grant", "group":"credits", "announced_at":"2026-10-26T07:00:00+00:00", "summary":"Banked reset", "url":null, "banked_grant":true},
            {"id":"other", "group":"boost", "announced_at":"2026-10-26T09:00:00Z", "summary":"Boost", "url":null, "confirmed":true}
        ]}).to_string()
    }

    #[test]
    fn maps_verified_resets_and_grants_without_counting_promises_or_grant_updates() {
        let resets = parse_timeline(&fixture()).unwrap();
        assert_eq!(
            resets.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["grant", "reset", "old"]
        );
        assert_eq!(resets[0].reset_type, "banked");
        assert_eq!(resets[0].source.url, SOURCE_URL);
        assert_eq!(resets[0].source.author, None);
        assert_eq!(resets[1].source.url, "https://x.com/thsottiaux/status/1");
        assert_eq!(resets[1].announced_at, "2026-10-26T06:08:46.000Z");
        assert_eq!(
            resets
                .into_iter()
                .find(|r| r.reset_type == "regular")
                .unwrap()
                .id,
            "reset"
        );
        assert!(parse_timeline(r#"{"events":[]}"#).unwrap().is_empty());
        assert!(parse_timeline(r#"{"data":[]}"#).is_err());
    }

    #[test]
    fn filters_history_locally_for_each_requested_range() {
        let now = DateTime::parse_from_rfc3339("2026-10-26T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            history_since(parse_timeline(&fixture()).unwrap(), 30, now).len(),
            2
        );
        assert_eq!(
            history_since(parse_timeline(&fixture()).unwrap(), 365, now).len(),
            3
        );
        assert!(history_since(
            parse_timeline(&fixture()).unwrap(),
            30,
            now - ChronoDuration::days(60)
        )
        .is_empty());
    }

    #[test]
    fn retains_both_parts_of_a_reset_with_a_banked_grant() {
        let mut timeline: serde_json::Value = serde_json::from_str(&fixture()).unwrap();
        timeline["events"][3]["banked_grant"] = json!(true);
        let resets = parse_timeline(&timeline.to_string()).unwrap();
        assert_eq!(resets.len(), 4);
        let grant = resets
            .iter()
            .find(|reset| reset.id == "reset-banked")
            .unwrap();
        assert_eq!(grant.reset_type, "banked");
        assert_eq!(grant.announced_at, "2026-10-26T06:08:46.000Z");
    }

    #[test]
    fn shares_cached_success_and_errors_across_history_and_latest_requests() {
        let mut cache = Cache::default();
        let now = Instant::now();
        let first = cache
            .get_or_fetch(now, || (parse_timeline(&fixture()), MIN_INTERVAL))
            .unwrap();
        assert_eq!(
            cache
                .get_or_fetch(now + Duration::from_secs(59), || panic!(
                    "duplicate request"
                ))
                .unwrap(),
            first
        );
        assert!(cache
            .get_or_fetch(now + MIN_INTERVAL, || (
                Err("429".into()),
                Duration::from_secs(180)
            ))
            .is_err());
        assert!(cache
            .get_or_fetch(now + Duration::from_secs(239), || panic!("retry too soon"))
            .is_err());
        assert!(cache
            .get_or_fetch(now + Duration::from_secs(240), || (
                Ok(vec![]),
                MIN_INTERVAL
            ))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn identifies_client_and_honors_http_retry_after() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/api/timeline", server.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            let mut buffer = [0; 4096];
            let n = stream.read(&mut buffer).unwrap();
            let received = String::from_utf8_lossy(&buffer[..n]);
            assert!(received.contains("GET /api/timeline "));
            assert!(received.contains(USER_AGENT));
            stream.write_all(b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 180\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let (result, delay) = request(&url);
        handle.join().unwrap();
        assert!(result.unwrap_err().contains("429"));
        assert!(delay >= Duration::from_secs(180));
        let now = DateTime::parse_from_rfc3339("2026-10-26T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            retry_delay(Some("Mon, 26 Oct 2026 00:03:00 GMT"), now),
            Duration::from_secs(180)
        );
        assert_eq!(retry_delay(Some("invalid"), now), MIN_INTERVAL);
    }
}
