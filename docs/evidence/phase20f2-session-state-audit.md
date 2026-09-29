# Phase 20F.2 — grading session-state audit

Branch `fix/phase20f2-grading-session-sync` (baseline `origin/main` = `4769ba63`,
PR #130 merge). Derived from the CURRENT working-tree source, not from memory.
Companion evidence: `phase20f2-browser-qa.md`, `phase20f2-visual-qa.md`,
`phase20f2-performance.md`, `phase20f2/` (48 PNG + `geometry.json`).

Scope: why freshly derived grading/group rows did not reach shell chrome, what
the session FAILED overlay now guarantees, how pending worker requests are
cancelled, the Cut/Fill + composer seams, and an explicit correctness-vs-display
risk verdict. No numerical/geometry behaviour changed.

## 1. Root cause — stale dock/toolspace chrome

The one-way bridge in `cadShellLink.ts` publishes a `CadWorkspaceSnapshot` to
subscribers (`useCadShellSnapshot` → Toolspace / manager / Properties / ribbon).
`publish()` is gated by `snapshotsEqual(previous, next)`: an equal snapshot is
**swallowed and never notifies**. The workspace rebuilds the grading subtrees
from the session caches on every `gradingVersion` bump, so the *data* was
correct — but `snapshotsEqual` compared only the pre-20F subtrees. A change
confined to `grading`/`gradingGroups` therefore compared equal, `publish()`
returned early, `useSyncExternalStore` never re-rendered, and Toolspace /
Properties kept the pre-transition frame. The dock chrome was not refreshing
because the equality contract, not the derivation, was incomplete.

## 2. Omitted fields (fixed)

`snapshotsEqual` omitted five derived subtrees that the workspace already
publishes:

| Field | Phase | Why it matters here |
|-------|-------|---------------------|
| `grading` | 20B | standalone grading rows + status/metrics |
| `gradingGroups` | 20C | group rows + status/metrics |
| `f2f` | 18E | F2F catalog/provenance node |
| `surveyTable` | 19A | survey-table rows/styles node |
| `parcel` | 19D | parcel node + schedule |

All five are now compared by `JSON.stringify`. Regression guard:
`tests/cad_shell_panels.test.tsx` (`it.each(DERIVED_SUBTREES)`) is a
compile-time completeness check — the array is `satisfies
ReadonlyArray<keyof CadWorkspaceSnapshot>`, so a future derived key that is
forgotten fails `tsc`, and each key has a publish/notify test.

## 3. Partial gaps left in place (documented, not fixed)

`snapshotsEqual` intentionally uses cheap structural comparators for some
fields; these remaining gaps are latent display-staleness only (no corruption),
because the compared field is a *proxy* that normally moves with the rest:

- `selectionPreview`: only `id` + `label` compared via `previewsEqual`, not
  `type`. A type-only reclassification would not republish.
- `layers[]`: `layersEqual` compares id/name/color/visible/locked/frozen/
  printable/lineTypeId/description/transparency/lineweightMm, but **not
  `layers[].role`** (the survey-purpose enum). A role-only change would not
  republish.
- `lineTypes`: only `.id` arrays compared; a `name`/`dashPattern` edit alone
  would not republish.
- `sheets`: only `id` + `name` compared; other `DraftSheet` fields
  (dimensions, margins, viewports, title-block fields) would not republish.

These are pre-existing, out of the 20F.2 defect class (they do not gate grading
session sync), and are listed so the next parity pass can decide whether to
deepen them. Fixing any would only ever *add* publishes.

## 4. Equality contract (unchanged shape)

`publish` notifies iff `!snapshotsEqual(prev, next)`. `snapshotsEqual` is a
fast-ref check + 14 `JSON.stringify` subtree compares + typed structural
compares. The five added subtrees are 89.9% of compared bytes but only
~3.5 ms per full compare on a loaded session (§10). No memoisation, no digest.

## 5. Cancellation policy — and the dead seams it replaced

`SurfaceGradingService` owns session BUILDING state (`pending`,
`pendingGroups`) that the snapshot builders read via `buildingGradingIds()` /
`buildingGroupIds()`. Before 20F.2 the service exposed event hooks
`notifyTargetBuilt`, `notifySourceChanged`, `cancelGrading`,
`handleGradingDeleted`, `handleGradingChanged` — and **none of them had any
caller in `src/`, `tests/`, or `scripts/`** (verified with `git grep` at
`HEAD:4769ba63`). The pending maps could therefore never be retired by an
edit: a definition/source/target change left a stale BUILDING run alive, and
its late worker result could still land.

20F.2 replaces the event-label hooks with one revision-authoritative sweep:

- `reconcilePendingWithProject()` re-resolves every pending grading
  (`resolveGradingInputs`) and group (`resolveGroupInputs`) against the CURRENT
  project. A pending run survives **only** while the `grev1:`/`ggrev1:`
  revision it was requested for is byte-identical to what the definition
  resolves to now. A missing reference (deleted row, broken source/target) or a
  moved revision (Feature Line geometry, course endpoints, criterion/override,
  span/search, target reassignment, Project Transform, Grid/Ground, undo/redo)
  retires the run via `dropPending`/`dropPendingGroup` (which cancels the
  transport request).
- It **never auto-calculates** and **never promotes/transforms** a stale
  result: prior results stay in the grading caches as stale evidence and status
  re-derives `NEEDS_RECALC`/`SOURCE_NOT_CURRENT`/`BROKEN_REFERENCE`.
- It fires `onStateChange()` **only when the pending set actually changed**, so
  a no-op sweep cannot churn renders or loop.
- `notifyTargetBuilt` / `notifySourceChanged` now delegate to the sweep;
  `notifySourceChanged`'s feature-line-id label is diagnostic only, because
  revision identity — not the event label — decides. `cancelGrading`,
  `handleGradingDeleted`, `handleGradingChanged` remain as thin wrappers.

Wiring: `SurveyCadWorkspace` runs the sweep in a `useEffect` keyed on
`[cadProject, gradingService]` — one bounded sweep per project-reference
change, never per render.

Late results stay discarded independently of the sweep: `complete` /
`completeGroup` bail when `entry.requestId !== requestId`, the entry is gone
(cancelled/superseded), the drawing is foreign, the row is deleted, or the
resolved revision moved — so a late arrival can never become CURRENT.

## 6. FAILED policy and the masking mechanism

FAILED is **never derived**; it is a session overlay applied by the pure helper
`deriveFailedEffectiveStatus(derived, failure, currentRevision)` in
`gradingStatus.ts`. A diagnostic recorded by the worker/agreement path replaces
the derived status **only** when the derived status is `UNBUILT` or
`NEEDS_RECALC` **and** `failure.revision === currentRevision`.

Masking mechanism (why the old code hid real failures): the snapshot builders
(`cadGradingSnapshot.ts`, `cadGradingGroupSnapshot.ts`) applied FAILED only when
the derived status was strictly `UNBUILT`. When a **retained stale result**
existed, `hasResult` was true, so the derived status was `NEEDS_RECALC` — and
the recorded failure was never applied. The row read "Needs Recalc" while the
service's own `statusOf` (broader condition `result == null &&
diagnostics.has(...)`) read FAILED. The service and the published snapshot
**diverged**: the failure was visible in service truth but masked in the UI.

20F.2 makes eligibility `{UNBUILT, NEEDS_RECALC}` so a stale retained result
can no longer hide a current-revision failure, and routes BOTH the service
(`statusOf`/`groupStatusOf`) AND both snapshot builders through the same helper
so they cannot diverge. Guarantees:

- `BROKEN_REFERENCE` / `BUILDING` / `SOURCE_NOT_CURRENT` / `CURRENT` keep
  precedence over a diagnostic (a finished CURRENT never reads FAILED).
- A diagnostic recorded for a **different** revision never poisons a new one.
- Stale evidence stays visible: the row keeps `stale = true`, is never
  exportable, never promoted, and reports FAILED with the bounded reason.

The bounded reason is surfaced read-only on the grading/group Toolspace row,
Properties `Status` (`data-cad-grading-status-reason` /
`data-cad-grading-group-status-reason`), the manager row (compact stable code
via `gradingDiagnosticCode`), and the inquiry report (`Failure:` line).
Screenshot: `1366-diagnostic.png` / `1366-failed-stale.png`.

## 7. Cut/Fill defaults + composer seams

- `defaultGradingCriterionDraft.cutMagnitude/fillMagnitude` were bare `2`/`3`,
  which the `h-v` parser rejects (it requires `nH:1V`), so the untouched
  Cut/Fill create form read `invalid`. Now `2:1` / `3:1`.
- `ratioToRunText` emits explicit `nH:1V` (`2H:1V`), so a re-opened criterion
  round-trips to the same semantic ratio; the parser still rejects a bare `2`.
- `promptSlope` Cut/Fill prompts default to `2:1`/`3:1` with the corrected
  example.
- Composer sync: `CadGradingGroupCriteriaPanel` resyncs the draft on
  `[group.id, defaultKey]`, where `defaultKey` is the canonical persisted
  default-criterion key — so a default/family change (Set Group Default,
  undo/redo) refreshes the composer while override-only edits preserve active
  typing. Tick selection resets on group change only.
- Locked-family invariant: `CadGradingCriterionFields` forces a one-family
  composer to that family for both display and the emitted draft, so a locked
  composer can never show/emit a different criterion than its label claims.
- Cross-row clobber: both managers key `RowActions` by `selected.id`, so
  switching rows remounts the editor instead of leaking the previous draft.

## 8. Calc-notice UX seam

Both managers drive the `Computing …` notice off the **snapshot row status**:
the Calculate click arms `{id, revision, message}` decided from the row (never
by parsing the service string); the notice then follows BUILDING (keep
Computing) → CURRENT (success) → FAILED (bounded reason) → moved revision
(superseded). A newer operator notice disarms the pending request. No polling,
no worker-state duplicate, no synthetic selection/tab/command.

## 9. Workflows exercised

See `phase20f2-browser-qa.md` for the full table. Summary: A live chrome refresh
(Unbuilt→Building→Current across manager/Toolspace/Properties with the manager
closed), B FAILED after stale (`CORNER_NO_SOLUTION` /
`GRADING_ANALYTIC_CORNER_Z`, never promoted), C edit while BUILDING (sweep
retires the pending run, late result never CURRENT), D Cut/Fill defaults +
re-open round-trip. §34 shell contract and §35 focused chrome checks pass at all
three resolutions.

## 10. Screenshot inventory / error counts / perf

- **Screenshots**: `docs/evidence/phase20f2/` — **48 PNGs** (14 states × 3
  resolutions + 1366-only `editwhilebuilding-{building,retired}`,
  `f2f-surveyTable-parcel`) plus **48 `geometry.json` entries**. Complete §32
  state set at each resolution.
- **Errors**: **0 page errors, 0 console errors** across all 14 browser tests
  (every test funnels `pageerror` + console-error into `expect([])`).
- **Perf** (`phase20f2-performance.md`): full compare ~3.5 ms on a loaded
  session; ~5–6.5 ms with notify; new 5 subtrees are 89.9% of compared bytes
  (grading/group rows embed full CURRENT result meshes). Publishes fire on
  discrete state changes only; equal snapshots never notify. No timing gate.

## 11. Remaining restrictions (deferred, unchanged)

Relative Elevation; grading transitions; mixed-family groups (fail closed);
walls; corridors; radial grading; warped pads; DEM; boolean repair;
selection-scoped GRIDGROUND. Plus §3 partial equality gaps above.

## 12. Risk verdict

| Concern | Verdict | Basis |
|---------|---------|-------|
| Correctness corruption (wrong geometry promoted / stale result reads CURRENT) | **None** | Late/foreign/moved-revision results are discarded by request-id + revision guards in `complete`/`completeGroup` (unchanged, intact); the sweep only *retires* runs, never promotes. |
| Suppression (edits leaving a stale BUILDING alive) | **Real, fixed** | The pre-fix event hooks had zero callers; the revision-authoritative sweep now retires moved runs. |
| Display inconsistency (derived rows not reaching chrome) | **Real, fixed** | 5 omitted subtrees added to the publish gate; compile-time completeness guard added. |
| Stale BUILDING read | **Narrow** | Only while a run is genuinely in flight; a moved revision now retires it before the late result can settle. |
| Wasted worker work | **Minor** | A cancelled request still completes in the worker (transport `cancel` drops it); bounded by one in-flight run per row. |

No numerical/geometry output changed by any 20F.2 change — the fixes are the
publish gate, the status overlay, the sweep, and UI seams.
