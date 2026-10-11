# STRUCT-241.13 Architecture — alignment + parcel-construction command payload leaves

## Baseline

- Pinned main: `49d945053c30834bc0e83301241ce04ec202bc1d` (PR #255 merge,
  fetched + verified before branching; local `main` fast-forwarded, clean).
- Branch: `refactor/issue24113-alignment-parcel-construction-command-types`.
- Pre-change hub frozen at
  `/tmp/struct24113-baseline/cadTransactions.types.ts.baseline`
  (SHA256 `a8d52d04ffbf81ca56d99b62d197756172f2c32fd62d3e386fd5df34b80d78f8`).
- 14 pre-existing user stashes untouched (count + order preserved); ignored
  Study Desktop private fixtures untouched; `.pi/lsp.json` untouched.

## What moved (type-only, 15 inline members -> 2 alias refs)

Source run: `CadCommand` union in `cadTransactions.types.ts`, contiguous
after `TANGENT_CURVE`, before the six survey-table intersections.

- NEW `src/engine/cad/cadTransactionsAlignmentCommandTypes.ts` (67 lines):
  `CadAlignmentCommandPayload` = 6 variants, verbatim in original order:
  ALIGNMENT_CREATE, ALIGNMENT_OFFSET_CREATE, ALIGNMENT_STATION_REPORT,
  ALIGNMENT_STATION_EQUATION, ALIGNMENT_OFFSET_POINT,
  ALIGNMENT_INTERVAL_POINTS. Only dependency:
  `import type { CadEntityId } from './cadCorePrimitiveTypes'`.
- NEW `src/engine/cad/cadTransactionsParcelConstructionCommandTypes.ts`
  (101 lines): `CadParcelConstructionCommandPayload` = 9 variants, verbatim
  in original order: PARCEL_CREATE, PARCEL_SPLIT, PARCEL_SPLIT_BEARING,
  PARCEL_SPLIT_AREA, PARCEL_SPLIT_SLIDE, PARCEL_SPLIT_SWING,
  PARCELCOURSEARC, PARCELCOURSELINE, PARCEL_LAYOUT_AUTO. Only dependencies:
  `CadEntityId` from `./cadCorePrimitiveTypes`, `CadParcelLayoutSettings`
  from `./cadParcelLayoutTypes` (verified: that leaf imports only
  `CadEntityId` — no hub back-edge).
- Hub splice (`cadTransactions.types.ts`, 876 -> 779 lines): grouped
  `import type` for both leaves (no barrels); six alignment inline branches
  replaced by `| CadAlignmentCommandPayload` at the exact ALIGNMENT_CREATE
  position; nine parcel inline branches replaced by
  `| CadParcelConstructionCommandPayload` at the exact PARCEL_CREATE
  position. Retired the now-unused `CadParcelLayoutSettings` specifier from
  the hub's `./cadTypes` import (its only hub uses were the three moved
  `settings:` fields); `CadEntityId` and all other imports retained.
- Untouched neighbors: TANGENT_CURVE before; the six
  LINETABLE/CURVETABLE/PARCELTABLE/POINTTABLE/PARCELREPORT/PARCELDESC
  intersections, the seven `ParcelDesignate/Number/Link/Unlink/SharedEdit/
  Check/ScheduleCommand` aliases, TABLESTYLE, SURVEYTABLE_EDIT after.
  `CadCommandKey` raw bytes / 248 literals / 241 unique / 7 BLOCK repeats
  identical. No SCC reduction claimed (zero CAD SCCs before and after).

## Parity proof

- Programmatic diff of baseline hub lines 512-549 vs alignment leaf body
  and 550-613 vs parcel leaf body: identical except the leading 2-space
  union-continuation indent of the first `| {` (positional artifact).
- All 15 bodies keep property order, key literals, `?` optionality,
  `| null` nullability, and `'start' | 'end'` / `'slide' | 'swing'`
  literal unions. No Phase header existed above these runs; none invented.
- Effective `CadCommand`: still 168 flattened members in exact original
  order (TANGENT_CURVE @23, alignment @24-29, parcel @30-38, LINETABLE @39,
  seven Parcel* refs @45-51, TABLESTYLE @52, SURVEYTABLE_EDIT @53).
  Top-level: 102 (66/29/7) -> 89 (51/31/7) = -15 inline +2 refs.
- Emitted JS (transpileModule, removeComments:true): hub + both leaves all
  byte-identical inert `export {};` (11 bytes on disk, `export {};` trimmed,
  SHA256 `2e29cd9a…c8d05`); hub emit identical to pre-change baseline.

## Graph delta (measured, type-only)

- Scoped CAD+F2F: 505/2470 -> 507/2475 (+2 nodes, +5 type edges: 2 hub
  imports + 1 alignment out-edge + 2 parcel out-edges; zero retired module
  edges — the hub keeps its `./cadTypes` barrel edge and never imported
  `./cadParcelLayoutTypes` directly). VALUE SCC 0, TYPE SCC 0.
  VALUE/MIXED 1585 edges / 1567 pairs digest
  `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`
  unchanged.
- Full src: 1677/7581 -> 1679/7586 (same +2/+5, all edges resolve in `src`).
  VALUE SCC 0, TYPE 7 SCC / 38 nodes unchanged. VALUE/MIXED 4444/4385
  digest `415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448`
  unchanged.
- 2417 layout-leaf inbound allowlist gains exactly one legitimate edge:
  parcel leaf `import type { CadParcelLayoutSettings }` (pinned in 2417
  suite; still type-only, still zero value edges).

## Workers / review

- Worker A (alignment leaf) + Worker B (parcel leaf): parallel, disjoint,
  landed verbatim; parent verified parity before splicing.
- Parent owned hub splice, 60-test focused suite, 15-file guard
  roll-forward, docs, PR.
- Independent read-only reviewer: PENDING (must APPROVE before handoff).
