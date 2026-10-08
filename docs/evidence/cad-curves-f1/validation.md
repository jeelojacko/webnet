# CAD Curves F1 — Validation (engine half)

Engine-side validation for the F1 integration batch. UI/session/browser
certification is owned by the UI worker; this file records only the engine
scope: the six atomic transactions, the atomic subdivision command, the
engine fixes, and their focused tests.

## New atomic commands

All commands are single `runCadCommand` transactions (one history entry
each), commit through the FILLET / BATCH_COGO single-transaction pattern, and
return `null` on any validation failure so `runCadCommand` leaves state and
the undo stack untouched.

| Command | Behavior | Sources |
| --- | --- | --- |
| `CURVE_BETWEEN_TWO_LINES_CREATE` | Tangent arc via `buildCadCurveBetweenTangentRays`; both `CadLineEntity` sources trimmed/extended to PC/PT via `buildTrimmedEntityPieces` (TRIM label law; direct-extension fallback when the tangent point is off-segment). | modified |
| `CURVE_ON_TWO_LINES_CREATE` | Identical arc geometry, sources left byte-unchanged. | unchanged |
| `CURVE_THROUGH_POINT_CREATE` | Unique tangent circle through a pick (typed no-solution / multi-solution refusal), sources trimmed. | modified |
| `MULTIPLE_CURVES_CREATE` | 2..10 chains, one floating curve, N arcs + one COGO computation, deterministic index order, all arcs selected. | unchanged |
| `CURVE_FROM_END_CREATE` | One point- or radius-mode continuation arc from a line/arc source. | unchanged |
| `REVERSE_COMPOUND_CURVE_CREATE` | One G1 arc via `buildCadCurveReverseOrCompound`; metric extent or the legacy `radius,delta` compat input. | unchanged |
| `SUBDIVIDE_CURVE_CREATE` | All interior subdivision points in one entry. | unchanged |

Shared plumbing lives in `cadTransactionsCurveF1Shared.ts`; payload types in
`cadTransactionsCurveF1Types.ts`; command keys/union in
`cadTransactions.types.ts`; registry wiring in `cadTransactions.ts`.

## Laws enforced

- **Identity Between/On**: both commands share the kernel; the committed arc
  for the same inputs is geometrically identical, only trimming differs.
- **Current layer**: every created arc lands on `resolveCurrentCadLayerId`.
- **Selection = created**: the primary created arc(s) (all arcs for
  `MULTIPLE_CURVES_CREATE`, all points for `SUBDIVIDE_CURVE_CREATE`) are
  selected.
- **Provenance**: every commit records a COGO provenance with
  `sourceEntityIds`, metric/turn/trim inputs, and a result report; entity
  metadata carries `cogo` plus per-command fields.
- **Editable gates**: locked/hidden sources are rejected before any mutation
  (`checkCadEntityEditable`), including commands whose sources are unchanged.
- **No partial edits**: any failure (locked source, degenerate rays, invalid
  metric, impossible chain, multi-solution through-point) returns `null`
  before the project is rewritten.
- **Exact undo/redo**: undo restores the `before` snapshot reference; redo
  restores the committed project.

## Engine fixes (see `existing-command-audit.md`)

- SUBDIVIDE chord law rebuilt on the equal-chord oracle; diameter and
  max-count refusals added.
- `cadArcPointByChordDistance(arc, 0)` returns the arc start.
- `buildCadCurveChain` rejects an opposite-sign floating residual with
  `CURVES_CANNOT_FIT`.
- `buildCadCurveReverseOrCompound` accepts an explicit legacy `deltaDeg`
  (bit-for-bit with the previous direct `cadBuildCompoundCurve` /
  `cadBuildReverseCurve` calls).
- Registry category moves (category field only).

## Focused tests

New files (agent tier; all fast):

- `tests/cadCogo/cadCurvesF1.engine-audit.test.ts` — equal-chord oracle,
  consecutive-equal chords, diameter/cap refusals, arc-length stepping,
  OFFSET CW/CCW, POINT_ON_CURVE bounds, all ten CURVE_SOLVER pairs, chain
  sign rejection.
- `tests/cadCogo/cadCurvesF1.transactions.test.ts` — Between/On identity +
  trim + one undo; Through trim + one entry; Multiple one entry + unchanged
  sources + deterministic geometry + impossible-fit zero mutation; From-End
  unchanged source + one entry; Reverse/Compound unchanged source + one entry
  + legacy compat; subdivide atomicity; undo/redo exactness; locked-source
  zero mutation.

Neighboring suites re-run green: `tests/cadCogo/*`, `tests/cadCommandHistory/*`,
`cad_shapes_transactions_v1`, `cad_shell_registry`, `cad_ribbon_tool_families`,
`cad_best_fit_commands_c1`.

## Chord disposition

Fixed. `cadArcSubdivisionPoints` chord mode now uses
`d = 2·asin(C / 2R)`, emits `start + k·d` for `k = 1..` while strictly before
the end angle, refuses `C >= diameter`, and shares the 10000-point cap. The
pre-fix behavior (chord measured from the start each iteration) is gone.

## UI worker validation (sessions/prompts/preview/ribbon/browser)

Scope: six canonical session keys (`CURVE_BETWEEN_TWO_LINES`,
`CURVE_ON_TWO_LINES`, `CURVE_THROUGH_POINT`, `MULTIPLE_CURVES`,
`CURVE_FROM_END`, `REVERSE_OR_COMPOUND`) with collision-free aliases
(`CURVEBETWEENTWOLINES`, `CURVEONTWOLINES`, `CURVETHROUGHPOINT`,
`MULTIPLECURVES`, `CURVEFROMENDOFOBJECT`, `REVERSEORCOMPOUND`); shared
prompt/help/parsing in `useSurveyCadCurveF1Session.ts` +
`useSurveyCadCurveF1Text.ts`, submit/picks in
`useSurveyCadCurveF1Submit.ts`. No engine file touched
(`git status` shows engine/ clean).

- `tsc --noEmit` clean.
- New `tests/cad_curves_f1_sessions.test.ts` (35 tests): shared
  parsing (metric/extent-with-D-as-delta/signed-radius/degree/count/
  floating/`L,R` segments/backstep), registry resolution + alias
  uniqueness + repaired hints, preseed law, Between/On/Through/Multiple/
  From-End/Reverse-Compound submits (trim/identity/atomicity/continuity/
  side laws/endpoint sharing), exact-id picks + invalid-stays-active,
  legacy arc-less picks, native-circle LINE_CIRCLE commit, bounded
  previews, prompt/empty-slot no-throw regressions.
- Updated `tests/cad_ribbon_tool_families.test.ts`: Curves = 16 live rows,
  zero planned, Between default, all selectable.
- Browser `tests-browser/cad-draw-curves-f1.spec.ts`: 9/9 green with zero
  page/console/unhandled errors (see `browser-qa.md`).
- Neighboring suites green: `tests/cadCogo/*` (129), shell registry,
  ribbon families, circle/line sessions; full `test:agent` + exact-head CI
  own the final gate (see worker report).
- Icons: no assets adopted (none exact); six F1 rows stay text-face; no
  manifest change, no draw-spline wiring (see `icon-sources.md`).
- Ribbon: `defaultVariantId` stays `curves-between-two-lines` (now
  runnable); sticky face moves only on flyout choice; typed commands never
  move it; New/Open resets via the existing lifecycle hook.
- Caught during QA: eager `${session.arc!.id}` template evaluation threw
  on arc-less sessions and broke the render (fixed with null guards +
  no-throw regression tests); dock autocomplete hover arming under a
  resting cursor (spec parks the mouse; app law unchanged).
