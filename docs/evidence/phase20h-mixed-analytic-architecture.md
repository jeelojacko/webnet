# Phase 20H — mixed-analytic grading-group architecture

Status: engine + UI landed on `feat/cad-grading-mixed-analytic-groups`
(baseline `d364174bbcd21b2b00cea047de861720159d023f`). Tests/evidence only on
the worker branch.

## 1. Termination KIND vs termination DOMAIN

| layer | symbol | home | meaning |
|---|---|---|---|
| kind | `GradingTerminationKind` | `gradingTypes.ts` | 4-way: `surface`, `distance`, `elevation`, `relative-elevation` |
| kind | `gradingTerminationKind(criterion)` | `gradingTypes.ts` | criterion → kind (unchanged from 20F/20G) |
| domain | `GradingTerminationDomain` | `gradingTypes.ts` | 2-way: `surface`, `analytic` |
| domain | `gradingTerminationDomain(criterion)` | `gradingTypes.ts` | fixed/cut-fill → `surface`; distance/elevation/relative-elevation → `analytic` |

The kind is the persisted/displayed family; the domain is derived and never
persisted. All analytic kinds share one closed-form kernel, so they may mix
inside a single group. Surface has a TIN tie instead, so it can never mix
with analytic.

## 2. Compatibility matrix (same domain)

| default ↓ / override → | fixed | cut-fill | distance | elevation | relative-elevation |
|---|---|---|---|---|---|
| fixed | ✓ | ✓ | ✗ | ✗ | ✗ |
| cut-fill | ✓ | ✓ | ✗ | ✗ | ✗ |
| distance | ✗ | ✗ | ✓ | ✓ | ✓ |
| elevation | ✗ | ✗ | ✓ | ✓ | ✓ |
| relative-elevation | ✗ | ✗ | ✓ | ✓ | ✓ |

Enforced in ONE place: `validateGroupTerminationDomainCriteria`
(`gradingGroupTermination.ts`). `validateGroupTerminationCriteria` is a thin
alias, so every authoring path (`createGroupDefinition`,
`editGroupCriteria`, `setCourseCriteriaOverrides`, group persistence) reads
the same rule.

## 3. Hardening (single authorities)

- `resolveRelativeElevationParams(gradeRatio, relativeElevation)` — the ONE
  sign/size authority (finite + machine-nonzero grade/Δ, derived `d = Δ/g`
  finite + strictly positive). Used by `constantAnalyticOffset`, the analytic
  resolver, and authoring/draft validation. Opposite-sign input is a
  `GRADING_RELATIVE_ELEVATION_WRONG_DIRECTION` failure, never negated.
- `resolveAnalyticCriterionAt` — the ONE closed-form "limit at this source
  elevation?" authority for all three analytic kinds. `analyticTerminalLine`
  no longer re-derives `D`, `(E−Zsrc)/g`, or `Δ/g`.
- Distance limit-overflow guard: `limitZ = sourceZ + g·d` must be finite even
  when every input is finite; otherwise `GRADING_BAD_CRITERION`, before any
  geometry. `GRADING_BAD_SEARCH_DISTANCE` / `GRADING_BAD_SOURCE` are checked
  first.

## 4. Routing

- `computeGradingGroupFromSnapshots`: a same-domain gate runs **before any
  partial solve**; a surface+analytic mix returns
  `MEMBER_NO_SOLUTION / GRADING_GROUP_MIXED_TERMINATION_DOMAIN`. The domain
  branch (`domains.has('surface')`) replaces the old per-side `||` check, so
  an all-analytic group routes every joint through `solveAnalyticCorner`.
- `resolveGroupInputsWithReason`: recomputes the domain set from the default
  plus every effective member criterion and returns
  `GRADING_GROUP_MIXED_TERMINATION_DOMAIN: group mixes surface and analytic
  termination` before resolving a target. A hand-edited/stale override cannot
  reach the worker.
- The worker/session path (`computeGradingFromSnapshots`, grading service)
  is unchanged; it consumes the group result produced by the compute gate.

## 5. Revision / persistence / target

- **Revision**: `buildGroupRevision` (`ggrev1:`) hashes the canonical sparse
  overrides, so switching a default or an override kind moves the hash; a
  dormant `targetSurfaceId` on an all-analytic group stays `tgt:none`.
  Phase 20G legacy pins are unchanged.
- **Persistence**: `sanitizeCadGradingGroupsDetailed` enforces the domain
  **per override** — an `incompatible-domain` override is dropped on its own
  with a `CourseCriteriaDrop` reason while valid siblings survive. Malformed
  defaults still drop the whole group via the authoring constructor. WNCAD
  shape stays schema **v2** (additive optional fields, no bump).
- **Target**: analytic groups carry no target; a retained legacy id is
  dormant (ignored by resolve/status/calculate). Surface groups still require
  a resolvable CURRENT target.

## 6. Transform

`scaleCadGradingGroup` scales the `distance` default/override and the
search/tolerance lengths, and never scales `gradeRatio`, `targetElevation`,
`relativeElevation`, or Z (18R is XY-only). Selection-scoped transforms leave
grading definitions untouched.

## 7. Provenance / design patch

- `makeDesignPatchProvenance` and the group-bake command collect
  `canonicalAnalyticKinds([default, ...memberCriteria])`. When more than one
  analytic kind is effective they record `targetKind: 'mixed-analytic'` plus
  `analyticKinds` in canonical order `distance → elevation →
  relative-elevation`; homogeneous groups keep their exact legacy shape.
- `normalizeTinProvenance` accepts `mixed-analytic` for group-bake and
  design-patch provenances only; a standalone single-grading bake reads a
  stray `mixed-analytic` back as `surface` (fail-closed). Unknown
  `analyticKinds` entries are dropped.
- `tinProvenanceRevisionPart` emits `mixed-analytic:distance+elevation+...`.

## 8. UI

- `allowedMethodsForGroupDomain(domain)` (`cadGradingCriterionInput.ts`)
  returns `['surface']` or `['distance','elevation','relative-elevation']`;
  `clampToAllowedMethods` keeps a draft inside the offered set. The group
  criteria composer (`CadGradingGroupCriteriaPanel`) locks to the **domain**,
  not a single kind.
- `groupMethodSummary` / `summarizeGroupMethods`
  (`cadGradingGroupMethodSummary.ts`) produce one label: `Mixed Analytic`
  (`MIXED_ANALYTIC_LABEL`) when >1 analytic kind is effective, else the
  single method name. Manager / Properties / Toolspace / Inquiry / CSV all
  read this one helper.
- Properties adds a `Methods` row and a `Domain` row; a mixed group shows
  `Target: Not applicable` instead of a fake surface.
- The group Edit Criteria editor treats a surface↔analytic switch with stored
  overrides as a **confirmed two-step** change: reset overrides (one Undo),
  then edit the default (one Undo). Overrides are never silently deleted.

## 9. Extract / bake / status

- Status derivation (`deriveGroupStatus`) is unchanged: a mixed-analytic group
  reaches `CURRENT` once a result exists at the current revision;
  `exportable` (Extract Daylight / Bake) requires `CURRENT` + a result.
- A mixed-analytic bake records `targetKind: 'mixed-analytic'` +
  `analyticKinds`; a surface+analytic group never reaches the bake because it
  fails closed earlier.

## 10. Restrictions carried forward

- No mixing of surface and analytic termination in one group (fail-closed).
- No averaging/bridging/interpolation at incompatible analytic corners; a
  mismatched limit Z fails `CORNER_NO_SOLUTION / GRADING_ANALYTIC_CORNER_Z`.
- No clamping of over-search; it fails `MAX_DISTANCE_REACHED`.
- No target resolution for analytic groups.
- Extraction/bake remain gated on a CURRENT result.
