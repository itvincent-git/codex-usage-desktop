use crate::{
    db::{query_session_rollup_record, SessionRollupRecord},
    types::{
        DailyUsageRow, ModelUsage, SessionReplayDetail, SessionReplayItem, SessionReplayMessage,
        SessionReplayPatchResult, SessionReplaySummary, SessionReplayTokenEvent,
        SessionReplayToolCall, SessionReplayTurn,
    },
};
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

const LEGACY_FALLBACK_MODEL: &str = "gpt-5";
const UNGROUPED_TURN_ID: &str = "Ungrouped";

#[derive(Debug, Clone, Default)]
struct RawUsage {
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_output_tokens: i64,
    total_tokens: i64,
}

#[derive(Debug, Default)]
struct ReplayParseState {
    previous_totals: Option<RawUsage>,
    current_model: Option<String>,
    current_project_path: Option<String>,
    current_turn_id: Option<String>,
    first_token_at: Option<DateTime<Utc>>,
    start_at: Option<DateTime<Utc>>,
    end_at: Option<DateTime<Utc>>,
    cli_version: Option<String>,
    cwd: Option<String>,
    git: BTreeMap<String, String>,
    system_messages: Vec<SessionReplayMessage>,
    turns: BTreeMap<String, SessionReplayTurn>,
    turn_order: Vec<String>,
    pending_tools: BTreeMap<String, (String, String, Option<String>)>,
    tool_aliases: BTreeMap<String, String>,
    cell_tools: BTreeMap<String, (String, String)>,
    process_continuations: BTreeMap<String, ProcessContinuation>,
    token_target_tool: Option<(String, String)>,
}

pub fn fetch_session_detail(db: &Connection, path: &str) -> Result<SessionReplayDetail, String> {
    let record = query_session_rollup_record(db, path)?
        .ok_or_else(|| "Session file is not indexed".to_string())?;
    let raw_jsonl = fs::read_to_string(&record.path).map_err(|error| error.to_string())?;
    Ok(parse_session_detail(record, raw_jsonl))
}

fn parse_session_detail(record: SessionRollupRecord, raw_jsonl: String) -> SessionReplayDetail {
    let session_id = Path::new(&record.path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&record.path)
        .to_string();

    let mut state = ReplayParseState::default();
    for line in raw_jsonl.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        state.ingest(&entry);
    }

    let mut turns = state
        .turn_order
        .iter()
        .filter_map(|turn_id| state.turns.remove(turn_id))
        .collect::<Vec<_>>();

    for turn in &mut turns {
        turn.duration_ms =
            duration_between(turn.started_at.as_deref(), turn.completed_at.as_deref());
    }

    let mut summary = build_summary(&record.rows, &turns, &state);
    summary.turn_count = turns.len();
    summary.message_count = turns
        .iter()
        .map(|turn| {
            turn.user_messages.len()
                + turn.assistant_messages.len()
                + turn.reasoning_summaries.len()
        })
        .sum();
    summary.tool_call_count = turns.iter().map(|turn| turn.tool_calls.len()).sum();
    summary.patch_count = turns.iter().map(|turn| turn.patch_results.len()).sum();
    summary.error_count = turns.iter().map(|turn| turn.errors.len()).sum::<usize>()
        + turns
            .iter()
            .flat_map(|turn| turn.tool_calls.iter())
            .filter(|tool| tool.is_error)
            .count()
        + turns
            .iter()
            .flat_map(|turn| turn.patch_results.iter())
            .filter(|patch| patch.is_error)
            .count();

    SessionReplayDetail {
        path: record.path,
        session_id,
        thread_name: record.prompt_title.filter(|title| !title.is_empty()),
        modified_at_ms: record.modified_at_ms,
        size_bytes: record.size_bytes,
        raw_jsonl,
        summary,
        turns,
    }
}

impl ReplayParseState {
    fn ingest(&mut self, entry: &Value) {
        let timestamp = entry
            .get("timestamp")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let parsed_time = timestamp
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc));
        if let Some(parsed_time) = parsed_time {
            self.start_at = Some(
                self.start_at
                    .map_or(parsed_time, |start| start.min(parsed_time)),
            );
            self.end_at = Some(self.end_at.map_or(parsed_time, |end| end.max(parsed_time)));
        }

        if let Some(turn_id) = find_turn_id(entry) {
            self.current_turn_id = Some(turn_id);
        }

        let entry_type = entry.get("type").and_then(Value::as_str).unwrap_or("");
        let payload = entry.get("payload").unwrap_or(&Value::Null);

        match entry_type {
            "session_meta" => {
                self.capture_meta(payload, timestamp);
                return;
            }
            "turn_context" => {
                self.capture_context(payload);
                let turn_id = self
                    .current_turn_id
                    .clone()
                    .unwrap_or_else(|| UNGROUPED_TURN_ID.to_string());
                let turn = self.turn_mut(&turn_id);
                if turn.started_at.is_none() {
                    turn.started_at = timestamp;
                }
                return;
            }
            _ => {}
        }

        let event = if matches!(entry_type, "event_msg" | "response_item") {
            payload
        } else {
            entry
        };
        let event_type = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or(entry_type);
        if let Some(turn_id) = find_turn_id(event) {
            self.current_turn_id = Some(turn_id);
        }

        if event_type == "token_count" {
            self.ingest_token_event(event, timestamp, parsed_time);
            return;
        }

        let turn_id = self
            .current_turn_id
            .clone()
            .unwrap_or_else(|| UNGROUPED_TURN_ID.to_string());

        match event_type {
            "task_started" => {
                let turn = self.turn_mut(&turn_id);
                turn.started_at = timestamp;
            }
            "task_complete" | "task_completed" => {
                let turn = self.turn_mut(&turn_id);
                turn.completed_at = timestamp;
            }
            _ if is_user_message(event_type, event) => {
                if let Some(text) = extract_message_text(event) {
                    let turn = self.turn_mut(&turn_id);
                    if push_unique_message(
                        &mut turn.user_messages,
                        SessionReplayMessage {
                            timestamp: timestamp.clone(),
                            kind: event_type.to_string(),
                            text: text.clone(),
                        },
                    ) {
                        turn.items.push(SessionReplayItem::Message {
                            timestamp,
                            role: "user".to_string(),
                            source: event_type.to_string(),
                            text,
                        });
                    }
                }
            }
            _ if is_assistant_message(event_type, event) => {
                if let Some(text) = extract_message_text(event) {
                    let turn = self.turn_mut(&turn_id);
                    if push_unique_message(
                        &mut turn.assistant_messages,
                        SessionReplayMessage {
                            timestamp: timestamp.clone(),
                            kind: event_type.to_string(),
                            text: text.clone(),
                        },
                    ) {
                        turn.items.push(SessionReplayItem::Message {
                            timestamp,
                            role: "assistant".to_string(),
                            source: event_type.to_string(),
                            text,
                        });
                    }
                }
            }
            _ if is_system_message(event_type, event) => {
                if let Some(text) = extract_message_text(event) {
                    let role = string_field(event, "role").unwrap_or_else(|| "system".to_string());
                    let turn = self.turn_mut(&turn_id);
                    if push_unique_message(
                        &mut turn.system_messages,
                        SessionReplayMessage {
                            timestamp: timestamp.clone(),
                            kind: event_type.to_string(),
                            text: text.clone(),
                        },
                    ) {
                        turn.items.push(SessionReplayItem::Message {
                            timestamp,
                            role,
                            source: event_type.to_string(),
                            text,
                        });
                    }
                }
            }
            _ if is_reasoning_message(event_type) => {
                if let Some(text) = extract_message_text(event) {
                    let turn = self.turn_mut(&turn_id);
                    if push_unique_message(
                        &mut turn.reasoning_summaries,
                        SessionReplayMessage {
                            timestamp: timestamp.clone(),
                            kind: event_type.to_string(),
                            text: text.clone(),
                        },
                    ) {
                        turn.items
                            .push(SessionReplayItem::Reasoning { timestamp, text });
                    }
                }
            }
            _ if is_tool_call(event_type) => {
                let call_id = extract_call_id(event);
                let name = extract_tool_name(event).unwrap_or_else(|| event_type.to_string());
                let arguments = extract_tool_arguments(event);
                if let (Some(call_id), Some(continuation)) = (
                    call_id.as_ref(),
                    arguments
                        .as_deref()
                        .and_then(|arguments| extract_process_continuation(&name, arguments)),
                ) {
                    if let Some((target_turn_id, target_call_id)) =
                        self.cell_tools.get(&continuation.session_id).cloned()
                    {
                        if let Some((_, target_name, target_arguments)) =
                            self.pending_tools.get(&target_call_id).cloned()
                        {
                            self.pending_tools.insert(
                                call_id.clone(),
                                (target_turn_id, target_name, target_arguments),
                            );
                            self.tool_aliases.insert(call_id.clone(), target_call_id);
                            self.process_continuations
                                .insert(call_id.clone(), continuation);
                            return;
                        }
                    }
                }
                if let Some(call_id) = &call_id {
                    self.pending_tools.insert(
                        call_id.clone(),
                        (turn_id.clone(), name.clone(), arguments.clone()),
                    );
                }
                let tool = SessionReplayToolCall {
                    call_id,
                    name,
                    status: None,
                    arguments,
                    output: None,
                    stderr: None,
                    started_at: timestamp,
                    completed_at: None,
                    duration_ms: None,
                    is_error: false,
                };
                let turn = self.turn_mut(&turn_id);
                turn.tool_calls.push(tool.clone());
                turn.items.push(SessionReplayItem::ToolCall { tool });
            }
            _ if is_tool_output(event_type) => {
                self.ingest_tool_output(&turn_id, event, timestamp);
            }
            _ if is_patch_event(event_type) => {
                self.ingest_patch_event(&turn_id, event, timestamp);
            }
            _ if is_error_event(event_type, event) => {
                let text = extract_error_text(event).unwrap_or_else(|| event_type.to_string());
                let turn = self.turn_mut(&turn_id);
                turn.errors.push(text.clone());
                turn.items
                    .push(SessionReplayItem::Error { timestamp, text });
            }
            "context_compacted" | "compacted" => {
                self.turn_mut(&turn_id)
                    .items
                    .push(SessionReplayItem::Notice {
                        timestamp,
                        label: "context_compacted".to_string(),
                        text: string_field(event, "message"),
                    })
            }
            _ => {}
        }
    }

    fn capture_meta(&mut self, payload: &Value, timestamp: Option<String>) {
        if let Some(cwd) = string_field(payload, "cwd") {
            self.cwd = Some(cwd.clone());
            self.current_project_path = Some(cwd);
        }
        self.cli_version = string_field(payload, "cli_version")
            .or_else(|| string_field(payload, "cliVersion"))
            .or_else(|| string_field(payload, "version"))
            .or_else(|| self.cli_version.clone());

        if let Some(git) = payload.get("git").and_then(Value::as_object) {
            for (key, value) in git {
                if let Some(value) = value.as_str() {
                    self.git.insert(key.clone(), value.to_string());
                }
            }
        }

        if let Some(text) = extract_system_prompt_text(payload) {
            if !self
                .system_messages
                .iter()
                .any(|message| message.text == text)
            {
                self.system_messages.push(SessionReplayMessage {
                    timestamp,
                    kind: "base_instructions".to_string(),
                    text,
                });
            }
        }
    }

    fn capture_context(&mut self, payload: &Value) {
        if let Some(model) = extract_model(payload) {
            self.current_model = Some(model);
        }
        if let Some(project_path) = string_field(payload, "cwd") {
            self.current_project_path = Some(project_path);
        }
    }

    fn ingest_token_event(
        &mut self,
        payload: &Value,
        timestamp: Option<String>,
        parsed_time: Option<DateTime<Utc>>,
    ) {
        let info = payload.get("info").unwrap_or(&Value::Null);
        let last_usage = normalize_raw_usage(info.get("last_token_usage"));
        let total_usage = normalize_raw_usage(info.get("total_token_usage"));
        let raw = last_usage.or_else(|| {
            total_usage
                .as_ref()
                .map(|current| subtract_raw_usage(current, self.previous_totals.as_ref()))
        });

        if let Some(total_usage) = total_usage {
            self.previous_totals = Some(total_usage);
        }

        let Some(raw) = raw else {
            return;
        };
        let usage = convert_to_delta(&raw);
        if usage.input_tokens == 0
            && usage.cached_input_tokens == 0
            && usage.output_tokens == 0
            && usage.reasoning_output_tokens == 0
        {
            return;
        }

        if let Some(parsed_time) = parsed_time {
            self.first_token_at = Some(
                self.first_token_at
                    .map_or(parsed_time, |first| first.min(parsed_time)),
            );
        }

        let model = extract_model(&merge_payload_info(payload, info))
            .or_else(|| self.current_model.clone())
            .unwrap_or_else(|| LEGACY_FALLBACK_MODEL.to_string());
        self.current_model = Some(model.clone());

        let turn_id = self
            .current_turn_id
            .clone()
            .unwrap_or_else(|| UNGROUPED_TURN_ID.to_string());
        let usage = SessionReplayTokenEvent {
            timestamp,
            model,
            input_tokens: usage.input_tokens,
            cached_input_tokens: usage.cached_input_tokens,
            output_tokens: usage.output_tokens,
            reasoning_output_tokens: usage.reasoning_output_tokens,
            total_tokens: usage.total_tokens,
        };
        let token_target = self.token_target_tool.take();
        let turn = self.turn_mut(&turn_id);
        turn.token_events.push(usage.clone());
        if let Some((target_turn_id, target_call_id)) =
            token_target.filter(|(target_turn_id, _)| target_turn_id == &turn_id)
        {
            if let Some(tool_index) = turn.items.iter().position(|item| {
                matches!(item, SessionReplayItem::ToolCall { tool } if tool.call_id.as_ref() == Some(&target_call_id))
            }) {
                let token_item = SessionReplayItem::TokenUsage { usage };
                if matches!(turn.items.get(tool_index + 1), Some(SessionReplayItem::TokenUsage { .. })) {
                    turn.items[tool_index + 1] = token_item;
                } else {
                    turn.items.insert(tool_index + 1, token_item);
                }
                return;
            }
        }
        turn.items.push(SessionReplayItem::TokenUsage { usage });
    }

    fn ingest_tool_output(
        &mut self,
        fallback_turn_id: &str,
        event: &Value,
        timestamp: Option<String>,
    ) {
        let source_call_id = extract_call_id(event);
        let continuation = source_call_id
            .as_ref()
            .and_then(|call_id| self.process_continuations.remove(call_id));
        let call_id = source_call_id
            .as_ref()
            .and_then(|call_id| self.tool_aliases.get(call_id))
            .cloned()
            .or_else(|| source_call_id.clone());
        let (turn_id, name, arguments) = call_id
            .as_ref()
            .and_then(|call_id| {
                self.pending_tools
                    .get(call_id)
                    .or_else(|| {
                        source_call_id
                            .as_ref()
                            .and_then(|source_call_id| self.pending_tools.get(source_call_id))
                    })
                    .cloned()
            })
            .unwrap_or_else(|| {
                (
                    fallback_turn_id.to_string(),
                    extract_tool_name(event).unwrap_or_else(|| "tool".to_string()),
                    None,
                )
            });
        let output = extract_tool_output(event);
        let stderr = string_field(event, "stderr").or_else(|| {
            event
                .get("output")
                .and_then(|output| string_field(output, "stderr"))
        });
        let output_state = output
            .as_deref()
            .map(parse_process_output)
            .unwrap_or_default();
        let is_process_activity = continuation.is_some()
            || is_exec_command_call(&name, arguments.as_deref())
            || output_state.cell_id.is_some()
            || output_state.has_process_exit;
        let process_was_stopped = output_state.is_stopped
            || continuation.as_ref().is_some_and(|value| {
                value.input.as_deref() == Some("\u{3}") && output_state.has_process_exit
            });
        let status = if process_was_stopped {
            Some("stopped".to_string())
        } else if output_state.is_error {
            Some("failed".to_string())
        } else if continuation.as_ref().is_some_and(|value| {
            value.kind == ProcessContinuationKind::WriteStdin && !output_state.has_process_exit
        }) {
            Some("running".to_string())
        } else if output_state.is_running {
            Some("running".to_string())
        } else {
            string_field(event, "status").or_else(|| Some("completed".to_string()))
        };
        let is_error = !process_was_stopped
            && (output_state.is_error
                || status
                    .as_deref()
                    .map(|status| {
                        !matches!(
                            status,
                            "success" | "ok" | "completed" | "running" | "stopped"
                        )
                    })
                    .unwrap_or(false)
                || stderr
                    .as_deref()
                    .map(|value| !value.trim().is_empty())
                    .unwrap_or(false));

        let turn = self.turn_mut(&turn_id);
        if let Some(call_id) = &call_id {
            if let Some(tool_index) = turn
                .tool_calls
                .iter()
                .position(|tool| tool.call_id.as_ref() == Some(call_id))
            {
                let tool = &mut turn.tool_calls[tool_index];
                let output = if is_process_activity {
                    merge_process_output(
                        continuation.as_ref().and_then(process_input_marker),
                        output_state.output,
                    )
                } else {
                    output
                };
                tool.output = merge_process_output(tool.output.take(), output);
                tool.stderr = stderr;
                tool.status = status.clone();
                tool.completed_at = if status.as_deref() == Some("running") {
                    None
                } else {
                    timestamp.clone()
                };
                tool.duration_ms = if is_process_activity {
                    duration_between(tool.started_at.as_deref(), timestamp.as_deref())
                        .or(output_state.duration_ms)
                } else {
                    output_state.duration_ms.or_else(|| {
                        duration_between(tool.started_at.as_deref(), tool.completed_at.as_deref())
                    })
                };
                tool.is_error = is_error;
                let registered_cell = output_state
                    .cell_id
                    .zip(tool.call_id.clone())
                    .map(|(cell_id, call_id)| (cell_id, (turn_id.clone(), call_id)));
                if let Some(SessionReplayItem::ToolCall { tool: item_tool }) = turn
                    .items
                    .iter_mut()
                    .find(|item| matches!(item, SessionReplayItem::ToolCall { tool } if tool.call_id.as_ref() == Some(call_id)))
                {
                    *item_tool = tool.clone();
                }
                if let Some((cell_id, tool_ref)) = registered_cell {
                    self.cell_tools.insert(cell_id, tool_ref);
                }
                self.token_target_tool = Some((turn_id, call_id.clone()));
                return;
            }
        }

        if let Some(tool_index) = turn
            .tool_calls
            .iter()
            .rposition(|tool| tool.completed_at.is_none() && tool.name == name)
        {
            let tool = &mut turn.tool_calls[tool_index];
            if tool.call_id.is_none() {
                tool.call_id = call_id;
            }
            tool.output = output;
            tool.stderr = stderr;
            tool.status = status;
            tool.completed_at = timestamp;
            tool.duration_ms =
                duration_between(tool.started_at.as_deref(), tool.completed_at.as_deref());
            tool.is_error = is_error;
            if let Some(SessionReplayItem::ToolCall { tool: item_tool }) = turn
                .items
                .iter_mut()
                .rev()
                .find(|item| matches!(item, SessionReplayItem::ToolCall { tool } if tool.completed_at.is_none() && tool.name == name))
            {
                *item_tool = tool.clone();
            }
            return;
        }

        let tool = SessionReplayToolCall {
            call_id,
            name,
            status,
            arguments,
            output,
            stderr,
            started_at: None,
            completed_at: timestamp,
            duration_ms: None,
            is_error,
        };
        turn.tool_calls.push(tool.clone());
        turn.items.push(SessionReplayItem::ToolCall { tool });
    }

    fn ingest_patch_event(
        &mut self,
        fallback_turn_id: &str,
        event: &Value,
        timestamp: Option<String>,
    ) {
        let success = event.get("success").and_then(Value::as_bool).or_else(|| {
            event
                .get("payload")
                .and_then(|payload| payload.get("success"))
                .and_then(Value::as_bool)
        });
        let output = extract_tool_output(event).or_else(|| extract_message_text(event));
        let is_error = success == Some(false);
        let patch = SessionReplayPatchResult {
            call_id: extract_call_id(event),
            success,
            output,
            timestamp,
            is_error,
        };
        let turn = self.turn_mut(fallback_turn_id);
        turn.patch_results.push(patch.clone());
        turn.items.push(SessionReplayItem::Patch { patch });
    }

    fn turn_mut(&mut self, turn_id: &str) -> &mut SessionReplayTurn {
        if !self.turns.contains_key(turn_id) {
            self.turn_order.push(turn_id.to_string());
            let mut turn = empty_turn(turn_id);
            turn.system_messages = self.system_messages.clone();
            turn.items
                .extend(
                    self.system_messages
                        .iter()
                        .map(|message| SessionReplayItem::Message {
                            timestamp: message.timestamp.clone(),
                            role: "system".to_string(),
                            source: message.kind.clone(),
                            text: message.text.clone(),
                        }),
                );
            self.turns.insert(turn_id.to_string(), turn);
        }
        self.turns.get_mut(turn_id).expect("turn exists")
    }
}

fn empty_turn(turn_id: &str) -> SessionReplayTurn {
    SessionReplayTurn {
        turn_id: turn_id.to_string(),
        started_at: None,
        completed_at: None,
        duration_ms: None,
        system_messages: Vec::new(),
        user_messages: Vec::new(),
        assistant_messages: Vec::new(),
        reasoning_summaries: Vec::new(),
        tool_calls: Vec::new(),
        patch_results: Vec::new(),
        token_events: Vec::new(),
        errors: Vec::new(),
        items: Vec::new(),
    }
}

fn push_unique_message(
    messages: &mut Vec<SessionReplayMessage>,
    message: SessionReplayMessage,
) -> bool {
    let is_mirrored_rollout_event = messages.last().is_some_and(|existing| {
        existing.text == message.text
            && ((existing.kind == "message") != (message.kind == "message"))
    });
    if is_mirrored_rollout_event {
        return false;
    }
    messages.push(message);
    true
}

fn build_summary(
    rows: &[DailyUsageRow],
    turns: &[SessionReplayTurn],
    state: &ReplayParseState,
) -> SessionReplaySummary {
    let mut summary = SessionReplaySummary {
        start_time: state
            .start_at
            .map(|value| value.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        end_time: state
            .end_at
            .map(|value| value.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        duration_ms: state
            .start_at
            .zip(state.end_at)
            .map(|(start, end)| (end - start).num_milliseconds().max(0)),
        time_to_first_token_ms: state
            .start_at
            .zip(state.first_token_at)
            .map(|(start, first)| (first - start).num_milliseconds().max(0)),
        cwd: state
            .cwd
            .clone()
            .or_else(|| state.current_project_path.clone()),
        cli_version: state.cli_version.clone(),
        git: state.git.clone(),
        ..SessionReplaySummary::default()
    };

    let mut projects = BTreeSet::new();
    let mut models = BTreeSet::new();
    for row in rows {
        summary.input_tokens += row.input_tokens;
        summary.cached_input_tokens += row.cached_input_tokens;
        summary.output_tokens += row.output_tokens;
        summary.reasoning_output_tokens += row.reasoning_output_tokens;
        summary.total_tokens += row.total_tokens;
        summary.cost_usd += row.cost_usd;
        models.extend(row.models.keys().cloned());
        projects.extend(row.projects.keys().cloned());
    }
    for turn in turns {
        models.extend(turn.token_events.iter().map(|event| event.model.clone()));
    }
    if let Some(project_path) = &state.current_project_path {
        projects.insert(project_path.clone());
    }

    summary.projects = projects.into_iter().collect();
    summary.models = models.into_iter().collect();
    summary
}

fn is_user_message(event_type: &str, event: &Value) -> bool {
    matches!(
        event_type,
        "user_message" | "user_message_delta" | "input_text"
    ) || event_type.contains("user_message")
        || (event_type == "message" && string_field(event, "role").as_deref() == Some("user"))
}

fn is_assistant_message(event_type: &str, event: &Value) -> bool {
    matches!(
        event_type,
        "assistant_message" | "agent_message" | "assistant_message_delta" | "output_text"
    ) || event_type.contains("assistant_message")
        || event_type.contains("agent_message")
        || (event_type == "message" && string_field(event, "role").as_deref() == Some("assistant"))
}

fn is_system_message(event_type: &str, event: &Value) -> bool {
    event_type == "message"
        && matches!(
            string_field(event, "role").as_deref(),
            Some("system" | "developer")
        )
}

fn is_reasoning_message(event_type: &str) -> bool {
    event_type.contains("reasoning") || event_type.contains("summary")
}

fn is_tool_call(event_type: &str) -> bool {
    (event_type.contains("tool_call") && !is_tool_output(event_type))
        || matches!(
            event_type,
            "function_call"
                | "custom_tool_call"
                | "local_shell_call"
                | "tool_search_call"
                | "web_search_call"
                | "image_generation_call"
        )
        || event_type == "exec_command_begin"
        || event_type == "mcp_tool_call_begin"
}

fn is_tool_output(event_type: &str) -> bool {
    event_type.contains("tool_result")
        || event_type.contains("tool_output")
        || event_type == "exec_command_end"
        || event_type == "mcp_tool_call_end"
        || event_type == "web_search_end"
        || event_type == "image_generation_end"
        || matches!(
            event_type,
            "function_call_output" | "custom_tool_call_output" | "tool_search_output"
        )
}

fn is_patch_event(event_type: &str) -> bool {
    event_type.contains("patch_apply") || event_type.contains("apply_patch")
}

fn is_error_event(event_type: &str, event: &Value) -> bool {
    event_type.contains("error")
        || string_field(event, "level").as_deref() == Some("error")
        || string_field(event, "status").as_deref() == Some("failed")
}

fn find_turn_id(value: &Value) -> Option<String> {
    string_field(value, "turn_id")
        .or_else(|| string_field(value, "turnId"))
        .or_else(|| {
            value.get("payload").and_then(|payload| {
                string_field(payload, "turn_id").or_else(|| string_field(payload, "turnId"))
            })
        })
}

fn extract_message_text(value: &Value) -> Option<String> {
    string_field(value, "message")
        .or_else(|| string_field(value, "text"))
        .or_else(|| string_field(value, "content"))
        .or_else(|| {
            value.get("message").and_then(|message| {
                string_field(message, "content").or_else(|| string_field(message, "text"))
            })
        })
        .or_else(|| {
            value.get("item").and_then(|item| {
                string_field(item, "text").or_else(|| string_field(item, "content"))
            })
        })
        .or_else(|| extract_content_text(value.get("content")?))
        .or_else(|| extract_content_text(value.get("summary")?))
        .or_else(|| {
            value
                .get("content")
                .filter(|content| content.is_array() || content.is_object())
                .map(value_to_compact_string)
        })
}

fn extract_content_text(content: &Value) -> Option<String> {
    let texts = content
        .as_array()?
        .iter()
        .filter_map(|part| {
            string_field(part, "text")
                .or_else(|| string_field(part, "content"))
                .or_else(|| summarize_non_text_content(part))
        })
        .collect::<Vec<_>>();
    if texts.is_empty() {
        None
    } else {
        Some(texts.join("\n"))
    }
}

fn summarize_non_text_content(part: &Value) -> Option<String> {
    let kind = string_field(part, "type")?;
    let value = string_field(part, "image_url")
        .or_else(|| string_field(part, "file_url"))
        .or_else(|| string_field(part, "name"));
    let value = value.map(|value| {
        if value.starts_with("data:") {
            "embedded data".to_string()
        } else {
            value
        }
    });
    Some(match value {
        Some(value) => format!("[{kind}: {value}]"),
        None => format!("[{kind}]"),
    })
}

fn extract_system_prompt_text(value: &Value) -> Option<String> {
    value
        .get("base_instructions")
        .and_then(|instructions| string_field(instructions, "text"))
        .or_else(|| string_field(value, "system_prompt"))
        .or_else(|| string_field(value, "systemPrompt"))
        .or_else(|| string_field(value, "instructions"))
}

fn extract_call_id(value: &Value) -> Option<String> {
    string_field(value, "call_id")
        .or_else(|| string_field(value, "callId"))
        .or_else(|| string_field(value, "id"))
        .or_else(|| {
            value
                .get("output")
                .and_then(|output| string_field(output, "call_id"))
        })
}

fn extract_tool_name(value: &Value) -> Option<String> {
    string_field(value, "name")
        .or_else(|| string_field(value, "tool_name"))
        .or_else(|| string_field(value, "command"))
        .or_else(|| {
            value.get("tool").and_then(|tool| {
                string_field(tool, "name").or_else(|| tool.as_str().map(ToString::to_string))
            })
        })
        .or_else(|| match value.get("type").and_then(Value::as_str) {
            Some("local_shell_call") => Some("local_shell".to_string()),
            Some("tool_search_call") => Some("tool_search".to_string()),
            Some("web_search_call") => Some("web_search".to_string()),
            Some("web_search_end") => Some("web_search".to_string()),
            Some("image_generation_call") => Some("image_generation".to_string()),
            Some("image_generation_end") => Some("image_generation".to_string()),
            _ => None,
        })
}

fn extract_tool_arguments(value: &Value) -> Option<String> {
    value
        .get("arguments")
        .or_else(|| value.get("args"))
        .or_else(|| value.get("params"))
        .or_else(|| value.get("input"))
        .or_else(|| value.get("action"))
        .or_else(|| value.get("execution"))
        .or_else(|| value.get("revised_prompt"))
        .map(value_to_compact_string)
}

fn extract_tool_output(value: &Value) -> Option<String> {
    string_field(value, "output")
        .or_else(|| string_field(value, "stdout"))
        .or_else(|| string_field(value, "stderr"))
        .or_else(|| string_field(value, "result"))
        .or_else(|| value.get("results").map(value_to_pretty_string))
        .or_else(|| string_field(value, "saved_path"))
        .or_else(|| value.get("output").map(value_to_pretty_string))
}

fn extract_error_text(value: &Value) -> Option<String> {
    string_field(value, "error")
        .or_else(|| string_field(value, "message"))
        .or_else(|| value.get("error").map(value_to_compact_string))
}

fn value_to_compact_string(value: &Value) -> String {
    value
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn value_to_pretty_string(value: &Value) -> String {
    value.as_str().map(ToString::to_string).unwrap_or_else(|| {
        serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
    })
}

fn duration_between(start: Option<&str>, end: Option<&str>) -> Option<i64> {
    let start = start
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))?;
    let end = end
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))?;
    Some((end - start).num_milliseconds().max(0))
}

#[derive(Default)]
struct ProcessOutputState {
    cell_id: Option<String>,
    duration_ms: Option<i64>,
    output: Option<String>,
    has_process_exit: bool,
    is_running: bool,
    is_stopped: bool,
    is_error: bool,
}

fn parse_process_output(output: &str) -> ProcessOutputState {
    let decoded_output = decode_tool_output_text(output);
    let output = decoded_output.as_deref().unwrap_or(output);
    let cell_id = output
        .split("Script running with cell ID ")
        .nth(1)
        .and_then(|value| value.lines().next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let duration_ms = ["Wall time ", "Wait time "].iter().find_map(|prefix| {
        output.split(prefix).nth(1).and_then(|value| {
            value
                .split_whitespace()
                .next()
                .and_then(|seconds| seconds.parse::<f64>().ok())
                .map(|seconds| (seconds * 1000.0).round() as i64)
        })
    });
    let normalized = output.to_ascii_lowercase();
    let exit_code = ["\"exit_code\"", "exit code:", "process exited with code"]
        .iter()
        .find_map(|marker| {
            normalized.split(marker).nth(1).and_then(|value| {
                value
                    .trim_start_matches(|character: char| {
                        character.is_whitespace() || matches!(character, ':' | '=')
                    })
                    .split(|character: char| !character.is_ascii_digit() && character != '-')
                    .next()
                    .and_then(|code| code.parse::<i64>().ok())
            })
        });
    let signal = ["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP"]
        .into_iter()
        .find(|signal| output.contains(signal));
    let has_process_exit = exit_code.is_some() || signal.is_some();
    let is_running = cell_id.is_some() && !has_process_exit;
    let is_stopped = signal.is_some();
    let is_error = !is_stopped
        && (normalized.contains("script failed") || exit_code.is_some_and(|code| code != 0));
    let mut process_output = extract_process_chunk(output);
    if let Some(exit_code) = exit_code {
        process_output = merge_process_output(
            process_output,
            Some(format!("Process exited with code {exit_code}")),
        );
    }
    if let Some(signal) = signal {
        process_output = merge_process_output(
            process_output,
            Some(format!("Process stopped with signal {signal}")),
        );
    }

    ProcessOutputState {
        cell_id,
        duration_ms,
        output: process_output,
        has_process_exit,
        is_running,
        is_stopped,
        is_error,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProcessContinuationKind {
    Wait,
    WriteStdin,
}

#[derive(Debug, Clone)]
struct ProcessContinuation {
    kind: ProcessContinuationKind,
    session_id: String,
    input: Option<String>,
}

fn extract_process_continuation(tool_name: &str, arguments: &str) -> Option<ProcessContinuation> {
    let base_name = tool_name.rsplit('.').next().unwrap_or(tool_name);
    let (kind, called_name, id_key) =
        if base_name == "write_stdin" || arguments.contains("tools.write_stdin") {
            (
                ProcessContinuationKind::WriteStdin,
                "write_stdin",
                "session_id",
            )
        } else if base_name == "wait" || arguments.contains("tools.wait") {
            (ProcessContinuationKind::Wait, "wait", "cell_id")
        } else {
            return None;
        };
    let parsed = extract_nested_tool_arguments(arguments, called_name);
    let session_id = parsed
        .as_ref()
        .and_then(|value| value.get(id_key))
        .and_then(|value| {
            value
                .as_str()
                .map(ToString::to_string)
                .or_else(|| value.as_i64().map(|value| value.to_string()))
        })
        .or_else(|| extract_argument_scalar(arguments, called_name, id_key))?;
    let input = (kind == ProcessContinuationKind::WriteStdin)
        .then(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("chars"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .or_else(|| extract_argument_string(arguments, called_name, "chars"))
                .unwrap_or_default()
        })
        .filter(|value| !value.is_empty());

    Some(ProcessContinuation {
        kind,
        session_id,
        input,
    })
}

fn is_exec_command_call(tool_name: &str, arguments: Option<&str>) -> bool {
    let base_name = tool_name.rsplit('.').next().unwrap_or(tool_name);
    base_name == "exec_command"
        || arguments.is_some_and(|arguments| arguments.contains("tools.exec_command"))
}

fn extract_nested_tool_arguments(arguments: &str, tool_name: &str) -> Option<Value> {
    if let Ok(value) = serde_json::from_str::<Value>(arguments) {
        return value.is_object().then_some(value);
    }
    let marker = format!("tools.{tool_name}(");
    let rest = arguments.split(&marker).nth(1)?;
    let start = rest.find('{')?;
    let bytes = rest.as_bytes();
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escaped = false;
    for index in start..bytes.len() {
        let byte = bytes[index];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return serde_json::from_str(&rest[start..=index]).ok();
                }
            }
            _ => {}
        }
    }
    None
}

fn extract_argument_scalar(arguments: &str, tool_name: &str, key: &str) -> Option<String> {
    let tool_arguments = arguments
        .split(&format!("tools.{tool_name}"))
        .nth(1)
        .unwrap_or(arguments);
    let marker = tool_arguments
        .find(key)
        .map(|index| &tool_arguments[index + key.len()..])?;
    let value = marker.trim_start_matches(|character: char| {
        character.is_whitespace() || matches!(character, ':' | '=' | '\\' | '"' | '\'')
    });
    let value = value
        .split(|character: char| {
            character.is_whitespace() || matches!(character, ',' | '}' | ')' | '\\' | '"' | '\'')
        })
        .next()
        .unwrap_or("");
    (!value.is_empty()).then(|| value.to_string())
}

fn extract_argument_string(arguments: &str, tool_name: &str, key: &str) -> Option<String> {
    let tool_arguments = arguments
        .split(&format!("tools.{tool_name}"))
        .nth(1)
        .unwrap_or(arguments);
    let marker = tool_arguments
        .find(key)
        .map(|index| &tool_arguments[index + key.len()..])?;
    let value = marker.trim_start_matches(|character: char| {
        character.is_whitespace() || matches!(character, ':' | '=')
    });
    if value.starts_with('"') {
        let mut escaped = false;
        for (index, character) in value.char_indices().skip(1) {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                return serde_json::from_str(&value[..=index]).ok();
            }
        }
    }
    None
}

fn process_input_marker(continuation: &ProcessContinuation) -> Option<String> {
    let input = continuation.input.as_deref()?;
    if input == "\u{3}" {
        Some("› Sent Ctrl+C".to_string())
    } else {
        Some(format!("› Sent: {}", input.trim_end_matches(['\r', '\n'])))
    }
}

fn extract_process_chunk(output: &str) -> Option<String> {
    let decoded_output = decode_tool_output_text(output);
    let output = decoded_output.as_deref().unwrap_or(output);
    let payload = output
        .split_once("\nOutput:\n")
        .map(|(_, payload)| payload)
        .or_else(|| {
            output
                .split_once("\r\nOutput:\r\n")
                .map(|(_, payload)| payload)
        })
        .unwrap_or(output);
    if let Ok(value) = serde_json::from_str::<Value>(payload.trim()) {
        if let Some(chunk) = value.get("output").and_then(Value::as_str) {
            return (!chunk.is_empty()).then(|| chunk.to_string());
        }
        if value.is_object() {
            return None;
        }
    }
    let cleaned = payload.trim();
    (!cleaned.is_empty()).then(|| cleaned.to_string())
}

fn decode_tool_output_text(output: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(output).ok()?;
    let blocks = value.as_array()?;
    let text = blocks
        .iter()
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<String>();
    (!text.is_empty()).then_some(text)
}

fn merge_process_output(existing: Option<String>, new: Option<String>) -> Option<String> {
    match (existing, new) {
        (Some(existing), Some(new)) if existing != new => Some(format!("{existing}\n{new}")),
        (Some(existing), _) => Some(existing),
        (_, new) => new,
    }
}

fn merge_payload_info(payload: &Value, info: &Value) -> Value {
    let mut merged = payload.as_object().cloned().unwrap_or_default();
    merged.insert("info".to_string(), info.clone());
    Value::Object(merged)
}

fn normalize_raw_usage(value: Option<&Value>) -> Option<RawUsage> {
    let value = value?;
    if !value.is_object() {
        return None;
    }

    let input = number_field(value, "input_tokens");
    let cached = number_field(value, "cached_input_tokens")
        .or_else(|| number_field(value, "cache_read_input_tokens"))
        .unwrap_or(0);
    let output = number_field(value, "output_tokens").unwrap_or(0);
    let reasoning = number_field(value, "reasoning_output_tokens").unwrap_or(0);
    let total = number_field(value, "total_tokens").unwrap_or(0);

    Some(RawUsage {
        input_tokens: input.unwrap_or(0),
        cached_input_tokens: cached,
        output_tokens: output,
        reasoning_output_tokens: reasoning,
        total_tokens: if total > 0 {
            total
        } else {
            input.unwrap_or(0) + output
        },
    })
}

fn number_field(value: &Value, field: &str) -> Option<i64> {
    value.get(field).and_then(Value::as_i64)
}

fn subtract_raw_usage(current: &RawUsage, previous: Option<&RawUsage>) -> RawUsage {
    RawUsage {
        input_tokens: (current.input_tokens
            - previous.map(|value| value.input_tokens).unwrap_or(0))
        .max(0),
        cached_input_tokens: (current.cached_input_tokens
            - previous.map(|value| value.cached_input_tokens).unwrap_or(0))
        .max(0),
        output_tokens: (current.output_tokens
            - previous.map(|value| value.output_tokens).unwrap_or(0))
        .max(0),
        reasoning_output_tokens: (current.reasoning_output_tokens
            - previous
                .map(|value| value.reasoning_output_tokens)
                .unwrap_or(0))
        .max(0),
        total_tokens: (current.total_tokens
            - previous.map(|value| value.total_tokens).unwrap_or(0))
        .max(0),
    }
}

fn convert_to_delta(raw: &RawUsage) -> ModelUsage {
    ModelUsage {
        input_tokens: raw.input_tokens,
        cached_input_tokens: raw.cached_input_tokens.min(raw.input_tokens),
        output_tokens: raw.output_tokens,
        reasoning_output_tokens: raw.reasoning_output_tokens,
        total_tokens: if raw.total_tokens > 0 {
            raw.total_tokens
        } else {
            raw.input_tokens + raw.output_tokens
        },
        is_fallback: None,
    }
}

fn extract_model(value: &Value) -> Option<String> {
    if let Some(info) = value.get("info") {
        if let Some(model) =
            string_field(info, "model").or_else(|| string_field(info, "model_name"))
        {
            return Some(model);
        }
        if let Some(model) = info
            .get("metadata")
            .and_then(|metadata| string_field(metadata, "model"))
        {
            return Some(model);
        }
    }

    string_field(value, "model").or_else(|| {
        value
            .get("metadata")
            .and_then(|metadata| string_field(metadata, "model"))
    })
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_database, upsert_session_file_rollups, SessionFileRollup};
    use std::{
        io::Write,
        sync::atomic::{AtomicU64, Ordering},
    };

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn parses_multiple_turns_and_preserves_raw_jsonl() {
        let raw = [
            session_meta("2026-06-01T00:00:00.000Z", "/repo/app"),
            turn_context("2026-06-01T00:00:01.000Z", "turn-1", "gpt-5.5", "/repo/app"),
            event_msg(
                "2026-06-01T00:00:02.000Z",
                serde_json::json!({"type":"user_message","turn_id":"turn-1","text":"Hello"}),
            ),
            event_msg(
                "2026-06-01T00:00:03.000Z",
                serde_json::json!({"type":"assistant_message","turn_id":"turn-1","text":"Hi"}),
            ),
            event_msg(
                "2026-06-01T00:00:04.000Z",
                token_payload("turn-1", "gpt-5.5", 100, 25, 50, 150, 100, 25, 50, 150),
            ),
            turn_context("2026-06-01T00:01:00.000Z", "turn-2", "gpt-5.5", "/repo/app"),
            event_msg(
                "2026-06-01T00:01:01.000Z",
                serde_json::json!({"type":"user_message","turn_id":"turn-2","text":"Run tests"}),
            ),
        ]
        .join("\n");

        let detail = parse_session_detail(record("/tmp/session.jsonl"), raw.clone());

        assert_eq!(detail.raw_jsonl, raw);
        assert_eq!(detail.summary.turn_count, 2);
        assert_eq!(detail.summary.message_count, 3);
        assert_eq!(detail.turns[0].turn_id, "turn-1");
        assert_eq!(detail.turns[1].turn_id, "turn-2");
        assert_eq!(detail.turns[0].token_events[0].total_tokens, 150);
        assert_eq!(detail.summary.time_to_first_token_ms, Some(4000));
    }

    #[test]
    fn attaches_base_instructions_to_each_turn() {
        let raw = [
            session_meta_with_base_instructions(
                "2026-06-01T00:00:00.000Z",
                "/repo/app",
                "Use the repository instructions.",
            ),
            turn_context("2026-06-01T00:00:01.000Z", "turn-1", "gpt-5", "/repo/app"),
            turn_context("2026-06-01T00:01:00.000Z", "turn-2", "gpt-5", "/repo/app"),
        ]
        .join("\n");

        let detail = parse_session_detail(record("/tmp/session.jsonl"), raw);

        assert_eq!(detail.turns.len(), 2);
        assert_eq!(
            detail.turns[0].system_messages[0].text,
            "Use the repository instructions."
        );
        assert_eq!(detail.turns[1].system_messages[0].kind, "base_instructions");
    }

    #[test]
    fn parses_response_item_user_message_content() {
        let raw = [
            session_meta("2026-06-01T00:00:00.000Z", "/repo/app"),
            response_item(
                "2026-06-01T00:00:01.000Z",
                serde_json::json!({
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": "# AGENTS.md instructions for /repo/app\n\n<INSTRUCTIONS>\nUse the repository instructions.\n</INSTRUCTIONS>"
                        },
                        {
                            "type": "input_text",
                            "text": "<environment_context>\n  <cwd>/repo/app</cwd>\n</environment_context>"
                        }
                    ]
                }),
            ),
        ]
        .join("\n");

        let detail = parse_session_detail(record("/tmp/session.jsonl"), raw);

        assert_eq!(detail.turns.len(), 1);
        assert_eq!(detail.turns[0].turn_id, UNGROUPED_TURN_ID);
        assert_eq!(detail.turns[0].user_messages.len(), 1);
        assert!(detail.turns[0].user_messages[0]
            .text
            .contains("AGENTS.md instructions"));
        assert!(detail.turns[0].user_messages[0]
            .text
            .contains("environment_context"));
    }

    #[test]
    fn deduplicates_messages_written_as_response_item_and_event_msg() {
        let raw = [
            turn_context("2026-06-01T00:00:00.000Z", "turn-1", "gpt-5", "/repo/app"),
            response_item(
                "2026-06-01T00:00:01.000Z",
                serde_json::json!({
                    "type": "message",
                    "role": "user",
                    "content": [{ "type": "input_text", "text": "Create a modal" }]
                }),
            ),
            event_msg(
                "2026-06-01T00:00:01.000Z",
                serde_json::json!({
                    "type": "user_message",
                    "message": "Create a modal"
                }),
            ),
            event_msg(
                "2026-06-01T00:00:02.000Z",
                serde_json::json!({
                    "type": "agent_message",
                    "message": "I will inspect the code first."
                }),
            ),
            response_item(
                "2026-06-01T00:00:02.000Z",
                serde_json::json!({
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": "I will inspect the code first." }]
                }),
            ),
        ]
        .join("\n");

        let detail = parse_session_detail(record("/tmp/session.jsonl"), raw);

        assert_eq!(detail.turns[0].user_messages.len(), 1);
        assert_eq!(detail.turns[0].assistant_messages.len(), 1);
        assert_eq!(detail.summary.message_count, 2);
    }

    #[test]
    fn preserves_rollout_order_and_current_response_tool_calls() {
        let raw = [
            event_msg(
                "2026-06-01T00:00:00.000Z",
                serde_json::json!({"type":"task_started","turn_id":"turn-1"}),
            ),
            response_item(
                "2026-06-01T00:00:01.000Z",
                serde_json::json!({
                    "type": "message",
                    "role": "developer",
                    "content": [{"type":"input_text","text":"Follow AGENTS.md"}]
                }),
            ),
            response_item(
                "2026-06-01T00:00:02.000Z",
                serde_json::json!({
                    "type": "message",
                    "role": "user",
                    "content": [{"type":"input_text","text":"Run the tests"}]
                }),
            ),
            response_item(
                "2026-06-01T00:00:03.000Z",
                serde_json::json!({
                    "type":"reasoning",
                    "summary":[{"type":"summary_text","text":"I should inspect first."}]
                }),
            ),
            response_item(
                "2026-06-01T00:00:04.000Z",
                serde_json::json!({
                    "type":"function_call",
                    "name":"exec_command",
                    "call_id":"call-1",
                    "arguments":"{\"cmd\":\"pnpm test\"}"
                }),
            ),
            response_item(
                "2026-06-01T00:00:05.000Z",
                serde_json::json!({
                    "type":"function_call_output",
                    "call_id":"call-1",
                    "output":"all tests passed"
                }),
            ),
            response_item(
                "2026-06-01T00:00:06.000Z",
                serde_json::json!({
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type":"output_text","text":"Done"}]
                }),
            ),
        ]
        .join("\n");

        let detail = parse_session_detail(record("/tmp/session.jsonl"), raw);
        let turn = &detail.turns[0];

        assert_eq!(turn.system_messages[0].text, "Follow AGENTS.md");
        assert_eq!(turn.reasoning_summaries[0].text, "I should inspect first.");
        assert_eq!(turn.tool_calls[0].name, "exec_command");
        assert_eq!(turn.tool_calls[0].status.as_deref(), Some("completed"));
        assert_eq!(
            turn.tool_calls[0].output.as_deref(),
            Some("all tests passed")
        );
        assert!(
            matches!(turn.items[0], SessionReplayItem::Message { ref role, .. } if role == "developer")
        );
        assert!(
            matches!(turn.items[1], SessionReplayItem::Message { ref role, .. } if role == "user")
        );
        assert!(matches!(turn.items[2], SessionReplayItem::Reasoning { .. }));
        assert!(matches!(turn.items[3], SessionReplayItem::ToolCall { .. }));
        assert!(
            matches!(turn.items[4], SessionReplayItem::Message { ref role, .. } if role == "assistant")
        );
    }

    #[test]
    fn preserves_legitimately_repeated_messages() {
        let raw = [
            response_item(
                "2026-06-01T00:00:01.000Z",
                serde_json::json!({"type":"message","role":"user","content":[{"type":"input_text","text":"Retry"}]}),
            ),
            response_item(
                "2026-06-01T00:00:02.000Z",
                serde_json::json!({"type":"message","role":"user","content":[{"type":"input_text","text":"Retry"}]}),
            ),
        ]
        .join("\n");

        let detail = parse_session_detail(record("/tmp/session.jsonl"), raw);

        assert_eq!(detail.turns[0].user_messages.len(), 2);
        assert_eq!(detail.turns[0].items.len(), 2);
    }

    #[test]
    fn rejects_unindexed_session_path() {
        let temp_dir = tempfile_dir();
        let db = open_database(&temp_dir.join("usage.sqlite")).unwrap();
        let error = fetch_session_detail(&db, "/tmp/not-indexed.jsonl").unwrap_err();
        assert_eq!(error, "Session file is not indexed");
    }

    #[test]
    fn uses_cached_prompt_title_in_session_detail() {
        let mut record = record("/tmp/session.jsonl");
        record.prompt_title = Some("First real request".to_string());

        let detail = parse_session_detail(record, String::new());

        assert_eq!(detail.thread_name.as_deref(), Some("First real request"));
    }

    #[test]
    fn calculates_token_deltas_from_running_totals() {
        let raw = [
            turn_context("2026-06-01T00:00:01.000Z", "turn-1", "gpt-5", "/repo/app"),
            event_msg(
                "2026-06-01T00:00:02.000Z",
                token_payload_without_last("turn-1", "gpt-5", 100, 20, 50, 150),
            ),
            event_msg(
                "2026-06-01T00:00:03.000Z",
                token_payload_without_last("turn-1", "gpt-5", 180, 40, 90, 270),
            ),
        ]
        .join("\n");

        let detail = parse_session_detail(record("/tmp/session.jsonl"), raw);

        assert_eq!(detail.turns[0].token_events[0].total_tokens, 150);
        assert_eq!(detail.turns[0].token_events[1].input_tokens, 80);
        assert_eq!(detail.turns[0].token_events[1].cached_input_tokens, 20);
        assert_eq!(detail.turns[0].token_events[1].output_tokens, 40);
        assert_eq!(detail.turns[0].token_events[1].total_tokens, 120);
    }

    #[test]
    fn maps_tool_output_and_patch_errors_by_call_id() {
        let raw = [
            turn_context("2026-06-01T00:00:01.000Z", "turn-1", "gpt-5", "/repo/app"),
            event_msg("2026-06-01T00:00:02.000Z", serde_json::json!({"type":"exec_command_begin","turn_id":"turn-1","call_id":"call-1","name":"exec","arguments":{"cmd":"pnpm test"}})),
            event_msg("2026-06-01T00:00:03.000Z", serde_json::json!({"type":"exec_command_end","turn_id":"turn-1","call_id":"call-1","status":"failed","output":"boom","stderr":"failed"})),
            event_msg("2026-06-01T00:00:04.000Z", serde_json::json!({"type":"patch_apply_end","turn_id":"turn-1","call_id":"patch-1","success":false,"output":"rejected"})),
        ].join("\n");

        let detail = parse_session_detail(record("/tmp/session.jsonl"), raw);

        assert_eq!(detail.turns[0].tool_calls.len(), 1);
        assert_eq!(
            detail.turns[0].tool_calls[0].output.as_deref(),
            Some("boom")
        );
        assert!(detail.turns[0].tool_calls[0].is_error);
        assert_eq!(
            detail.turns[0].patch_results[0].call_id.as_deref(),
            Some("patch-1")
        );
        assert!(detail.turns[0].patch_results[0].is_error);
        assert_eq!(detail.summary.error_count, 2);
    }

    #[test]
    fn merges_process_continuations_by_session_id_without_summing_poll_durations() {
        let raw = [
            turn_context("2026-08-19T13:30:58.000Z", "turn-1", "gpt-5", "/repo/app"),
            response_item(
                "2026-08-19T13:30:59.255Z",
                serde_json::json!({
                    "type": "custom_tool_call",
                    "call_id": "call-exec",
                    "name": "exec",
                    "input": "const r = await tools.exec_command({\"cmd\":\"pnpm test src/App.test.tsx && pnpm typecheck\",\"yield_time_ms\":30000}); text(r.output);"
                }),
            ),
            response_item(
                "2026-08-19T13:31:10.275Z",
                serde_json::json!({
                    "type": "custom_tool_call_output",
                    "call_id": "call-exec",
                    "output": "Script running with cell ID 4\nWall time 11.0 seconds\nOutput:\npartial test output"
                }),
            ),
            event_msg(
                "2026-08-19T13:31:10.276Z",
                token_payload(
                    "turn-1", "gpt-5", 50_000, 400, 384, 50_784, 50_000, 400, 384,
                    50_784,
                ),
            ),
            response_item(
                "2026-08-19T13:31:10.500Z",
                serde_json::json!({
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type":"output_text","text":"Still waiting."}]
                }),
            ),
            response_item(
                "2026-08-19T13:31:11.300Z",
                serde_json::json!({
                    "type": "custom_tool_call",
                    "call_id": "call-write-poll",
                    "name": "exec",
                    "input": "const r = await tools.write_stdin({\"session_id\":4,\"chars\":\"\",\"yield_time_ms\":3000}); text(r);"
                }),
            ),
            response_item(
                "2026-08-19T13:31:14.300Z",
                serde_json::json!({
                    "type": "custom_tool_call_output",
                    "call_id": "call-write-poll",
                    "output": "Script completed\nWall time 3.0 seconds\nOutput:\n{\"session_id\":4,\"wall_time_seconds\":3.0,\"output\":\"more test output\"}"
                }),
            ),
            event_msg(
                "2026-08-19T13:31:14.301Z",
                token_payload(
                    "turn-1", "gpt-5", 55_000, 500, 1_500, 56_500, 55_000, 500, 1_500,
                    56_500,
                ),
            ),
            response_item(
                "2026-08-19T13:31:15.000Z",
                serde_json::json!({
                    "type": "custom_tool_call",
                    "call_id": "call-write-input",
                    "name": "exec",
                    "input": "const r = await tools.write_stdin({\"session_id\":4,\"chars\":\"y\\n\",\"yield_time_ms\":1000}); text(r);"
                }),
            ),
            response_item(
                "2026-08-19T13:31:16.000Z",
                serde_json::json!({
                    "type": "custom_tool_call_output",
                    "call_id": "call-write-input",
                    "output": "Script completed\nWall time 1.0 seconds\nOutput:\n{\"session_id\":4,\"wall_time_seconds\":1.0,\"output\":\"accepted input\"}"
                }),
            ),
            response_item(
                "2026-08-19T13:31:17.000Z",
                serde_json::json!({
                    "type": "custom_tool_call",
                    "call_id": "call-wait",
                    "name": "exec",
                    "input": "const r = await tools.wait({\"cell_id\":\"4\",\"yield_time_ms\":30000}); text(r);"
                }),
            ),
            response_item(
                "2026-08-19T13:31:28.055Z",
                serde_json::json!({
                    "type": "custom_tool_call_output",
                    "call_id": "call-wait",
                    "output": "Script completed\nWall time 11.0 seconds\nOutput:\n{\"exit_code\":0,\"output\":\"all tests passed\"}"
                }),
            ),
        ]
        .join("\n");

        let detail = parse_session_detail(record("/tmp/session.jsonl"), raw);
        let turn = &detail.turns[0];

        assert_eq!(turn.tool_calls.len(), 1);
        assert_eq!(turn.items.len(), 3);
        assert_eq!(detail.summary.tool_call_count, 1);
        assert_eq!(turn.tool_calls[0].call_id.as_deref(), Some("call-exec"));
        assert_eq!(turn.tool_calls[0].status.as_deref(), Some("completed"));
        assert_eq!(turn.tool_calls[0].duration_ms, Some(28_800));
        assert!(turn.tool_calls[0]
            .output
            .as_deref()
            .unwrap()
            .contains("partial test output"));
        assert!(turn.tool_calls[0]
            .output
            .as_deref()
            .unwrap()
            .contains("more test output"));
        assert!(turn.tool_calls[0]
            .output
            .as_deref()
            .unwrap()
            .contains("› Sent: y"));
        assert!(turn.tool_calls[0]
            .output
            .as_deref()
            .unwrap()
            .contains("all tests passed"));
        assert!(matches!(
            turn.items.get(1),
            Some(SessionReplayItem::TokenUsage { usage }) if usage.total_tokens == 56_500
        ));
        assert!(matches!(
            turn.items.get(2),
            Some(SessionReplayItem::Message { text, .. }) if text == "Still waiting."
        ));
    }

    #[test]
    fn keeps_write_stdin_poll_running_without_a_process_exit() {
        let raw = [
            turn_context("2026-08-19T13:30:58.000Z", "turn-1", "gpt-5", "/repo/app"),
            response_item(
                "2026-08-19T13:30:59.000Z",
                serde_json::json!({
                    "type": "custom_tool_call",
                    "call_id": "call-exec",
                    "name": "exec",
                    "input": "const r = await tools.exec_command({\"cmd\":\"pnpm tauri dev\"}); text(r.output);"
                }),
            ),
            response_item(
                "2026-08-19T13:31:09.000Z",
                serde_json::json!({
                    "type": "custom_tool_call_output",
                    "call_id": "call-exec",
                    "output": "Script running with cell ID 44519\nWall time 10.0 seconds\nOutput:\nstarted"
                }),
            ),
            response_item(
                "2026-08-19T13:31:10.000Z",
                serde_json::json!({
                    "type": "custom_tool_call",
                    "call_id": "call-poll",
                    "name": "exec",
                    "input": "const r = await tools.write_stdin({session_id:44519,chars:\"\",yield_time_ms:5000}); text(r.output);"
                }),
            ),
            response_item(
                "2026-08-19T13:31:15.000Z",
                serde_json::json!({
                    "type": "custom_tool_call_output",
                    "call_id": "call-poll",
                    "output": [
                        {"type":"input_text","text":"Script completed\nWall time 5.0 seconds\nOutput:\n"},
                        {"type":"input_text","text":"still running"}
                    ]
                }),
            ),
        ].join("\n");

        let detail = parse_session_detail(record("/tmp/session.jsonl"), raw);
        let tool = &detail.turns[0].tool_calls[0];

        assert_eq!(detail.turns[0].tool_calls.len(), 1);
        assert_eq!(detail.turns[0].items.len(), 1);
        assert_eq!(tool.status.as_deref(), Some("running"));
        assert_eq!(tool.completed_at, None);
        assert_eq!(tool.duration_ms, Some(16_000));
        assert!(tool.output.as_deref().unwrap().contains("still running"));
    }

    #[test]
    fn marks_a_signaled_process_as_stopped_and_records_ctrl_c_input() {
        let raw = [
            turn_context("2026-08-19T13:30:58.000Z", "turn-1", "gpt-5", "/repo/app"),
            response_item(
                "2026-08-19T13:30:59.000Z",
                serde_json::json!({
                    "type": "custom_tool_call",
                    "call_id": "call-exec",
                    "name": "exec",
                    "input": "const r = await tools.exec_command({\"cmd\":\"pnpm tauri dev\"}); text(r.output);"
                }),
            ),
            response_item(
                "2026-08-19T13:31:09.000Z",
                serde_json::json!({
                    "type": "custom_tool_call_output",
                    "call_id": "call-exec",
                    "output": "Script running with cell ID 44519\nWall time 10.0 seconds\nOutput:\nstarted"
                }),
            ),
            response_item(
                "2026-08-19T13:31:10.000Z",
                serde_json::json!({
                    "type": "custom_tool_call",
                    "call_id": "call-stop",
                    "name": "exec",
                    "input": "const r = await tools.write_stdin({session_id:44519,chars:\"\\u0003\"}); text(r);"
                }),
            ),
            response_item(
                "2026-08-19T13:31:11.000Z",
                serde_json::json!({
                    "type": "custom_tool_call_output",
                    "call_id": "call-stop",
                    "output": "Script completed\nWall time 1.0 seconds\nOutput:\n{\"signal\":\"SIGTERM\",\"output\":\"shutting down\"}"
                }),
            ),
        ].join("\n");

        let detail = parse_session_detail(record("/tmp/session.jsonl"), raw);
        let tool = &detail.turns[0].tool_calls[0];

        assert_eq!(detail.turns[0].tool_calls.len(), 1);
        assert_eq!(tool.status.as_deref(), Some("stopped"));
        assert_eq!(tool.duration_ms, Some(12_000));
        assert!(!tool.is_error);
        assert!(tool.output.as_deref().unwrap().contains("› Sent Ctrl+C"));
        assert!(tool.output.as_deref().unwrap().contains("SIGTERM"));
    }

    #[test]
    fn recognizes_nonzero_process_exit_codes_as_failures() {
        let output = parse_process_output(
            "Script completed\nWall time 14.2 seconds\nOutput:\n{\"exit_code\":2}",
        );

        assert_eq!(output.duration_ms, Some(14_200));
        assert!(output.is_error);
        assert!(!output.is_running);
    }

    #[test]
    fn validates_indexed_path_before_reading_file() {
        let temp_dir = tempfile_dir();
        let db_path = temp_dir.join("usage.sqlite");
        let mut db = open_database(&db_path).unwrap();
        let session_path = temp_dir.join("session.jsonl");
        let raw = turn_context("2026-06-01T00:00:01.000Z", "turn-1", "gpt-5", "/repo/app");
        let mut file = fs::File::create(&session_path).unwrap();
        write!(file, "{raw}").unwrap();
        drop(file);
        upsert_session_file_rollups(
            &mut db,
            &[SessionFileRollup {
                path: session_path.to_string_lossy().to_string(),
                modified_at_ms: 123,
                size_bytes: raw.len() as i64,
                rows: vec![],
                prompt_title: Some("Replay this session".to_string()),
                quota_usage: None,
                agent_metadata: None,
            }],
            "2026-06-01T00:00:00.000Z",
        )
        .unwrap();

        let detail = fetch_session_detail(&db, &session_path.to_string_lossy()).unwrap();
        assert_eq!(detail.path, session_path.to_string_lossy());
        assert_eq!(detail.raw_jsonl, raw);
    }

    fn tempfile_dir() -> std::path::PathBuf {
        let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "codex-usage-desktop-session-replay-{}-{}",
            Utc::now().timestamp_nanos_opt().unwrap(),
            counter
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn record(path: &str) -> SessionRollupRecord {
        SessionRollupRecord {
            path: path.to_string(),
            modified_at_ms: 100,
            size_bytes: 200,
            rows: vec![],
            prompt_title: None,
        }
    }

    fn session_meta(timestamp: &str, cwd: &str) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "session_meta",
            "payload": { "cwd": cwd, "cli_version": "1.2.3", "git": { "branch": "main" } }
        })
        .to_string()
    }

    fn session_meta_with_base_instructions(timestamp: &str, cwd: &str, text: &str) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "session_meta",
            "payload": {
                "cwd": cwd,
                "cli_version": "1.2.3",
                "base_instructions": { "text": text }
            }
        })
        .to_string()
    }

    fn turn_context(timestamp: &str, turn_id: &str, model: &str, cwd: &str) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "turn_context",
            "payload": { "turn_id": turn_id, "model": model, "cwd": cwd }
        })
        .to_string()
    }

    fn event_msg(timestamp: &str, payload: Value) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": payload
        })
        .to_string()
    }

    fn response_item(timestamp: &str, payload: Value) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "response_item",
            "payload": payload
        })
        .to_string()
    }

    #[allow(clippy::too_many_arguments)]
    fn token_payload(
        turn_id: &str,
        model: &str,
        total_input: i64,
        total_cached_input: i64,
        total_output: i64,
        total_tokens: i64,
        last_input: i64,
        last_cached_input: i64,
        last_output: i64,
        last_tokens: i64,
    ) -> Value {
        serde_json::json!({
            "type": "token_count",
            "turn_id": turn_id,
            "info": {
                "model": model,
                "total_token_usage": {
                    "input_tokens": total_input,
                    "cached_input_tokens": total_cached_input,
                    "output_tokens": total_output,
                    "reasoning_output_tokens": 0,
                    "total_tokens": total_tokens
                },
                "last_token_usage": {
                    "input_tokens": last_input,
                    "cached_input_tokens": last_cached_input,
                    "output_tokens": last_output,
                    "reasoning_output_tokens": 0,
                    "total_tokens": last_tokens
                }
            }
        })
    }

    fn token_payload_without_last(
        turn_id: &str,
        model: &str,
        total_input: i64,
        total_cached_input: i64,
        total_output: i64,
        total_tokens: i64,
    ) -> Value {
        serde_json::json!({
            "type": "token_count",
            "turn_id": turn_id,
            "info": {
                "model": model,
                "total_token_usage": {
                    "input_tokens": total_input,
                    "cached_input_tokens": total_cached_input,
                    "output_tokens": total_output,
                    "reasoning_output_tokens": 0,
                    "total_tokens": total_tokens
                }
            }
        })
    }
}
