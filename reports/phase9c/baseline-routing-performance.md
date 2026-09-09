# Phase 9B.1 Baseline Routing Performance

Historical local measurements preserved for Phase 9C. These numbers were not rerun during Phase 9C.

- Fixture: `tests/fixtures/camp_design_preanalysis_traverse_only.dat`
- Station unknowns: 46
- Coordinate parameters: 92 (historical runtime scope; upper range 176 with 84 orientations)
- Effective solve-preparation scope (Phase 9C): 86 coordinates + 84 orientations = 170 predicted
- Orientation parameters: 84
- Planning systems: 18
- Runtime parameter range: 170–176

| Mode | Median |
|---|---:|
| Forced TypeScript | 2607 ms |
| Baseline cap128 | 5276 ms |
| Phase 9B cap256 | 5403 ms |
| Phase 9B sparse attempt | 2836 ms |

Native correction work was approximately 5.4 ms; native covariance and verification work was approximately 15.9 ms.

C1 passed. Native C2 failed, and the TypeScript-reference C2 failed similarly (C2 follow-up: conditioning-aware research; mathematics and tolerances unchanged). The condition estimate was approximately `1.1645e51`; the normalized C2 residual was approximately `8.65e-17`.
