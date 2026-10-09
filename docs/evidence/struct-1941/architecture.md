# STRUCT-194.1 — Safe first extraction from the SurveyCadWorkspace monolith

Branch: `refactor/issue194-cad-workspace-extraction-a`
Baseline: `b746036510348d65cb5cfa945e0a9cebefe294ff`
Refs #194 (`TODO.md` in-progress note; **NOT CLOSED**).

This phase is behavior-preserving only. It extracts three cohesive seams from
`src/components/SurveyCadWorkspace.tsx` and adds regression coverage for the
extracted production code. No engine geometry, schema, persistence bytes,
cache-epoch, shell-link, worker, or protocol behavior changed.

## BEFORE / AFTER (root file)

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `src/components/SurveyCadWorkspace.tsx` LOC | 3151 | 2862 | **-289 (-9.2%)** |
| Root hook-call sites | 160 | 160 | 0 |

The net reduction is 289 lines, below the ~350 aspirational target. The gap is
entirely the manager wrapper wiring: the extracted overlay tree needs ~60 live
root values (refs, handlers, catalog/dependency state, session objects), and
those values cannot be derived inside the presentational component without
moving orchestration out of the root, which this phase explicitly forbids
(`New/Open/Save`, LandXML staging, `shellActions`, surface/profile/section/
contour/worker lifecycles stay in the root). The extraction is still a real
~160-line JSX move from root to the manager component, plus ~62 lines from the
drawing-source hook and ~53 lines from the dependency constants/memo.

## New modules

| File | LOC | Responsibility |
| --- | ---: | --- |
| `src/hooks/surveyCad/useSurveyCadDrawingSource.ts` | 146 | Drawing-source precedence + `CadDrawingDocument -> SurveyCadPersistedState` fallback setter; also exports the pure `cloneCadBounds` helper. |
| `src/components/surveyCad/cadDependencyDiagnostics.ts` | 117 | Pure dependency word/action maps + full drawing summary (engine summary + draft-label augmentation) + chip formatting. No React import. |
| `src/components/surveyCad/SurveyCadWorkspaceManagers.tsx` | 375 | Dedicated-page chrome (hidden file inputs, title/file actions, dependency chip, command toolbar) + conditional overlays (drafting panel, 8 survey/surface/profile/section/grading managers, Export Center, LandXML review modal, edit entry forms) + `children` (the interaction surface). |
| `src/components/surveyCad/SurveyCadWorkspaceEditForms.tsx` | 55 | The three surface point/bulk edit entry overlays, routed to the parent-owned session hooks. |
| `tests/cad_workspace_extraction_1941.test.tsx` | 552 | Real production hook/component coverage for the three seams. |

## Seam 1 — drawing source hook

`useSurveyCadDrawingSource` preserves the exact inline implementation:

- Precedence: controlled `drawing` prop → `persistedState` migration → spike
  project from `input`/`parseOptions` (adjustment-backed only when
  `canFeedDraftingFromResult`) → blank drawing.
- Memo deps are byte-identical:
  `[canFeedDraftingFromResult, input, instrumentLibrary, parseOptions,
  persistedState, result, resultDependencyIdentity, units]`.
- `emitDrawingChange` is `onDrawingChange ?? fallback`; identity is preserved
  (the controlled setter when supplied, a fresh fallback closure otherwise —
  exactly as before).
- Fallback setter semantics: `previousLegacy -> (previousDrawing | activeDrawing)
  -> update -> identity no-op -> mapped persisted state with the synthetic
  `cad-drawing:` id prefix stripped -> null`.
- Hook order is unchanged: the single internal `useMemo` replaces the former
  `legacyDrawing` `useMemo` in the same linear position (after the
  `noteUiTabReady` effect).
- `cloneCadBounds` is now a stable module-level function; the surface is not
  memoized, so this cannot affect the #183/#184 render contracts.

## Seam 2 — dependency diagnostics (pure)

`cadDependencyDiagnostics.ts` owns:

- `DEPENDENCY_CAUSE_WORDS` / `DEPENDENCY_ACTION_HINT` with exhaustive
  `CadDependencyReasonCode` keys.
- `summarizeActiveDrawingDependency(drawing, current, inputs)` — the exact
  former root `useMemo` body: engine `summarizeDrawingDependency` + the
  draft-label augmentation that promotes an otherwise non-stale summary to
  `STALE` and appends `CAD_DERIVED_LABEL_STALE`.
- `getDependencyCause` / `getDependencyAction` / `formatDependencyStatusLabel`
  / `formatDependencyChipText`.

The root keeps the `useMemo` with the exact dependency array
`[activeDrawing, resultDependencyIdentity, stationIds, f2fLinkStatus,
f2fLinkSourceKind]`, so identity behavior is unchanged. The `title` uses
`getDependencyAction(summary) ?? undefined`.

Parity note (pre-existing, preserved): the engine excludes `CAD_CURRENT` and
`CAD_NO_DEPENDENCY` from `DrawingDependencySummary.reasons`, so the root chip
has always rendered the `CAD_OWNER_CONFLICT` fallback phrase for CURRENT and
MANUAL_ONLY drawings (`CAD status: CURRENT — conflicting ownership.`,
`CAD status: MANUAL-ONLY — conflicting ownership.`). The extraction reproduces
that exactly and the regression test pins it.

## Seam 3 — manager/panel composition

`SurveyCadWorkspaceManagers` receives grouped props (file inputs, chrome,
toolbar, drafting panel, managers, export center, LandXML, edit forms) plus
`children`. The parent builds the `SurveyCadWorkspaceSurface` element and its
drawing/pick handlers, so those remain root-owned.

Preserved:

- Exact `data-testid`/`data-*` attributes, `aria-label`s, class names, z-index,
  render order, and visible-vs-hidden semantics.
- Conditional mount/unmount identity: each overlay is only mounted under its
  original condition; the dependency chip always renders (independent of
  `shellChrome`), matching the pre-extraction tree.
- Parent-owned file-input refs and event handlers (passed in as refs/props).
- Callback bodies routed through the live sources: catalog rewire (shared
  `catalogRewire` helper), `validateSetCurrent` layer guard, Draft-only
  `requestDraftCommit` vs full-replace fallback, shell snapshot/actions, and
  LandXML preview cancel/confirm.
- `SurveyCadWorkspaceEditForms` only routes to the parent-owned session hooks
  and introduces no hooks/services.

No `React.memo` was added; the manager component re-renders with the parent as
before, so the #184 shell-snapshot memo and #183 static-pointer memo are
untouched.

## Identity / lifecycle contracts

- Hook order: fixed replacement only (one `useMemo` for one `useMemo`).
- `shellLink` registration effects, surface/profile/section/contour/worker
  lifecycles, persistence, and `good` deterministic ordering are unchanged.
- The manager is unconditional (no conditional hooks).

## Remaining #194 roadmap

This is the first, safe slice. Still monolithic in the root and queued for
later phases:

1. `shellActions` control plane (~2160-2718; ~560 lines).
2. `New/Open/Save` + LandXML async review/scheduling (~1350-1530).
3. Surface/profile/section/contour/worker service lifecycles (~500-1120).
4. `SurveyCadWorkspaceSurface` drawing/pick handler bodies (kept in the parent
   by design for this phase).
