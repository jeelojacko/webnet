# Phase 20P.1 — Compatibility and persistence

- Branch: `feat/phase20p1-sparse-collinear-transitions`, baseline main
  `f786f76ba21818d863dc39a6c35f70697968c70e`.

## 1. Behavior-identical paths

- **No transition:** an absent/empty intent still routes through
  `deriveGradingTopologyExpectation` unchanged; `planTransitionGroup` is only
  reached for N ≥ 1 plural intents, and `GroupSolveInput` keeps `transitions[]`
  mutually exclusive with the singular field.
- **Singular transition:** `selectGroupTransition` (N ≤ 1 cap) and
  `deriveSingularTransitionExpectation` are byte-identical; the singular
  tiler path is unchanged. A length-1 plural group still routes the legacy
  path.
- **Consecutive 20N.1 set:** when joints are consecutive, the station gap
  `S(j+1) - S(j)` equals the shared middle-member length, so the new gate
  reduces bit-for-bit to the 20N.1 rule. The legacy branch of
  `deriveTransitionSetExpectation` (no `stationGaps`) and the immediate-member
  branch of `geometryError` are retained, so saved 20N.1 groups and their tests
  behave identically.

## 2. Persistence roundtrip

- The persisted transition list is an ordered array of per-joint intents
  (`jointId`, full-precision `width`, law, side). `buildGroupRevision` hashes
  the array **in order** (`ggrev1:`), so it is deterministic and
  order-sensitive: reordering or adding/removing a sparse transition changes
  the hash; no sort participates.
- JSON roundtrip preserves sparse ids, canonical order, and full-precision
  widths (e.g. `8.0000000001` survives and re-hashes differently from `8`).
- **No schema migration:** `schemaVersion` is unchanged and no persisted joint
  station field is added — stations are derived at runtime from authoritative
  member lengths.

## 3. Fail-closed order / malformed state

- `canonicalJointOrderError` (authoring), `selectGroupTransitions` (policy),
  `checkGroupTransitionPlansAgreement` (worker), and the topology set mode all
  require strictly-increasing parsed ids and reject duplicate / out-of-order /
  malformed input. Nothing is sorted or repaired into validity.
- Load sanitation retains the loaded intent order verbatim; a malformed loaded
  set is surfaced (panel warning + compute fail-closed), never silently
  repaired by opening/editing.

## 4. No auto-insert

Skipped joints keep their existing native/corner authority. A sparse set never
creates a transition at a joint the operator did not author; a deflected skipped
joint belongs to the native corner path and existing failures remain failures.

## 5. Non-binding finding for gaps ≥ 2 members

For two transitions separated by at least one whole member (`j ≥ i+2`),
per-joint feasibility `W ≤ 2·min(incident lengths)` already bounds
`Wi/2 ≤ L_{i+1}` and `Wj/2 ≤ L_j` with `gap = L_{i+1}+…+L_j`, so the strict
global separation check is **non-binding** for gaps ≥ 2 members: true overlap
cannot occur while every transition is independently feasible, and only exact
touch is reachable at the feasibility corner. A deliberately infeasible overlap
fixture can still reject at separation, but it also violates per-joint
feasibility — the rejection code depends on check order.

The station rule is therefore retained as the **correctness authority**, not as
extra rejection power: it must reduce to the 20N.1 shared-member rule for
consecutive joints, and the UI `separationError` needs the true station gap to
report touch/overlap truthfully across skipped joints. This document does not
claim the global gate rejects sets that per-joint feasibility would accept.
