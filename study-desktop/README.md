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

## Runtime API audit

- IndexedDB: works unchanged; database `webnet.study.v1`, open version 10.
- OPFS: works unchanged in supported webviews; logical paths remain `study/documents/...`.
- Web Worker/MiniSearch: works unchanged; Vite emits the Study search worker separately.
- URL/history/hash routing: works unchanged inside Study routes.
- File, Blob/download, import/export, and PDF APIs: retained unchanged for Phase 1.
- `window.open` and BroadcastChannel: retained unchanged; Locate picker multi-window behavior needs desktop runtime smoke validation and later native replacement.

## Tooling boundary

The Study runtime and Study tests live under this application boundary. Content, corpus,
Exam Prep QA, and AI authoring scripts remain in the repository-level `scripts/` directory
for Phase 1 and import only `study-desktop/src`; relocating that authoring toolchain is
planned separately. This keeps runtime independent without mixing a risky tooling move into
this extraction.

No persistence/native API migration in Phase 1; behavior unchanged.
