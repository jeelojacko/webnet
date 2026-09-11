# Study Desktop Audit (Phase 4 baseline, 2026-09-10)

Baseline record for the standalone Study Desktop shell. Facts below were
read directly from the tree on 2026-09-10; anything not yet run is marked
NOT RUN rather than claimed.

## Versions and config

- `study-desktop/package.json` version: `0.0.0` (placeholder; no version
  policy has been set — do not invent one here).
- `study-desktop/src-tauri/Cargo.toml` package version: `0.0.0`
  (placeholder, same note).
- `study-desktop/src-tauri/tauri.conf.json`: productName `WebNet Study`,
  identifier `com.webnet.study`, bundle targets `all`, category
  `Education`, frontendDist `../dist`, devUrl `http://localhost:1421`.
- Toolchain on the audit host: Node `v26.8.1`, npm `11.19.0`,
  rustc `1.98.1` (Arch Linux). These are host facts, not CI pins —
  see the new `study-desktop.yml` workflow for CI versions.

## Capabilities

- `src-tauri/capabilities/default.json` (main window): `core:default`,
  window create/close/set-focus, webview `create-webview-window`, event
  emit-to/listen/unlisten. No filesystem or dialog `fs`/`dialog` frontend
  permissions — dialogs run only inside the coupled Rust backup commands.
- `src-tauri/capabilities/study-locate-picker.json` (picker window): event
  emit-to/listen/unlisten only. No window-management permissions.
- The unused bare event `emit` permission is not granted anywhere.

## Native API surface (existing status)

- Narrow Rust commands: `study_native_status`, `study_native_put/get/
  delete`, `study_native_list_keys`, `study_native_batch`,
  `study_native_load_all`, `study_native_list_store`,
  `study_native_query_field`, `study_files_*` (write/read/delete/exists/
  status), `study_backup_import_dialog`, `study_backup_export_dialog`.
- `study_native_status` returns `{ db_path, schema_version, stores }`
  (native schema v1 at app-data `webnet-study/study.sqlite3`).
- Phase 4 adds NO new status/diagnostics UI: the existing
  `studyNativeStatus` IPC plus Rust unit-test coverage is the diagnostics
  surface. A Manage-visible native-status indicator is deferred until a
  headed run can validate it (no UI bloat without validation).

## Commands and invariants

- Frontend: `npm run dev` / `build` (`tsc --noEmit && vite build`) /
  `typecheck` / `lint` (`eslint src`) / `test` (`vitest run`), all run
  inside `study-desktop/` against its own lockfile.
- Rust: `cargo fmt --check`, `cargo check` / `cargo test` inside
  `study-desktop/src-tauri/`.
- Desktop: `npm run tauri:dev` / `tauri:build` (frontend build first via
  `beforeBuildCommand`).
- Preserved contracts: `/study/*` routes, IndexedDB `webnet.study.v1`
  v10, OPFS `study/…` paths, content hashes, export schema. Native SQLite
  is a separate schema v1; legacy IndexedDB/OPFS→native migration is
  deferred by decision (see `study-desktop/README.md`).

## Metadata audit

- Icons: `src-tauri/icons/` contains existing PNGs plus `icon.ico`, generated
  from the existing placeholder `icon.png` so Windows CI can compile and
  bundle. No `.icns` is needed for Linux/Windows. Placeholder art was NOT
  replaced and no version was bumped: inventing branding or a version policy
  is out of scope for Phase 4.
- `productName`/`identifier`/`category` left untouched (content/behavior
  freeze).

## Validation actually run for Phase 4

- Focused checks: `npm run lint`, `npm run typecheck`, and the Study
  suite inside `study-desktop/` (110 files / 1262 passed / 4 skipped),
  plus `npm run build` and `cargo fmt --check` / `cargo check` /
  `cargo test` (29 passed) inside `study-desktop/src-tauri/`.
- Standalone runtime checks: `npm run tauri:dev` compiled successfully but
  failed at GTK initialization because this host has no display backend;
  the release executable failed at the same GTK initialization point. Both
  emitted `[study][startup] version=0.0.0 platform=linux arch=x86_64` before
  the failure. This is an environment-blocked GUI result, not a GUI pass.
- `npm run tauri:build` produced the release executable, `.deb`, and `.rpm`:
  `WebNet Study_0.0.0_amd64.deb` and `WebNet Study-0.0.0-1.x86_64.rpm`.
  AppImage bundling reached `linuxdeploy` then failed; no AppImage was
  claimed. No package launch was possible without a display backend.
- Workflow verification (static): `actions/upload-artifact@v7` tag confirmed
  to exist upstream and matches established repository convention. Artifact
  path `study-desktop/src-tauri/target/release/bundle/` is workspace-root
  relative and correct for Tauri v2 Linux/Windows bundle subdirectories.
  YAML parses cleanly; no hosted workflow run has been observed yet.
- Root gates run locally: root lint/typecheck/build passed; agent 461 files /
  2774 passed / 1 skipped; WASM 8 files / 41 passed; industry parity 25
  passed. The four generated Phase 8 report changes from these gates were
  restored unchanged.

## Blockers (explicit)

1. **No live GUI validation** (headless host):
   `DISPLAY=<unset> WAYLAND_DISPLAY=<unset> XDG_SESSION_TYPE=tty`.
   Both `tauri:dev` and the release executable were attempted; GTK failed
   to initialize before any window could open. No GUI behavior is claimed.
2. **No Windows run**: `tauri build` packaging for Windows is uncovered
   until CI or a headed Windows host runs the new `study-desktop.yml` workflow;
   `icon.ico` now exists for the Windows resource step, but no hosted run has
   yet verified it.
3. **No version/branding policy**: versions stay `0.0.0`, icons stay
   placeholder until a release decision sets them.
4. **Legacy migration deferred**: fresh native backends seed cleanly;
   pre-existing browser/desktop installs keep IndexedDB v10/OPFS.
