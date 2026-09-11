//! Phase 2D native Study document asset filesystem (Rust-owned).
//!
//! Safe logical-path file operations rooted under
//! `<app_data_dir>/webnet-study/documents`. The browser OPFS namespace
//! `study/documents/<doc>/<role>/<file>` is preserved: callers pass the full
//! logical path and it maps to `<root>/<doc>/<role>/<file>`.
//!
//! Only the narrow typed commands at the bottom are exposed to the frontend.
//! No frontend adapter, SQLite metadata, dialogs, or migration here.

use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};

/// Directory name under the app-data dir holding the native Study tree.
pub const NATIVE_STUDY_DIR_NAME: &str = "webnet-study";
/// Document asset subtree (maps the `documents` segment of the logical path).
pub const NATIVE_DOCUMENTS_DIR_NAME: &str = "documents";
/// Logical namespace prefix preserved from the browser (`study/documents/…`).
pub const LOGICAL_PREFIX: &str = "study/documents/";

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Resolve `<app_data_dir>/webnet-study/documents`.
pub fn app_files_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join(NATIVE_STUDY_DIR_NAME)
        .join(NATIVE_DOCUMENTS_DIR_NAME)
}

/// Validate a logical path and resolve it under `root`.
///
/// Rules: must start with `study/documents/`, `/`-separated, no NUL,
/// no backslashes, no absolute paths, no drive letters, no `.`/`..`/empty
/// segments, no control chars, no `:` (drive/ADS trick). Confinement is then
/// enforced by re-checking the joined path stays under `root`.
pub fn resolve_logical_path(root: &Path, logical: &str) -> Result<PathBuf, String> {
    if logical.is_empty() {
        return Err("empty study file path".into());
    }
    if logical.contains('\0') {
        return Err("rejected study file path: NUL byte".into());
    }
    if logical.contains('\\') {
        return Err("rejected study file path: backslash separator".into());
    }
    if logical.starts_with('/') {
        return Err("rejected study file path: absolute path".into());
    }
    if !logical.starts_with(LOGICAL_PREFIX) {
        return Err("rejected study file path: must start with study/documents/".into());
    }
    let rest = &logical[LOGICAL_PREFIX.len()..];
    if rest.is_empty() {
        return Err("rejected study file path: no path after study/documents/".into());
    }
    if rest.contains(':') {
        return Err("rejected study file path: drive/ADS separator".into());
    }
    let mut rel = PathBuf::new();
    for segment in rest.split('/') {
        if segment.is_empty() {
            return Err("rejected study file path: empty segment".into());
        }
        if segment == "." || segment == ".." {
            return Err("rejected study file path: dot segment".into());
        }
        if segment.chars().any(|c| c.is_control()) {
            return Err("rejected study file path: control character".into());
        }
        // Defensive: a segment must be a single normal component.
        let mut comps = Path::new(segment).components();
        match (comps.next(), comps.next()) {
            (Some(Component::Normal(_)), None) => {}
            _ => return Err("rejected study file path: bad segment".into()),
        }
        rel.push(segment);
    }
    let joined = root.join(&rel);
    if !joined.starts_with(root) {
        return Err("rejected study file path: escapes asset root".into());
    }
    Ok(joined)
}

/// Atomic write: temp sibling in the same directory, then rename/replace.
/// Temp file is removed on any failure; no partial target is left behind.
pub fn write_asset_bytes(root: &Path, logical: &str, bytes: &[u8]) -> Result<u64, String> {
    let target = resolve_logical_path(root, logical)?;
    let parent = target
        .parent()
        .ok_or_else(|| "rejected study file path: no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create asset dir: {e}"))?;
    let id = TMP_COUNTER.fetch_add(1, Ordering::SeqCst);
    let tmp_name = format!(
        ".tmp-{}-{}-{}",
        std::process::id(),
        id,
        target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "asset".into())
    );
    let tmp = parent.join(tmp_name);
    let outcome = (|| {
        std::fs::write(&tmp, bytes).map_err(|e| format!("write asset temp: {e}"))?;
        std::fs::rename(&tmp, &target).map_err(|e| format!("publish asset: {e}"))?;
        Ok(bytes.len() as u64)
    })();
    if outcome.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    outcome
}

pub fn read_asset_bytes(root: &Path, logical: &str) -> Result<Vec<u8>, String> {
    let target = resolve_logical_path(root, logical)?;
    std::fs::read(&target).map_err(|e| format!("read asset: {e}"))
}

pub fn delete_asset(root: &Path, logical: &str) -> Result<(), String> {
    let target = resolve_logical_path(root, logical)?;
    match std::fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete asset: {e}")),
    }
}

pub fn asset_exists(root: &Path, logical: &str) -> Result<bool, String> {
    let target = resolve_logical_path(root, logical)?;
    Ok(target.is_file())
}

// ---- Narrow typed bridge (the only surface exposed to the frontend) ----

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyFileWrite {
    /// Logical path, e.g. `study/documents/doc-id/raw-html/index.html`.
    pub path: String,
    /// Raw asset bytes (JSON number array via serde).
    pub contents: Vec<u8>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyFilePath {
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct StudyFilesStatus {
    pub root: String,
}

fn root_from_app(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_files_root(&dir))
}

#[tauri::command]
pub fn study_files_status(app: AppHandle) -> Result<StudyFilesStatus, String> {
    let root = root_from_app(&app).map_err(|error| {
        eprintln!("[study][documents] document root initialization failed: {error}");
        error
    })?;
    eprintln!("[study][documents] document root ready");
    Ok(StudyFilesStatus {
        root: root.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn study_files_write(app: AppHandle, input: StudyFileWrite) -> Result<u64, String> {
    let root = root_from_app(&app)?;
    write_asset_bytes(&root, &input.path, &input.contents)
}

#[tauri::command]
pub fn study_files_read(app: AppHandle, input: StudyFilePath) -> Result<Vec<u8>, String> {
    let root = root_from_app(&app)?;
    read_asset_bytes(&root, &input.path)
}

#[tauri::command]
pub fn study_files_delete(app: AppHandle, input: StudyFilePath) -> Result<(), String> {
    let root = root_from_app(&app)?;
    delete_asset(&root, &input.path)
}

#[tauri::command]
pub fn study_files_exists(app: AppHandle, input: StudyFilePath) -> Result<bool, String> {
    let root = root_from_app(&app)?;
    asset_exists(&root, &input.path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_root() -> PathBuf {
        let id = TEST_DIR_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "webnet-study-files-test-{}-{}",
            std::process::id(),
            id
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join(NATIVE_STUDY_DIR_NAME)
            .join(NATIVE_DOCUMENTS_DIR_NAME)
    }

    fn cleanup(root: &Path) {
        // root = <tmp>/webnet-study/documents → remove <tmp>.
        if let Some(study) = root.parent() {
            if let Some(tmp) = study.parent() {
                let _ = std::fs::remove_dir_all(tmp);
            }
        }
    }

    const SAMPLE: &str = "study/documents/doc-1/normalized-markdown/index.md";

    #[test]
    fn roundtrip_write_read_exists() {
        let root = test_root();
        assert_eq!(asset_exists(&root, SAMPLE).unwrap(), false);
        let n = write_asset_bytes(&root, SAMPLE, b"# hello").unwrap();
        assert_eq!(n, 7);
        assert!(asset_exists(&root, SAMPLE).unwrap());
        assert_eq!(read_asset_bytes(&root, SAMPLE).unwrap(), b"# hello");
        cleanup(&root);
    }

    #[test]
    fn traversal_and_tricks_rejected() {
        let root = test_root();
        for bad in [
            "study/documents/../escape",
            "study/documents/a/../../escape",
            "study/documents/..",
            "study/documents/a/..",
            "/study/documents/a",
            "study\\documents\\a",
            "study/documents/a\\b",
            "study/documents/a//b",
            "study/documents/a/",
            "study/documents/",
            "study/documents",
            "other/documents/a",
            "study/other/a",
            "",
            "study/documents/a\0b",
            "study/documents/./a",
            "C:/study/documents/a",
            "study/documents/a:b",
            "\\\\server\\share",
        ] {
            assert!(resolve_logical_path(&root, bad).is_err(), "accepted: {bad}");
            assert!(write_asset_bytes(&root, bad, b"x").is_err());
            assert!(read_asset_bytes(&root, bad).is_err());
            assert!(delete_asset(&root, bad).is_err());
            assert!(asset_exists(&root, bad).is_err());
        }
        // Nothing escaped onto disk.
        assert!(!root.exists());
        cleanup(&root);
    }

    #[test]
    fn resolved_paths_stay_confined_to_root() {
        let root = test_root();
        let target = resolve_logical_path(&root, "study/documents/d1/pdf/report.pdf").unwrap();
        assert!(target.starts_with(&root));
        assert_eq!(target, root.join("d1").join("pdf").join("report.pdf"));
        // Logical namespace prefix is preserved, roles/filenames pass through.
        for role in [
            "raw-html",
            "pdf",
            "imported-source",
            "normalized-markdown",
            "backup",
        ] {
            let logical = format!("study/documents/my-doc/{role}/file-1.bin");
            let resolved = resolve_logical_path(&root, &logical).unwrap();
            assert!(resolved.starts_with(&root));
        }
        cleanup(&root);
    }

    #[test]
    fn atomic_overwrite_replaces_and_leaves_no_temp() {
        let root = test_root();
        write_asset_bytes(&root, SAMPLE, b"v1").unwrap();
        write_asset_bytes(&root, SAMPLE, b"v2-longer").unwrap();
        assert_eq!(read_asset_bytes(&root, SAMPLE).unwrap(), b"v2-longer");
        let dir = root.join("doc-1").join("normalized-markdown");
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp leftovers: {leftovers:?}");
        cleanup(&root);
    }

    #[test]
    fn write_failure_reports_and_keeps_old_content() {
        let root = test_root();
        // Make the asset parent path a file so creating dirs/temp fails.
        let blocker = root.join("doc-blocked");
        std::fs::create_dir_all(&blocker.parent().unwrap()).unwrap();
        std::fs::write(&blocker, b"blocker").unwrap();
        let err = write_asset_bytes(&root, "study/documents/doc-blocked/f.txt", b"x").unwrap_err();
        assert!(!err.is_empty());
        // Blocker untouched, no temp sibling left behind.
        assert_eq!(std::fs::read(&blocker).unwrap(), b"blocker");
        let leftovers: Vec<_> = std::fs::read_dir(&blocker.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp leftovers: {leftovers:?}");
        cleanup(&root);
    }

    #[test]
    fn delete_and_exists() {
        let root = test_root();
        write_asset_bytes(&root, SAMPLE, b"data").unwrap();
        assert!(asset_exists(&root, SAMPLE).unwrap());
        delete_asset(&root, SAMPLE).unwrap();
        assert!(!asset_exists(&root, SAMPLE).unwrap());
        // Deleting a missing asset is idempotent.
        delete_asset(&root, SAMPLE).unwrap();
        assert!(read_asset_bytes(&root, SAMPLE).is_err());
        cleanup(&root);
    }

    #[test]
    fn assets_survive_reresolve_like_restart() {
        let tmp =
            std::env::temp_dir().join(format!("webnet-study-files-restart-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let root = app_files_root(&tmp);
        write_asset_bytes(&root, SAMPLE, b"persist me").unwrap();
        // Fresh resolve from the same app-data base, like a process restart.
        let reopened = app_files_root(&tmp);
        assert_eq!(read_asset_bytes(&reopened, SAMPLE).unwrap(), b"persist me");
        assert!(asset_exists(&reopened, SAMPLE).unwrap());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn root_uses_app_data_dir_without_hardcoded_home() {
        let base = Path::new("/tmp/fake-app-data/abc");
        let resolved = app_files_root(base);
        assert_eq!(
            resolved,
            Path::new("/tmp/fake-app-data/abc/webnet-study/documents")
        );
        assert!(!resolved.to_string_lossy().contains("home"));
    }

    #[test]
    fn bridge_payloads_serde_round_trip() {
        let write = StudyFileWrite {
            path: SAMPLE.into(),
            contents: b"hi".to_vec(),
        };
        let json = serde_json::to_string(&write).unwrap();
        assert_eq!(
            serde_json::from_str::<StudyFileWrite>(&json).unwrap(),
            write
        );
    }
}
