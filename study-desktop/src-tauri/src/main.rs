// Minimal Tauri 2 shell for the standalone Study desktop app (Phase 1).
// No commands, plugins, or native persistence yet: the Study frontend keeps
// its browser storage contracts (IndexedDB `webnet.study.v1`, OPFS `study/…`)
// unchanged. Native APIs migrate in a later phase.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod study_backup;
mod study_files;
mod study_store;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            study_backup::study_backup_import_dialog,
            study_backup::study_backup_export_dialog,
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
