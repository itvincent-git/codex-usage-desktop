use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_fallback: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsageRow {
    pub date: String,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    #[serde(rename = "costUSD")]
    pub cost_usd: f64,
    pub models: BTreeMap<String, ModelUsage>,
    pub projects: BTreeMap<String, ProjectUsage>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUsage {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    pub models: BTreeMap<String, ModelUsage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewDailyRow {
    pub date: String,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    #[serde(rename = "costUSD")]
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewTotals {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    #[serde(rename = "costUSD")]
    pub cost_usd: f64,
    pub avg_tokens_per_day: f64,
    pub avg_cost_per_day: f64,
    pub cache_hit_rate: f64,
    pub cost_per_million_tokens: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewModelRow {
    pub model: String,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    #[serde(rename = "costUSD")]
    pub cost_usd: f64,
    pub pricing_status: PricingStatus,
    pub input_cost_per_million_tokens: Option<f64>,
    pub cached_input_cost_per_million_tokens: Option<f64>,
    pub output_cost_per_million_tokens: Option<f64>,
    pub effective_cost_per_million_tokens: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PricingStatus {
    Priced,
    Free,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricingCatalogEntry {
    pub model: String,
    pub provider: String,
    pub pricing_status: PricingStatus,
    pub input_cost_per_million_tokens: Option<f64>,
    pub cached_input_cost_per_million_tokens: Option<f64>,
    pub output_cost_per_million_tokens: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricingCatalogResponse {
    pub is_limited: bool,
    pub models: Vec<ModelPricingCatalogEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewProjectRow {
    pub project: String,
    pub display_name: String,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    #[serde(rename = "costUSD")]
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnalyticsModelRow {
    pub model: String,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnalyticsResponse {
    pub project: String,
    pub display_name: String,
    pub range: String,
    pub start_date: String,
    pub end_date: String,
    pub timezone: String,
    pub summary: OverviewProjectRow,
    pub models: Vec<ProjectAnalyticsModelRow>,
    pub daily: Vec<OverviewDailyRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewResponse {
    pub range: String,
    pub days: i64,
    pub timezone: String,
    pub start_date: String,
    pub end_date: String,
    pub updated_at: Option<String>,
    pub daily: Vec<OverviewDailyRow>,
    pub totals: OverviewTotals,
    pub models: Vec<OverviewModelRow>,
    pub projects: Vec<OverviewProjectRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyUsageRow {
    pub month: String,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    #[serde(rename = "costUSD")]
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyUsageResponse {
    pub timezone: String,
    pub start_month: String,
    pub end_month: String,
    pub updated_at: Option<String>,
    pub monthly: Vec<MonthlyUsageRow>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanResponse {
    pub imported_days: usize,
    pub scanned_at: String,
    pub timezone: String,
    pub metrics: ScanMetrics,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanMetrics {
    pub total_ms: u128,
    pub pricing_ms: u128,
    pub parse_ms: u128,
    pub db_ms: u128,
    pub files_scanned: usize,
    pub files_parsed: usize,
    pub files_reused: usize,
    pub bytes_read: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResponse {
    pub path: String,
    pub format: String,
    pub range: String,
    pub exported_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexLimitWindow {
    pub used_percent: f64,
    pub remaining_percent: f64,
    pub window_minutes: Option<i64>,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexResetCredit {
    pub id: String,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexLimitsResponse {
    pub session: Option<CodexLimitWindow>,
    pub weekly: Option<CodexLimitWindow>,
    pub reset_credits_available_count: Option<i64>,
    pub reset_credits: Option<Vec<CodexResetCredit>>,
    pub updated_at: String,
    pub source: String,
    pub account: Option<String>,
    pub membership_level: Option<String>,
    pub subscription_expires_at: Option<String>,
    pub subscription_will_renew: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexQuotaForecastResponse {
    pub score: i64,
    pub fetched_at: String,
    pub next_refresh_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageRefreshResponse {
    pub scan: ScanResponse,
    pub limits: Option<CodexLimitsResponse>,
    pub limits_error: Option<String>,
    pub limits_skipped: bool,
    pub refreshed_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResponse {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub latest_tag: String,
    pub release_name: Option<String>,
    pub release_notes: Option<String>,
    pub release_url: String,
    pub etag: Option<String>,
    pub not_modified: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallResponse {
    pub version: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub finished: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDailyUsageRow {
    pub date: String,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    #[serde(rename = "costUSD")]
    pub cost_usd: f64,
    pub models: Vec<String>,
    pub projects: Vec<String>,
    pub quota_usage: Option<SessionQuotaUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionQuotaUsage {
    pub five_hour: Vec<SessionQuotaWindowUsage>,
    pub weekly: Vec<SessionQuotaWindowUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionQuotaWindowUsage {
    pub window_minutes: i64,
    pub resets_at: Option<String>,
    pub observed_start_at: String,
    pub observed_end_at: String,
    pub observed_start_percent: f64,
    pub observed_end_percent: f64,
    pub observed_delta_percent: f64,
    pub below_resolution: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetailRow {
    pub path: String,
    pub session_id: String,
    pub thread_name: Option<String>,
    pub thread_id: Option<String>,
    pub parent_thread_id: Option<String>,
    pub agent_session_id: Option<String>,
    pub parent_session_id: Option<String>,
    pub agent_depth: usize,
    pub agent_path: Option<String>,
    pub agent_nickname: Option<String>,
    pub agent_role: Option<String>,
    pub modified_at_ms: i64,
    pub size_bytes: i64,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    #[serde(rename = "costUSD")]
    pub cost_usd: f64,
    pub models: Vec<String>,
    pub projects: Vec<String>,
    pub daily_usage: Vec<SessionDailyUsageRow>,
    pub quota_usage: Option<SessionQuotaUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionReplaySummary {
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub duration_ms: Option<i64>,
    pub time_to_first_token_ms: Option<i64>,
    pub cwd: Option<String>,
    pub projects: Vec<String>,
    pub models: Vec<String>,
    pub cli_version: Option<String>,
    pub git: BTreeMap<String, String>,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
    #[serde(rename = "costUSD")]
    pub cost_usd: f64,
    pub turn_count: usize,
    pub message_count: usize,
    pub tool_call_count: usize,
    pub patch_count: usize,
    pub error_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionReplayMessage {
    pub timestamp: Option<String>,
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionReplayToolCall {
    pub call_id: Option<String>,
    pub name: String,
    pub status: Option<String>,
    pub arguments: Option<String>,
    pub output: Option<String>,
    pub stderr: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionReplayPatchResult {
    pub call_id: Option<String>,
    pub success: Option<bool>,
    pub output: Option<String>,
    pub timestamp: Option<String>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionReplayTokenEvent {
    pub timestamp: Option<String>,
    pub model: String,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionReplayItem {
    Message {
        timestamp: Option<String>,
        role: String,
        source: String,
        text: String,
    },
    Reasoning {
        timestamp: Option<String>,
        text: String,
    },
    ToolCall {
        #[serde(flatten)]
        tool: SessionReplayToolCall,
    },
    Patch {
        #[serde(flatten)]
        patch: SessionReplayPatchResult,
    },
    TokenUsage {
        #[serde(flatten)]
        usage: SessionReplayTokenEvent,
    },
    Error {
        timestamp: Option<String>,
        text: String,
    },
    Notice {
        timestamp: Option<String>,
        label: String,
        text: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionReplayTurn {
    pub turn_id: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub system_messages: Vec<SessionReplayMessage>,
    pub user_messages: Vec<SessionReplayMessage>,
    pub assistant_messages: Vec<SessionReplayMessage>,
    pub reasoning_summaries: Vec<SessionReplayMessage>,
    pub tool_calls: Vec<SessionReplayToolCall>,
    pub patch_results: Vec<SessionReplayPatchResult>,
    pub token_events: Vec<SessionReplayTokenEvent>,
    pub errors: Vec<String>,
    pub items: Vec<SessionReplayItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionReplayAgent {
    pub path: String,
    pub session_id: String,
    pub parent_session_id: Option<String>,
    pub depth: usize,
    pub agent_path: String,
    pub nickname: Option<String>,
    pub role: Option<String>,
    pub thread_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionReplayDetail {
    pub path: String,
    pub session_id: String,
    pub thread_name: Option<String>,
    pub modified_at_ms: i64,
    pub size_bytes: i64,
    pub raw_jsonl: String,
    pub agents: Vec<SessionReplayAgent>,
    pub summary: SessionReplaySummary,
    pub turns: Vec<SessionReplayTurn>,
}
