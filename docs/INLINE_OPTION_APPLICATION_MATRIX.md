# Inline Option Application Matrix (Phase 1)

This matrix documents where the Section 5.6 global inline options are applied and which families each directive affects.

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
| `.LWEIGHT`             | N/A                | Applied                                   | Applied                   | Applied (`L`)  | Applied (report/profile shows state) | Fallback weighting is wired for omitted-sigma leveling equations across `L` plus the length-aware delta-derived paths (`DV`/`M`/`BM`/`T`/`DM`/`SS`). Pure `V` records remain lengthless and therefore do not gain a `mm/km` fallback term. |
| `.NORMALIZE`           | N/A                | N/A                                       | Applied (`T/TE`, `DN/DM`) | N/A            | Applied                              | Core behavior present for mixed-face acceptance/rejection in traverse and direction-set workflows.                                                                       |
| `.END`                 | Applied            | Applied                                   | Applied                   | Applied        | Applied                              | Core behavior present. Parse terminates deterministically at `.END`.                                                                                                     |

## Phase 3 Coverage Locks

1. `tests/inline_option_matrix_phase3.test.ts` now locks `.LWEIGHT` semantics across the length-aware non-`L` leveling-producing families, `.COORD 2D/3D` vertical-equation behavior, and deterministic `.END` termination.
2. `tests/inline_option_profile_outputs.test.tsx` now verifies that listing/report solve-profile outputs surface the active directive state for `.UNITS`, `.ORDER`, `.COORD`, `.DELTA`, `.MAPMODE`, and `.NORMALIZE`.
