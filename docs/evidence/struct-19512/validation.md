# STRUCT-195.12 — Break parcel-diagnostics runtime import cycle: validation

## Graph

- Baseline `c132c428`: 481 nodes / 2393 edges / value|mixed 1580 /
  pairs 1562 / SHA `3d7284db…` / VALUE 3 SCC-16 nodes / TYPE 0.
- Final: 482 nodes / 2400 edges / value|mixed 1584 / pairs 1566 /
  SHA `0feb1dc8…` / VALUE 2 SCC-12 nodes / TYPE 0.
- Old parcel quad gone from both graphs; remaining SCCs: geometry 7
  (`cadGeometry`, `cadGeometryArcBuilders`, `cadGeometryArcPrimitives`,
  `cadGeometryCurveCore`, `cadGeometryCurveIntersections`, `cadGeometryCurves`,
  `cadGeometryTangentCurve`) and arc/polyline 5 (`cadCogoEntityIntersections`,
  `cadCogoMath`, `cadParcelArcGeometry`, `cadPolylineCourses`,
  `cadPolylineGeometry`) — both byte-untouched by this phase.

## Fidelity / parity

- Helper bodies `buildParcelLineCandidate`/`buildParcelNodeMap`: extracted from
  `git show HEAD:` vs new topology file → `diff` byte-identical.
- Diagnostics diff: one import hunk only (+7/−5); every function body unchanged.
- SourceDraft diff: one import line; Linework diff: import repoint + helper
  removal + named re-export only; facade: zero diff.
- Behavior oracles in `tests/cad_cogo_parcel_runtime_cycle_19512.test.ts`
  (closed polyline, straight square, mixed line+arc bulge, 3×3 gap 100 m² @
  (15,15), shifted-square overlap 50 m², linework diagnostics, no input
  mutation) all pass. Parcel area/selection/reconstruction/gap/overlap/
  tolerance/rounding/error handling untouched by construction.

## Tests

- New `tests/cad_cogo_parcel_runtime_cycle_19512.test.ts`: 25/25 (export
  identity, import-order safety, SCC/singleton guard with 30 s timeout on the
  cold-graph test, 41-edge baseline slice + exact removed-4/added-11 allowlist,
  negative controls, helper fidelity, exact oracles).
- Rolled guards: 19511 (24), 1957/1958/1959/19510 goldens, 1954 SCC pin —
  all green (125/125 across the 19511+1959+19510+19512 batch; 96/97 + fix →
  full pass for the 19511+1954+1957+1958 batch).
- Existing parcel suites (`cadCogo.03/.06/.07/.08`, `curved_splits_19c`,
  `shared_edit_19d`): 51/51 (Worker B) and 22/22 (Worker A).
- `npx tsc --noEmit`: exit 0 (both workers, whole repo). `git diff --check`:
  clean (verified at PR time).
- `npm run test:agent`, `npm run build`, `npm run check:portable-paths`:
  run once pre-PR by parent; results recorded in the PR body. Exact-head CI
  is authoritative.
- Known-unrelated: gitignored Study Desktop real-data calibration/preflight
  tests may fail locally (content untouched); 195.11-era intermittent
  `cad_ribbon_controls` scroll failure is out of scope — no ribbon changes here.

## Review / PR

- Independent reviewer (`openai-codex/gpt-6-sol` per role policy) on the exact
  full diff + SCC proof; findings resolved in-phase with fresh re-review.
- ONE PR against exact `origin/main` `c132c428`, body uses `Refs #195` only.
  Never merged here; issue #195 stays open for the two remaining VALUE SCCs
  (geometry 7, arc/polyline 5).
