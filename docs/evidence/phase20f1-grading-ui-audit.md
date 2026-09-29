# Phase 20F.1 Grading-UI Audit — Worker A (per-course criteria closeout)

Scope: `CadGradingGroupCriteriaPanel.tsx`, `cadGradingGroupCourseCriteria.ts`,
`cadGradingGroupReport.ts` (+ tests). No engine math, no tolerances, no new
criterion parser — the shared `cadGradingCriterionInput` machinery is reused.

## Scout findings fixed (B1–B6)

- **B1 — local 2-way criterion parser in the criteria panel.** The panel owned
  a private `parseCriterion(kind: 'fixed' | 'cut-fill', …)` plus `kind` /
  `fixedText` / `cutText` / `fillText` state, diverging from the shared
  draft model. Fixed: the override composer now uses
  `gradingCriterionDraftFromCriterion` + `parseGradingCriterionDraft` +
  `<CadGradingCriterionFields>` (locked via a new optional `methods` prop).
- **B2 — composer offered cross-family options.** Fixed + Cut/Fill were
  offered regardless of group family, so distance/elevation groups could not
  be overridden truthfully and the engine single-family gate could trip from
  the UI. Fixed: the composer locks to the group family — Surface groups
  offer Fixed + Cut/Fill only, Distance groups Distance-only (grade + target
  distance editable), Elevation groups Elevation-only (grade + target
  elevation editable). The Method selector collapses to a locked label; the
  `onChange` clamp keeps the draft in-family even if the group changes.
- **B3 — untruthful 2-way per-row Type tag.** The old `:180`
  `effective.kind === 'fixed' ? 'Fixed' : 'Cut/Fill'` labeled analytic rows
  as Fixed/Cut-Fill. Fixed: `courseCriterionTypeText` is now 4-way —
  `Surface Fixed` / `Surface Cut/Fill` / `Distance` / `Elevation` — and the
  panel reads it (single source with the report rows).
- **B4 — no analytic value on member rows.** Fixed: `CourseMemberRow` gains
  `targetValue` (`'<d> m'` distance, `'<z> m'` target elevation, `'—'` for
  surface rows). Fixed/cut/fill columns keep `'—'` on analytic rows — no
  fake values, no fake target-surface wording.
- **B5 — report/CSV member lines lacked the analytic target.** Fixed:
  `buildCourseMemberRows` is the single source for report + CSV, so one
  change propagates: the report member line gains `· target <value>`, and
  the CSV member table gains a `Target Value` column after Fill Grade:
  `Course,From,To,Criterion Source,Criterion Type,Fixed Grade,Cut Grade,
  Fill Grade,Target Value,Classification,Source Length,Grading Area`
  (also noted in a code comment at the header site).
- **B6 — Apply-to-All second `run()` unchecked + misattributing notices.**
  The `GROUP_RESET_COURSE_CRITERIA` follow-up result was ignored, and
  override/default rejections claimed ref errors even when the engine
  refused on termination-family grounds. Fixed: the second result is
  checked (partial-success notice names the manual-recovery path), and
  rejection texts are family-neutral
  (`no changes applied (check course refs and termination family)`).

## Intentionally unchanged (B10–B11, out of scope)

- **B10 — ghost-seam fallback.** Screen-only viewport preview
  (`groupGhostSeam` note in the manager); no persisted/report/CSV effect.
  Left as-is.
- **B11 — GRADEGROUP description.** Doc-level command wording; no behavior
  or output change required. Left as-is.

## Verified correct (no change needed)

- Sparse semantics: `criteriaEqual` removes the override record (engine
  `setCourseCriteriaOverrides`); Reset removes records; multi-select apply
  stays one transaction (one undo); Reset-selected is one transaction.
- Explicit two-step Apply-to-All (default, then clear) with confirm dialog
  and live default-change preview (followers vs remaining overrides).
- Deterministic ordering (traversal order) in table, report, and CSV.
- Surface fixed/cut-fill bytes and formatting untouched; analytic rows never
  print a target-surface name (`gradingTargetSummary` already truthful).

## Tests

- Updated `tests/cad_grading_group_course_ui_20e.test.tsx` pins only where
  columns/labels changed (4-way type tags, `Target Value` CSV header).
- New `tests/cad_grading_group_criteria_20f1.test.tsx`: family locks
  (surface offers Fixed + Cut/Fill only; distance/elevation single-method
  with editable grade + target), edited distance/elevation commit payloads,
  single-command reset, truthful row labels + target values, report lines,
  and CSV header/rows.
