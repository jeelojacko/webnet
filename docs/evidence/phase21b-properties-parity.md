# Phase 21B §8 — parcel report migration into the shell Properties palette

Branch `feat/cad-shell-closeout-civil-icons`, base `origin/main 0407a4d`.
Closes the last remaining user-visible delta recorded in
`docs/evidence/phase21a-properties-parity.md` §3.1: the legacy
`SurveyCadParcelReportOverlay` / parcel Properties report block
(area ha/ac/ft² + headed course table) was unreachable in shell mode.

## 1. What changed

| file | change |
|---|---|
| `src/cad-app/shell/cadParcelSnapshot.ts` | `CadParcelSnapshotEntry.report: CadParcelReportSummary \| null`, built through the authoritative `buildParcelCourseReportSummary` (same resolver the legacy selection derivations used). Closure/area/perimeter/course counts now derive from that one report call instead of a second `cadBuildParcelClosureSummary` call. |
| `src/cad-app/shell/CadParcelReportProperties.tsx` | **new** sibling block. Headed `Parcel Report` + area m²/ha/ac/ft² + perimeter/closure + straight-line course table. Reuses `cadConvertAreaSquareMeters`; no parcel math of its own. |
| `src/cad-app/shell/CadPropertiesPalette.tsx` | single-selection wiring only: find the selected parcel entry, render the block after the entity heading. No other behavior touched. |
| `tests/cad_shell_parcel_report.test.tsx` | **new** focused suite (7 tests). |

No second report engine, no cached geometry: the block renders the report the
engine already produces at read time. `cadProperties.ts` row math is untouched.

## 2. Rounding / units (byte-identical to the overlay)

`cadConvertAreaSquareMeters` with the overlay's format spec:
m² `.toFixed(3)`, ha `.toFixed(4)`, ac `.toFixed(4)`, ft² `.toFixed(3)`,
perimeter/closure distances `.toFixed(3)`, course distance `.toFixed(3)`.
Course rows show `fromLabel-toLabel`, bearing + DMS azimuth, distance — the
same values as the legacy overlay's course table.

## 3. Curved courses

Mixed line/arc parcels keep truthful **chord** bearing/length in the course
table (`buildParcelCourseReportSummary` already maps arc courses to chord
values). Per-course curve metrics (R / Δ / L / direction) remain in the
palette's existing engine rows (`parcelInquiryRows` → `curve:<courseId>`), so
the block does **not** duplicate a second `Curves` section. Curved-course
behavior is preserved and covered by tests; shared-boundary row actions
(`Edit Shared` / `Unlink`) are unchanged and covered next to the report block.

## 4. Parity delta vs Phase 21A

| phase 21A delta | status |
|---|---|
| dedicated `CadParcelReportSummary` block not migrated | **migrated** (this wave) |
| Toolspace / `CadParcelToolspace` alternate action paths | still open (not in §8 scope) |

No floating panel is reintroduced: the block is a palette group, never an
absolutely-positioned overlay (test pins the absence of
`data-survey-cad-parcel-report`).

## 5. Validation

| check | result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors / 2 pre-existing warnings (`tests/evidence`, `gnssBaseline`) |
| `npx vitest run tests/cad_shell_parcel_report.test.tsx` | **7 passed** |
| `npx vitest run tests/cad_shell_panels.test.tsx tests/cad_parcel_network_ui_19d.test.tsx tests/cad_parcel_curved_core_19c.test.ts tests/cad_parcel_shared_boundary_19d.test.ts tests/surveyCad_shell_chrome.test.tsx` | **75 passed** |
| `npm run test:agent` | 6535 passed / 1 skipped; 4 failed — 3 pre-existing real-data `study-desktop` calibration failures + 1 flaky `tests/cad_feature_line_ui_20a.test.tsx` under full-suite load (passes 7/7 in isolation ×3; different wave's uncommitted ribbon/icon WIP, not touched here) |

Coverage: line-only parcel (area units, perimeter/closure, 4-row course
table), mixed line/arc (chord course values + curve rows still visible),
non-parcel selection (no block), no legacy floating overlay, Unlink dispatch
with the block present. Legacy non-shell mode is unchanged (same
`SurveyCadParcelPropertiesBlock` path as before).
