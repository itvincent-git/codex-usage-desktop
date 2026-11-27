use serde_json::{json, Value};

const PERIODS: [&str; 3] = ["today", "week", "month"];
const STROKE_WIDTHS: [f64; 6] = [17.5, 15.0, 13.0, 11.2, 9.8, 8.8];
const TONES: [f64; 6] = [1.0, 0.80, 0.65, 0.54, 0.46, 0.40];
const HALF_GAP_TURNS: f64 = 0.0043;

struct Row<'a> {
    name: &'a str,
    id: Option<&'a str>,
    total: u64,
}

pub(crate) fn prepare(snapshot: &Value) -> Value {
    let mut prepared = serde_json::Map::new();
    for period in PERIODS {
        let total = snapshot[period].as_u64();
        prepared.insert(
            period.to_owned(),
            json!({
                "shortTotal": total.map(short),
                "exactTotal": total.map(grouped),
                "models": chart(&snapshot["models"][period]),
                "projects": chart(&snapshot["projects"][period]),
            }),
        );
    }
    Value::Object(prepared)
}

fn chart(rows: &Value) -> Option<Value> {
    let mut source: Vec<_> = rows
        .as_array()?
        .iter()
        .filter_map(|row| {
            let total = row["tokens"]["total"].as_u64()?;
            if total == 0 {
                return None;
            }
            let name = row["name"].as_str()?;
            let id = row["id"].as_str().filter(|id| !id.is_empty());
            Some(Row { name, id, total })
        })
        .collect();
    let other = source
        .iter()
        .skip(5)
        .map(|row| row.total)
        .fold(0, u64::saturating_add);
    source.truncate(5);
    if other > 0 {
        source.push(Row {
            name: "其余",
            id: Some("widget-others"),
            total: other,
        });
    }
    let amounts: Vec<_> = source.iter().map(|row| row.total).collect();
    let ranks: Vec<_> = amounts
        .iter()
        .map(|total| {
            amounts
                .iter()
                .filter(|other| *other > total)
                .count()
                .min(STROKE_WIDTHS.len() - 1)
        })
        .collect();
    let arcs = build_arcs(&amounts, &ranks);
    let rows: Vec<_> = source
        .into_iter()
        .zip(ranks)
        .map(|(row, rank)| {
            let name = if row.id.is_none() && row.name.starts_with("<external_") {
                "未命名对话"
            } else {
                row.name
            };
            let width = STROKE_WIDTHS[rank];
            json!({
                "id": row.id,
                "name": name,
                "short": short(row.total),
                "exact": grouped(row.total),
                "dot": 4.5 + width * 0.22,
                "tone": TONES[rank],
            })
        })
        .collect();
    Some(json!({ "rows": rows, "arcs": arcs }))
}

fn build_arcs(amounts: &[u64], ranks: &[usize]) -> Vec<Value> {
    if amounts.is_empty() {
        return Vec::new();
    }
    let parts = shares(amounts);
    let multiple = parts.len() > 1;
    let mut position = 0.0;
    parts
        .into_iter()
        .zip(ranks)
        .map(|(size, &rank)| {
            let gap = if multiple {
                HALF_GAP_TURNS.min(size * 0.25)
            } else {
                0.0
            };
            let start = position + gap;
            let end = (position + size - gap).max(start);
            position += size;
            json!({
                "start": start,
                "end": end,
                "width": STROKE_WIDTHS[rank],
                "tone": TONES[rank],
            })
        })
        .collect()
}

fn grouped(number: u64) -> String {
    let digits = number.to_string();
    let first = (digits.len() - 1) % 3 + 1;
    let mut result = digits[..first].to_owned();
    for offset in (first..digits.len()).step_by(3) {
        result.push(',');
        result.push_str(&digits[offset..offset + 3]);
    }
    result
}

fn short(number: u64) -> String {
    let (divisor, precision, suffix) = match number {
        100_000_000.. => (100_000_000.0, 2, " 亿"),
        10_000_000.. => (10_000.0, 0, " 万"),
        10_000.. => (10_000.0, 1, " 万"),
        _ => return grouped(number),
    };
    let text = format!("{:.*}", precision, number as f64 / divisor);
    let (whole, fraction) = text.split_once('.').unwrap_or((&text, ""));
    let whole = grouped(whole.parse().unwrap_or_default());
    if fraction.is_empty() {
        format!("{whole}{suffix}")
    } else {
        format!("{whole}.{fraction}{suffix}")
    }
}

fn shares(amounts: &[u64]) -> Vec<f64> {
    let total = amounts.iter().map(|number| *number as f64).sum::<f64>();
    let mut shares: Vec<_> = amounts
        .iter()
        .map(|number| *number as f64 / total)
        .collect();
    if shares.len() == 2 {
        let first = shares[0].clamp(0.02, 0.98);
        shares = vec![first, 1.0 - first];
    } else if shares.len() > 2 && shares.iter().any(|value| *value < 0.022) {
        for share in &mut shares {
            *share = share.powf(0.85).max(0.032);
        }
        let adjusted = shares.iter().sum::<f64>();
        for share in &mut shares {
            *share /= adjusted;
        }
    }
    shares
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepares_codex_arcs_and_compact_totals() {
        assert_eq!(shares(&[93, 7]), vec![0.93, 1.0 - 0.93]);
        assert_eq!(shares(&[999, 1]), vec![0.98, 1.0 - 0.98]);
        assert_eq!(short(95_188_000), "9,519 万");
        assert_eq!(short(4_797_000), "479.7 万");
        assert_eq!(short(441_000_000), "4.41 亿");
        let data = prepare(&json!({
            "today": 100,
            "models": {"today": [{"name": "A", "tokens": {"total": 93}}, {"name": "B", "tokens": {"total": 7}}]}
        }));
        assert_eq!(data["today"]["shortTotal"], "100");
        assert_eq!(data["today"]["models"]["rows"][1]["short"], "7");
        assert_eq!(data["today"]["models"]["rows"][1]["tone"], TONES[1]);
        assert_eq!(data["today"]["models"]["arcs"].as_array().unwrap().len(), 2);
        assert!(data["today"]["projects"].is_null());
    }
}
