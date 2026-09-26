# Phase 18W — Definition-Edit Performance Evidence

Campaign: `tests/evidence/phase18w_definition_perf.test.ts` (evidence tier,
manual-only via `vitest.evidence.config.ts`; registered in
`scripts/testTiers.ts`). Bounded, record-only — no millisecond assertions.
Correctness is asserted lightly (clean validation verdicts, `ok` builds,
revision stability) so a broken run cannot masquerade as fast.

Machine: local dev (Linux x86_64, Node 22, single run, 2026-09-26).
Timings are wall-clock `performance.now()` deltas around the named call.
Full rebuilds run the same `buildCadSurface` engine entry the surface worker
uses (sync harness, not a worker round-trip — transport is out of scope).

## 1. Breakline chain validation (§123)

Duplicate-ref scan + self-intersection seam on a winding non-crossing chain.

| points | duplicate-ref | self-intersect |
| --- | --- | --- |
| 10 | 0.0 ms | 0.5 ms |
| 100 | 0.0 ms | 5.3 ms |
| 1000 | 0.6 ms | 75.8 ms |

Reading: the ref scan is linear (hash set); self-intersection is ~quadratic
(~10–14× per 10×) — same complexity class as the existing `breaklinesCross`
pairwise seam (architecture §5). No gate: chains over ~1k points are outside
the interactive editor envelope, and 76 ms at 1k is not a UI blocker.

## 2. Ring candidate validation (§124)

`validateSurfaceBoundaryCandidate` (exact predicates, no epsilon snap) with
3 attached voids present; candidate rings are circles (worst-case-ish edge
counts, no collinear runs).

| outer vertices | outer check | void vertices | void check |
| --- | --- | --- | --- |
| 100 | 4.2 ms | 25 | 0.2 ms |
| 1000 | 56.2 ms | 250 | 3.6 ms |
| 5000 | 1291.0 ms | 1250 | 80.9 ms |

Reading: outer validation scales with ring size × attached geometry
(~1.3 s at 5000 vertices — acceptable for a bounded pre-commit check, and
the async rebuild owns triangulation per §60-61 policy). Voids stay cheap
because the candidate, not the whole definition, dominates.

## 3. Source-revision compute (§125, revision only)

`computeCadSurfaceSourceRevision` on planar native grids (revision text only —
never a full rebuild at this scale per pointer).

| points | first | repeat |
| --- | --- | --- |
| 10,000 | 16.1 ms | 14.2 ms |
| 50,176 | 74.1 ms | 58.1 ms |
| 100,489 | 132.9 ms | 149.9 ms |

Reading: linear in point count (~1.4 µs/point). Revision recompute is never
the bottleneck — downstream staleness checks stay cheap at 100k.

## 4. Rebuild split: commit vs rebuild vs edit-stack replay

Grid + diagonal breakline + outer + one void; (a) one insert commit +
revision recompute, (b) full `buildCadSurface`, (c) stacked build (2 edits:
`raise-lower-surface` + `add-point`) minus bare build.

| scale | commit+revision | full rebuild | stacked − bare (replay) | triangles |
| --- | --- | --- | --- | --- |
| 10k | 34.8 ms | 492.0 ms | −0.1 ms (noise) | 19,994 |
| 50k | 206.8 ms | 4216.0 ms | +326.9 ms | 100,346 |

Reading: definition-edit overhead is ~5–7% of the rebuild; replay of a small
stack adds ~8% at 50k. The 50k rebuild (4.2 s) is far below the ~120 s stop
bound, so no campaign stop was needed; 100k rebuilds were not attempted
(out of scope per pointer — revision-only evidence above covers 100k).

## 5. Notes

- One adversarial synthetic (a 500-unit breakline segment across a dense
  grid) fails constrained recovery with `SURFACE_TRIANGULATION_FAILED` —
  correct fail-closed behavior, kept out of the timed envelope.
- Interactive envelopes (chains ≤ 1k, rings ≤ 5k, revisions ≤ 100k) all
  complete synchronously without worker offload for the validation/revision
  paths; only full triangulation needs the async rebuild path.
