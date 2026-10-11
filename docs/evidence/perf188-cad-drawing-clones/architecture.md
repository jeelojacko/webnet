# PERF-188 — Redundant CAD drawing-document clone optimization: architecture

- Baseline: `origin/main 76415916adc87795305b7a7896dc59b098d3b054` (PR #261 merge).
- Branch: `perf/issue188-cad-history-drawing-clone-optimization` (from pinned main, no rebase).
- Issue: #188. `Refs #188` only — the parent owns issue state and PR creation.
- 14 pre-existing user stashes untouched; `manual/` ignored fixtures untouched;
  `.pi/lsp.json` untouched; no history rewrite.

## Problem

Two independent sites paid a full `cloneCadDrawingDocument`
(`src/engine/cad/cadDrawingFile.ts`, which deep-copies the whole project via
`cloneCadProject` and re-sanitizes the draft) on hot paths that did not need
one.

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
`onPersistedStateChange` fallback, on every effect run.

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

## Change 2 — persistence clone precheck (Candidate 2)

The persistence effect now decides whether a write is needed *before*
cloning, using the values the clone would compare anyway:

```ts
const currentSignature = buildCadProjectSignature(current.project);
if (currentSignature !== buildCadProjectSignature(syncedDrawing.project)) return current; // stale guard
const projectMatches = currentSignature === buildCadProjectSignature(cadProject);
const layoutMatches  = JSON.stringify(current.parcelLayout ?? null) === JSON.stringify(parcelLayoutState ?? null);
const labelsMatch    = (current.showParcelLabels ?? true) === (showParcelLabels ?? true);
if (projectMatches && layoutMatches && labelsMatch) return current; // PERF-188
// genuine change: fall through to the unchanged clone + sanitation path
```

The fall-through path is byte-for-byte the previous logic, so sanitation
(draft `plotFrame:false` restore, parcel-layout deep copy, `showParcelLabels
?? true`, key-order normalization) is preserved on every real write. Effect
deps remain exactly `[cadProject, onDrawingChange, parcelLayoutState,
showParcelLabels]`; `drawing` is still deliberately omitted.

Raw-vs-clone-normalization contract: the precheck compares raw
`buildCadProjectSignature` strings, exactly as the post-clone `sigSame` check
does. If the raw signatures already match, current is already the canonical
form, so cloning would not change the observable project (verified by a test
on a normalized imported-TIN clone). When the raw strings differ only by key
order (imported TIN, legacy migration), the precheck conservatively falls
through to the existing clone — the documented residual. The precheck can
never return an *incorrect* early keep: `projectMatches` implying a discarded
clone is the safe no-change direction, and the key-order-insensitive
history-adoption equivalence (`areCadProjectsCanonicallyEqual`, PERF-187)
already guarantees the history baseline cannot be wiped by a clone-normalized
document.

## Candidate 3 — deliberately not taken

Reusing `next.present.project` directly to build the internal command drawing
(avoiding even the residual wrapper clone) was not attempted. The residual
clone is the ownership boundary that publishes an independent document to the
parent/controlled state; sharing history-snapshot project references into the
persisted document risks alias corruption across multiple edits + undo/redo +
F2F save/reopen. Since Candidates 1+2 already remove one full-project clone
from every real commit/undo/redo path, the extra risk was not justified.

## Files

- `src/hooks/surveyCad/useSurveyCadWorkspace.ts` (+14/-0).
- `src/hooks/surveyCad/useSurveyCadWorkspacePersistence.ts` (+18/-6).
- `tests/cad_transaction_clone_perf188.test.tsx` (new, 17 tests).
- `docs/evidence/perf188-cad-drawing-clones/{architecture,validation}.md`.
- `docs/evidence/perf187-history-signature/validation.md` (stale round-8 line
  corrected only).
- `TODO.md` (single PERF-188 ledger entry).

No engine clone helper, type, schema, DOM, graph module, or file-format edge
changed. `cloneCadDrawingDocument` / `cloneCadProject` remain the boundary
clone for save/open/serialize/workspace-snapshot/payload-loader/F2F rerun.
