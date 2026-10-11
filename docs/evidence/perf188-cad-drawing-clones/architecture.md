# PERF-188 — Redundant CAD drawing-document clone optimization: architecture

- Baseline: `origin/main 76415916adc87795305b7a7896dc59b098d3b054` (PR #261 merge).
- Branch: `perf/issue188-cad-history-drawing-clone-optimization` (from pinned main, no rebase).
- Issue: #188. `Refs #188` only — the parent owns issue state and PR creation.
- 14 pre-existing user stashes untouched; `manual/` ignored fixtures untouched;
  `.pi/lsp.json` untouched; no history rewrite.

## Problem

Two independent sites paid a full `cloneCadDrawingDocument`
(`src/engine/cad/cadDrawingFile.ts`, which deep-copies the whole project via
`cloneCadProject` and re-sanitizes the draft) on hot paths. Hot path A's clone
(arbitrary history updates) proved safely avoidable; hot path B's clone
(persistence normalization) is load-bearing and was kept — see the P1
correction under Change 2.

**Hot path A — `useSurveyCadWorkspace.applyHistoryUpdate` wrapper**
(`src/hooks/surveyCad/useSurveyCadWorkspace.ts`). The wrapper published a
cloned drawing document whenever the history updater ran, with no check that
the updater had actually changed anything:

```ts
applyHistoryUpdateBase((current) => { const next = updater(current); ... });
if (!nextProject) return;
onProjectChange((current) => cloneCadDrawingDocument({ ...current, project: nextProject, ... }));
```

Selection-only updates, command-state transitions, and rejected commands that
return the same `current` history object all paid the clone even though the
drawing document only carries project + draft (+ the separately-kept parcel
layout/labels). The clone was then discarded by the persistence sync.

**Hot path B — `useSurveyCadWorkspacePersistence` effect**
(`src/hooks/surveyCad/useSurveyCadWorkspacePersistence.ts`). The effect
deep-cloned the entire document *before* comparing it against the intended
target, then discarded the clone on the common no-change path:

```ts
const nextState = cloneCadDrawingDocument({ ...current, project: cadProject, ... });
const sigSame = sig(current.project) === sig(nextState.project);
const layoutSame = ...; const labelsSame = ...;
if (sigSame && layoutSame && labelsSame) return current;
return nextState;
```

This ran on every committed project/undo/redo and, in the legacy
`onPersistedStateChange` fallback, on every effect run. Unlike hot path A, this
clone is not pure waste: it is the normalization boundary, and the original
revision's attempt to skip it on a raw signature match was unsound (P1
correction below).

## Change 1 — no-op guard in the wrapper (Candidate 1)

The wrapper still always runs `applyHistoryUpdateBase` (history state,
selection, command state, undo/redo stacks flow unchanged), but captures
whether the updater changed the project or draft reference and skips the
drawing publish when neither moved:

```ts
let projectChanged = false;
applyHistoryUpdateBase((current) => {
  const next = updater(current);
  nextProject = next.present.project;
  projectChanged = nextProject !== current.present.project;
  if (next.present.draft !== current.present.draft) { nextDraft = next.present.draft ?? null; draftChanged = true; }
  return next;
});
if (!nextProject) return;
if (!projectChanged && !draftChanged) return;   // PERF-188
```

Why this is safe:

- The published `CadDrawingDocument` carries `project`, `draft`,
  `parcelLayout`, `showParcelLabels` (plus identity/name/units/imports copied
  from `current`). It never carries selection or history stacks. With both
  `project` and `draft` reference-identical, the only drawing fields the
  wrapper could change are `parcelLayout`/`showParcelLabels`, which are props
  owned by the persistence effect (its dependency list includes both), so a
  real prop change is still propagated there.
- A genuine project change (`LAYER_*`, geometry, F2F, import, transform) or a
  draft change (`PROJECTTRANSFORM` atomic draft) still clones and still bumps
  `updatedAt`.
- `applyHistoryUpdateBase` is intentionally still invoked, so selection-only
  and rejected-command updates keep their exact history semantics.

## Change 2 — persistence normalization sync retained (P1 correction)

**P1 correction (post-review of PR #262).** The first revision of this branch
guarded the persistence effect with a pre-clone raw-signature early return:

```ts
const projectMatches = currentSignature === buildCadProjectSignature(cadProject);
const layoutMatches  = JSON.stringify(current.parcelLayout ?? null) === JSON.stringify(parcelLayoutState ?? null);
const labelsMatch    = (current.showParcelLabels ?? true) === (showParcelLabels ?? true);
if (projectMatches && layoutMatches && labelsMatch) return current; // UNSAFE
```

That early return was **unsound** and has been removed. It assumed
`cloneCadDrawingDocument` only normalizes key order, so a raw-signature match
proved cloning was a no-op. That premise is false. `cloneCadProject`
(`src/engine/cad/cadPersistence.ts`) always:

- sets `version: 2` unconditionally;
- defaults `cogoComputations` to `[]` when absent;
- migrates surface point sources (`cloneCadSurfaces` -> `cloneCadSurface` ->
  `cloneCadSurfaceDefinition`, `src/engine/cad/cadSurfaceTypes.ts`): a
  supported legacy `{ kind: 'point-group', pointGroupId: 'g1' }` becomes
  `{ kind: 'point-group', pointGroupIds: ['g1'] }`;
- sanitizes surface `purpose` (`sanitizeCadSurfacePurposeValue`: unknown ->
  `'other'`, absent stays absent);
- rebuilds nested key order (surfaces, imported-TIN payloads, project tables).

The drawing clone (`cloneCadDrawingDocument`) additionally re-sanitizes the
draft and defaults `showParcelLabels` to `true`.

A controlled drawing is supplied **untouched** by `useSurveyCadDrawingSource`
(`drawing ?? legacyDrawing`), and a legacy `.wncad`/persisted-state document can
also carry a supported legacy shape. Those inputs can be raw-equal to
`cadProject` (`current.project === cadProject` on mount) while still needing a
normalization write. Under the removed early return, a controlled drawing
carrying a supported legacy `pointGroupId` (or a non-canonical key-order
imported TIN) was published verbatim, where the pre-#262 code published the
normalized form. That is a real behavior change for legacy owners.

The corrected persistence effect is exactly the pre-#262 shape — stale guard,
then clone, then compare the **cloned** result:

```ts
const currentSignature = buildCadProjectSignature(current.project);
if (currentSignature !== buildCadProjectSignature(syncedDrawing.project)) return current; // stale guard
const nextState = cloneCadDrawingDocument({ ...current, project: cadProject, ... });
const sigSame = currentSignature === buildCadProjectSignature(nextState.project);
const layoutSame = ...; const labelsSame = ...;
if (sigSame && layoutSame && labelsSame) return current;
return nextState;
```

Effect deps remain exactly `[cadProject, onDrawingChange, parcelLayoutState,
showParcelLabels]`; `drawing` is still deliberately omitted.

### Precise safe-precheck domain

There is **no** safe pre-clone project-signature short-circuit for this path.
Raw equality of `current.project` and `cadProject` cannot prove either side is
normalization-stable: the normalizer is not order-only, is not pure key
reordering, and is not idempotent-detectable without running it. A cheap
"is this project canonical?" test is not available without either a full
clone or a provenance marker (a global `WeakSet`/cache), and neither is
justified for this boundary. The only sound precheck is the *post-clone*
`sigSame` comparison already present; the clone must run first. The retained
optimization is the workspace wrapper's reference-based no-op guard
(Change 1), which needs no such proof because it observes **reference**
identity of the history updater's own project/draft.

Consequence, stated honestly: on a genuine order-preserved
commit/undo/redo the wrapper publishes one clone and the persistence sync
clones again to normalize/compare (and discards the equal result) — `2`, the
same as before #262. The no-op / selection-only / rejected-command paths drop
to `0`, and mount pays exactly one normalization clone (`1` drawing, `1`
nested project), matching the pre-#262 baseline. The transitive
canonical-equality contract (`areCadProjectsCanonicallyEqual`, PERF-187) is
unaffected: the history baseline cannot be wiped by a clone-normalized
document, and `buildStableCadProjectSignature` still treats clone-normalized
TIN surfaces as equal (key order only); a legacy point-source migration is a
genuine value change and correctly re-baselines the history.

## Candidate 3 — deliberately not taken

Reusing `next.present.project` directly to build the internal command drawing
(avoiding even the residual wrapper clone) was not attempted. The residual
clone is the ownership boundary that publishes an independent document to the
parent/controlled state; sharing history-snapshot project references into the
persisted document risks alias corruption across multiple edits + undo/redo +
F2F save/reopen. Candidate 1 already removes the wrapper clone from every
no-op / selection-only / rejected-command path, and that is the only clone the
review proved redundant; the extra risk was not justified.

## Files

- `src/hooks/surveyCad/useSurveyCadWorkspacePersistence.ts` (P1 correction:
  pre-clone early return removed; clone-then-compare restored).
- `src/hooks/surveyCad/useSurveyCadWorkspace.ts` (+14/-0, no-op guard retained).
- `tests/cad_transaction_clone_perf188.test.tsx` (19 tests; mount counter armed
  before mount, legacy-`pointGroupId` and key-reordered imported-TIN
  normalization regressions added).
- `docs/evidence/perf188-cad-drawing-clones/{architecture,validation}.md`.
- `docs/evidence/perf187-history-signature/validation.md` (stale round-8 line
  corrected only).
- `TODO.md` (single PERF-188 ledger entry).

No engine clone helper, type, schema, DOM, graph module, or file-format edge
changed. `cloneCadDrawingDocument` / `cloneCadProject` remain the boundary
clone for save/open/serialize/workspace-snapshot/payload-loader/F2F rerun.
