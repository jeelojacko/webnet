# Inline Option Application Matrix (Phase 1)

This matrix documents where the Section 5.6 global inline options are already applied, and which per-family gaps remain for Phase 2 wiring.

Legend:

- `Applied`: directive behavior is wired for that family/path.
- `N/A`: directive does not meaningfully apply to that family.
- `Gap`: behavior expected for parity is not yet wired in that family/path.

Observation-family groups:

- `Control/coordinate`: `C`, `CH`, `E`, `EH`, `P`, `PH`, `GS`
- `Conventional`: `D`, `A`, `B`, `V`, `DV`, `M`, `BM`, `SS`
- `Traverse/direction`: `TB`, `T`, `TE`, `DB`, `DN`, `DM`, `DE`
- `GNSS/leveling`: `G`, `G4`, `L`

| Directive              | Control/Coordinate | Conventional                              | Traverse/Direction        | GNSS/Leveling  | Engine/Run path                      | Phase 1 finding                                                                                                                                                          |
| ---------------------- | ------------------ | ----------------------------------------- | ------------------------- | -------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.UNITS`               | Applied            | Applied                                   | Applied                   | Applied        | Applied                              | Core behavior present. Linear tokens go through unit normalization and angle tokens honor global angle-unit overrides.                                                   |
| `.COORD`, `.2D`, `.3D` | Applied            | Applied                                   | Applied                   | Applied        | Applied                              | Core behavior present. Parser state drives 2D/3D parsing and solver vertical-equation inclusion/exclusion.                                                               |
| `.ORDER`               | Applied            | Applied (angle station order for `A`/`M`) | N/A                       | Applied (`GS`) | Applied                              | Core behavior present for coordinate order + angle triplet order where defined.                                                                                          |
| `.DELTA`               | N/A                | Applied                                   | Applied                   | N/A            | Applied                              | Core behavior present. Vertical parsing switches between dH and zenith pathways and distance mode handling.                                                              |
| `.MAPMODE`             | N/A                | Partial                                   | Applied                   | N/A            | Applied                              | Traverse map-style behavior is implemented (`TB/T/TE`, including `ANGLECALC` semantics). Non-traverse conventional records do not use map-traverse semantics (expected). |
| `.LWEIGHT`             | N/A                | Applied                                   | Applied                   | Applied (`L`)  | Applied (report/profile shows state) | Fallback weighting is now wired for omitted-sigma leveling equations across `L` plus delta-derived paths (`V`/`DV`/`M`/`BM`/`T`/`DM`/`SS`).                              |
| `.NORMALIZE`           | N/A                | N/A                                       | Applied (`T/TE`, `DN/DM`) | N/A            | Applied                              | Core behavior present for mixed-face acceptance/rejection in traverse and direction-set workflows.                                                                       |
| `.END`                 | Applied            | Applied                                   | Applied                   | Applied        | Applied                              | Core behavior present. Parse terminates deterministically at `.END`.                                                                                                     |

## Next Focus From This Matrix

1. Expand fixture-locked regression coverage so `.LWEIGHT` behavior is locked for each non-`L` leveling-producing family, not just representative paths.
