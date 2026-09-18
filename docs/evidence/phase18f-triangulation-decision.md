# Phase 18F Triangulation Decision

Date: 2026-09-18. Status: ACCEPTED (implemented in `src/engine/cad/tin/`).

## 1. Problem

18F needs a 2D TIN supporting survey workflows: deterministic output,
large state-plane (UTM) magnitudes, constrained breaklines (ridge/F2F
linework enforced as real mesh edges), outer/void boundary clipping, and
barycentric interpolation. No surface model existed (greenfield).

## 2. Decision

- **Base Delaunay:** `delaunator@5.1.0` (ISC license).
- **Exact predicates:** `robust-predicates@3.0.3` (Unlicense).
- **Constrained edges:** small in-repo module under `src/engine/cad/tin/`
  (`tinBase`, `tinConstraintRecovery`, `tinLegalize`, `tinDomainFilter`,
  `tinBuild`, plus `tinTypes`/`tinDedupe`/`tinPredicates`) implementing
  Sloan-style flip recovery from the literature — written for this repo,
  not copied from any candidate, never OpenCADStudio.
- No new native deps, no WASM, no GPL.

## 3. Alternatives considered and REJECTED

| Candidate | Verdict |
|---|---|
| d3-delaunay | Redundant wrapper over delaunator; stale. Nothing gained over the direct dep. |
| earcut | Polygon triangulator, not a TIN; non-conforming for scattered survey points. |
| cdt2d | MIT but stale (2015); measured 820 ms @ 5k points, timeout @ 1M. |
| poly2tri | No interior-constraint support (breaklines impossible). |
| @three-roads/cdt | MIT but 51/60 breakline failures, no Steiner fallback, no repo to audit. |
| cdt-js | npm metadata says MIT but upstream is MPL-2.0 — license mismatch, avoid. |
| triangle-wasm | Non-commercial license; incompatible with project distribution. |

## 4. Evaluation criteria

Determinism (permutation-invariant, seeded-shuffle stable), exactness at
UTM magnitudes (~1e6–1e7), real breakline constraints (each segment a mesh
edge, crossings blocked), mandatory Steiner fallback on non-convex quads,
worker-safe (no node builtins/DOM/WASM), bundle cost, license compatibility.

## 5. Measurements (researcher benchmarks, UTM magnitudes)

10k points 6.7 ms · 100k 38.6 ms · 400k 241.9 ms. Bundle ~5.5 KB gzip.
Base triangulation is O(n log n) via delaunator; constraint recovery is
bounded flips per segment with capped Steiner-restart rounds.

## 6. Architecture

`tinBase` (condition + Delaunator + CCW normalize + zero-area reject) →
`tinConstraintRecovery` (flip recovery, Steiner request on non-convex
quads) → restart-with-Steiner loop in `tinBuild` (≤6 rounds) → `tinLegalize`
(Lawson empty-circle pass, constrained edges immune) → `tinDomainFilter`
(outer/void centroid clip, max-edge drop). XY dedupe lives at the engine
boundary (`tinDedupe`, exact equality) because delaunator silently skips
duplicate points and would desync indices.

## 7. Gotchas (all pinned by `tests/cad_surface_tin.test.ts`)

1. delaunator@5.1.0 emits CLOCKWISE triangles despite `.d.ts` claiming CCW
   — normalized to math-CCW in `tinBase`.
2. robust-predicates `orient2d` returns positive for CLOCKWISE (README
   flipped) — wrapped as `ccwSign = -orient2d`.
3. delaunator silently SKIPS duplicate points (index desync) — exact dedupe
   at the engine boundary; no epsilon snap (near-distinct stays distinct).
4. No epsilon snap anywhere; Steiner/exact coincidences use exact equality.
5. Steiner-point fallback on non-convex quads is MANDATORY (unit-tested
   directly against `recoverConstrainedEdges`).
6. Local origin subtraction (`floor(minX)`, `floor(minY)`) + exact
   predicates; translation oracle (+2e6/+7e6) proves topology invariance.

## 8. License review

delaunator ISC + robust-predicates Unlicense: both permissive, commercial
use allowed, no copyleft. Tarballs vendored at `third-party/npm/` and
referenced via relative `file:` URLs so offline/reproducible installs keep
working; `package-lock.json` pins integrity hashes.

## 9. Risks

- Flip-recovery iteration caps trade pathological inputs for a clean
  `SURFACE_TRIANGULATION_FAILED` block (fail-closed, never a bad mesh).
- Centroid-clip boundaries are triangle-granularity (ragged at the edge);
  exact polygon-intersection clipping is deferred until a workflow needs it.
- Recovery is O(segments × triangles) worst-case; fine for breakline-scale
  inputs, re-evaluate if profile evidence says otherwise.

## 10. Determinism contract

Canonical input sort → conditioned base → sorted edge scans → canonical
triangle output. Shuffle-stability, translation-invariance, and cocircular
repeatability are test-enforced.

## 11. Rollout

Engine-only in 18F (no UI/persistence/worker-file changes by this worker).
Consumers: `cadSurfaces.buildCadSurface`, worker snapshot path reads the
same engine entry points.

## 12. References

- `src/engine/cad/tin/*`, `src/engine/cad/cadSurfaces.ts`
- `tests/cad_surface_tin.test.ts` (oracles + gotcha pins)
- `docs/evidence/phase18f-surface-architecture-audit.md`
