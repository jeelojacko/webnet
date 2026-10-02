# Phase 20L — Offset-Radius Architecture (evidence)

Study-only. Zero `src/` changes. Branch `research/phase20l-offset-radius-safety`,
baseline `d9400af7157e343e7b6ca932c2b05fb5795ac8c2`.

## 1. Lineage

- **20K symbolic:** `offsetRadiusSafety` classified `Roff` symbolically; the
  resolver never ran, so the collapse/inversion boundary and the residual were
  unmeasured. Arc×arc corners stayed `NO_GO_TERMINAL_CHORD_ARC_PAIR`, and
  transition-less mixing stayed blocked.
- **20K.1 / 20K.2 / 20K.3:** seam, topology, and certificate fixes. Left the
  offset-radius gap unchanged (no `Roff` arithmetic added).
- **20L closes the measurement gap, not the production gap:** exact `Roff`
  arithmetic, adjacent-member joins, locality, tolerance, and topology evidence
  — all in `scripts/` + `tests/` + `docs/evidence/phase20l/`. Production keeps
  its single join authority (`miterExtent`) and its chord-offset daylight.
- **Still deferred:** the transition problem (spiral/transition curves between
  members) is untouched by every track in this study.

## 2. Geometry objects

- **Source arc:** center C, radius R, sweep, traversal tangent, grading side.
- **Exact constant-distance offset:** concentric arc, same C,
  `Roff = R + radialSign·d`, where `radialSign` is exact geometry (center lies
  on the curvature side), never a tolerance. Endpoints are source endpoints
  shifted by the signed normal via `fromLocalFrame`.
- **Boundary:** `d = R` (inward) collapses every endpoint to C
  (`OFFSET_RADIUS_COLLAPSE`); `d > R` is same-orientation unrepresentable
  (needs sweep-sense flip + π shift) → `OFFSET_RADIUS_INVERTED`, gated as
  POLICY_REQUIRED. Variable `d(station)` → `OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR`,
  never forced into `Roff`.
- **Join:** wherever the two members' offset curves intersect, surfaced with
  along-travel parameters `uIn`/`uOut`, `|J−V|`, locality, and branch
  consistency. Classified (`UNIQUE` / `AMBIGUOUS` / `NONE` / `NONLOCAL` /
  `WRONG_SIDE` / `SELF_INTERSECTION` / `COLLAPSE` / `INVERSION`), never
  resolved — every intersection is reported, none auto-picked.

## 3. Why concentric-through-V is forbidden

Forcing the offset arc through the joint V confuses two different curves: the
offset is concentric with the source (same C, radius `Roff`), so its endpoints
lie off V by construction. Routing it through V would silently substitute a
different arc (wrong center, wrong radius) and corrupt the residual, the join
parameters, and the topology strip. All three tracks construct endpoints by
signed-normal shift and verify them against independent analytic evaluation
(`endpointAgreement`).

## 4. Ownership (no overlaps)

| Track | File(s) | Owns |
|---|---|---|
| core | `scripts/phase20lOffsetRadiusCore.ts` | 20K symbolic controls, sign authority (CCW/CW mirror), `Roff` classification vocabulary, 400-row core corpus |
| joins | `scripts/phase20lOffsetJoinCore.ts`, `scripts/phase20lOffsetRadiusVariants.ts` | Analytic offset-join engine, 31 fixtures + transform helpers, locality/extent analysis, branch classification |
| matrix/audit/perf | `scripts/phase20lOffsetRadiusAudit.ts`, `scripts/phase20lOffsetRadiusPerf.ts` | 11088-cell parameter matrix, variable-distance classification, production observe-only comparison, tolerance audit, topology audit, 48-row corpus, timing harness |

Shared vocabulary (`OFFSET_RADIUS_OK | COLLAPSE | INVERTED | NONFINITE`) is
spelled with the SAME four literals in both tracks by convention, but it is
NOT defined once: the core track declares it (`phase20lOffsetRadiusCore.ts`)
and the audit track re-declares it (`phase20lOffsetRadiusAudit.ts`, with its
own `classifyOffsetRadius` / `radialSignOf` / `offsetRadiusOf`) — duplicated,
not imported, so each track stands alone. (An earlier revision wrongly claimed
“defined once”.) Reused production authorities (unchanged, observe
only): `linearizeGradingArc`, `gradingSideNormal`,
`coordinateAgreementTol`, `auditMesh` / `validateGradingMeshTopology`.
