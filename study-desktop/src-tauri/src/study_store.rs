//! Phase 2C native persistence foundation (Rust-owned SQLite).
//!
//! Minimal key/value persistence over a single SQLite file. One table per
//! browser logical store (`store TEXT` is the table name, always taken from
//! the [`LOGICAL_STORES`] allowlist — never interpolated from untrusted
//! input), each row a stable `key` + JSON `payload` pair. The browser
//! IndexedDB schema/version (`webnet.study.v1`, version 10) is untouched;
//! the native schema version below is independent and starts at 1.
//!
//! Only the narrow typed commands at the bottom of this file are exposed to
//! the frontend. No raw SQL crosses the IPC bridge.

use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Independent native schema version. Bump only with a real migration.
pub const NATIVE_SCHEMA_VERSION: u32 = 1;

pub const NATIVE_DB_DIR_NAME: &str = "webnet-study";
pub const NATIVE_DB_FILE_NAME: &str = "study.sqlite3";

/// The 22 browser logical stores (17 base + 5 Exam Prep). The two derived
/// search stores (`searchIndexMetadata`, `searchIndexArtifacts`) are part of
/// the 22 and keep the same key/payload shape here; the search index itself
/// is NOT rebuilt natively in this phase.
pub const LOGICAL_STORES: [&str; 22] = [
    "documents",
    "units",
    "prompts",
    "concepts",
    "rubrics",
    "progress",
    "attempts",
    "drafts",
    "settings",
    "legalDocuments",
    "legalComponents",
    "importHistory",
    "searchIndexMetadata",
    "searchIndexArtifacts",
    "aiAuthoringRuns",
    "aiStudyMapProposals",
    "aiUnitProposals",
    "examPrepUnitProgress",
    "examPrepRecallProgress",
    "examPrepAttempts",
    "examPrepSettings",
    "examPrepMockSessions",
];

/// Browser key path per store (informational: callers extract the key before
/// calling `put_record`; native storage normalizes to `key` + `payload`).
/// Informational only (documents the browser key path each native `key` derives from).
#[allow(dead_code)]
pub fn store_key_field(store: &str) -> &'static str {
    match store {
        "progress" => "unitId",
        "legalComponents" => "recordKey",
        "aiAuthoringRuns" => "runId",
        "aiUnitProposals" => "proposalId",
        _ => "id",
    }
}

pub fn is_known_store(store: &str) -> bool {
    LOGICAL_STORES.contains(&store)
}

fn checked_store(store: &str) -> rusqlite::Result<()> {
    if is_known_store(store) {
        Ok(())
    } else {
        Err(rusqlite::Error::InvalidParameterName(format!(
            "unknown study store: {store}"
        )))
    }
}

/// Resolve `<app_data_dir>/webnet-study/study.sqlite3`. The base directory
/// always comes from Tauri path APIs — never a hardcoded user path.
pub fn app_db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join(NATIVE_DB_DIR_NAME)
        .join(NATIVE_DB_FILE_NAME)
}

/// Open (creating parent dirs + file) and deterministically migrate to
/// [`NATIVE_SCHEMA_VERSION`]. Migrations run inside one transaction each.
pub fn open_and_migrate(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(
                Box::new(e) as Box<dyn std::error::Error + Send + Sync>
            )
        })?;
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    run_migrations(&conn)?;
    Ok(conn)
}

pub fn current_schema_version(conn: &Connection) -> rusqlite::Result<u32> {
    let version: Option<String> = conn
        .query_row(
            "SELECT value FROM native_schema_meta WHERE key = 'version'",
            [],
            |row| row.get(0),
        )
        .ok();
    Ok(version.and_then(|v| v.parse().ok()).unwrap_or(0))
}

fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS native_schema_meta (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL
         )",
    )?;
    let current: u32 = tx
        .query_row(
            "SELECT value FROM native_schema_meta WHERE key = 'version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if current < 1 {
        for store in LOGICAL_STORES {
            // Safe: `store` comes from the compile-time allowlist above.
            tx.execute_batch(&format!(
                "CREATE TABLE IF NOT EXISTS \"{store}\" (
                   key TEXT PRIMARY KEY,
                   payload TEXT NOT NULL
                 )"
            ))?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO native_schema_meta (key, value) VALUES ('version', ?1)",
            params![NATIVE_SCHEMA_VERSION.to_string()],
        )?;
    }
    tx.commit()
}

pub fn put_record(
    conn: &Connection,
    store: &str,
    key: &str,
    payload: &serde_json::Value,
) -> rusqlite::Result<()> {
    checked_store(store)?;
    conn.execute(
        &format!("INSERT OR REPLACE INTO \"{store}\" (key, payload) VALUES (?1, ?2)"),
        params![key, payload.to_string()],
    )?;
    Ok(())
}

pub fn get_record(
    conn: &Connection,
    store: &str,
    key: &str,
) -> rusqlite::Result<Option<serde_json::Value>> {
    checked_store(store)?;
    let raw: Option<String> = conn
        .query_row(
            &format!("SELECT payload FROM \"{store}\" WHERE key = ?1"),
            params![key],
            |row| row.get(0),
        )
        .ok();
    raw.map(|s| {
        serde_json::from_str(&s).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })
    })
    .transpose()
}

pub fn delete_record(conn: &Connection, store: &str, key: &str) -> rusqlite::Result<()> {
    checked_store(store)?;
    conn.execute(
        &format!("DELETE FROM \"{store}\" WHERE key = ?1"),
        params![key],
    )?;
    Ok(())
}

pub fn list_keys(conn: &Connection, store: &str) -> rusqlite::Result<Vec<String>> {
    checked_store(store)?;
    let mut stmt = conn.prepare(&format!("SELECT key FROM \"{store}\" ORDER BY key"))?;
    let keys = stmt
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(keys)
}

/// Max ops per batch (clears + puts + deletes). Keeps one IPC call bounded.
/// Full-snapshot rewrites stay well under this (22 clears + ~thousands of puts
/// split by the caller if ever exceeded — the frontend chunks replaceAll).
pub const NATIVE_BATCH_OP_LIMIT: usize = 20000;
/// Max rows returned by a single read command. Reads that would exceed this
/// fail closed with an error (never silently truncate): the caller must
/// narrow the read instead of receiving a partial snapshot.
pub const NATIVE_READ_LIMIT: i64 = 50000;

fn read_limit_overflow(store: &str, limit: i64) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(format!(
        "store '{store}' exceeds read limit of {limit} rows; narrow the read instead of truncating"
    ))
}

fn parse_payload_rows(rows: Vec<String>) -> rusqlite::Result<Vec<serde_json::Value>> {
    rows.iter()
        .map(|s| {
            serde_json::from_str(s).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })
        })
        .collect()
}

pub fn list_store(conn: &Connection, store: &str) -> rusqlite::Result<Vec<serde_json::Value>> {
    list_store_with_limit(conn, store, NATIVE_READ_LIMIT)
}

fn list_store_with_limit(
    conn: &Connection,
    store: &str,
    limit: i64,
) -> rusqlite::Result<Vec<serde_json::Value>> {
    checked_store(store)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT payload FROM \"{store}\" ORDER BY key LIMIT ?1"
    ))?;
    // Fetch one row past the limit: reaching it proves overflow, so the read
    // fails closed instead of silently returning a truncated store.
    let rows = stmt
        .query_map(params![limit + 1], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    if rows.len() as i64 > limit {
        return Err(read_limit_overflow(store, limit));
    }
    parse_payload_rows(rows)
}

/// Generic equality filter over one top-level JSON payload field
/// (covers the browser `byUnitId`/`byDocumentId`-style lazy reads without
/// translating domain logic into Rust — field and value are opaque).
pub fn query_by_field(
    conn: &Connection,
    store: &str,
    field: &str,
    value: &str,
) -> rusqlite::Result<Vec<serde_json::Value>> {
    query_by_field_with_limit(conn, store, field, value, NATIVE_READ_LIMIT)
}

fn query_by_field_with_limit(
    conn: &Connection,
    store: &str,
    field: &str,
    value: &str,
    limit: i64,
) -> rusqlite::Result<Vec<serde_json::Value>> {
    checked_store(store)?;
    if field.is_empty()
        || field.len() > 64
        || !field.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(rusqlite::Error::InvalidParameterName(
            "invalid query field".into(),
        ));
    }
    if value.len() > 512 {
        return Err(rusqlite::Error::InvalidParameterName(
            "query value too long".into(),
        ));
    }
    // Safe: `store` is allowlisted, `field` is charset-validated above; the
    // value travels as a bound parameter.
    let mut stmt = conn.prepare(&format!(
        "SELECT payload FROM \"{store}\" WHERE json_extract(payload, '$.' || ?1) = ?2 ORDER BY key LIMIT ?3"
    ))?;
    let rows = stmt
        .query_map(params![field, value, limit + 1], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    // One row past the limit proves overflow: fail closed, never truncate.
    if rows.len() as i64 > limit {
        return Err(read_limit_overflow(store, limit));
    }
    parse_payload_rows(rows)
}

pub fn load_all(
    conn: &Connection,
) -> rusqlite::Result<std::collections::BTreeMap<String, Vec<serde_json::Value>>> {
    let mut out = std::collections::BTreeMap::new();
    for store in LOGICAL_STORES {
        out.insert(store.to_string(), list_store(conn, store)?);
    }
    Ok(out)
}

/// Pre-write expectation checked inside the batch transaction (preserves the
/// browser CAS/immutability semantics without moving domain logic to Rust).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StudyNativeExpected {
    /// Key must not exist (immutable `add` writes, absent-expectations).
    Absent,
    /// Existing payload's `updatedAt` must equal `updatedAt`; missing keys
    /// pass (mirrors the browser progress-CAS "only check when present").
    UpdatedAtEquals { updated_at: String },
    /// Key must exist with `updatedAt` equal to `updated_at`.
    PresentWithUpdatedAt { updated_at: String },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyNativeCondition {
    pub store: String,
    pub key: String,
    pub expected: StudyNativeExpected,
    /// Error text surfaced when the condition fails (domain wording chosen
    /// by the TypeScript caller, not by Rust).
    pub message: String,
}

/// Generic creation-lock guard: fail the batch when any OTHER record in
/// `store` has `status == active_status` plus the given field equalities.
/// The frontend uses it for the one-active-current-mock lock; the fields
/// themselves stay opaque here.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyNativeUniquenessGuard {
    pub store: String,
    pub except_key: String,
    pub active_status: String,
    pub field_equals: std::collections::BTreeMap<String, String>,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyNativeBatch {
    #[serde(default)]
    pub clears: Vec<String>,
    #[serde(default)]
    pub puts: Vec<StudyNativePut>,
    #[serde(default)]
    pub deletes: Vec<StudyNativeKey>,
    #[serde(default)]
    pub conditions: Vec<StudyNativeCondition>,
    #[serde(default)]
    pub uniqueness_guard: Option<StudyNativeUniquenessGuard>,
}

fn payload_updated_at(payload: &serde_json::Value) -> Option<&str> {
    payload.get("updatedAt")?.as_str()
}

/// Apply a whole batch inside ONE SQLite transaction: conditions first,
/// then clears/puts/deletes. Any failure rolls everything back.
pub fn apply_batch(conn: &mut Connection, batch: &StudyNativeBatch) -> Result<(), String> {
    let op_count = batch.clears.len() + batch.puts.len() + batch.deletes.len();
    if op_count > NATIVE_BATCH_OP_LIMIT {
        return Err(format!("study batch too large: {op_count} ops"));
    }
    for store in &batch.clears {
        checked_store(store).map_err(|e| e.to_string())?;
    }
    for put in &batch.puts {
        checked_store(&put.store).map_err(|e| e.to_string())?;
    }
    for del in &batch.deletes {
        checked_store(&del.store).map_err(|e| e.to_string())?;
    }
    for cond in &batch.conditions {
        checked_store(&cond.store).map_err(|e| e.to_string())?;
    }
    if let Some(guard) = &batch.uniqueness_guard {
        checked_store(&guard.store).map_err(|e| e.to_string())?;
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // 1. Conditions (fail-closed, before any write).
    for cond in &batch.conditions {
        let raw: Option<String> = tx
            .query_row(
                &format!("SELECT payload FROM \"{}\" WHERE key = ?1", cond.store),
                params![cond.key],
                |row| row.get(0),
            )
            .ok();
        let existing: Option<serde_json::Value> = raw
            .map(|s| serde_json::from_str(&s))
            .transpose()
            .map_err(|e: serde_json::Error| e.to_string())?;
        let ok = match &cond.expected {
            StudyNativeExpected::Absent => existing.is_none(),
            StudyNativeExpected::UpdatedAtEquals { updated_at } => existing
                .as_ref()
                .and_then(payload_updated_at)
                .map_or(true, |v| v == updated_at),
            StudyNativeExpected::PresentWithUpdatedAt { updated_at } => {
                existing.as_ref().and_then(payload_updated_at) == Some(updated_at.as_str())
            }
        };
        if !ok {
            return Err(cond.message.clone());
        }
    }
    // 2. Uniqueness guard (single SELECT inside the same tx as the writes).
    if let Some(guard) = &batch.uniqueness_guard {
        for field in guard.field_equals.keys() {
            if field.is_empty()
                || field.len() > 64
                || !field.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                return Err("invalid uniqueness guard field".into());
            }
        }
        // Safe: store allowlisted, fields charset-validated; values bound.
        // Numbered parameters (?1, ?2, ...) so ordering is explicit.
        let mut sql = format!(
            "SELECT key FROM \"{}\" WHERE json_extract(payload, '$.status') = ?1",
            guard.store
        );
        let mut index = 2;
        for field in guard.field_equals.keys() {
            sql.push_str(&format!(
                " AND json_extract(payload, '$.{field}') = ?{index}"
            ));
            index += 1;
        }
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let owned: Vec<String> = guard.field_equals.values().cloned().collect();
        let status = guard.active_status.clone();
        // One small query per arity (each closure has its own type, so the
        // match arms cannot share a single `query_map` call).
        fn collect_keys(
            rows: rusqlite::MappedRows<
                '_,
                impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<String>,
            >,
        ) -> Result<Vec<String>, String> {
            rows.collect::<rusqlite::Result<_>>()
                .map_err(|e| e.to_string())
        }
        let hits: Vec<String> = match owned.as_slice() {
            [] => collect_keys(
                stmt.query_map(params![status], |row| row.get(0))
                    .map_err(|e| e.to_string())?,
            )?,
            [a] => collect_keys(
                stmt.query_map(params![status, a.clone()], |row| row.get(0))
                    .map_err(|e| e.to_string())?,
            )?,
            [a, b] => collect_keys(
                stmt.query_map(params![status, a.clone(), b.clone()], |row| row.get(0))
                    .map_err(|e| e.to_string())?,
            )?,
            [a, b, c] => collect_keys(
                stmt.query_map(params![status, a.clone(), b.clone(), c.clone()], |row| {
                    row.get(0)
                })
                .map_err(|e| e.to_string())?,
            )?,
            _ => return Err("too many uniqueness guard fields".into()),
        };
        if hits.iter().any(|k| k != &guard.except_key) {
            return Err(guard.message.clone());
        }
    }
    // 3. Writes.
    for store in &batch.clears {
        tx.execute(&format!("DELETE FROM \"{store}\""), [])
            .map_err(|e| e.to_string())?;
    }
    for put in &batch.puts {
        tx.execute(
            &format!(
                "INSERT OR REPLACE INTO \"{}\" (key, payload) VALUES (?1, ?2)",
                put.store
            ),
            params![put.key, put.payload.to_string()],
        )
        .map_err(|e| e.to_string())?;
    }
    for del in &batch.deletes {
        tx.execute(
            &format!("DELETE FROM \"{}\" WHERE key = ?1", del.store),
            params![del.key],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Narrow typed bridge (the only surface exposed to the frontend) ----

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyNativeStatus {
    pub db_path: String,
    pub schema_version: u32,
    pub stores: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyNativePut {
    pub store: String,
    pub key: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyNativeKey {
    pub store: String,
    pub key: String,
}

fn open_from_app(app: &AppHandle) -> Result<(Connection, PathBuf), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = app_db_path(&dir);
    let conn = open_and_migrate(&path).map_err(|e| e.to_string())?;
    Ok((conn, path))
}

#[tauri::command]
pub fn study_native_status(app: AppHandle) -> Result<StudyNativeStatus, String> {
    let (conn, path) = open_from_app(&app)?;
    let schema_version = current_schema_version(&conn).map_err(|e| e.to_string())?;
    Ok(StudyNativeStatus {
        db_path: path.to_string_lossy().into_owned(),
        schema_version,
        stores: LOGICAL_STORES.iter().map(|s| s.to_string()).collect(),
    })
}

/// Tauri command threading (deliberate): these commands stay synchronous.
/// Each call opens a short-lived connection, runs one bounded statement
/// batch (writes cap at `NATIVE_BATCH_OP_LIMIT` ops, reads fail closed at
/// `NATIVE_READ_LIMIT` rows), and closes it — WAL mode plus a 5 s busy
/// timeout keeps contention negligible, and Tauri dispatches commands off
/// the UI thread. An async wrapper or connection pool would add lifetime
/// complexity for no measurable gain at this call volume.
#[tauri::command]
pub fn study_native_put(app: AppHandle, input: StudyNativePut) -> Result<(), String> {
    let (conn, _) = open_from_app(&app)?;
    put_record(&conn, &input.store, &input.key, &input.payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn study_native_get(
    app: AppHandle,
    input: StudyNativeKey,
) -> Result<Option<serde_json::Value>, String> {
    let (conn, _) = open_from_app(&app)?;
    get_record(&conn, &input.store, &input.key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn study_native_delete(app: AppHandle, input: StudyNativeKey) -> Result<(), String> {
    let (conn, _) = open_from_app(&app)?;
    delete_record(&conn, &input.store, &input.key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn study_native_list_keys(app: AppHandle, store: String) -> Result<Vec<String>, String> {
    let (conn, _) = open_from_app(&app)?;
    list_keys(&conn, &store).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn study_native_batch(app: AppHandle, batch: StudyNativeBatch) -> Result<(), String> {
    let (mut conn, _) = open_from_app(&app)?;
    apply_batch(&mut conn, &batch)
}

#[tauri::command]
pub fn study_native_load_all(
    app: AppHandle,
) -> Result<std::collections::BTreeMap<String, Vec<serde_json::Value>>, String> {
    let (conn, _) = open_from_app(&app)?;
    load_all(&conn).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyNativeListStore {
    pub store: String,
}

#[tauri::command]
pub fn study_native_list_store(
    app: AppHandle,
    input: StudyNativeListStore,
) -> Result<Vec<serde_json::Value>, String> {
    let (conn, _) = open_from_app(&app)?;
    list_store(&conn, &input.store).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyNativeFieldQuery {
    pub store: String,
    pub field: String,
    pub value: String,
}

#[tauri::command]
pub fn study_native_query_field(
    app: AppHandle,
    input: StudyNativeFieldQuery,
) -> Result<Vec<serde_json::Value>, String> {
    let (conn, _) = open_from_app(&app)?;
    query_by_field(&conn, &input.store, &input.field, &input.value).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// Unique temp dir without extra dev-dependencies (std only).
    fn test_db_path() -> PathBuf {
        let id = TEST_DIR_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "webnet-study-native-test-{}-{}",
            std::process::id(),
            id
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join(NATIVE_DB_DIR_NAME).join(NATIVE_DB_FILE_NAME)
    }

    fn sample_payload() -> serde_json::Value {
        serde_json::json!({"id": "u1", "title": "Unit 1", "n": 42})
    }

    #[test]
    fn creates_empty_db_at_schema_version_1() {
        let path = test_db_path();
        assert!(!path.exists());
        let conn = open_and_migrate(&path).unwrap();
        assert!(path.exists());
        assert_eq!(current_schema_version(&conn).unwrap(), 1);
        for store in LOGICAL_STORES {
            assert!(list_keys(&conn, store).unwrap().is_empty());
        }
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn migrations_are_idempotent() {
        let path = test_db_path();
        {
            let conn = open_and_migrate(&path).unwrap();
            put_record(&conn, "units", "u1", &sample_payload()).unwrap();
        }
        let conn = open_and_migrate(&path).unwrap();
        assert_eq!(current_schema_version(&conn).unwrap(), 1);
        assert_eq!(
            get_record(&conn, "units", "u1").unwrap().unwrap(),
            sample_payload()
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn crud_round_trip() {
        let path = test_db_path();
        let conn = open_and_migrate(&path).unwrap();
        assert!(get_record(&conn, "documents", "missing").unwrap().is_none());
        put_record(&conn, "documents", "d1", &sample_payload()).unwrap();
        assert_eq!(
            get_record(&conn, "documents", "d1").unwrap().unwrap(),
            sample_payload()
        );
        let updated = serde_json::json!({"id": "d1", "rev": 2});
        put_record(&conn, "documents", "d1", &updated).unwrap();
        assert_eq!(
            get_record(&conn, "documents", "d1").unwrap().unwrap(),
            updated
        );
        delete_record(&conn, "documents", "d1").unwrap();
        assert!(get_record(&conn, "documents", "d1").unwrap().is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn unknown_store_is_rejected() {
        let path = test_db_path();
        let conn = open_and_migrate(&path).unwrap();
        assert!(put_record(&conn, "nope", "k", &sample_payload()).is_err());
        assert!(get_record(&conn, "nope", "k").is_err());
        assert!(delete_record(&conn, "nope", "k").is_err());
        assert!(list_keys(&conn, "nope; DROP TABLE units;--").is_err());
        // Allowlisted tables survive the injection-shaped input.
        assert!(list_keys(&conn, "units").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn transaction_commit_persists_and_rollback_discards() {
        let path = test_db_path();
        let mut conn = open_and_migrate(&path).unwrap();
        {
            let tx = conn.transaction().unwrap();
            tx.execute(
                "INSERT INTO \"attempts\" (key, payload) VALUES (?1, ?2)",
                params!["a1", "{}"],
            )
            .unwrap();
            tx.commit().unwrap();
        }
        assert!(get_record(&conn, "attempts", "a1").unwrap().is_some());
        {
            let tx = conn.transaction().unwrap();
            tx.execute(
                "INSERT INTO \"attempts\" (key, payload) VALUES (?1, ?2)",
                params!["a2", "{}"],
            )
            .unwrap();
            tx.rollback().unwrap();
        }
        assert!(get_record(&conn, "attempts", "a2").unwrap().is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn records_survive_reopen() {
        let path = test_db_path();
        {
            let conn = open_and_migrate(&path).unwrap();
            put_record(&conn, "examPrepSettings", "s1", &sample_payload()).unwrap();
            put_record(&conn, "legalComponents", "doc::sec1", &sample_payload()).unwrap();
        }
        let conn = open_and_migrate(&path).unwrap();
        assert_eq!(
            get_record(&conn, "examPrepSettings", "s1")
                .unwrap()
                .unwrap(),
            sample_payload()
        );
        assert_eq!(
            get_record(&conn, "legalComponents", "doc::sec1")
                .unwrap()
                .unwrap(),
            sample_payload()
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn db_path_uses_app_data_dir_without_hardcoded_home() {
        let base = Path::new("/tmp/fake-app-data/abc");
        let resolved = app_db_path(base);
        assert_eq!(
            resolved,
            Path::new("/tmp/fake-app-data/abc/webnet-study/study.sqlite3")
        );
        assert!(!resolved.to_string_lossy().contains("home"));
    }

    #[test]
    fn batch_applies_multi_store_writes_in_one_transaction() {
        let path = test_db_path();
        let mut conn = open_and_migrate(&path).unwrap();
        let batch = StudyNativeBatch {
            clears: vec![],
            puts: vec![
                StudyNativePut {
                    store: "attempts".into(),
                    key: "a1".into(),
                    payload: serde_json::json!({"id": "a1"}),
                },
                StudyNativePut {
                    store: "progress".into(),
                    key: "u1".into(),
                    payload: serde_json::json!({"unitId": "u1", "updatedAt": "t1"}),
                },
            ],
            deletes: vec![],
            conditions: vec![],
            uniqueness_guard: None,
        };
        apply_batch(&mut conn, &batch).unwrap();
        assert!(get_record(&conn, "attempts", "a1").unwrap().is_some());
        assert!(get_record(&conn, "progress", "u1").unwrap().is_some());
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn batch_condition_failure_rolls_back_all_writes() {
        let path = test_db_path();
        let mut conn = open_and_migrate(&path).unwrap();
        put_record(
            &conn,
            "progress",
            "u1",
            &serde_json::json!({"unitId": "u1", "updatedAt": "t1"}),
        )
        .unwrap();
        let stale = StudyNativeBatch {
            clears: vec![],
            puts: vec![StudyNativePut {
                store: "attempts".into(),
                key: "a9".into(),
                payload: serde_json::json!({"id": "a9"}),
            }],
            deletes: vec![],
            conditions: vec![StudyNativeCondition {
                store: "progress".into(),
                key: "u1".into(),
                expected: StudyNativeExpected::UpdatedAtEquals {
                    updated_at: "t-stale".into(),
                },
                message: "stale".into(),
            }],
            uniqueness_guard: None,
        };
        assert_eq!(apply_batch(&mut conn, &stale).unwrap_err(), "stale");
        // The put rolled back with the failed condition.
        assert!(get_record(&conn, "attempts", "a9").unwrap().is_none());
        assert_eq!(
            get_record(&conn, "progress", "u1").unwrap().unwrap(),
            serde_json::json!({"unitId": "u1", "updatedAt": "t1"})
        );
        // Absent-condition preserves immutable-add semantics.
        put_record(
            &conn,
            "examPrepAttempts",
            "e1",
            &serde_json::json!({"id": "e1"}),
        )
        .unwrap();
        let dup = StudyNativeBatch {
            clears: vec![],
            puts: vec![StudyNativePut {
                store: "examPrepAttempts".into(),
                key: "e1".into(),
                payload: serde_json::json!({"id": "e1", "rev": 2}),
            }],
            deletes: vec![],
            conditions: vec![StudyNativeCondition {
                store: "examPrepAttempts".into(),
                key: "e1".into(),
                expected: StudyNativeExpected::Absent,
                message: "duplicate".into(),
            }],
            uniqueness_guard: None,
        };
        assert_eq!(apply_batch(&mut conn, &dup).unwrap_err(), "duplicate");
        assert_eq!(
            get_record(&conn, "examPrepAttempts", "e1")
                .unwrap()
                .unwrap(),
            serde_json::json!({"id": "e1"})
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn batch_uniqueness_guard_blocks_second_active_mock() {
        let path = test_db_path();
        let mut conn = open_and_migrate(&path).unwrap();
        let active = |id: &str| StudyNativePut {
            store: "examPrepMockSessions".into(),
            key: id.into(),
            payload: serde_json::json!({
                "id": id, "status": "in_progress",
                "curriculumId": "cur1", "curriculumContentHash": "h1",
            }),
        };
        let guard_for = |id: &str, curriculum_id: &str, hash: &str| StudyNativeUniquenessGuard {
            store: "examPrepMockSessions".into(),
            except_key: id.into(),
            active_status: "in_progress".into(),
            field_equals: [
                ("curriculumId".to_string(), curriculum_id.to_string()),
                ("curriculumContentHash".to_string(), hash.to_string()),
            ]
            .into_iter()
            .collect(),
            message: "already in progress".into(),
        };
        apply_batch(
            &mut conn,
            &StudyNativeBatch {
                clears: vec![],
                puts: vec![active("m1")],
                deletes: vec![],
                conditions: vec![],
                uniqueness_guard: Some(guard_for("m1", "cur1", "h1")),
            },
        )
        .unwrap();
        // A different binding is unaffected by the guard.
        apply_batch(&mut conn, &StudyNativeBatch {
            clears: vec![],
            puts: vec![StudyNativePut { store: "examPrepMockSessions".into(), key: "m2".into(),
                payload: serde_json::json!({"id": "m2", "status": "in_progress", "curriculumId": "other", "curriculumContentHash": "h1"}) }],
            deletes: vec![], conditions: vec![], uniqueness_guard: Some(guard_for("m2", "other", "h1")),
        }).unwrap();
        // Same binding, other id -> blocked, and the blocked put rolls back.
        let blocked = apply_batch(
            &mut conn,
            &StudyNativeBatch {
                clears: vec![],
                puts: vec![active("m3")],
                deletes: vec![],
                conditions: vec![],
                uniqueness_guard: Some(guard_for("m3", "cur1", "h1")),
            },
        );
        assert_eq!(blocked.unwrap_err(), "already in progress");
        assert!(get_record(&conn, "examPrepMockSessions", "m3")
            .unwrap()
            .is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn batch_rejects_unknown_store_and_oversize_batches() {
        let path = test_db_path();
        let mut conn = open_and_migrate(&path).unwrap();
        let evil = StudyNativeBatch {
            clears: vec!["units; DROP TABLE units;--".into()],
            puts: vec![],
            deletes: vec![],
            conditions: vec![],
            uniqueness_guard: None,
        };
        assert!(apply_batch(&mut conn, &evil).is_err());
        assert!(list_keys(&conn, "units").unwrap().is_empty());
        let huge = StudyNativeBatch {
            clears: vec![],
            puts: (0..(NATIVE_BATCH_OP_LIMIT + 1))
                .map(|i| StudyNativePut {
                    store: "drafts".into(),
                    key: format!("d{i}"),
                    payload: serde_json::json!({}),
                })
                .collect(),
            deletes: vec![],
            conditions: vec![],
            uniqueness_guard: None,
        };
        assert!(apply_batch(&mut conn, &huge).is_err());
        assert!(list_keys(&conn, "drafts").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn field_query_and_load_all_round_trip() {
        let path = test_db_path();
        let conn = open_and_migrate(&path).unwrap();
        put_record(
            &conn,
            "concepts",
            "c1",
            &serde_json::json!({"id": "c1", "unitId": "u1"}),
        )
        .unwrap();
        put_record(
            &conn,
            "concepts",
            "c2",
            &serde_json::json!({"id": "c2", "unitId": "u2"}),
        )
        .unwrap();
        let hits = query_by_field(&conn, "concepts", "unitId", "u1").unwrap();
        assert_eq!(hits.len(), 1);
        assert!(query_by_field(&conn, "concepts", "nope!", "u1").is_err());
        let all = load_all(&conn).unwrap();
        assert_eq!(all.len(), 22);
        assert_eq!(all["concepts"].len(), 2);
        assert!(all["units"].is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn read_limits_fail_closed_on_overflow_instead_of_truncating() {
        let path = test_db_path();
        let conn = open_and_migrate(&path).unwrap();
        // Limit of 3: exactly 3 rows reads fine, the 4th row errors.
        for i in 0..3 {
            put_record(
                &conn,
                "drafts",
                &format!("d{i}"),
                &serde_json::json!({"id": format!("d{i}"), "unitId": "u1"}),
            )
            .unwrap();
        }
        assert_eq!(list_store_with_limit(&conn, "drafts", 3).unwrap().len(), 3);
        assert_eq!(
            query_by_field_with_limit(&conn, "drafts", "unitId", "u1", 3)
                .unwrap()
                .len(),
            3
        );
        put_record(
            &conn,
            "drafts",
            "d3",
            &serde_json::json!({"id": "d3", "unitId": "u1"}),
        )
        .unwrap();
        let list_err = list_store_with_limit(&conn, "drafts", 3).unwrap_err();
        assert!(
            list_err.to_string().contains("exceeds read limit"),
            "unexpected error: {list_err}"
        );
        let query_err = query_by_field_with_limit(&conn, "drafts", "unitId", "u1", 3).unwrap_err();
        assert!(
            query_err.to_string().contains("exceeds read limit"),
            "unexpected error: {query_err}"
        );
        // A narrower query under the limit still succeeds (fail-closed only
        // triggers on actual overflow).
        assert_eq!(
            query_by_field_with_limit(&conn, "drafts", "id", "d0", 3)
                .unwrap()
                .len(),
            1
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn bridge_payloads_serde_round_trip() {
        let put = StudyNativePut {
            store: "units".into(),
            key: "u1".into(),
            payload: sample_payload(),
        };
        let json = serde_json::to_string(&put).unwrap();
        assert_eq!(serde_json::from_str::<StudyNativePut>(&json).unwrap(), put);
        let status = StudyNativeStatus {
            db_path: "/x/study.sqlite3".into(),
            schema_version: NATIVE_SCHEMA_VERSION,
            stores: LOGICAL_STORES.iter().map(|s| s.to_string()).collect(),
        };
        let json = serde_json::to_string(&status).unwrap();
        let back: StudyNativeStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(back.stores.len(), 22);
    }
}
