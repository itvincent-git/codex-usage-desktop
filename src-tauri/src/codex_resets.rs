use crate::types::CodexResetAnnouncement;
use chrono::{Duration as ChronoDuration, SecondsFormat, Utc};
use serde::Deserialize;
use std::time::Duration;

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
    let body = send_request(CODEX_RESETS_STATUS_URL, &[])?;
    parse_latest_reset(&body)
}

pub fn fetch_reset_history(days: u32) -> Result<Vec<CodexResetAnnouncement>, String> {
    let days = days.clamp(1, 365);
    let from = (Utc::now() - ChronoDuration::days(i64::from(days)))
        .to_rfc3339_opts(SecondsFormat::Millis, true);
    let query = [
        ("limit", "100".to_string()),
        ("from", from),
        ("order", "desc".to_string()),
    ];
    let body = send_request(CODEX_RESETS_LIST_URL, &query)?;
    parse_reset_history(&body)
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
        assert_eq!(reset.source.author, "thsottiaux");
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
