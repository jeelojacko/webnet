# Phase 20L Worker-CORE — offset-radius safety (study)

Study-only. No `src/` change, no production route.

## Model

- Source arc: center C, radius R, sweep, traversal tangent, side.
- Exact constant-distance parallel: same C, `Roff = R + s·d`; sign `s`
  measured from `gradingSideNormal` dotted with the radial direction
  (CCW-right → +1; CW flips both sides).
- Endpoints: source endpoints shifted by the signed normal via
  `fromLocalFrame`; the offset arc does not pass through V.
- `d = R` collapses to C; `d > R` unrepresentable same-orientation
  (needs sweep-sense flip + π shift) → gate as POLICY_REQUIRED.
- Variable distance → OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR, not solved.
- Joint/miter solve → joins track (OFFSET_JOIN_DEFERRED stub here).

## Vocabulary

OFFSET_RADIUS_OK / COLLAPSE / INVERTED / NONFINITE ·
OFFSET_JOIN_DEFERRED / NOT_APPLICABLE ·
OFFSET_POLICY_NONE / REQUIRED.

## 20K controls preserved

R = 60, ratios [0.1, 0.5, 0.9, 1.0, 1.1], right growth / left shrink,
left =1 collapse / >1 inversion, all rows resolver-null symbolic-only.

## Corpus

`docs/evidence/phase20l/corpus-core.json` — radii [10, 60, 100, 252.5, 500]
× sweeps [5, 45, 90, 135] × CCW/CW × left/right × 5 ratios (400 rows: 5×4×2×2×5),
sha256 digest slice(0, 16). Regenerate:
`PHASE20L_CORE_OUT=<path> npx tsx scripts/phase20lOffsetRadiusCore.ts`.
