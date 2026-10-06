# Circle v1 Validation (baseline main 6c7380a9, branch feat/cad-draw-circle-v1)

## Focused suites (exact head, all green)

- `tests/cad_geometry_circle_v1.test.ts` — builders: fixed-center CR/CD,
  asymmetric CD-vs-2P distinction, degeneracy/non-finite, determinism.
- `tests/cad_circle_transactions_v1.test.ts` — entity law (no sweep fields),
  CD half-diameter, layer/ByLayer/selection/one-undo, invalid no-commit,
  move/rotate, save/reopen, native CIRCLE export (no ARC), clipboard,
  snap-kind truth table, grip kinds.
- `tests/cad_circle_command_sessions_v1.test.tsx` — pick flows, typed
  center/scalar, degenerate keep-alive, pick gating, preview==commit.
- `tests/cad_circle_consumer_v1.test.ts` — bounds, native ring render,
  segment/circle intersections, transforms + affine refusal, trim refusal,
  grip edits, properties, block non-uniform refusal, MlightCAD mapping,
  block-render circle visibility, sheet-export circle item.
- `tests/cad_ribbon_tool_families.test.ts` — CR/CD runnable, rest planned.
- `tests/cad_shapes_transactions_v1.test.ts` — Circle-live update, neighbors kept.
- Browser `tests-browser/cad-draw-circle-v1.spec.ts` — 5/5 green, 0 errors:
  ribbon truth, click flow + preview + 2 grips, typed CD (center fixed,
  r = D/2), invalid/cancel sterility, save/reopen exact with geometry.json.

## Static gates

- `tsc --noEmit` clean; `eslint` clean on touched files; `npm run build`
  clean (~10s); portable-paths clean (new paths verified ASCII).

## Neighbor suites

- 12-file CAD batch (circle + shapes + ribbon + blocks + properties):
  134/134 green.
- Full `tests/cad_grading*` untouched by this phase (no grading changes);
  exact-head CI is authoritative for the broad matrix.

## Review

- Adversarial self-review pass over representation leakage, CD regression,
  snap/grip leakage, transform/block, DXF, consumer exhaustiveness,
  persistence, and UI (see final report). Findings fixed before PR.
- Independent nested review: 2 BLOCKER (block-render child drop, sheet
  export omission) + 1 MAJOR (DXF radial-dim circle refusal) + 1 MINOR
  (persistence doc claim) — all fixed and pinned (block-render + sheet
  circle tests, DXF dim path widened, doc softened to arc convention).
  Re-verified: consumer suite green, annotation/export/block suites green.
- Review-fix round 3: 1 BLOCKER (UI adapter + Properties bypass of circle
  scale gate) + 1 MAJOR (Block Manager capture excluded circles) + 1 BLOCKER-
  once-fixed (UI redefine invalidating live non-uniform refs) + 1 MAJOR
  (sum-overflow validator) + 1 test-gap MAJOR (load/session seams unpinned)
  — all fixed and pinned in `tests/cad_circle_reviewfix_v1.test.ts` (18/18):
  UI insert/set-transform gates, Manager capture, redefine preflight,
  field-by-field validator incl. overflow case, parse-level load rejection
  (top-level + block child), anchor factory, DIMRADIUS/DIMDIAMETER session
  seam with re-measurement.
- Review-fix round 4: real-seam pins — DIMRADIUS/DIMDIAMETER
  commit through `handleAnnotationPointPick` (center anchor persisted,
  re-measurement after edits, rim picks stay fixed), Properties
  `editSurveyCadPropertiesField` block-scale gates (refused + history
  untouched), `toFiniteCircle` shares `isValidCircleGeometry`.
- Review-fix round 5 (this head): strengthened the same pins — the DIM
  session closes after the final pick, the same dimension re-resolves the
  moved Circle center and keeps its measurement, quadrant picks stay
  fixed, Properties asserts the wrapper reason plus no-undo/one-undo
  entries, and a single-axis 1e-14 scale edit on a valid uniform 1/1 Circle
  block is refused (fail-closed before any non-uniform state is reachable).
  Reviewfix suite now 25/25.
