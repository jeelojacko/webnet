// Tauri 2 shell for standalone WebNet Study desktop app.
// Browser storage contracts remain unchanged; desktop adapters use native
// SQLite and application-confined document files.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod study_backup;
mod study_bundled;
mod study_files;
mod study_store;

fn main() {
    eprintln!(
        "[study][startup] version={} platform={} arch={}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            study_backup::study_backup_import_dialog,
            study_backup::study_backup_export_dialog,
            study_bundled::study_bundled_official_package_status,
            study_bundled::study_bundled_official_package_id,
            study_bundled::study_bundled_official_package_read,
            study_store::study_native_status,
            study_store::study_native_put,
            study_store::study_native_get,
            study_store::study_native_delete,
            study_store::study_native_list_keys,
            study_store::study_native_batch,
            study_store::study_native_load_all,
            study_store::study_native_list_store,
            study_store::study_native_query_field,
            study_files::study_files_status,
            study_files::study_files_write,
            study_files::study_files_read,
            study_files::study_files_delete,
            study_files::study_files_exists,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run WebNet Study desktop shell");
}
