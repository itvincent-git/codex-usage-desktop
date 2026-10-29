use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::Duration,
};

fn id(n: u128) -> String {
    uuid::Uuid::from_u128(n).to_string()
}
fn body(ids: &[&str], amount: Value) -> String {
    json!({"data_as_of":null,"threads": ids.iter().map(|id| json!({"thread_id":id,
        "data_status":"available","usage_source":"credits","balance_usage_credits":amount,"groups":[]})).collect::<Vec<_>>()}).to_string()
}

#[test]
fn validates_and_deduplicates_bounded_uuids() {
    let rows = (0..101)
        .chain([0])
        .map(|n| CreditThread {
            thread_id: id(n),
            modified_at_ms: n as i64,
        })
        .collect();
    let rows = validate_threads(rows).unwrap();
    assert_eq!(rows.len(), 101);
    assert_eq!(
        rows.chunks(100).map(<[_]>::len).collect::<Vec<_>>(),
        [100, 1]
    );
    assert!(validate_threads(vec![CreditThread {
        thread_id: "filename.jsonl".into(),
        modified_at_ms: 0
    }])
    .is_err());
    assert!(validate_threads(
        (0..1001)
            .map(|n| CreditThread {
                thread_id: id(n),
                modified_at_ms: 0
            })
            .collect()
    )
    .is_err());
}

#[test]
fn preserves_decimal_strings_zero_null_partial_and_omissions() {
    let root = id(1);
    for raw in [
        "12.34",
        "0E-10",
        "-0.000000000000000001",
        "1e-20",
        "1.000000000000000002",
        "1E+3",
    ] {
        let result = parse_response(&body(&[&root], json!(raw)), &[&root], false).unwrap();
        assert_eq!(result[0].balance_usage_credits.as_deref(), Some(raw));
    }
    let result = parse_response(
        &body(&[&root], Value::Null).replace("available", "partial"),
        &[&root],
        false,
    )
    .unwrap();
    assert_eq!(result[0].data_status.as_deref(), Some("partial"));
    assert!(result[0].balance_usage_credits.is_none());
    assert!(parse_response(&body(&[], Value::Null), &[&root], false)
        .unwrap()
        .is_empty());
    for raw in [
        "NaN",
        "Infinity",
        "1..0",
        "",
        "1e999999999999",
        "1e1e1",
        "--1",
    ] {
        assert!(
            parse_response(&body(&[&root], json!(raw)), &[&root], false).is_err(),
            "{raw}"
        );
    }
    assert!(parse_response(&body(&[&root], json!(1.25)), &[&root], false).is_err());
    assert!(parse_response(&body(&[&root, &root], json!("1")), &[&root], false).is_err());
    assert!(parse_response(&body(&["other"], json!("1")), &[&root], false).is_err());
    assert!(parse_response("not json", &[&root], false).is_err());
}

#[test]
fn cache_is_account_scoped_and_tracks_activity_expiry_and_attempts() {
    let db = Connection::open_in_memory().unwrap();
    create_tables(&db).unwrap();
    let now = 2 * DAY;
    let mut thread = CreditThread {
        thread_id: id(1),
        modified_at_ms: now,
    };
    let mut row = empty_row(&thread.thread_id, now, false);
    row.data_status = Some("available".into());
    row.balance_usage_credits = Some("1e-20".into());
    write_row(&db, "account-a", &thread, &row, now).unwrap();
    assert!(read_cached(&db, "account-b", &thread, now, false)
        .unwrap()
        .is_none());
    assert!(
        !read_cached(&db, "account-a", &thread, now + MIN_INTERVAL - 1, false)
            .unwrap()
            .unwrap()
            .row
            .stale
    );
    assert!(
        read_cached(&db, "account-a", &thread, now + MIN_INTERVAL, false)
            .unwrap()
            .unwrap()
            .row
            .stale
    );
    thread.modified_at_ms += 1;
    assert!(
        read_cached(&db, "account-a", &thread, now + 1, false)
            .unwrap()
            .unwrap()
            .row
            .stale
    );
    thread.modified_at_ms = 0;
    write_row(&db, "account-a", &thread, &row, now).unwrap();
    assert!(
        !read_cached(&db, "account-a", &thread, now + DAY - 1, false)
            .unwrap()
            .unwrap()
            .row
            .stale
    );
    assert!(
        read_cached(&db, "account-a", &thread, now + DAY, false)
            .unwrap()
            .unwrap()
            .row
            .stale
    );
    // An error updates attempt state without advancing the successful timestamp or amount.
    db.execute(
        "UPDATE session_credits SET last_attempt_at=?,stale=1",
        [now + DAY],
    )
    .unwrap();
    let cached = read_cached(&db, "account-a", &thread, now + DAY, false)
        .unwrap()
        .unwrap();
    assert_eq!(cached.fetched_at, now);
    assert_eq!(cached.last_attempt, now + DAY);
    assert_eq!(cached.row.balance_usage_credits.as_deref(), Some("1e-20"));
    row.data_status = Some("partial".into());
    write_row(&db, "account-a", &thread, &row, now).unwrap();
    assert!(
        read_cached(&db, "account-a", &thread, now + MIN_INTERVAL, false)
            .unwrap()
            .unwrap()
            .row
            .stale
    );
}

fn auth() -> CodexAuth {
    CodexAuth {
        access_token: "fixture-token".into(),
        account_id: Some("fixture-account".into()),
        user_id: Some("fixture-user".into()),
        is_chatgpt: true,
    }
}

fn fixture(status: u16, payload: String, delay: Duration) -> (String, thread::JoinHandle<String>) {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!(
        "http://{}/backend-api/wham/usage/thread_usage/query_v2",
        server.local_addr().unwrap()
    );
    let handle = thread::spawn(move || {
        let (mut stream, _) = server.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut buffer = Vec::new();
        loop {
            let mut part = [0; 2048];
            let size = stream.read(&mut part).unwrap();
            buffer.extend_from_slice(&part[..size]);
            if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&buffer[..index]).to_lowercase();
                let len: usize = header
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .unwrap()
                    .parse()
                    .unwrap();
                if buffer.len() >= index + 4 + len {
                    break;
                }
            }
        }
        thread::sleep(delay);
        let _ = write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nContent-Type: application/json\r\nRetry-After: 600\r\nConnection: close\r\n\r\n{payload}", payload.len());
        String::from_utf8(buffer).unwrap()
    });
    (endpoint, handle)
}

#[test]
fn http_contract_and_error_fixtures() {
    let root = id(1);
    let (url, server) = fixture(200, body(&[&root], json!("12.34")), Duration::ZERO);
    let rows = http_request(&auth(), &[&root], &url, Duration::from_secs(5)).unwrap();
    assert_eq!(rows[0].balance_usage_credits.as_deref(), Some("12.34"));
    let request = server.join().unwrap();
    assert!(request.starts_with("POST /backend-api/wham/usage/thread_usage/query_v2 HTTP/1.1"));
    assert!(request
        .to_lowercase()
        .contains("authorization: bearer fixture-token"));
    assert!(request
        .to_lowercase()
        .contains("chatgpt-account-id: fixture-account"));
    let json: Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(
        json,
        json!({"threads":[{"thread_id":root,"created_at":null,"descendant_thread_ids":[]}]})
    );
    for (status, reason) in [
        (401, "chatgptLoginRequired"),
        (403, "forbidden"),
        (404, "endpointUnavailable"),
        (429, "rateLimited"),
        (503, "serviceUnavailable"),
        (200, "invalidResponse"),
    ] {
        let (url, server) = fixture(status, "invalid".into(), Duration::ZERO);
        let error = http_request(&auth(), &[&root], &url, Duration::from_secs(5)).unwrap_err();
        assert_eq!(error.status, reason);
        if status == 429 {
            assert_eq!(error.retry_ms, 600_000);
        }
        server.join().unwrap();
    }
    let (url, server) = fixture(200, body(&[&root], json!("1")), Duration::from_millis(100));
    assert_eq!(
        http_request(&auth(), &[&root], &url, Duration::from_millis(20))
            .unwrap_err()
            .status,
        "networkError"
    );
    server.join().unwrap();
    assert_eq!(
        retry_after("Wed, 21 Oct 2015 07:28:00 GMT", 0),
        1445412480000
    );
}

#[test]
fn scope_revisions_reject_late_activation_and_stop_queued_work() {
    let scope = id(999);
    set_scope(scope.clone(), 2, false).unwrap();
    set_scope(scope.clone(), 1, true).unwrap();
    assert!(!is_active(&scope, 1));
    set_scope(scope.clone(), 3, true).unwrap();
    assert!(is_active(&scope, 3));
    set_scope(scope.clone(), 4, false).unwrap();
    assert!(!is_active(&scope, 3));
}

#[cfg(debug_assertions)]
#[test]
fn demo_uses_real_parser_and_an_independent_memory_cache() {
    let ids = (0..8).map(id).collect::<Vec<_>>();
    let refs = ids.iter().map(String::as_str).collect::<Vec<_>>();
    let rows = parse_response(&demo_response(&refs), &refs, true).unwrap();
    assert_eq!(rows.len(), 7);
    assert!(rows.iter().all(|row| row.is_mock));
    assert!(rows
        .iter()
        .any(|row| row.data_status.as_deref() == Some("partial")));
    let real = Connection::open_in_memory().unwrap();
    create_tables(&real).unwrap();
    let demo = Connection::open_in_memory().unwrap();
    create_tables(&demo).unwrap();
    let thread = CreditThread {
        thread_id: ids[0].clone(),
        modified_at_ms: 0,
    };
    write_row(&demo, "demo", &thread, &rows[0], 0).unwrap();
    assert!(read_cached(&real, "demo", &thread, 0, false)
        .unwrap()
        .is_none());
}
