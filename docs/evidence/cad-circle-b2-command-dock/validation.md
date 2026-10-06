# Phase B2 — Validation

All counts are for branch `feat/cad-circle-construction-command-dock-b2`, PR
#175. History: `c6123432` (implementation) → `79f1bbf3` (review-fix) →
`baac9502` (docs pi-lsp policy) → final two-row dock law correction (this
commit). PR open, NOT merged. 14 stashes preserved.

The sections below keep the four evidence layers distinct: (A) the initial
implementation run, (B) the review-fix round, (C) the final browser QA, and
(D) the final-correction run + exact-head CI.

## A. Initial focused validation (recorded at c6123432)

```
npx vitest run tests/cad_circle_2p3p_b2.test.ts \
  tests/cad_circle_construction_b2.test.ts \
  tests/cad_circle_tangent_b2.test.ts \
  tests/cad_command_dock_b2.test.tsx \
  tests/cad_ribbon_icon_manifest.test.tsx
```

Result: 5 files / **85 tests passed** — 2p3p 13, construction 20, tangent 19,
dock 27, icon manifest 6. Neighbouring shell 5 files 70/70
(`cad_dock_polygon_mode_v1`, `cad_ribbon_controls`, `cad_shell_layout`,
`cad_shell_panels`, `cad_ribbon_tool_families`). `npm run typecheck` clean.
Icon PNGs (`magick identify` / `compare -metric AE`): all 12 pixel-identical
to their cited sources, native 16/32 px, no text metadata
(`icon-sources.md` §3).

## B. Review-fix validation (recorded at 79f1bbf3)

Two review findings were fixed and re-run before the final correction:

- **Finding 3 — CIRCLETTR repick law.** An AMBIGUOUS/NO_SOLUTION radius
  submission opens a UI-only repick window (never persisted); the next
  distinct tangent-object click replaces the second tangent and clears the
  error. Same-pair radius retry stays valid; first/current-second repick is
  rejected; Escape cancels with no partial undo.
- **Finding 4 — history chevron direction.** Collapsed renders `⌄`, expanded
  renders `⌃`, labels/`aria-expanded` unchanged, glyph pinned in the test.

Recorded re-run: focused 80/80 (construction 24, tangent 29, dock 27);
neighbouring 138/138; B2 browser spec 7/7; `tsc --noEmit` clean; eslint clean.
`test:agent` 8713 passed with 3 pre-existing study-desktop calibration/
preflight fails (unrelated, on clean tree). `tests/cad_circle_construction_b2`
gained 4 repick tests; the dock glyph assertions were added to the existing
chevron test.

## C. Final browser QA (re-run in this correction)

Spec `tests-browser/cad-draw-circle-b2.spec.ts`, production build, headless
Chromium via `playwright.prod.config.ts`:

```
npx playwright test cad-draw-circle-b2 --config=playwright.prod.config.ts
```

Result: **7 passed, 0 failed** (~25 s). Flow E (compact/history layout) now
asserts the two-row law directly and compares pre-use vs post-collapse heights
without hard-coding a pixel value:

| Width | Collapsed (pre-use) | Collapsed (after use) | Expanded | Reclaimed | Result |
|---|---|---|---|---|---|
| 1366 | 54 px | 54 px | 148 px | 54 px | baseline |
| 1920 | 54 px | 54 px | 148 px | 54 px | baseline |

The pre-fix bug was 54 px collapsed → 74 px after use + re-collapse (a
persistent third echo row). The regression is gone: collapsed stays two rows,
after-use height equals baseline, and collapsing after a session returns to
the pre-use height within a 1 px tolerance. 0 page errors, 0 console errors,
0 unhandled rejections in every test.

## D. Final-correction focused run (this commit)

Change: `CadCommandDock.tsx` computes one `visibleStatusText` and renders a
single status row (`data-cad-command-prompt`, carrying the
`cad-shell-command-echo` marker only while idle echo is shown); a session
start clears the stale echo so the live prompt never gets masked. No separate
echo row, no reserved hidden space.

```
npx vitest run tests/cad_command_dock_b2.test.tsx \
  tests/cad_shell_panels.test.tsx tests/cad_shell_layout.test.ts \
  tests/cad_dock_polygon_mode_v1.test.tsx tests/cad_ribbon_controls.test.tsx
```

Result: 5 files / **93 tests passed** (dock 33 incl. 6 new two-row/status
tests; the other 4 files 60).

Full focused + neighbouring rerun:

```
npx vitest run tests/cad_circle_2p3p_b2.test.ts tests/cad_circle_construction_b2.test.ts \
  tests/cad_circle_tangent_b2.test.ts tests/cad_command_dock_b2.test.tsx \
  tests/cad_ribbon_icon_manifest.test.tsx
npm run typecheck
```

Result: focused 5 files / **105 tests passed** (2p3p 13, construction 24,
tangent 29, dock 33, icon manifest 6); neighbouring shell 5 files 70/70;
`tsc --noEmit` clean. The production build used by the browser config
completed clean.

## E. Exact-head CI

- `baac9502` (reviewed state): CI run 37533311204 **SUCCESS** —
  classify / static / tests / build-smoke / numerical.
- Production-correction validation head `e00f08f6`: exact-head CI check
  #1066 / run 37539057501 **SUCCESS** — all five jobs green (classify,
  static, tests, build-smoke, numerical). CI is an automated check, not an
  independent review verdict.
- This docs-only closeout adds a new head after `e00f08f6`; that closeout
  head requires its own exact-head CI, to be recorded in the PR metadata
  after push.

## F. Repository invariants

- Stashes intact: **14**.
- No engine/parity regression assumed or measured here; `CadCircleEntity`
  geometry and persistence shape are unchanged. Parity/industry-reference and
  WASM tiers were not run in this scope.
