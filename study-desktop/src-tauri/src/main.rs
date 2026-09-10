// Minimal Tauri 2 shell for the standalone Study desktop app (Phase 1).
// No commands, plugins, or native persistence yet: the Study frontend keeps
// its browser storage contracts (IndexedDB `webnet.study.v1`, OPFS `study/…`)
// unchanged. Native APIs migrate in a later phase.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run WebNet Study desktop shell");
}
