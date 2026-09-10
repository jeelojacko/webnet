# WebNet Study Desktop (Phase 1 foundation)

Standalone Tauri 2 shell for the Study application. `./src` is the one
source of truth for Study code (relocated from host `src/study`); the host
browser `/study` route is a transitional shim (`src/study/StudyApp.tsx`)
re-exporting it.

## Boundary

- Bundles only Study runtime sources plus the shared curriculum asset
  `../study-content/exam-curriculum/nb-sit-exam-curriculum-v1.json`
  (same relative depth as before, so the manifest import is unchanged).
- Never imports the adjustment engine, workers, or C++/WASM glue.
  The former `../engine/projectStorageOpfs` import is replaced by local
  generic OPFS helpers in `./src/opfsStorage.ts`.
- Preserved contracts: `/study/*` routes, search worker (`search/`),
  IndexedDB name/version (`webnet.study.v1` / 10), OPFS `study/…` paths,
  content/hash behavior.

## Commands

- `npm run dev` / `npm run build` / `npm run typecheck` — Vite frontend.
- `npm run test` — runs the Study suite in `./tests` with this package's
  own dependencies (one test source; the same files also run in the
  host agent tier via the root Vitest configs).
- `npm run tauri:dev` / `npm run tauri:build` — desktop shell
  (`cargo check` passes; icons are a solid-color placeholder — run
  `tauri icon` against real branding before release packaging, adding
  `.icns`/`.ico` for macOS/Windows bundles).

## Phase 2C native SQLite foundation (Rust-owned, unused by the frontend)

`src-tauri/src/study_store.rs` opens `<app_data_dir>/webnet-study/study.sqlite3`
(app-data dir from Tauri path APIs; no hardcoded user paths) with rusqlite
(bundled SQLite, WAL + `busy_timeout`). Independent native schema version 1
in `native_schema_meta`; the browser IndexedDB schema/version
(`webnet.study.v1`, version 10) is preserved separately.

- One table per browser logical store (all 22, including the derived
  `searchIndexMetadata`/`searchIndexArtifacts` stores, whose index bytes are
  stored opaquely — no native search rebuild in this phase). Each table is
  `(key TEXT PRIMARY KEY, payload TEXT NOT NULL)` holding the browser key
  plus the record as JSON (`store_key_field` documents the browser key path
  each native key derives from).
- Migrations are deterministic (fixed store order) and transactional
  (single transaction for the v0→v1 create); store names are allowlisted so
  no caller input reaches SQL as an identifier.
- Bridge is five narrow typed commands — `study_native_status`,
  `study_native_put/get/delete`, `study_native_list_keys` — carrying only
  `{store, key, payload}` JSON. No raw SQL is exposed to React, and no
  TypeScript selects these commands yet.
- Rust unit tests (std-only temp dirs): empty creation/version,
  migration idempotence, CRUD, unknown-store rejection, commit/rollback,
  reopen persistence, path resolution, bridge serde.

Limitations: per-command open/migrate (no pooled handle); no frontend
adapter, search rewrite, legacy IndexedDB→SQLite migration, or dialogs.

## Phase 2E+2F native adapter and atomic Study transactions (TypeScript selects native)

- `src/studyNativeIpc.ts` is the ONLY module that touches `invoke` (lazy
  `@tauri-apps/api/core` import, so browser/root bundles never require the
  Tauri package). `src/studyNativeStorage.ts` implements the UNCHANGED
  `StudyStorage` interface over it; `studyStoragePlatform.ts` resolves
  `browser` vs `tauri` (`__TAURI_INTERNALS__`/`__TAURI__`), and
  `createStudyStorage()` returns the matching adapter. Native init/IPC
  failure throws fail-closed — never a silent IndexedDB/OPFS fallback.
  Browser DB name/version/upgrades and all UI/domain/search behavior are untouched.
- Rust adds four narrow commands: `study_native_batch` (bounded clears +
  puts + deletes + generic CAS conditions + a one-active-mock-style
  uniqueness guard, all in ONE SQLite transaction), `study_native_load_all`,
  `study_native_list_store`, and `study_native_query_field` (generic
  top-level-field equality for the `byUnitId`/`byDocumentId`-style lazy
  reads). Records stay opaque JSON; no business logic moved to Rust.
- Every multi-store browser transaction maps to one native batch:
  `saveRatedAttempt`, `saveAttemptProgress`/`saveSchedulingUndo`,
  `deleteUnitCascade`, `replaceAiAuthoringArtifacts`,
  `approveAiUnitProposal`, `replaceAll`, official package import, mock
  CAS + active lock, and recall CAS (immutable `add` via absent-conditions).
- Tests: `tests/study_native_storage.test.ts` (18 mocked-IPC cases:
  selection, CRUD, batch payloads, CAS/lock atomicity, init errors, no
  fallback) + Rust batch commit/rollback/condition/guard tests (22 total).

## Phase 2G desktop search without IndexedDB (main-thread native bootstrap)

Browser search keeps the direct IndexedDB worker path unchanged. The Tauri desktop runtime uses a native bootstrap instead: `src/search/studySearchPlatform.ts` centrally selects the backend, `src/studySearchNativeBridge.ts` (main thread only — workers cannot use Tauri IPC) reads authoritative records plus cached derived artifacts over native IPC/SQLite and writes fresh artifacts back, and pure `src/search/studySearchIndexCore.ts` builds/restores both MiniSearch indexes from supplied records only (never IndexedDB). The worker accepts `native-bootstrap` / `native-study-update` messages, emits `native-persist` only when fresh artifacts were built, and stays fail-closed (stale/unbootstrapped state rebuilds; never falls back to IndexedDB/OPFS). `NATIVE_SEARCH_DB_VERSION` (= native schema v1) is the native drift guard, mirroring the browser `dbVersion` semantics. Coverage: `tests/study_search_native.test.ts`.

## Phase 2H+2I import/export compatibility and native conformance (TypeScript, mocked IPC)

- `src/studyFileAssets.ts` is the platform-neutral Study asset operation
  boundary: the browser path delegates to the exact OPFS helper
  (`saveStudyTextAssetToOpfs`, logical paths `study/documents/...`, same
  metadata semantics); the Tauri path UTF-8-encodes the text and calls the
  narrow Rust `study_files_*` commands (new `studyNativeFilesWrite/Read/
  Delete/Exists/Status` helpers in `src/studyNativeIpc.ts`) — bytes land
  natively, with NO desktop OPFS fallback. Native IPC errors (including Rust
  traversal rejections) propagate fail-closed. `saveStudyTextAssetToOpfs`
  itself is byte-unchanged, so all existing browser tests still pass.
- Compatibility: `tests/study_native_browser_parity.test.ts` proves
  representative fixture data (pilot official/legal import, FSRS
  schedules/attempts, drafts, Exam Prep recall/attempts/settings plus a mock
  session, AI authoring runs/map/unit proposals) is representable as native
  records and that native `replaceAll`/`loadAll`/export is logically
  equivalent — per-store counts, spot records, and `exportStudyData` bytes
  identical to the browser contract, deterministically reloaded. The public
  export schema/format is unchanged.
- Conformance: `tests/study_native_conformance.test.ts` covers empty→seed
  (once-only), CRUD round-trips, draft delete + unit-cascade delete, stale
  CAS rollback with browser messages (rated attempt, recall rating,
  immutable attempt-add), restart-like reload over the same mocked backend
  (byte-identical export), and native asset round-trip/traversal-error
  propagation. `tests/study_file_assets.test.ts` covers the boundary itself
  (browser OPFS exactness + null-without-OPFS, native bytes/metadata,
  traversal + failure propagation). Shared fakes live in
  `tests/study_native_conformance_support.ts`; existing suites untouched.
- Legacy Phase 1 migration decision: DEFERRED. There is still no automatic
  IndexedDB→SQLite or OPFS→native-files migration — a fresh native backend
  seeds cleanly, and pre-existing browser/desktop installs keep their
  IndexedDB v10/OPFS contracts unchanged. Migration is not straightforward
  (record-key mapping is proven, but asset-byte moves plus settings/progress
  identity across two live backends need a designed, tested cutover), so it
  stays an explicit later phase; no silent or partial migration ships here.

Known atomicity gaps: native multi-record batches are atomic (one SQLite
transaction), but Study asset bytes and SQLite records are NOT a single
atomic unit — a crash between a `study_files_write` and its referencing
record write (or vice versa) can orphan bytes or dangle a `storagePath`.
OPFS on browser has the same two-system property. Callers that add asset
references should write bytes first, then the record, and treat missing-byte
reads as fail-closed.

Known validation gap: no live Windows/GUI desktop validation yet — native
persistence is covered by Rust unit tests plus mocked-IPC TypeScript
conformance/parity/search tests, not an end-to-end desktop run.

## Runtime API audit

- IndexedDB: works unchanged; database `webnet.study.v1`, open version 10.
- OPFS: works unchanged in supported webviews; logical paths remain `study/documents/...`.
- Web Worker/MiniSearch: works unchanged; Vite emits the Study search worker separately.
- URL/history/hash routing: works unchanged inside Study routes.
- File, Blob/download, import/export, and PDF APIs: retained unchanged for Phase 1.
- Phase 3B–3E native backup dialogs: `src/studyFileInteractions.ts` is the ONLY
  module that selects backup file interactions (browser vs Tauri; no scattered
  host checks). Browser keeps the existing file input, textarea import, and
  export text byte-for-byte. Tauri adds two coupled Rust commands in
  `src-tauri/src/study_backup.rs` (`study_backup_import_dialog`,
  `study_backup_export_dialog`, via `tauri-plugin-dialog`): both commands are
  `async` so the blocking picker calls run on Tauri worker threads, never the
  UI thread. The Open dialog
  reads the selected JSON backup (32 MiB cap, UTF-8) and the Save dialog
  writes the TypeScript-built export text through a temp sibling + rename
  (deliberate overwrite) — no filesystem path crosses the bridge, and no
  generic read/write IPC exists. Validation/parsing stays in TypeScript
  (`parseStudyImport` + existing `replaceAll` semantics); cancel is a no-op
  and failures surface as status text. Manage shows Open/Save buttons only
  on Tauri. Tests: `tests/study_file_interactions.test.ts` (8 boundary +
  format cases) + `tests/study_backup_dialogs_hook.test.tsx` (8 hook cases:
  cancel no-ops, valid import, invalid/storage/dialog-rejection failures,
  export bytes + export rejection) +
  6 Rust backup read/write tests. No new frontend dialog/fs capability:
  dialogs run only inside the coupled Rust commands. Known gap: no live
  GUI dialog validation yet (headless CI cannot click native dialogs).
- `window.open` and BroadcastChannel: retained unchanged for browser hosts. On Tauri the Locate picker instead uses the platform-neutral `src/examPrep/locateWindowBridge.ts` (stable `study-locate-picker` WebviewWindow + typed `webnet-study-locate-pick` / `webnet-study-locate-control` events, session-scoped, explicit errors, no `window.open`/BroadcastChannel); the child window loads the same Study picker route. Tests: `tests/exam_prep_locate_window_bridge.test.ts` (9 mocked-API cases). Least privilege is split across `src-tauri/capabilities/default.json` (main window: window create/close/focus, webview-window create, event emit-to/listen/unlisten) and `src-tauri/capabilities/study-locate-picker.json` (picker window: only event emit-to/listen/unlisten); the unused event `emit` permission is not granted anywhere. Known gap: no live GUI validation yet (no Tauri runtime in this environment — native window focus/event delivery needs desktop smoke validation).

## Tooling boundary

The Study runtime and Study tests live under this application boundary. Content, corpus,
Exam Prep QA, and AI authoring scripts remain in the repository-level `scripts/` directory
for Phase 1 and import only `study-desktop/src`; relocating that authoring toolchain is
planned separately. This keeps runtime independent without mixing a risky tooling move into
this extraction.

Phase 1 changed no persistence behavior; Phase 2C adds the native SQLite foundation below (browser storage still authoritative).

## Phase 4 validation hardening (docs + standalone CI, no content changes)

- Canonical manual GUI smoke checklist: `docs/STUDY_DESKTOP_SMOKE_TEST.md`
  (PASS/FAIL/NOT TESTED/ENVIRONMENT BLOCKED per step; currently all GUI
  steps ENVIRONMENT BLOCKED — headless host, no display server).
- Baseline audit: `docs/STUDY_DESKTOP_AUDIT.md` (versions/config/
  capabilities/commands/invariants, metadata audit with no changes,
  explicit GUI/package blockers).
- Standalone CI: `.github/workflows/study-desktop.yml` (Linux + Windows:
  frontend install, Study lint/typecheck/tests/build, Rust fmt/check/test,
  Tauri production build + bundle artifacts). The root numerical workflow
  stays separate and is never run from it.
- Metadata deliberately unchanged: version stays `0.0.0`; existing PNG
  placeholder art remains, with a generated `icon.ico` added for Windows CI.
  Branding/version policy needs a release decision. No new diagnostics UI —
  existing `study_native_status` IPC is
  the surface.
