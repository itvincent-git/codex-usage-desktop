use crate::types::CodexResetAnnouncement;
use chrono::{Duration as ChronoDuration, SecondsFormat, Utc};
use serde::Deserialize;
use std::time::{Duration, Instant};

const CODEX_RESETS_STATUS_URL: &str = "https://codex-resets.com/api/v1/status";
const CODEX_RESETS_LIST_URL: &str = "https://codex-resets.com/api/v1/resets";

#[derive(Debug, Deserialize)]
struct StatusResponse {
    data: StatusData,
}

#[derive(Debug, Deserialize)]
struct StatusData {
    latest_reset: Option<CodexResetAnnouncement>,
}

#[derive(Debug, Deserialize)]
struct ResetListResponse {
    data: Vec<CodexResetAnnouncement>,
}

pub fn fetch_latest_reset() -> Result<Option<CodexResetAnnouncement>, String> {
    let started = Instant::now();
    log::info!("Fetching latest Codex reset announcement.");

    let result =
        send_request(CODEX_RESETS_STATUS_URL, &[]).and_then(|body| parse_latest_reset(&body));

    match &result {
        Ok(Some(reset)) => log::info!(
            "Latest Codex reset fetched. id={} type={} announcedAt={} elapsedMs={}",
            reset.id,
            reset.reset_type,
            reset.announced_at,
            started.elapsed().as_millis()
        ),
        Ok(None) => log::warn!(
            "Codex Resets status returned no latest reset. elapsedMs={}",
            started.elapsed().as_millis()
        ),
        Err(error) => log::warn!(
            "Failed to fetch latest Codex reset. elapsedMs={} error={error}",
            started.elapsed().as_millis()
        ),
    }

    result
}

pub fn fetch_reset_history(days: u32) -> Result<Vec<CodexResetAnnouncement>, String> {
    let days = days.clamp(1, 365);
    let started = Instant::now();
    log::info!("Fetching Codex reset history. days={days}");
    let from = (Utc::now() - ChronoDuration::days(i64::from(days)))
        .to_rfc3339_opts(SecondsFormat::Millis, true);
    let query = [
        ("limit", "100".to_string()),
        ("from", from),
        ("order", "desc".to_string()),
    ];
    let result =
        send_request(CODEX_RESETS_LIST_URL, &query).and_then(|body| parse_reset_history(&body));

    match &result {
        Ok(resets) => log::info!(
            "Codex reset history fetched. days={days} count={} elapsedMs={}",
            resets.len(),
            started.elapsed().as_millis()
        ),
        Err(error) => log::warn!(
            "Failed to fetch Codex reset history. days={days} elapsedMs={} error={error}",
            started.elapsed().as_millis()
        ),
    }

    result
}

fn send_request(url: &str, query: &[(&str, String)]) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|error| format!("Failed to build Codex Resets HTTP client: {error}"))?;

    let response = client
        .get(url)
        .query(query)
        .header("User-Agent", "codex-usage-desktop")
        .header("Accept", "application/json")
        .send()
        .map_err(|error| format!("Codex Resets request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Codex Resets endpoint returned status {status}"));
    }

    response
        .text()
        .map_err(|error| format!("Failed to read Codex Resets response: {error}"))
}

fn parse_latest_reset(body: &str) -> Result<Option<CodexResetAnnouncement>, String> {
    serde_json::from_str::<StatusResponse>(body)
        .map(|response| response.data.latest_reset)
        .map_err(|error| format!("Failed to parse Codex Resets status JSON: {error}"))
}

fn parse_reset_history(body: &str) -> Result<Vec<CodexResetAnnouncement>, String> {
    serde_json::from_str::<ResetListResponse>(body)
        .map(|response| response.data)
        .map_err(|error| format!("Failed to parse Codex Resets history JSON: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_latest_reset_from_status_response() {
        let reset = parse_latest_reset(
            r#"{
                "data": {
                    "latest_reset": {
                        "id": "2091688655828246890",
                        "reset_type": "regular",
                        "announced_at": "2026-08-24T00:46:51.000Z",
                        "text": "Reset has been propagated.",
                        "source": {
                            "type": "x_post",
                            "author": "thsottiaux",
                            "url": "https://x.com/thsottiaux/status/2091688655828246890"
                        }
                    },
                    "active_watch": null,
                    "stats": { "total": 1 }
                },
                "meta": { "api_version": "v1" }
            }"#,
        )
        .unwrap()
        .unwrap();

        assert_eq!(reset.reset_type, "regular");
        assert_eq!(reset.source.author.as_deref(), Some("thsottiaux"));
    }

    #[test]
    fn parses_observed_reset_without_author() {
        let reset = parse_latest_reset(
            r#"{
                "data": {
                    "latest_reset": {
                        "id": "observed-20260825T143200Z",
                        "reset_type": "regular",
                        "announced_at": "2026-08-25T14:30:00.000Z",
                        "text": "Observed reset.",
                        "source": {
                            "type": "observed",
                            "url": "https://x.com/thsottiaux/status/2092311059197808936"
                        }
                    }
                }
            }"#,
        )
        .unwrap()
        .unwrap();

        assert_eq!(reset.id, "observed-20260825T143200Z");
        assert_eq!(reset.source.author, None);
    }

    #[test]
    fn parses_reset_history_list() {
        let resets = parse_reset_history(
            r#"{
                "data": [{
                    "id": "1",
                    "reset_type": "banked",
                    "announced_at": "2026-08-21T23:40:12.000Z",
                    "text": "A banked reset is available.",
                    "source": {
                        "type": "x_post",
                        "author": "thsottiaux",
                        "url": "https://x.com/thsottiaux/status/1"
                    }
                }],
                "pagination": { "has_more": false, "next_cursor": null },
                "meta": { "api_version": "v1" }
            }"#,
        )
        .unwrap();

        assert_eq!(resets.len(), 1);
        assert_eq!(resets[0].reset_type, "banked");
    }
}
