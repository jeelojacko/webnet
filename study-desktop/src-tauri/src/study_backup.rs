//! Phase 3C/3D native Study backup import/export dialogs (Rust-owned).
//!
//! Two narrow typed commands couple the native dialog with the file
//! operation in Rust: the frontend never sends or receives a filesystem
//! path, so no generic arbitrary path read/write IPC exists. Import reads
//! the dialog-selected JSON backup into a string (validation/parsing stays
//! in TypeScript); export writes the TypeScript-built export text through a
//! temp sibling + rename, deliberately overwriting the chosen file.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Suggested backup file name in the native Save dialog.
pub const BACKUP_SUGGESTED_FILE_NAME: &str = "webnet-study-backup.json";
/// Max backup bytes accepted by the native Open dialog (fail closed above).
pub const BACKUP_MAX_BYTES: u64 = 32 * 1024 * 1024;

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Read a backup file into a UTF-8 string, bounded by [`BACKUP_MAX_BYTES`].
pub fn read_backup_file(path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("read backup: {e}"))?;
    if meta.len() > BACKUP_MAX_BYTES {
        return Err(format!(
            "backup too large: {} bytes (max {BACKUP_MAX_BYTES})",
            meta.len()
        ));
    }
    std::fs::read_to_string(path).map_err(|e| format!("read backup: {e}"))
}

/// Atomic write: temp sibling in the same directory, then rename/replace.
/// Deliberately overwrites an existing target; the temp file is removed on
/// any failure so no partial target is left behind.
pub fn write_backup_file_atomic(path: &Path, bytes: &[u8]) -> Result<u64, String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "rejected backup path: no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create backup dir: {e}"))?;
    let id = TMP_COUNTER.fetch_add(1, Ordering::SeqCst);
    let tmp_name = format!(
        ".tmp-{}-{}-{}",
        std::process::id(),
        id,
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "backup.json".into())
    );
    let tmp = parent.join(tmp_name);
    let outcome = (|| {
        std::fs::write(&tmp, bytes).map_err(|e| format!("write backup temp: {e}"))?;
        std::fs::rename(&tmp, path).map_err(|e| format!("publish backup: {e}"))?;
        Ok(bytes.len() as u64)
    })();
    if outcome.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    outcome
}

// ---- Narrow typed bridge (the only surface exposed to the frontend) ----

/// Outcome of the native backup Open dialog. `contents` is `None` exactly
/// when `cancelled` is true; the path itself never crosses the bridge.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyBackupOpenResult {
    pub cancelled: bool,
    pub contents: Option<String>,
}

/// Export input: the already-built TypeScript export text. The destination
/// comes from the native Save dialog, never from the frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyBackupExportInput {
    pub contents: String,
}

/// Outcome of the native backup Save dialog. `bytes` is 0 when cancelled.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyBackupSaveResult {
    pub cancelled: bool,
    pub bytes: u64,
}

// Async commands run on Tauri's worker threads (not the UI thread), so the
// blocking picker calls below are safe here. Sync commands would block the
// event loop; the non-blocking callback APIs are for main-thread contexts.
#[tauri::command]
pub async fn study_backup_import_dialog(app: AppHandle) -> Result<StudyBackupOpenResult, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("JSON backup", &["json"])
        .blocking_pick_file();
    let Some(file_path) = picked else {
        eprintln!("[study][backup] import dialog cancelled");
        return Ok(StudyBackupOpenResult {
            cancelled: true,
            contents: None,
        });
    };
    let Some(path) = file_path.as_path() else {
        eprintln!("[study][backup] import dialog failed: selection has no path");
        return Err("backup selection has no filesystem path".into());
    };
    let contents = read_backup_file(path).map_err(|error| {
        eprintln!("[study][backup] import read failed: {error}");
        error
    })?;
    eprintln!("[study][backup] import dialog selected backup");
    Ok(StudyBackupOpenResult {
        cancelled: false,
        contents: Some(contents),
    })
}

#[tauri::command]
pub async fn study_backup_export_dialog(
    app: AppHandle,
    input: StudyBackupExportInput,
) -> Result<StudyBackupSaveResult, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(BACKUP_SUGGESTED_FILE_NAME)
        .add_filter("JSON backup", &["json"])
        .blocking_save_file();
    let Some(file_path) = picked else {
        eprintln!("[study][backup] export dialog cancelled");
        return Ok(StudyBackupSaveResult {
            cancelled: true,
            bytes: 0,
        });
    };
    let Some(path) = file_path.as_path() else {
        eprintln!("[study][backup] export dialog failed: destination has no path");
        return Err("backup destination has no filesystem path".into());
    };
    let bytes = write_backup_file_atomic(path, input.contents.as_bytes()).map_err(|error| {
        eprintln!("[study][backup] export write failed: {error}");
        error
    })?;
    eprintln!("[study][backup] export saved bytes={bytes}");
    Ok(StudyBackupSaveResult {
        cancelled: false,
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_dir() -> std::path::PathBuf {
        let id = TEST_DIR_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "webnet-study-backup-test-{}-{}",
            std::process::id(),
            id
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn roundtrip_write_then_read() {
        let dir = test_dir();
        let target = dir.join("webnet-study-backup.json");
        let n = write_backup_file_atomic(&target, b"{\"schemaVersion\":10}").unwrap();
        assert_eq!(n, 20);
        assert_eq!(read_backup_file(&target).unwrap(), "{\"schemaVersion\":10}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn overwrite_replaces_and_leaves_no_temp() {
        let dir = test_dir();
        let target = dir.join("backup.json");
        write_backup_file_atomic(&target, b"v1").unwrap();
        write_backup_file_atomic(&target, b"v2-longer").unwrap();
        assert_eq!(read_backup_file(&target).unwrap(), "v2-longer");
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp leftovers: {leftovers:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversize_and_missing_reads_fail_closed() {
        let dir = test_dir();
        let missing = dir.join("missing.json");
        assert!(read_backup_file(&missing).is_err());
        // A file one byte over the cap is rejected before reading.
        let big = dir.join("big.json");
        std::fs::write(&big, vec![b'x'; BACKUP_MAX_BYTES as usize + 1]).unwrap();
        let err = read_backup_file(&big).unwrap_err();
        assert!(err.contains("too large"), "unexpected error: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_failure_reports_and_keeps_old_content() {
        let dir = test_dir();
        // Make the target parent path a file so temp creation fails.
        let blocker = dir.join("blocker");
        std::fs::write(&blocker, b"blocker").unwrap();
        let target = blocker.join("backup.json");
        let err = write_backup_file_atomic(&target, b"x").unwrap_err();
        assert!(!err.is_empty());
        assert_eq!(std::fs::read(&blocker).unwrap(), b"blocker");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn suggested_name_uses_json_extension() {
        assert!(BACKUP_SUGGESTED_FILE_NAME.ends_with(".json"));
    }

    #[test]
    fn bridge_payloads_serde_round_trip() {
        let open = StudyBackupOpenResult {
            cancelled: false,
            contents: Some("{\"a\":1}".into()),
        };
        let json = serde_json::to_string(&open).unwrap();
        assert_eq!(
            serde_json::from_str::<StudyBackupOpenResult>(&json).unwrap(),
            open
        );
        let cancelled = StudyBackupOpenResult {
            cancelled: true,
            contents: None,
        };
        let json = serde_json::to_string(&cancelled).unwrap();
        assert_eq!(
            serde_json::from_str::<StudyBackupOpenResult>(&json).unwrap(),
            cancelled
        );
        let input = StudyBackupExportInput {
            contents: "hi".into(),
        };
        let json = serde_json::to_string(&input).unwrap();
        assert_eq!(
            serde_json::from_str::<StudyBackupExportInput>(&json).unwrap(),
            input
        );
    }
}
