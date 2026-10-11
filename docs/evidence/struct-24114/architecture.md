# STRUCT-241.14 Architecture — primitive-draw + basic-curve command payload leaves

## Baseline

- Pinned main: `cce6ab288d1ce67fbcb4104b27be6cdb05914ce6` (PR #256 merge,
  fetched + verified before branching; local `main` fast-forwarded, clean).
- Branch: `refactor/issue24114-primitive-curve-command-type-leaves`.
- Pre-change hub: 779 lines; post-splice hub: 660 lines (-119 net).
- 14 pre-existing user stashes untouched (count + order preserved); ignored
  Study Desktop private fixtures untouched; `.pi/lsp.json` untouched.

## What moved (type-only, 19 inline members -> 2 alias refs)

Two NONADJACENT groups, intentionally separated by TRAVERSE and BATCH_COGO,
which stay inline in the hub in their original positions.

- NEW `src/engine/cad/cadTransactionsPrimitiveDrawCommandTypes.ts`
  (121 lines): `CadPrimitiveDrawCommandPayload` = 13 variants, verbatim in
  original order: POINT, COGO_POINT, LINE, LINE_CREATE_BATCH, RECTANGLE,
  POLYGON, CIRCLE, CIRCLECD, CIRCLE2P, CIRCLE3P, CIRCLETTR, CIRCLETTT,
  PLINE. Sits after ERASE, before TRAVERSE. Only dependencies (both
  `import type`): `CadTangentSource` from
  `./cadGeometryCircleTangentSolvers` (runtime module, type-only edge, no
  emitted JS) and `CadPolylineSegmentGeometry` /
  `CadPolylineSegmentWidth` from `./cadPrimitiveGeometryEntityTypes`
  (owning leaf, avoids hub back-edge).
- NEW `src/engine/cad/cadTransactionsBasicCurveCommandTypes.ts` (68 lines):
  `CadBasicCurveCommandPayload` = 6 variants, verbatim in original order:
  ARC_3PT, ARC_CREATE, BEST_FIT_LINE, BEST_FIT_ARC, BEST_FIT_PARABOLA,
  TANGENT_CURVE. Sits after BATCH_COGO, before
  `CadAlignmentCommandPayload`. Zero imports.
- Hub splice (`cadTransactions.types.ts`, 779 -> 660 lines): grouped
  `import type` for both leaves (no barrels); thirteen primitive inline
  branches replaced by `| CadPrimitiveDrawCommandPayload` at the exact
  POINT position; six basic-curve inline branches replaced by
  `| CadBasicCurveCommandPayload` at the exact ARC_3PT position. Retired
  the now-unused `CadTangentSource` import and the
  `CadPolylineSegmentGeometry` / `CadPolylineSegmentWidth` specifiers from
  the hub's `./cadTypes` import (their only hub uses were the moved
  CIRCLETTR/CIRCLETTT/PLINE fields); `./cadTypes` declaration and all other
  imports retained.
- Untouched neighbors: SELECT_ALL, CLEAR_SELECTION, ERASE before;
  TRAVERSE + BATCH_COGO between the two splices, inline and unflattened;
  CadAlignmentCommandPayload, CadParcelConstructionCommandPayload, all
  table intersections, parcel management aliases, CurveF1 leaves, and all
  later members in exact original relative order. `CadCommandKey` raw bytes
  / 248 literals / 241 unique / 7 BLOCK repeats identical (raw SHA
  `4ff8cd4a…eca1502`). No consumer migration. No SCC reduction claimed.

## Parity proof (parent-verified pre-splice)

- Programmatic body diff: hub lines 365-450 vs primitive leaf body and hub
  lines 479-514 vs curve leaf body — byte-identical except the trailing
  `;` on the new union aliases (body SHAs `20baf238…` / `9e6b3e38…` match).
- All 13+6 bodies keep key literals, field names/order, literal unions
  (`'inscribed' | 'circumscribed'`), optionality (`label?`, `closed?`,
  `segmentGeometry?`, `segmentWidths?`, `metadata?`, `sourceEntityId?`),
  nested shapes, and attached JSDoc (LINE_CREATE_BATCH `createdBy`; all
  three PLINE blocks incl. signed-bulge + centered-band-width semantics).
  No Phase header existed above either run; none invented.
- Effective `CadCommand`: still 168 flattened members in exact original
  order (ERASE @2, primitive @3-15, TRAVERSE @16, BATCH_COGO @17,
  basic-curve @18-23, alignment onward unchanged). All 19 moved branches
  are single-keyed (plain one-literal `Extract` selectors; no double-key
  branches moved). Top-level: 89 (51 inline / 31 refs / 7 inter) -> 72
  (32 inline / 33 refs / 7 inter) = -19 inline +2 refs.
- Emitted JS (transpileModule ESNext, removeComments:true): hub + both
  leaves all inert `export {};` (10 B trimmed; hub SHA `2e29cd9a…c8d05`
  identical to pinned baseline; leaves 11 B on disk with trailing newline,
  same trimmed bytes). No runtime JS beyond the inert marker.

## Graph delta (measured live, type-only)

- Scoped CAD+F2F: 507/2475 -> 509/2478 (+2 nodes, +3 type edges: 2 hub
  leaf imports + 2 primitive-leaf out-edges + 0 curve-leaf edges − 1
  retired hub->tangent-solver module edge; hub keeps its `./cadTypes`
  barrel edge). VALUE SCC 0, TYPE SCC 0. VALUE/MIXED 1585 / 1567 digest
  `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`
  unchanged.
- Full src: 1679/7586 -> 1681/7589 (same +2/+3, all edges resolve in
  `src`). VALUE SCC 0, TYPE 7 SCC / 38 nodes unchanged. VALUE/MIXED
  4444/4385 digest
  `415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448`
  unchanged.
- 2413/2414 suites pin the new inbound edge into
  `cadPrimitiveGeometryEntityTypes` from the primitive-draw leaf (first
  ordered; hub pair kept; type-only, zero value edges).

## Workers / review

- Worker A (primitive leaf) + Worker B (curve leaf): parallel, disjoint,
  landed verbatim; parent verified byte-parity before splicing.
- Worker C: focused 65-test suite + 15-file narrow guard roll-forward.
- Parent owned hub splice, validation, docs, PR.
- Independent read-only reviewer: PENDING (must APPROVE before handoff).
