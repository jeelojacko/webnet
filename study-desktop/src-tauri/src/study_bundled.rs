//! Bundled official content package (read-only Tauri app resource).
//!
//! The current official NB SIT statute-corpus package ships inside the
//! desktop bundle as a read-only resource (see `bundle.resources` in
//! `tauri.conf.json`, which points at the existing validated
//! `study-content/packages/` file — no copy, no second format). The
//! frontend never sends a path: both commands below read one fixed
//! resource file, so no arbitrary resource path can cross the IPC bridge.
//!
//! Layout note: Tauri maps `../../study-content/packages/<file>` to
//! `<resource_dir>/_up_/_up_/study-content/packages/<file>` (see
//! `resource_relpath` in `tauri-utils`). The constant below pins that
//! exact suffix; anything else fails closed with "unavailable".

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Fixed resource suffix for the bundled official content package.
pub const BUNDLED_OFFICIAL_PACKAGE_RESOURCE_SUFFIX: &str =
    "_up_/_up_/study-content/packages/nb-sit-statute-corpus.content-package.json";

/// Upper bound for the bundled package read (current package ~19 MiB).
pub const BUNDLED_OFFICIAL_PACKAGE_MAX_BYTES: u64 = 64 * 1024 * 1024;

/// Resolve the fixed bundled-package path under `resource_dir`.
pub fn resolve_bundled_package_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join(BUNDLED_OFFICIAL_PACKAGE_RESOURCE_SUFFIX)
}

/// Read the fixed bundled-package file. Fails closed on missing files,
/// oversize content, or invalid UTF-8 — never returns partial text.
pub fn read_bundled_package_text(resource_dir: &Path) -> Result<String, String> {
    let path = resolve_bundled_package_path(resource_dir);
    let metadata =
        std::fs::metadata(&path).map_err(|_| "bundled official package unavailable".to_string())?;
    if metadata.len() > BUNDLED_OFFICIAL_PACKAGE_MAX_BYTES {
        return Err("bundled official package unavailable".to_string());
    }
    std::fs::read_to_string(&path).map_err(|_| "bundled official package unavailable".to_string())
}

#[derive(serde::Serialize)]
pub struct BundledOfficialPackageStatus {
    pub available: bool,
    pub byte_length: u64,
}

#[derive(serde::Serialize)]
pub struct BundledOfficialPackageId {
    pub id: String,
    pub manifest_id: String,
}

/// Availability probe: reports the fixed resource size without reading it.
#[tauri::command]
pub fn study_bundled_official_package_status(
    app: AppHandle,
) -> Result<BundledOfficialPackageStatus, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| "bundled official package unavailable".to_string())?;
    let path = resolve_bundled_package_path(&resource_dir);
    let metadata =
        std::fs::metadata(&path).map_err(|_| "bundled official package unavailable".to_string())?;
    if metadata.len() > BUNDLED_OFFICIAL_PACKAGE_MAX_BYTES {
        return Err("bundled official package unavailable".to_string());
    }
    Ok(BundledOfficialPackageStatus {
        available: true,
        byte_length: metadata.len(),
    })
}

/// Identity probe for the dashboard bundled-update hook (see
/// `shouldSurfaceBundledUpdatePreview`): parses only `id` + `manifestId`
/// from the fixed resource so the dashboard learns the bundled package
/// without transferring the full (~19 MiB) text. Fail-closed like the read
/// path.
#[tauri::command]
pub fn study_bundled_official_package_id(
    app: AppHandle,
) -> Result<BundledOfficialPackageId, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| "bundled official package unavailable".to_string())?;
    let text = read_bundled_package_text(&resource_dir)?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| "bundled official package unavailable".to_string())?;
    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "bundled official package unavailable".to_string())?;
    let manifest_id = value
        .get("manifestId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "bundled official package unavailable".to_string())?;
    Ok(BundledOfficialPackageId {
        id: id.to_string(),
        manifest_id: manifest_id.to_string(),
    })
}

/// Read the full bundled package text for the existing validated
/// parse/validate/preview/import core on the frontend. No path argument:
///
/// the fixed resource above is the only file this command can return.
#[tauri::command]
pub fn study_bundled_official_package_read(app: AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| "bundled official package unavailable".to_string())?;
    read_bundled_package_text(&resource_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "webnet-bundled-test-{}-{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(dir.join("_up_/_up_/study-content/packages")).unwrap();
        dir
    }

    #[test]
    fn missing_resource_fails_closed() {
        let dir = temp_dir("missing");
        let err = read_bundled_package_text(&dir).unwrap_err();
        assert_eq!(err, "bundled official package unavailable");
    }

    #[test]
    fn valid_resource_reads_exact_text() {
        let dir = temp_dir("valid");
        let path = resolve_bundled_package_path(&dir);
        std::fs::write(&path, r#"{"id":"pkg-1"}"#).unwrap();
        assert_eq!(
            read_bundled_package_text(&dir).unwrap(),
            r#"{"id":"pkg-1"}"#
        );
    }

    #[test]
    fn oversize_resource_fails_closed() {
        let dir = temp_dir("oversize");
        let path = resolve_bundled_package_path(&dir);
        let file = std::fs::File::create(&path).unwrap();
        // Sparse: set length without writing bytes.
        file.set_len(BUNDLED_OFFICIAL_PACKAGE_MAX_BYTES + 1)
            .unwrap();
        drop(file);
        let err = read_bundled_package_text(&dir).unwrap_err();
        assert_eq!(err, "bundled official package unavailable");
    }

    #[test]
    fn invalid_utf8_fails_closed() {
        let dir = temp_dir("nonutf8");
        let path = resolve_bundled_package_path(&dir);
        std::fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
        let err = read_bundled_package_text(&dir).unwrap_err();
        assert_eq!(err, "bundled official package unavailable");
    }
}
