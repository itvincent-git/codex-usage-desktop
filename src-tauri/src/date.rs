use chrono::{
    offset::LocalResult, DateTime, Datelike, Days, NaiveDate, SecondsFormat, TimeZone, Utc,
};
use chrono_tz::Tz;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HourBucket {
    pub key: String,
    pub label: String,
}

pub fn resolve_app_timezone() -> String {
    std::env::var("CODEX_USAGE_TIMEZONE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| iana_time_zone::get_timezone().ok())
        .unwrap_or_else(|| "UTC".to_string())
}

fn parse_timezone(timezone: &str) -> Tz {
    timezone.parse::<Tz>().unwrap_or(chrono_tz::UTC)
}

pub fn date_key_in_timezone(date: DateTime<Utc>, timezone: &str) -> String {
    let local = date.with_timezone(&parse_timezone(timezone));
    format!(
        "{:04}-{:02}-{:02}",
        local.year(),
        local.month(),
        local.day()
    )
}

pub fn local_hour_key(date: DateTime<Utc>, timezone: &str) -> String {
    let timezone = parse_timezone(timezone);
    let local_date = date.with_timezone(&timezone).date_naive();
    let day_start = first_instant_for_local_date(local_date, timezone)
        .expect("an instant with this local date must have a valid day start");
    let elapsed_hours = date.signed_duration_since(day_start).num_hours();
    let aligned = day_start + chrono::Duration::hours(elapsed_hours);
    aligned.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn first_instant_for_local_date(date: NaiveDate, timezone: Tz) -> Option<DateTime<Utc>> {
    let midnight = date.and_hms_opt(0, 0, 0)?;
    (0..24 * 60).find_map(|minutes| {
        let local = midnight + chrono::Duration::minutes(minutes);
        match timezone.from_local_datetime(&local) {
            LocalResult::Single(value) => Some(value.with_timezone(&Utc)),
            LocalResult::Ambiguous(first, second) => {
                Some(first.min(second).with_timezone(&Utc))
            }
            LocalResult::None => None,
        }
    })
}

pub fn list_hour_buckets_until(
    start_date: &str,
    timezone: &str,
    end: DateTime<Utc>,
) -> Result<Vec<HourBucket>, String> {
    let timezone = parse_timezone(timezone);
    let mut date =
        NaiveDate::parse_from_str(start_date, "%Y-%m-%d").map_err(|error| error.to_string())?;
    let end_date = end.with_timezone(&timezone).date_naive();
    let mut buckets = Vec::new();

    while date <= end_date {
        let next_date = date
            .checked_add_days(Days::new(1))
            .ok_or_else(|| "date shift overflow".to_string())?;
        let Some(mut instant) = first_instant_for_local_date(date, timezone) else {
            date = next_date;
            continue;
        };
        let day_end = first_instant_for_local_date(next_date, timezone).unwrap_or(end);
        while instant < day_end && instant <= end {
            buckets.push(HourBucket {
                key: instant.to_rfc3339_opts(SecondsFormat::Secs, true),
                label: instant
                    .with_timezone(&timezone)
                    .format("%Y-%m-%dT%H:%M%:z")
                    .to_string(),
            });
            instant = instant
                .checked_add_signed(chrono::Duration::hours(1))
                .ok_or_else(|| "hour shift overflow".to_string())?;
        }
        date = next_date;
    }

    Ok(buckets)
}

pub fn shift_date_key(date_key: &str, delta_days: i64) -> Result<String, String> {
    let date =
        NaiveDate::parse_from_str(date_key, "%Y-%m-%d").map_err(|error| error.to_string())?;
    let shifted = if delta_days >= 0 {
        date.checked_add_days(Days::new(delta_days as u64))
    } else {
        date.checked_sub_days(Days::new(delta_days.unsigned_abs()))
    }
    .ok_or_else(|| "date shift overflow".to_string())?;
    Ok(shifted.format("%Y-%m-%d").to_string())
}

pub fn list_date_keys(start_date: &str, end_date: &str) -> Result<Vec<String>, String> {
    let mut keys = Vec::new();
    let mut current = start_date.to_string();

    while current.as_str() <= end_date {
        keys.push(current.clone());
        current = shift_date_key(&current, 1)?;
    }

    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shifts_date_keys() {
        assert_eq!(shift_date_key("2026-04-01", -1).unwrap(), "2026-03-31");
        assert_eq!(shift_date_key("2026-04-01", 1).unwrap(), "2026-04-02");
    }

    #[test]
    fn lists_hour_buckets_in_the_app_timezone() {
        let end = "2026-04-02T02:34:00Z".parse::<DateTime<Utc>>().unwrap();

        let buckets = list_hour_buckets_until("2026-04-01", "Asia/Shanghai", end).unwrap();

        assert_eq!(buckets.first().unwrap().key, "2026-03-31T16:00:00Z");
        assert_eq!(buckets.first().unwrap().label, "2026-04-01T00:00+08:00");
        assert_eq!(buckets.last().unwrap().label, "2026-04-02T10:00+08:00");
        assert_eq!(buckets.len(), 35);
    }

    #[test]
    fn aligns_fractional_offset_timezones_to_local_natural_hours() {
        let event = "2026-10-22T18:35:00Z".parse::<DateTime<Utc>>().unwrap();
        assert_eq!(
            local_hour_key(event, "Asia/Kathmandu"),
            "2026-10-22T18:15:00Z"
        );

        let end = "2026-10-22T20:20:00Z".parse::<DateTime<Utc>>().unwrap();
        let buckets = list_hour_buckets_until("2026-10-23", "Asia/Kathmandu", end).unwrap();
        assert_eq!(
            buckets
                .iter()
                .map(|bucket| (bucket.key.as_str(), bucket.label.as_str()))
                .collect::<Vec<_>>(),
            [
                ("2026-10-22T18:15:00Z", "2026-10-23T00:00+05:45"),
                ("2026-10-22T19:15:00Z", "2026-10-23T01:00+05:45"),
                ("2026-10-22T20:15:00Z", "2026-10-23T02:00+05:45"),
            ]
        );
    }

    #[test]
    fn preserves_both_fall_back_hours_and_skips_spring_forward_gaps() {
        let fall_end = "2026-11-01T07:30:00Z".parse::<DateTime<Utc>>().unwrap();
        let fall = list_hour_buckets_until("2026-11-01", "America/New_York", fall_end).unwrap();
        assert_eq!(
            fall.iter().map(|bucket| bucket.label.as_str()).collect::<Vec<_>>(),
            [
                "2026-11-01T00:00-04:00",
                "2026-11-01T01:00-04:00",
                "2026-11-01T01:00-05:00",
                "2026-11-01T02:00-05:00",
            ]
        );

        let spring_end = "2026-03-08T08:30:00Z".parse::<DateTime<Utc>>().unwrap();
        let spring =
            list_hour_buckets_until("2026-03-08", "America/New_York", spring_end).unwrap();
        assert_eq!(
            spring.iter().map(|bucket| bucket.label.as_str()).collect::<Vec<_>>(),
            [
                "2026-03-08T00:00-05:00",
                "2026-03-08T01:00-05:00",
                "2026-03-08T03:00-04:00",
                "2026-03-08T04:00-04:00",
            ]
        );
    }

    #[test]
    fn starts_at_the_first_valid_hour_when_local_midnight_does_not_exist() {
        let end = "2026-09-06T06:30:00Z".parse::<DateTime<Utc>>().unwrap();

        let buckets = list_hour_buckets_until("2026-09-06", "America/Santiago", end).unwrap();

        assert_eq!(buckets.first().unwrap().label, "2026-09-06T01:00-03:00");
    }

    #[test]
    fn keeps_one_hour_buckets_across_fractional_dst_transitions() {
        let spring_event = "2026-10-03T15:35:00Z".parse::<DateTime<Utc>>().unwrap();
        let spring_end = "2026-10-03T17:10:00Z".parse::<DateTime<Utc>>().unwrap();
        let spring =
            list_hour_buckets_until("2026-10-04", "Australia/Lord_Howe", spring_end).unwrap();
        assert_eq!(
            local_hour_key(spring_event, "Australia/Lord_Howe"),
            "2026-10-03T15:30:00Z"
        );
        assert!(spring
            .iter()
            .any(|bucket| bucket.key == "2026-10-03T15:30:00Z"
                && bucket.label == "2026-10-04T02:30+11:00"));

        let fall_event = "2026-04-04T15:10:00Z".parse::<DateTime<Utc>>().unwrap();
        let fall_end = "2026-04-04T16:10:00Z".parse::<DateTime<Utc>>().unwrap();
        let fall =
            list_hour_buckets_until("2026-04-05", "Australia/Lord_Howe", fall_end).unwrap();
        let fall_key = local_hour_key(fall_event, "Australia/Lord_Howe");
        assert!(fall.iter().any(|bucket| bucket.key == fall_key));
    }
}
