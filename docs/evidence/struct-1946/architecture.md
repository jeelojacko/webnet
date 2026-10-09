# STRUCT-194.6 — CAD surface-compose lifecycle + civil inquiry + pick dispatch extraction

Branch: `refactor/issue194-cad-compose-surface-pick-extraction`
Baseline: `2394060ad68cad11c9a13c30780a8e7dd7eb2f9b` (exact origin/main)
Refs #194 (`TODO.md` in-progress note; **issue remains OPEN** — severity not
marked solved).

Behavior-preserving only. Three coupled seams are extracted from
`src/components/SurveyCadWorkspace.tsx`:

1. the exact two-surface composition lifecycle (worker service + pending-mode
   ref + UI-owned `applyCompose` history seam),
2. the four civil inquiry closures (analysis / volume / section / profile),
3. the long inline `onSurfacePickPoint` dispatcher.

No engine geometry, schema, persistence bytes, cache epoch, worker protocol,
hash, history, shell-link, action-ordering, status-notice, or visible-wording
change. The early primitive state/memos, the snapshot builders, the late
deletion effects, the 97-key shell mapping, and the twin `shellLink`
registration keep their exact positions and dependency arrays.

## BEFORE / AFTER (root file)

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `src/components/SurveyCadWorkspace.tsx` LOC | 1812 | 1600 | **-212 (-11.7%)** |
| Root primitive hook call sites (`useState`/`useRef`/`useMemo`/`useEffect`/`useCallback` with `<` or `(`) | 96 | 93 | **-3** |
| — `useState` | 40 | 40 | 0 |
| — `useRef` | 10 | 9 | -1 |
| — `useMemo` | 26 | 25 | -1 |
| — `useEffect` | 19 | 18 | -1 |
| — `useCallback` | 1 | 1 | 0 |
| Root custom (non-primitive) hook-call sites | 18 | 19 | **+1** |

The three primitive calls that moved are exactly the compose block's
`useRef(pendingComposeModeRef)` + `useMemo(composeService)` +
`useEffect(dispose)`; they are replaced by ONE unconditional custom-hook call at
the identical former render position. The four inquiry closures and the pick
handler are plain functions (never hooks), so hook order is unchanged.

The root remains above the repo 900-line guidance (1600 lines); this is the
sixth #194 slice and the root is smaller, not larger.

## New modules

| File | LOC | Responsibility |
| --- | ---: | --- |
| `src/hooks/surveyCad/useSurveyCadComposeLifecycle.ts` | 141 | The per-drawing `SurfaceComposeService`, its disposal effect, and the shared `pendingComposeModeRef` (`Map<pairKey, 'copy' \| 'paste'>`); the UI-owned `applyCompose` seam builds the payload-carrying `SURFCOMPOSE` / `SURFCOMPOSEPASTE` command and dispatches it through `cadWorkspace.runLayerCommand`. |
| `src/components/surveyCad/cadCivilInquiryHandlers.ts` | 177 | Pure `createCadCivilInquiryHandlers` factory returning the four read-only inquiry closures over explicit `project` / `surfaceCache` / `sectionCache` / `analysisSnapshot`. |
| `src/components/surveyCad/cadSurfacePickDispatch.ts` | 151 | Pure `createCadSurfacePickDispatch` factory returning the exact eight-stage `onSurfacePickPoint` handler. |

All three are UI-side; the engine never imports them. Largest is 177 lines
(repo warning 600, hard cap 900); largest exported function bodies are within
the 10-40 target band.

## Seam A — `useSurveyCadComposeLifecycle`

Args (grouped, typed): `drawingId`, `surfaceCache`,
`activeProjectForBuildsRef`, `drawingIdForBuildsRef`, `cadWorkspace`
(the live workspace seam; identity is a memo dependency), `setFileStatusText`.

Flattened primitive order at the former position:
`useRef(pendingComposeModeRef)` → `useMemo(composeService)` →
`useEffect(() => () => composeService.dispose(), [composeService])`. No new
state, no extra hooks.

Memo deps are the original `[drawingId, surfaceCache, cadWorkspace]`
(exhaustive-deps suppression preserved because the custom-hook setter/refs are
genuinely stable but unprovable). This preserves: a drawing switch, a fresh TIN
cache, or a fresh workspace identity replaces the service and disposes the old
one exactly once (StrictMode-safe via the idempotent `dispose` guard).

Preserved `applyCompose` contract (byte-for-byte):

- reads the CURRENT project from `activeProjectForBuildsRef.current` at
  completion time, then the first-match `.find` for base and overlay in
  `(project.surfaces ?? [])`;
- returns without consuming the pending mode when either source is missing;
- `key = ${base}|${overlay}`; mode defaults to `'copy'`;
- deletes the pending entry only AFTER both definitions resolve;
- builds `SURFCOMPOSEPASTE` for `paste`, else `SURFCOMPOSE`, with
  `computeCadSurfaceSourceRevision(project, base|overlay)` and
  `current: true` and `payload = { vertices, faces }`;
- `cadWorkspace.runLayerCommand(command)` is the only history seam (the service
  and worker never mutate history); a rejected / stale / locked commit is a
  no-op;
- exact status strings preserved (curly quotes / em dash):
  `Pasted “<overlay>” into “<base>”.`,
  `Composite copy created from “<base>” + “<overlay>”.`,
  `Compose rejected — a source revision moved or the target layer is locked.`

`pendingComposeModeRef` is the same shared ref the shell civil actions write
before `requestSurfaceCompose` and the APPLY seam consumes; it is stable across
unrelated rerenders.

### Worker URL parity

The original `new URL('../workers/surfaceWorker.ts', import.meta.url)` resolved
from `src/components/` to `src/workers/surfaceWorker.ts`. From
`src/hooks/surveyCad/` the same module is addressed as
`new URL('../../workers/surfaceWorker.ts', import.meta.url)`. Verified:

- `tests/cad_compose_lifecycle_1946.test.tsx` asserts the constructed `Worker`
  URL pathname ends with `/src/workers/surfaceWorker.ts`;
- the production build emits exactly one worker chunk,
  `dist/assets/surfaceWorker-YQANEhD9.js` (same hash as 194.4/194.5),
  referenced by the `survey-cad` chunk (the root's remain services dedupe to
  the same source module).

The `typeof Worker === 'undefined'` / construction-throw fallback to `null` is
byte-identical.

## Seam B — `createCadCivilInquiryHandlers`

`createCadCivilInquiryHandlers(context)` is a plain factory (called once per
render, never a hook, no memo, no singleton) returning the four originals with
identical signatures and strings:

- `describeAnalysisAt(analysisId, x, y)`: first-match map + snapshot-row lookup;
  `null` when either is absent; `queryAnalysisAt` outside-domain message;
  `UNCLASSIFIED (no band covers this value)` band fallback; elevation /
  signed-depth (`Δ … <side>`) / slope (`slope p% (d°)`) formatting.
- `describeVolumeDifference(volumeId, x, y)`: `volume?.name ?? volumeId`
  fallback plus `formatVolumeDifferenceAnswer` (null → the honest
  "no live source inquiry at point …" text).
- `describeSectionElevation(groupId, lineId, surfaceId, offset)`: group / line /
  surface / alignment gate, `formatCadStation(cadAlignmentRawStationToDisplayStation(...) ?? line.rawStation)`,
  signed offset, gap / outside-coverage wording; section cache stays read-only.
- `describeProfileElevation(profileId, displayStation)`: CURRENT-TIN gate via
  `surfaceCache.get(surface.id, surfaceContentRevision(project, surface))`,
  station-equation ambiguity (`resolveProfileStationInput == null`),
  snapped raw chainage, name + coords answer.

The factory receives the live `activeProject`, `surfaceCache`, `sectionCache`,
and `analysisSnapshot`; no invented CURRENT gate and no cache mutation.

## Seam C — `createCadSurfacePickDispatch`

`createCadSurfacePickDispatch(context)` is a pure factory (no React hooks, no
global registry, no render-time side effects). The root constructs it each
render (no `useMemo`) and passes grouped domain props:
`editSessions` (pointEdit / bulkSelection / bulkEdit / edit), `picks`
(blockInsertPick / analysisPick / volumePick / surfacePick), `project`,
`surfaceCache`, `inquiries` (the two inquiry closures), `runBlockOp`, and
`setters`.

Preserved EXACT eight-stage short-circuit precedence (earlier branch returns
immediately; idle pointer = no-op):

1. `surfacePointEditSessions.handlePick`,
2. `surfaceBulkSelection.handlePick`,
3. `surfaceBulkEditSessions.handlePick`,
4. `surfaceEditSessions.handlePick`,
5. block INSERT pick: `runBlockOp({ kind: 'insert', … })`; disarm only on
   `applied && !repeat` (a rejected or repeat insert stays armed),
6. analysis pick: answer stored only when non-null, pick ALWAYS cleared,
7. volume pick: same,
8. surface elevation / slope pick: slope routes `querySurfaceSlopeText` else
   `querySurfaceElevationText`; `setLastSurfaceInquiry` only on a non-null text;
   pick ALWAYS cleared.

The `surfacePickActive` prop, the renderer event/identity contract, the
select-state hooks, and `#183` pointer channel / `#186` viewport filter /
`#184` snapshot memo are unchanged.

## Preserved contracts

- Hook order: a single unconditional `useRef` + `useMemo` + `useEffect` triple
  at the former compose position; no new effects/state/hooks elsewhere.
- The two `shellLink` effects stay byte-identical; `pendingComposeModeRef` is
  still shared with the 97-action factory.
- The late analysis / volume / profile / section / surface deletion effects, the
  profile / section mesh-notify effects, the snapshot builders, and the
  `shellStarters` mapping keep their exact positions and dependency arrays.
- No viewport filtering, snapshot rerender, or idle setState behavior changes.
- No engine geometry / schema / hash / worker-protocol / persistence change.

## #194.7 roadmap (remaining)

1. `shellStarters` (~120 commands), the seven-field snapshot builder + its 12
   sub-builders, and the shell action manager wiring (`buildCadWorkspaceShellActions`).
2. Any remaining geometry/snapshot handler bodies that read the live workspace.
