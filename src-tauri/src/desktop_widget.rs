use crate::{codex_projects::CodexProjectCatalog, db, types::CodexLimitsResponse};
use chrono::{DateTime, Datelike, Days, Months, NaiveDate, TimeZone, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::OpenOptions,
    io::{BufRead, Write},
    os::unix::fs::OpenOptionsExt,
    path::Path,
    sync::{Mutex, OnceLock},
};

static QUOTA: Mutex<Option<CodexLimitsResponse>> = Mutex::new(None);
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn installed() -> bool {
    static INSTALLED: OnceLock<bool> = OnceLock::new();
    *INSTALLED.get_or_init(|| {
        std::env::current_exe().ok().is_some_and(|exe| {
            exe.ancestors()
                .nth(2)
                .is_some_and(|contents| contents.join("PlugIns/CodexUsageWidget.appex").is_dir())
        })
    })
}

pub(crate) fn publish_quota(db_path: &Path, limits: &CodexLimitsResponse) {
    if installed() {
        let Ok(mut quota) = QUOTA.lock() else { return };
        *quota = Some(limits.clone());
        drop(quota);
        refresh(db_path, &crate::date::resolve_app_timezone());
    }
}

pub(crate) fn refresh(db_path: &Path, timezone: &str) {
    if installed() {
        if let Err(error) = save(db_path, timezone, Utc::now()) {
            log::warn!("Could not update desktop widget: {error}");
        }
    }
}

#[derive(Default)]
struct Project {
    name: String,
    total: i64,
    threads: BTreeMap<String, (String, i64)>,
}

#[derive(Default)]
struct Period {
    total: i64,
    models: BTreeMap<String, i64>,
    projects: BTreeMap<(bool, String), Project>,
}

fn ranked(rows: impl Iterator<Item = (i64, Value)>) -> Vec<Value> {
    let mut rows: Vec<_> = rows.filter(|(amount, _)| *amount > 0).collect();
    rows.sort_by(|left, right| right.0.cmp(&left.0));
    rows.into_iter().map(|(_, row)| row).collect()
}

impl Period {
    fn model_rows(&self) -> Vec<Value> {
        ranked(
            self.models
                .iter()
                .map(|(name, total)| (*total, json!({"name":name, "tokens":{"total":total}}))),
        )
    }

    fn project_rows(&self) -> Vec<Value> {
        ranked(self.projects.iter().map(|((grouped, key), project)| {
            let mut row = json!({"name":project.name, "tokens":{"total":project.total}});
            if *grouped {
                row["id"] = json!(format!("{:x}", Sha256::digest(key)));
                row["threads"] = json!(ranked(project.threads.values().map(|(title, total)| {
                    (*total, json!({"name":title, "tokens":{"total":total}}))
                })));
            }
            (project.total, row)
        }))
    }
}

fn save(db_path: &Path, timezone: &str, now: DateTime<Utc>) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    let timezone = timezone.parse::<chrono_tz::Tz>().unwrap_or(chrono_tz::UTC);
    let date = now.with_timezone(&timezone).date_naive();
    let week_start = date - Days::new(u64::from(date.weekday().num_days_from_monday()));
    let month_start = date.with_day(1).ok_or("Invalid month start")?;
    let midnight = |date: NaiveDate| {
        date.and_hms_opt(0, 0, 0)
            .and_then(|local| {
                timezone
                    .from_local_datetime(&local)
                    .earliest()
                    .map(|time| time.timestamp())
                    .or_else(|| {
                        timezone
                            .from_local_datetime(&(local + chrono::TimeDelta::hours(1)))
                            .earliest()
                            .map(|time| time.timestamp())
                    })
            })
            .ok_or_else(|| format!("Cannot resolve day boundary for {date}"))
    };

    let home = crate::scanner::default_codex_home();
    let catalog = CodexProjectCatalog::load(&home);
    let names = crate::session_index::read_thread_names(&home).unwrap_or_default();
    let mut periods: [Period; 3] = Default::default();
    let db = db::open_database(db_path)?;
    let sessions = db::query_all_session_file_rollups(&db)?;
    let cutoff = week_start.min(month_start).format("%Y-%m-%d").to_string();
    let sessions = sessions
        .iter()
        .filter(|session| session.rows.iter().any(|row| row.date >= cutoff));
    let entries: Vec<_> = sessions
        .map(|session| {
            let path = Path::new(&session.path);
            let metadata = crate::session_file::open_session_file(path)
                .ok()
                .and_then(|reader| {
                    reader
                        .lines()
                        .take(8)
                        .filter_map(Result::ok)
                        .find_map(|line| {
                            let entry: Value = serde_json::from_str(&line).ok()?;
                            (entry["type"].as_str() == Some("session_meta"))
                                .then(|| entry["payload"].clone())
                        })
                });
            let id = metadata
                .as_ref()
                .and_then(|entry| entry["id"].as_str())
                .or_else(|| crate::codex_projects::rollout_thread_id(path))
                .map(str::to_owned);
            let parent = metadata
                .as_ref()
                .and_then(|entry| {
                    entry["parent_thread_id"].as_str().or_else(|| {
                        entry["source"]["subagent"]["thread_spawn"]["parent_thread_id"].as_str()
                    })
                })
                .filter(|parent| Some(*parent) != id.as_deref())
                .map(str::to_owned);
            (session, id, parent)
        })
        .collect();
    let parents: BTreeMap<_, _> = entries
        .iter()
        .filter_map(|(_, id, parent)| Some((id.as_deref()?, parent.as_deref()?)))
        .collect();
    for (session, thread, _) in &entries {
        let mut thread = thread.as_deref();
        let mut visited = std::collections::BTreeSet::new();
        while let Some((id, parent)) =
            thread.and_then(|id| parents.get(id).map(|parent| (id, parent)))
        {
            if !visited.insert(id) {
                thread = None;
                break;
            }
            thread = Some(parent);
        }
        let title = thread
            .and_then(|id| names.get(id).map(String::as_str))
            .filter(|title| {
                ![
                    "# Files mentioned by the user:",
                    "<send_user_message_question_reply>",
                    "<environment_context>",
                    "<subagent_notification>",
                ]
                .iter()
                .any(|prefix| title.trim_start().starts_with(prefix))
            });
        let assignment = thread.and_then(|id| catalog.desktop_widget_project(id));
        let (key, name) = assignment
            .map(|(id, name)| ((true, id.to_owned()), name))
            .unwrap_or_else(|| match (thread, title) {
                (Some(id), Some(title)) => ((false, id.to_owned()), title),
                _ => ((false, String::new()), "未能识别的对话"),
            });
        for row in &session.rows {
            let Ok(day) = NaiveDate::parse_from_str(&row.date, "%Y-%m-%d") else {
                continue;
            };
            if day > date {
                continue;
            }
            for (period, included) in
                periods
                    .iter_mut()
                    .zip([day == date, day >= week_start, day >= month_start])
            {
                if !included {
                    continue;
                }
                period.total += row.total_tokens;
                for (model, usage) in &row.models {
                    let label = if usage.is_fallback == Some(true) {
                        "未知模型"
                    } else {
                        model
                    };
                    *period.models.entry(label.to_owned()).or_default() += usage.total_tokens;
                }
                let project = period
                    .projects
                    .entry(key.clone())
                    .or_insert_with(|| Project {
                        name: name.to_owned(),
                        ..Project::default()
                    });
                project.total += row.total_tokens;
                if let (Some(id), Some(_)) = (thread, assignment) {
                    project
                        .threads
                        .entry(id.to_owned())
                        .or_insert_with(|| (title.unwrap_or("未命名对话").to_owned(), 0))
                        .1 += row.total_tokens;
                }
            }
        }
    }

    let auth_context = crate::codex_accounts::native::snapshot(
        &crate::codex_environment::selected_codex_environment(),
    )
    .ok()
    .map(|snapshot| snapshot.context());
    let quota = QUOTA.lock().map_err(|error| error.to_string())?;
    let weekly = quota
        .as_ref()
        .filter(|limits| auth_context.is_some() && limits.auth_context == auth_context)
        .and_then(|limits| limits.weekly.as_ref());
    let quota_end = weekly
        .and_then(|quota| quota.resets_at.as_deref())
        .and_then(|value| value.parse::<DateTime<Utc>>().ok())
        .filter(|end| *end > now);
    let quota_percent = quota_end
        .and(weekly)
        .map(|quota| quota.remaining_percent.clamp(0., 100.).round() as u8);
    drop(quota);
    let [today, week, month] = &periods;
    let snapshot = json!({
        "capturedAt": now.timestamp(),
        "dayEndsAt": midnight(date + Days::new(1))?,
        "weekEndsAt": midnight(week_start + Days::new(7))?,
        "monthEndsAt": midnight(month_start + Months::new(1))?,
        "today": today.total, "week": week.total, "month": month.total,
        "models": {"today":today.model_rows(), "week":week.model_rows(), "month":month.model_rows()},
        "projects": {"today":today.project_rows(), "week":week.project_rows(), "month":month.project_rows()},
        "quotaPercent": quota_percent, "quotaEndsAt": quota_end.map(|end| end.timestamp()),
    });
    let path = db_path.with_file_name("widget-usage.json");
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(|error| error.to_string())?;
    file.write_all(&serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    std::fs::rename(tmp, path).map_err(|error| error.to_string())
}
