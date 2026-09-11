# Study Desktop Manual GUI Smoke Checklist

Canonical deterministic checklist for a human-driven Study Desktop (Tauri 2)
run. Record one verdict per row: **PASS**, **FAIL**, or **NOT TESTED**.
Use **ENVIRONMENT BLOCKED** only when the environment prevents the step
(e.g. headless CI with no display server) and paste the exact evidence.

## Environment record (fill in per run)

- Date / tester:
- OS / version:
- `study-desktop` git SHA:
- Node / npm (`node --version`, `npm --version`):
- Rust (`rustc --version`):
- Display server (`echo $DISPLAY $WAYLAND_DISPLAY $XDG_SESSION_TYPE`):
- App under test: `npm run tauri:dev` (dev) or packaged bundle from
  `npm run tauri:build` (state which):

## 1. Launch and shell

| # | Step | Expected | Verdict |
|---|------|----------|---------|
| 1.1 | Start app (`tauri:dev` or installed bundle) | Main window opens, title "WebNet Study", no error dialog | ENVIRONMENT BLOCKED |
| 1.2 | Sidebar renders | Exam Prep / Library / Manage entries visible | ENVIRONMENT BLOCKED |
| 1.3 | DevTools console (dev run) | No red errors on first paint | ENVIRONMENT BLOCKED |
| 1.4 | Package launch (installed deb/msi from CI artifacts) | Installed bundle launches outside dev, same first paint as 1.1 | ENVIRONMENT BLOCKED |

## 2. Study flows (read-only first)

| # | Step | Expected | Verdict |
|---|------|----------|---------|
| 2.1 | Open Library → Documents tab | Seeded or imported documents list | ENVIRONMENT BLOCKED |
| 2.2 | Open a document reader | Metadata + sections render, TOC jump scrolls once and focuses heading | ENVIRONMENT BLOCKED |
| 2.3 | Open Exam Prep → Learn | 133 curriculum units with studied toggles | ENVIRONMENT BLOCKED |
| 2.4 | Open Exam Prep → Recall | Recall cards queue, rating persists after restart | ENVIRONMENT BLOCKED |

## 3. Search (init / results / navigation / restart)

| # | Step | Expected | Verdict |
|---|------|----------|---------|
| 3.1 | Open Library search first time | Preparing/loading progress shows, then results ready (worker lazy init) | ENVIRONMENT BLOCKED |
| 3.2 | Type a query (e.g. an Act title + a provision phrase) | Grouped results (Documents / Official Provisions / Study Units / Custom Units) with counts and highlighted snippets | ENVIRONMENT BLOCKED |
| 3.3 | Enter / click an official-provision result | Document opens at the source-key hash: section expanded, exactly one scroll, heading focused with short highlight | ENVIRONMENT BLOCKED |
| 3.4 | Restart app, search again | Same results (persisted artifacts reused or rebuilt from authoritative records; never an older store layout) | ENVIRONMENT BLOCKED |
| 3.5 | (Negative, if inducible) Break the worker path | Explicit unavailable/error banner, no silent empty results | ENVIRONMENT BLOCKED |

## 4. PDF / source-file handling and bookmarks

| # | Step | Expected | Verdict |
|---|------|----------|---------|
| 4.1 | Open a document with a `pdf` source file | Record actual behavior (external source-URL link vs embedded render). No in-app PDF renderer is claimed — observe and write down what happens | ENVIRONMENT BLOCKED |
| 4.2 | Bookmark / annotation affordances | Study has NO user bookmark/annotation feature (only the legacy `/study/exam-curriculum` route alias preserving old browser bookmarks). Confirm no such UI is claimed and none appears broken | ENVIRONMENT BLOCKED |

## 5. Deterministic mock exam session

| # | Step | Expected | Verdict |
|---|------|----------|---------|
| 5.1 | Start a mock exam from Exam Prep → Mock Exam | Session starts with profile snapshot + seed; question refs q01.. render | ENVIRONMENT BLOCKED |
| 5.2 | Answer, close app mid-session, relaunch | Session resumes `in_progress` with responses intact (150-minute mock survives reload/crash/restart) | ENVIRONMENT BLOCKED |
| 5.3 | Submit and self-grade | Status moves submitted → graded; results view shows per-question grading | ENVIRONMENT BLOCKED |

## 6. Locate picker window

| # | Step | Expected | Verdict |
|---|------|----------|---------|
| 6.1 | Open a Locate drill: prompt + context | Drill prompt renders with its curriculum context | ENVIRONMENT BLOCKED |
| 6.2 | Open the picker | Stable `study-locate-picker` window opens with the same Study picker route | ENVIRONMENT BLOCKED |
| 6.3 | Pick a location | Parent receives the typed pick event, picker closes | ENVIRONMENT BLOCKED |
| 6.4 | Stale-token isolation | A pick from an old sprint/token is ignored (token/sprint-scoped transport, no cross-sprint leak) | ENVIRONMENT BLOCKED |
| 6.5 | Focus / reuse | Opening the picker twice focuses the existing window (no duplicates) | ENVIRONMENT BLOCKED |
| 6.6 | Close / reopen | Close without picking is a no-op; reopening works for the next drill | ENVIRONMENT BLOCKED |
| 6.7 | Zombie check | Kill the picker window externally (window controls), then trigger the next drill — parent reopens cleanly with an explicit error or fresh window, never a hang or silent dead picker | ENVIRONMENT BLOCKED |
| 6.8 | Open Statute Library | The "Open Statute Library" control (Locate drill, mock active/grader) opens the built-in statute library | ENVIRONMENT BLOCKED |

## 7. Native persistence (Tauri runtime)

| # | Step | Expected | Verdict |
|---|------|----------|---------|
| 7.1 | Toggle a Learn unit studied, restart app | Toggle survives restart (native SQLite, not IndexedDB) | ENVIRONMENT BLOCKED |
| 7.2 | Rate a recall card, restart app | Rating/attempt survives restart | ENVIRONMENT BLOCKED |
| 7.3 | Create a custom unit, restart app | Custom unit survives restart | ENVIRONMENT BLOCKED |
| 7.4 | Native document restart | Imported official document (reader metadata + sections) renders identically after restart | ENVIRONMENT BLOCKED |
| 7.5 | Source picker import | Import a document through source picker/staged review; valid data appears, parse failure leaves existing data unchanged | ENVIRONMENT BLOCKED |

## 8. Backup dialogs and JSON round-trip (Tauri-only buttons in Manage)

| # | Step | Expected | Verdict |
|---|------|----------|---------|
| 8.1 | Manage → export via Save dialog | `.json` file written; re-import parses via `parseStudyImport` | ENVIRONMENT BLOCKED |
| 8.2 | Manage → import invalid JSON via Open dialog | Import rejected, existing data untouched (parse-before-replace) | ENVIRONMENT BLOCKED |
| 8.3 | Cancel either dialog | No-op, no error, no data change | ENVIRONMENT BLOCKED |
| 8.4 | JSON round-trip (browser parser) | Export → import the same text through the browser textarea path: byte-identical export, per-store counts and spot records match | ENVIRONMENT BLOCKED |

## 9. SQLite integrity and abrupt shutdown

| # | Step | Expected | Verdict |
|---|------|----------|---------|
| 9.1 | SQLite integrity | `study_native_status` reports schema_version 1 with all 22 stores; export before/after a clean restart is byte-identical | ENVIRONMENT BLOCKED |
| 9.2 | Abrupt / recovery-safe scenario | SIGKILL the app mid-write (during a rated attempt or import), relaunch: status query succeeds, export intact, no corruption. Known accepted gap: asset bytes + SQLite records are NOT one atomic unit — an orphan byte file or dangling `storagePath` is possible; missing-byte reads must fail closed, and that is a PASS with a note, not a FAIL | ENVIRONMENT BLOCKED |

## 10. Clean shutdown and relaunch

| # | Step | Expected | Verdict |
|---|------|----------|---------|
| 10.1 | Close app normally, relaunch | All §5/§7 state intact, no first-run reseed, no error dialogs | ENVIRONMENT BLOCKED |

## Verdict rules

- **PASS**: observed the expected behavior on the stated build.
- **FAIL**: observed different behavior; file the actual vs expected text
  plus console/Rust logs.
- **NOT TESTED**: step skipped (state why, e.g. out of scope for this run).
- **ENVIRONMENT BLOCKED**: environment prevents the step; paste exact
  evidence (e.g. `DISPLAY=<unset> WAYLAND_DISPLAY=<unset>` on a tty host).
  Never mark a step PASS without running it.

## Current status

No live GUI run has completed. Both `npm run tauri:dev` and the built release
executable were attempted. They compiled, emitted startup diagnostics, then
failed before window creation because GTK could not initialize:

```text
DISPLAY=<unset> WAYLAND_DISPLAY=<unset> XDG_SESSION_TYPE=tty
Failed to initialize GTK
```

so every GUI step above is ENVIRONMENT BLOCKED until a headed Linux,
Windows, or macOS run is recorded here. Native persistence is covered only
by Rust unit tests plus mocked-IPC TypeScript suites, not an end-to-end
desktop run. See `docs/STUDY_DESKTOP_AUDIT.md`.
